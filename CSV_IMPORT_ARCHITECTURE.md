# CSV Map & Import — Architecture

## Why CSV path differs from connector path

Map & Import (`uploadApplicationUsersCsvMapped`) is a high-volume, file-backed onboarding path. AD / universal connector / HRMS sync share the legacy `runReconciliation` orchestrator. CSV mapped import uses a dedicated **strategy** so performance work cannot regress connector pipelines.

## Before (call graph)

```text
ApplicationSchemaTab
  → POST /api/applications/:id/users/upload-mapped
    → uploadApplicationUsersCsvMapped
      → parseCsvBufferStreaming
      → buildUserDocsFromMappedRowsWithStats  (per-row header index rebuild)
      → display-name map (second O(n) pass)
      → strip entitlements list (third pass)
      → ingestApplicationUsersWithReconciliation
        → runReconciliation  (shared with AD/connectors)
          → canonicalize → hash partition
          → sequential staging → snapshot → delta → applyCanonicalUsers
          → post-upsert find($in) for ObjectIds
          → upsertIdentitySyncStateBatch
```

## After (call graph)

```text
ApplicationSchemaTab
  → POST /api/applications/:id/users/upload-mapped  (100MB multer; other uploads stay 10MB)
    → uploadApplicationUsersCsvMapped
      → runCsvImportEngine
          CompiledCsvMapper (compile once) → CanonicalAccount docs (single pass)
      → runCsvMappedReconciliation
          CsvMappedReconciliationStrategy lifecycle:
            prepare → buildExecutionGraph → execute → verify → finalize
```

AD / Universal / HRMS / Strict CSV continue to call `ingestApplicationUsersWithReconciliation` → `runReconciliation` unchanged (or via `LegacyReconciliationStrategy` / `ConnectorStrategy` adapters).

## Strategy lifecycle

```text
IReconciliationStrategy
  prepare()
  buildExecutionGraph()   ← strategy owns the DAG
  execute()
  verify()
  finalize()
```

`CsvMappedReconciliationStrategy` DAG (full apply):

```text
buildProjections
    ├─► persistStageSnapshotDelta  (Stage ∥ Snapshot ∥ Delta)
    └─► persistUsers               (pre-assigned ObjectIds; baseline insertMany)
            └─► persistSyncState   (baseline insertMany; else upsert batch)
                    └─► completeRun
```

Hash fast-path (unchanged file re-import): single `fastPath` node (touch sync state + complete run).

## New files

| Path | Role |
|------|------|
| `icm-backend/src/services/csvImport/compiledCsvMapper.js` | O(1) field mapping |
| `icm-backend/src/services/csvImport/csvImportEngine.js` | Parse / validate / transform once |
| `icm-backend/src/services/csvImport/bulkWritePool.js` | Chunked bulk + execution DAG runner |
| `icm-backend/src/services/csvImport/dbEquivalence.js` | Legacy vs optimized state compare |
| `icm-backend/src/services/reconciliation/strategies/*` | Strategy pattern |
| `icm-backend/src/services/reconciliation/generateRunId.js` | Shared run id helper |
| `icm-backend/src/scripts/csvImport/benchmarkCsvMappedImport.js` | Perf budgets + equivalence |
| `icm-backend/src/utils/csvMappedImportStrategy.test.js` | Unit tests |

## Modified files

| Path | Change |
|------|--------|
| `applicationController.js` | Wire CSV engine + `runCsvMappedReconciliation` |
| `applicationRoutes.js` | `uploadMapped` multer 100MB for mapped route only |
| `reconciliationOrchestrator.js` | Re-export `generateRunId` from helper (behavior unchanged) |

## Measured gain per change (5k warm, remote Mongo `IGA-V3`)

| Change | Approx impact |
|--------|----------------|
| CompiledCsvMapper + single-pass transform | Parse+transform ≈ 40ms (was multi-pass CPU) |
| Parallel Snapshot ∥ Delta ∥ Users DAG | Overlaps remote RTT |
| Pre-assigned ObjectIds (no post-find `$in`) | Removes ~⌈n/1000⌉ round-trips |
| Baseline SyncState `insertMany` | Sync state ~300ms vs ~4s upserts |
| Native driver for users + sync state | ≥15% bulk ingest win vs Mongoose |
| Chunk 1000 × concurrency 8 | Overlaps RTT (chunk=5000 left concurrency idle) |
| Skip PK index recreate when present | Avoids syncIndexes on hot path |

**Overall:** legacy ≈ 22–28s → optimized ≈ **3.2s** (5k); **15.7s** (50k); **28.6s** (100k).

## Persistence rule (native driver)

- **Users + IdentitySyncState:** native `collection.insertMany` / `bulkWrite` (default on; set `CSV_IMPORT_USE_NATIVE_DRIVER=0` to force Mongoose).
- **Snapshot / Delta / Staging:** Mongoose `insertMany` so casting matches legacy equivalence.

## Rollback plan

1. In `uploadApplicationUsersCsvMapped`, replace `runCsvMappedReconciliation(...)` with prior `ingestApplicationUsersWithReconciliation(...)` + old mapping loop (git history).
2. Revert mapped route to shared `upload` multer (10MB) if needed.
3. Leave strategy modules unused — AD/connector paths never imported them on the hot path.
4. No schema migrations required; collections and document shapes are unchanged.

## Equivalence

`benchmarkCsvMappedImport.js` runs legacy `ingestApplicationUsersWithReconciliation` vs optimized strategy on the same CSV, exports Users / Snapshot / Delta / SyncState / Runs / Duplicates, and fails on semantic mismatch (ignoring `runId`, timestamps, `applicationId`, `userId` pointers).
