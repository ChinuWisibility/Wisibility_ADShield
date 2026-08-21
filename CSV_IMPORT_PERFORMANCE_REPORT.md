# CSV Map & Import — Performance Report

Generated from Deloitte tenant (`IGA-V3`) benchmark runs of
`icm-backend/src/scripts/csvImport/benchmarkCsvMappedImport.js`.

Fixture: `/Users/dipankarkarmakar/Downloads/hr_users_master.csv` (5,000 rows).
Larger sizes synthesized with the same header schema.

## Budgets (hard gates)

| Users | Time budget | Memory budget | Result |
|------:|------------:|--------------:|--------|
| 5,000 | &lt; 5s | &lt; 500MB | **PASS** (3246 ms, ~336 MB) |
| 50,000 | &lt; 20s | &lt; 500MB | **PASS** (15721 ms, ~334 MB) |
| 100,000 | &lt; 45s | &lt; 900MB* | **PASS** (28575 ms, ~362 MB) |

\*100k retains full `rawData` projections; memory gate scaled to 900MB while time budget stays 45s.

## Before vs after (5,000 users)

| Metric | Legacy `runReconciliation` | Optimized `CsvMappedReconciliationStrategy` |
|--------|---------------------------:|--------------------------------------------:|
| Wall time | ≈ 22–28 s | **3.2 s** |
| Improvement | — | **~85–88%** |
| DB equivalence | — | **PASSED** |

## Stage timings (optimized, warm indexes)

### 5,000

| Stage | ms |
|-------|---:|
| Parse | 33 |
| Transform | 5 |
| Canonicalize | 79 |
| Hash partition | 48 |
| Snapshot ∥ Delta (wall) | 1396 |
| Users | 2656 |
| Sync state (baseline insertMany) | 300 |
| **Total recon** | **3144** |
| **HTTP-equivalent total** | **3246** |
| Rows/sec | 1540 |

### 50,000

| Stage | ms |
|-------|---:|
| Parse | 228 |
| Users | 11929 |
| Snapshot ∥ Delta (wall) | 7932 |
| Sync state | 2485 |
| **Total** | **15721** |
| Rows/sec | 3180 |

### 100,000

| Stage | ms |
|-------|---:|
| Parse | 418 |
| Users | 21679 |
| Snapshot ∥ Delta (wall) | 15499 |
| Sync state | 4535 |
| **Total** | **28575** |
| Rows/sec | 3500 |

## Execution DAG

```text
prepare (tenant, run, canonicalize, hash, pre-assign ObjectIds)
  → buildProjections
      → [parallel] Stage* + Snapshot + Delta + Users
      → SyncState (depends on Users)
      → finalize Run COMPLETED
* Stage skipped when hash reconciliation enabled (same as legacy).
```

## Mongo / network

- Remote Mongo (`db.wisibility.ai`) — RTT dominates; chunk **1000** × concurrency **8** overlaps latency.
- Native driver for **users + sync state** only (≥15% bulk ingest improvement vs Mongoose).
- Snapshot/Delta remain on Mongoose for identical casting vs legacy.
- Indexes ensured once per process (`ensureReconciliationIndexes` cache); PK unique index created before baseline insert when missing.

## Chunk throughput

| Setting | Value |
|---------|------:|
| `CSV_IMPORT_BULK_CHUNK` | 1000 |
| `CSV_IMPORT_BULK_CONCURRENCY` | 8 |
| Native driver | on (default; disable with `CSV_IMPORT_USE_NATIVE_DRIVER=0`) |

## Equivalence gate

Legacy vs optimized on 5k fixture:

- Counts: users / snapshots / deltas / sync states / duplicates match
- Semantic fields (PK payloads, hashes, run summary counts) match
- Normalized away: `runId`, wall-clock timestamps, per-app `applicationId`, sync `userId` ObjectIds

**Result: PASSED**

## Regression

- Unit tests: `csvMappedImportStrategy.test.js`, `csvUploadPerformance.test.js` — **10 passed**
- AD / connector / HRMS / strict CSV still use `runReconciliation` via existing ingest entrypoints (not `CsvMappedReconciliationStrategy`)
- Enterprise artifacts preserved: Runs, Snapshot, Delta, Sync State, Duplicates (hash path still skips Staging, same as legacy)

## How to re-run

```bash
cd icm-backend
node src/scripts/csvImport/benchmarkCsvMappedImport.js --sizes=5000,50000,100000
```

Exit code `0` = budgets + equivalence passed; `1` = gate failure.

Raw JSON: `CSV_IMPORT_BENCHMARK_RAW.json` (repo root).
