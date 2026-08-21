# Page Performance → Performance Observatory — Architecture

## Evolution

| Version | Focus |
|---------|--------|
| v1 | Mongo wall-clock labels → flat page reports |
| v2 | Layered grades (DB / API / Payload / FE) + `pageBenchmarks[]` + shared backends |
| **v3 Observatory** | Registry-driven **Navigation / Feature / Action / Shared API** targets |

This is an **evolution**, not a rewrite. CLI and run-folder history are unchanged.

## Entry points

```bash
cd icm-backend
node --env-file=.env scripts/page-perf-benchmark.mjs
node scripts/generate-page-perf-reports.mjs          # latest run
node scripts/generate-page-perf-reports.mjs <stamp>  # specific run
```

| File | Role |
|------|------|
| `scripts/page-perf-benchmark.mjs` | Thin orchestrator: registry → mongo + action + API probes → enrich → write run folder |
| `scripts/generate-page-perf-reports.mjs` | Registry navigation pages + Observatory feature/action/shared API reports |
| `scripts/page-perf/registry/` | **Source of truth** for all benchmark targets |
| `scripts/page-perf/drivers/mongo-driver.mjs` | v1 metric labels (nav + feature) |
| `scripts/page-perf/drivers/action-driver.mjs` | Historical long-running job timings |
| `scripts/page-perf/api-probes.mjs` | Layer-2 controller probes |
| `scripts/page-perf/enrich-raw.mjs` | v2 `pageBenchmarks[]` |
| `scripts/page-perf/enrich-targets.mjs` | v3 `targetBenchmarks[]` + `sharedApiReports[]` |
| `scripts/page-perf/render-reports.mjs` | v2 page + README |
| `scripts/page-perf/render-observatory.mjs` | v3 feature/action/shared API + hierarchical README |
| `docs/page-performance/reports/<stamp>/` | Immutable history |

## Target kinds

```
Level 1  navigation   e.g. nav.applications          → Applications-performance-report.md
Level 2  feature      e.g. feat.applications.accounts → Feature-feat.applications.accounts-…
Level 3  action       e.g. act.applications.syncAd    → Action-act.applications.syncAd-…
Level 4  sharedApi    e.g. api.security.findings      → SharedAPI-api.security.findings-…
```

## Data shape (v3 additive)

```json
{
  "schemaVersion": 3,
  "registryVersion": 1,
  "results": [ /* v1 labels unchanged + new feature/action labels */ ],
  "pageBenchmarks": [ /* v2 navigation compat */ ],
  "sharedOptimizations": [ /* v2 */ ],
  "targetBenchmarks": [ /* all non-API targets with grades */ ],
  "sharedApiReports": [ /* declared + auto-detected APIs used by ≥2 targets */ ],
  "framework": { "name": "Wisibility Performance Observatory", "version": 3 }
}
```

## Compatibility

- Old run folders are never overwritten
- Regenerating v1/v2 raw still works (generator branches on `schemaVersion`)
- Navigation report filenames (`AllIdentities-performance-report.md`, …) unchanged
- `pageId` keys match Framework v2 exactly

## Extending the suite

1. Add a target under `registry/targets/` (`navigation`, `features/*`, `actions/*`, or `apis.mjs`)
2. If it needs a new Mongo/controller measurement, add a `metricLabel` handler in `drivers/mongo-driver.mjs` or `api-probes.mjs` / `action-driver.mjs`
3. Re-run harness + generator — **do not** hardcode pages into the generator

Discovery helper: `discover/from-application-tabs.mjs` lists ApplicationDetail tab keys vs registered feature ids.

## Grading

| Dimension | Used for |
|-----------|----------|
| Database | explain / docsExamined |
| API | controller p50 or mongo proxy |
| Payload | response bytes |
| Frontend | React Query, mount fan-out |
| Action | completion / success rate (actions only) |
| Overall | Worst of core layers (+ action when present) |
