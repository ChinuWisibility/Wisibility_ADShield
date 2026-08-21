# AD Security — Assessment-Centric Architecture Analysis

**Status:** Analysis only — awaiting approval before implementation  
**Date:** 2026-07-21  
**Scope:** Evolve AD Security Scan Center from scan-centric to Assessment-centric  
**Constraint:** Not a UI redesign; maximize reuse of existing Scan Center, finding engine, diagnostics, compare, investigation, and workflow integration

---

## Executive Verdict

Today, **“Assessment” is product language only**. The real business object is a **`PostureScanResult` scan run** (`scanId`), while **feature configuration lives in mutable per-application overrides**. Configuration can change between runs without versioning, so remediation comparison and historical reproducibility are architecturally unreliable.

The target architecture introduces a strict hierarchy:

**Application → Assessment → Assessment Version (immutable config) → Assessment Execution → Findings → Workflow / Remediation / Reassessment**

Existing Scan Center UI, Feature Registry, posture orchestrator, Findings Explorer, and compare fingerprinting should be **reused**, not rewritten — with the interaction flow gated behind Assessment selection, and `PostureScanResult` evolved into (or wrapped as) **Assessment Execution**.

---

## 1. Current Architecture

### 1.1 Business flow (as implemented)

```
Application (URL: applicationId)
    ↓
Scan Center opens immediately with Feature Configuration (editable)
    ↓
User edits Search Base / Scope / LDAP / toggles (persisted to app overrides)
    ↓
Run Scan / Run Feature  →  POST /scans/run
    ↓
PostureScanResult created (scanId)
    ↓
Workspace pins scanId  →  Findings / Overview / Investigation / Compare
```

There is **no Assessment entity**, **no Assessment Version**, and **no Assessment Execution** model. Scan history is a flat list of posture scans per application.

### 1.2 Frontend surfaces

| Surface | Path / Component | Role today |
|---|---|---|
| Workspace shell | `SecurityWorkspaceContext.jsx` | Pins `applicationId` + `scanId`; `runScan`; overview hydration |
| Scan Center | `pages/security/scans/ScanCenter.jsx` | App select → feature workspace + scan history |
| Feature workspace | `ScanCenterFeatureWorkspace.jsx` | Categories, feature list, detail panel, run controls |
| Feature actions | `hooks/useSecurityFeatureActions.js` | **Upserts config before scan**, builds `queryOverrides`, runs full/feature scan |
| Feature config UI | `FeatureQueryConfigurationPanel.jsx`, `SecurityFeatureDetailPanel.jsx` | Editable LDAP / Search Base / Scope |
| Assessment context | `AssessmentContextBar.jsx` | Displays app · scan time · findings (labels a **scan**, not an Assessment) |
| Compare | `AssessmentComparePanel.jsx` | Picks two `scanId`s (arbitrary app scans) |
| Findings | `FindingsExplorer.jsx` | Loads findings for pinned `scanId` |
| Dashboard / Summary | `SecurityDashboard.jsx` + overview API | Summary for pinned scan |
| Investigation | Finding detail / remediate button | Creates workflow tasks from findings |
| Routes | `SecurityCenter.jsx` | Nested security routes under workspace |

**Critical UX fact:** Feature configuration is available as soon as an application is selected. There is no “create or select Assessment” gate.

### 1.3 Backend surfaces

| Concern | Location |
|---|---|
| Routes | `icm-backend/src/routes/securityRoutes.js` |
| Controllers | `securityController.js`, `securityQueryController.js` |
| Scan orchestration | `services/posture/postureOrchestrator.js` |
| Scan persistence | `services/posture/postureScanResultsStore.js` |
| Feature registry | `services/posture/postureFeatureRegistry.js` (+ feature modules) |
| Query overrides | `services/security/applicationSecurityQueryService.js` |
| Findings / compare / overview | `services/security/securityFindingsService.js` |
| Policy scoring | `services/security/securityPolicyEngine.js` |

### 1.4 Persistence model (today)

#### `posture_scan_results` (`PostureScanResult`)

One document per scan run.

| Field | Notes |
|---|---|
| `scanId` | UUID; workspace URL key |
| `applicationId`, `tenantId` | Scope |
| `status`, `startedAt`, `completedAt` | Run timing |
| `findings` | Discovery findings (severity stripped for re-eval) |
| `scanConfig` | Partial: `scanSource`, `requestedFeatures`, `featureSettings` |
| `diagnostics` | Per-feature LDAP fossils (`ldapFilter`, `searchBase`, `searchScope`) |
| `policySnapshot` | Shallow: policy count + severity counts only |
| `summary`, `modules`, `results` | Aggregates / module blobs |

**Missing from `scanConfig`:** `queryOverrides`, enabled feature map, AD endpoint fingerprint, materialize flags, registry version, assessment linkage.

#### `application_security_query_overrides`

Unique on `{ applicationId, featureKey }`.

Mutable live config: `ldapFilter`, `searchBase`, `searchScope`, `enabled`. Shared across **all** future scans for that application. No version history. No link to a scan or assessment.

#### `Application.securityScanSettings`

Mutable thresholds (`inactiveUsersDays`, OS tokens, OU patterns, etc.) — also not versioned per assessment.

#### Policies

Loaded live at read/compare time via `resolvePoliciesForScan` / `loadSecurityPolicies`. Historical severity can drift if policies change after the scan.

### 1.5 What “Assessment” means today

| Product language | Actual data |
|---|---|
| Assessment context | Active `PostureScanResult` (`scanId`) |
| Assessment history | List of scans for an application |
| Use assessment | Pin `scanId` in URL |
| Assessment completed | Scan run finished |
| Assessment compare | Diff two scan finding sets |

**There is no `Assessment` mongoose model and no `assessmentId` anywhere in the security persistence layer.**

### 1.6 Run path (configuration drift vector)

1. User edits feature LDAP fields in Scan Center (always editable).
2. `runFeatureScan` calls `upsertFeatureConfig` **before** `runScan`.
3. Body may also send `queryOverrides` (merged with DB overrides; body wins).
4. Orchestrator persists a new `PostureScanResult` with incomplete `scanConfig`.
5. Later runs can use different filters/thresholds/features; prior scans do not reference a frozen config version.
6. Compare diffs fingerprints only — it does **not** verify that configs match.

### 1.7 Comparison model (today)

```
GET /security/applications/:applicationId/scans/compare?left=&right=
```

- Inputs: two `scanId`s (or latest two).
- Loads findings → re-scores with **live** policies → fingerprints `feature::dn::findingType|status`.
- Buckets: Resolved / New / Unchanged.
- No config equality check; no assessment/version constraint.

### 1.8 Findings & workflow (today)

- Findings belong to a **scan document**.
- Findings Explorer filters by category/feature within the pinned scan.
- Remediation creates `workflow_task_queue` items from finding identity (DN / feature / type), not from a first-class Assessment Execution identity beyond incidental scan metadata.

### 1.9 Shared state

- URL: `?applicationId=&scanId=`
- React Query keys: `["security", "feature-config", applicationId]`, `["security", "scans", ...]`, overview/findings keyed by app + scan.
- Feature registry remains the capability catalog (correct reuse target).

---

## 2. Problems Identified

### P1 — Assessment is not a first-class business object

“Assessment” is a label over `scanId`. There is no named Assessment with owner, purpose, lifecycle status, or version chain. Downstream modules (Findings Explorer, future Remediation Center, Reporting) cannot hang off Assessment as a stable product entity.

### P2 — Feature configuration precedes Assessment selection

Scan Center presents editable Feature Selection / Search Base / Scope / LDAP / Policies immediately after application selection. Users can scan without creating an Assessment. This inverts the target product hierarchy.

### P3 — Configuration drifts between executions

`ApplicationSecurityQueryOverride` and `Application.securityScanSettings` are mutable current state. Every scan for an application shares the same live config store. There is no immutable baseline tying “what was configured” to “what was executed.”

### P4 — Incomplete config snapshot on scan documents

Even if diagnostics preserve per-feature LDAP fossils, `scanConfig` does not persist full `queryOverrides`, enabled map, or policy documents. Reproducibility and auditability are partial and accidental.

### P5 — Policy scoring is not frozen to the run

Findings are stored as discovery facts and re-scored with live policies. Severity and matched policy can change after the fact, undermining Assessment as a historical posture record and remediation progress math.

### P6 — Assessment lifecycle is incomplete

There is no Draft → Configured → Ready → Running → Completed → Under Remediation → Reassessed → Closed state machine. Scan status is effectively `completed` (or UI running flag). Remediation and reassessment are not Assessment-level statuses.

### P7 — Execution history is loosely connected

Scan history is a flat list per application. There is no grouping by Assessment, no version lineage, no “executions of Version 1 of Quarterly Review.”

### P8 — Comparison operates on arbitrary scans

Users can compare any two scans for an application, including runs with different feature sets, Search Bases, or LDAP filters. That produces false “resolved/new” signals and breaks remediation progress semantics.

### P9 — Run path mutates config as a side effect

Single-feature run upserts overrides before scanning. Draft editing and Assessment definition are the same write path — there is no “edit draft Assessment” vs “execute frozen version” separation.

### P10 — Findings are not Assessment-Execution-native in the product model

Technically findings live under a scan. Product-wise, context bars and exports still speak in scan metadata. Future Remediation Center and reporting need Assessment / Version / Execution identity as first-class context.

### P11 — No versioning for configuration changes

Changing Search Base or adding Kerberos features silently mutates the live app config. There is no “Create New Version” path that preserves Version 1 history while opening Version 2.

### P12 — Future Remediation Center cannot consume a clean hierarchy

Without Assessment → Version → Execution → Comparison → Progress, Remediation Center would either invent a parallel model or keep treating scans as assessments (continuing the current ambiguity). This analysis must leave a clean consumption surface without implementing Remediation Center now.

---

## 3. Target Architecture

### 3.1 Business hierarchy (source of truth)

```
Application
  └── Assessment                          (named, owned, stateful business object)
        └── Assessment Version            (immutable configuration snapshot)
              └── Assessment Execution    (historical run / posture snapshot)
                    └── Findings          (belong to exactly one execution)
                          └── Workflow (0..1)
                                └── Queue Events
```

**Invariants (non-negotiable)**

1. No Assessment Version without an Assessment.
2. No Assessment Execution without an Assessment Version.
3. No Finding without an Assessment Execution.
4. Configuration inside a Version is immutable after publish/ready.
5. Configuration changes create a **new Assessment Version**.
6. Comparisons are allowed **only** between Executions of the **same Assessment Version**.
7. Reassessment always creates a **new Execution** (never mutates a prior Execution).

### 3.2 Conceptual mapping to existing code

| Target concept | Evolve from |
|---|---|
| Assessment | **New** entity (name, description, purpose, owner, status, applicationId) |
| Assessment Version | **New** immutable config document (frozen features, overrides, settings, policy snapshot docs) |
| Assessment Execution | **Evolve** `PostureScanResult` (keep engine; add FK links; treat `scanId` as `executionId` alias) |
| Findings | Existing findings array / read APIs — scoped via Execution |
| Working / Draft config | Existing `ApplicationSecurityQueryOverride` **or** draft fields on Assessment Version while status=Draft (prefer version-owned draft to stop app-global drift) |
| Feature Registry | Unchanged |
| Posture orchestrator | Unchanged core; receive frozen version config as input |
| Compare | Guard + rename semantics to Execution Comparison within Version |
| Scan Center UI | Same components; gate behind Assessment selection; read-only mode for existing versions |

### 3.3 Assessment Modes (product)

**Mode 1 — Create New Assessment**

- User supplies: name, description, purpose, application, owner.
- Configuration editable: features, Search Base/Scope, LDAP queries, policies bindings / feature settings.
- On save → Assessment created; Version 1 created (Draft → Configured → Ready).
- Execution controls available after Ready.

**Mode 2 — Open Existing Assessment**

- Metadata displayed.
- Configuration for the active Version is **read-only**.
- Interactive: Execute, Findings, History, Compare Executions, Summary, Investigation, Export, Delete Execution (if permitted).
- Config change request → **Create New Version** wizard (clones prior version config into editable draft Version N+1).

### 3.4 Scan Center restructuring (interaction only)

```
Application
  → Assessment Selection (list / create / continue)
  → Assessment Workspace (existing Scan Center feature UI)
       · New Assessment / Draft Version → config editable
       · Existing Ready/Completed Version → config read-only + execute
  → Execution → Findings / Compare / Investigation
```

Reuse: category list, feature list, diagnostics, summary, investigation, existing styling.  
Change: **when** config appears and **whether** it is editable.

### 3.5 Comparison model (target)

```
Assessment "Quarterly Review"
  Version 1
    Execution 1  ──compare──►  Execution 2
         └── Resolved / Remaining / New / Reopened / Progress
```

Reject cross-version compare at API level. Progress metrics feed future Remediation Center without further restructuring.

### 3.6 What stays out of scope (this program)

- Building Remediation Center UI
- Redesigning Scan Center visual language
- Replacing Feature Registry / finding discovery engines
- Rewriting workflow queue

Design must still expose Assessment / Version / Execution / Comparison / Progress as clean APIs for that future center.

---

## 4. Entity Relationship Diagram

```
┌─────────────────┐
│   Application   │
└────────┬────────┘
         │ 1
         │
         │ N
┌────────▼────────┐         ┌──────────────────────┐
│   Assessment    │─────────│  Owner (User)        │
│  assessmentId   │         └──────────────────────┘
│  applicationId  │
│  name           │
│  description    │
│  purpose        │
│  status         │◄── lifecycle state machine
│  currentVersion │
│  currentExec.   │
└────────┬────────┘
         │ 1
         │
         │ N
┌────────▼────────────────┐
│  AssessmentVersion      │
│  versionId              │
│  assessmentId           │
│  versionNumber          │
│  status (draft|frozen)  │
│  configSnapshot  ★      │  immutable after freeze
│   - features[]          │
│   - enabledMap          │
│   - queryOverrides{}    │
│   - featureSettings{}   │
│   - policySnapshotDocs  │
│   - registryFingerprint │
│  createdAt, createdBy   │
│  changeSummary          │
└────────┬────────────────┘
         │ 1
         │
         │ N
┌────────▼────────────────┐
│  AssessmentExecution    │  (evolved PostureScanResult)
│  executionId (=scanId)  │
│  assessmentId           │
│  versionId              │
│  status                 │
│  startedAt/completedAt  │
│  duration               │
│  findingCount           │
│  diagnostics            │
│  findings[]             │
│  summary                │
│  featureResults         │
│  executionLogs          │
└────────┬────────────────┘
         │ 1
         │
         │ N
┌────────▼────────────────┐
│  Finding                │  (embedded or projected)
│  findingKey / DN / type │
│  featureKey             │
│  severity (at exec)     │
└────────┬────────────────┘
         │ 0..1
┌────────▼────────────────┐
│  Workflow Task          │  existing workflow_task_queue
└────────┬────────────────┘
         │ 1
         │ N
┌────────▼────────────────┐
│  Queue Events           │
└─────────────────────────┘

★ configSnapshot is write-once after Version freeze.
  Compare(E1, E2) requires E1.versionId === E2.versionId.
```

### 4.1 Recommended collection strategy

| Collection | Strategy |
|---|---|
| `ad_security_assessments` | **New** |
| `ad_security_assessment_versions` | **New** |
| `posture_scan_results` | **Evolve in place** → become Assessment Executions (add `assessmentId`, `versionId`, keep `scanId` as `executionId`) |
| `application_security_query_overrides` | **Phase-down role**: draft helper only while creating/editing a Draft Version; freeze copies into `configSnapshot`; stop using as execution source of truth |
| Policies collections | Unchanged; **copy** relevant policy docs into version `policySnapshotDocs` at freeze time |

This maximizes reuse of the finding engine and avoids dual scan stores.

---

## 5. Assessment Lifecycle

### 5.1 States

| Status | Meaning |
|---|---|
| `Draft` | Assessment created; configuration incomplete |
| `Configured` | Configuration completed on current version |
| `Ready` | Version frozen; eligible for execution |
| `Running` | An execution is in progress |
| `Completed` | Latest execution finished successfully |
| `UnderRemediation` | Findings actively being remediated |
| `Reassessed` | A subsequent execution verified remediation progress |
| `Closed` | Lifecycle complete |

### 5.2 Transition diagram

```
Draft
  │ (config complete)
  ▼
Configured
  │ (freeze Version / user Ready)
  ▼
Ready
  │ (start execution)
  ▼
Running
  │ (execution success)
  ▼
Completed ──────────────┐
  │ (remediation starts) │
  ▼                      │
UnderRemediation         │
  │ (new execution)      │
  ▼                      │
Running → Completed      │
  │                      │
  ▼                      │
Reassessed ──────────────┤
  │ (more remediation)   │
  └→ UnderRemediation    │
  │                      │
  │ (explicit close)     │
  ▼                      │
Closed ◄─────────────────┘
```

### 5.3 Business rules

1. Prefer **automatic** transitions where signals exist (execution start/complete; optional remediation-task activity; reassessment execution complete).
2. Multiple executions per Assessment (and per Version) are allowed.
3. Assessment may re-enter `UnderRemediation` multiple times.
4. Reassessment always creates a **new Execution** under the **same Version** (unless config changed → new Version first).
5. Assessment Versions are immutable after freeze (`Ready` and beyond for that version).
6. Creating Version N+1 sets Assessment back toward `Draft`/`Configured`/`Ready` for the new version without deleting prior versions or their executions.
7. `Closed` is terminal for the Assessment business lifecycle (executions remain readable).

### 5.4 Status ownership

| Event | Status effect |
|---|---|
| Create Assessment | `Draft` |
| Save complete config | `Configured` |
| Freeze version | Version frozen; Assessment `Ready` |
| Start execution | `Running` |
| Execution success | `Completed` |
| First remediation workflow opened (future hook) | `UnderRemediation` |
| New execution after remediation | `Running` → `Completed` → `Reassessed` |
| User closes | `Closed` |

Until Remediation Center exists, `UnderRemediation` may be set when any finding-linked workflow is active, or left as a soft/manual transition — decide in Phase 2 implementation detail; architecture must support both.

---

## 6. Frontend Changes

### 6.1 Principles

- **Do not redesign** Scan Center visual language.
- Reuse `ScanCenterFeatureWorkspace`, category/feature lists, detail panel, diagnostics, AssessmentContextBar (extend fields), Findings Explorer, compare panel.
- Change **flow and editability**, not chrome.

### 6.2 New / evolved UX modules

| Module | Change |
|---|---|
| **Assessment Selection** | New gate after Application: list assessments, Create New, Continue Existing |
| **Assessment Create** | Form: name, description, purpose, owner; then enter editable workspace |
| **Assessment Workspace** | Existing Scan Center body, bound to Assessment + Version |
| **Config mode** | Editable only for Draft/new Version; otherwise read-only |
| **Create New Version** | Action when user attempts to edit frozen config |
| **Execution History** | Grouped under Assessment/Version (reuse scan history table with new columns) |
| **AssessmentContextBar** | Show Assessment · Version · Execution (not only scan time) |
| **Findings Explorer** | Require/display Assessment + Version + Execution context |
| **Compare panel** | Execution picker constrained to same Version |
| **SecurityWorkspaceContext** | Hold `assessmentId`, `versionId`, `executionId` (`scanId` alias) |

### 6.3 Scan Center flow (target)

```
[Application select]
        ↓
[Assessment Selection]
   ├─ Create New Assessment → Draft Version (editable config)
   └─ Open Existing → read-only config + execute / history / compare
        ↓
[Assessment Workspace = existing feature UI]
        ↓
[Execute] → pins Execution → Findings / Summary / Investigation
```

Feature Configuration section **must not render** until an Assessment is selected or created.

### 6.4 Editability matrix

| Control | New Assessment / Draft Version | Existing Frozen Version |
|---|---|---|
| Feature toggles | Editable | Read-only |
| Search Base / Scope / LDAP | Editable | Read-only |
| Feature settings / thresholds | Editable | Read-only |
| Execute Assessment | After Ready | Enabled |
| View Findings / History / Compare / Export | After first execution | Enabled |
| Create New Version | N/A | Enabled |
| Delete Execution | Policy-gated | Policy-gated |

### 6.5 Hooks & API client

- Extend `securityApi.js` with Assessment / Version / Execution endpoints.
- Split `useSecurityFeatureActions`:
  - Draft: save to Version draft config (not global app overrides as source of truth).
  - Execute: send Version id; server loads frozen snapshot (no upsert-before-run for frozen versions).
- Preserve React Query patterns; key by `assessmentId` / `versionId` / `executionId`.

### 6.6 Routes / URL contract (proposed)

```
?applicationId=
&assessmentId=
&versionId=
&executionId=   (alias: scanId for backward compatibility)
```

Deep links that only have `scanId` resolve Assessment/Version via Execution lookup during migration.

---

## 7. Backend Changes

### 7.1 New services (thin orchestration; reuse engines)

| Service | Responsibility |
|---|---|
| `assessmentService` | CRUD Assessment, lifecycle transitions |
| `assessmentVersionService` | Create draft version, freeze, clone-to-new-version, immutability enforcement |
| `assessmentExecutionService` | Start execution from frozen version → call existing `runPostureScan` with snapshot options → persist as Execution |
| `assessmentCompareService` | Wrap `compareSecurityScans` with same-version guard + progress metrics |

### 7.2 Existing services (reuse with adapters)

| Existing | Change |
|---|---|
| `postureOrchestrator.runPostureScan` | Accept frozen `queryOverrides` / `featureSettings` / feature list from Version; enrich `scanConfig` + full policy docs |
| `postureScanResultsStore` | Persist `assessmentId`, `versionId`; treat document as Execution |
| `applicationSecurityQueryService` | Optional hydrate for Draft only; stop being execution authority |
| `securityFindingsService` | Prefer execution-scoped findings; freeze scoring at write time **or** re-score against Version `policySnapshotDocs` |
| `securityController` | Add Assessment controllers; keep scan routes as compatibility aliases |
| Feature Registry / LDAP / Graph modules | **No rewrite** |

### 7.3 Immutability enforcement

- Version freeze copies working config + policy documents into `configSnapshot`.
- API rejects PATCH of frozen version config fields.
- Execution start loads config **only** from Version snapshot (ignore live app overrides).
- Soft-delete executions allowed; never mutate findings of a completed execution (except explicit admin repair tooling).

### 7.4 Policy freeze strategy (recommended)

At Version freeze (or Execution start — prefer **Version freeze** for config, **Execution start** for policy if policies are shared globally):

**Recommended:** Freeze policies at **Version freeze** into `policySnapshotDocs`, and score findings at execution using that snapshot. Read/compare paths use the same snapshot — eliminates severity drift (addresses P5).

Fallback for Phase 1 compatibility: continue live re-score but store `policyFingerprint` and warn on drift. Target end-state is frozen scoring.

---

## 8. Database Changes

### 8.1 New: `ad_security_assessments`

```
assessmentId (ObjectId)
tenantId
applicationId
name
description
purpose
ownerUserId
status: Draft|Configured|Ready|Running|Completed|UnderRemediation|Reassessed|Closed
currentVersionId
latestExecutionId
createdAt, updatedAt, closedAt
```

Indexes: `{ applicationId, updatedAt }`, `{ tenantId, applicationId, status }`.

### 8.2 New: `ad_security_assessment_versions`

```
versionId (ObjectId)
assessmentId
versionNumber (int, unique per assessment)
status: draft | frozen
changeSummary
configSnapshot: {
  features: [featureKey],
  enabledMap: { featureKey: bool },
  queryOverrides: { featureKey: { ldapFilter, searchBase, searchScope } },
  featureSettings: { ... },
  policySnapshotDocs: [ ... ],   // full docs used for scoring
  registryFingerprint: string,
  adEndpointFingerprint?: string
}
createdBy
createdAt
frozenAt
```

Indexes: `{ assessmentId, versionNumber }` unique.

**Immutability:** application-level update filter rejects changes to `configSnapshot` when `status === 'frozen'`.

### 8.3 Evolve: `posture_scan_results` → Assessment Execution

Add:

```
assessmentId
versionId
executionNumber (optional, per version)
executionStatus (running|completed|failed)  // align with existing status
durationMs
```

Keep: `scanId` as public `executionId`, findings, diagnostics, summary, modules, results.

Enrich `scanConfig` on write to include full overrides used (copy from version snapshot).

Indexes: `{ assessmentId, completedAt }`, `{ versionId, completedAt }`, `{ applicationId, assessmentId, completedAt }`.

### 8.4 Deprecate-as-authority: `application_security_query_overrides`

- Remain for migration and optional draft UX convenience.
- After Phase 3+, Draft Version owns config; overrides either sync from draft or become unused for Scan Center.
- Do not delete collection in early phases (backward compatibility).

---

## 9. API Changes

### 9.1 New Assessment APIs (proposed)

| Method | Path | Purpose |
|---|---|---|
| GET | `/security/applications/:applicationId/assessments` | List assessments |
| POST | `/security/applications/:applicationId/assessments` | Create Assessment (+ Version 1 draft) |
| GET | `/security/assessments/:assessmentId` | Get Assessment + current version summary |
| PATCH | `/security/assessments/:assessmentId` | Metadata / lifecycle (not config) |
| POST | `/security/assessments/:assessmentId/versions` | Create New Version (clone) |
| GET | `/security/assessments/:assessmentId/versions` | Version history |
| GET | `/security/assessment-versions/:versionId` | Get version + config |
| PATCH | `/security/assessment-versions/:versionId` | Update **draft** config only |
| POST | `/security/assessment-versions/:versionId/freeze` | Freeze → Ready |
| POST | `/security/assessment-versions/:versionId/executions` | Execute Assessment |
| GET | `/security/assessment-versions/:versionId/executions` | Execution history |
| GET | `/security/executions/:executionId` | Execution detail (alias of scan get) |
| GET | `/security/assessment-versions/:versionId/executions/compare` | Compare two executions (same version enforced) |
| GET | `/security/executions/:executionId/findings` | Findings for execution |

### 9.2 Compatibility aliases (preserve)

| Existing | Behavior during migration |
|---|---|
| `POST .../scans/run` | If Assessment context provided → create Execution under Version; else legacy path (flag-gated / eventually reject) |
| `GET .../scans` | Filter by assessment/version when provided; else app-level list |
| `GET .../scans/compare` | Add validation: if both scans have `versionId`, require equality; return 400 on mismatch |
| `GET .../findings` | Resolve via executionId; attach Assessment context in response |
| Feature-config GET/PUT | Allowed only for Draft Version mapping or legacy apps until cutover |

### 9.3 Compare response (evolve, not replace)

Keep existing fingerprint buckets; extend:

```
{
  assessmentId, versionId,
  leftExecutionId, rightExecutionId,
  counts: { resolved, remaining, new, reopened, unchanged },
  progress: { percentResolved, netChange },
  items: { ... samples }
}
```

`reopened` can be derived when a fingerprint was resolved in an intermediate execution and reappears — Phase 8 detail.

### 9.4 Success criterion for APIs

Clients of future Remediation Center / Reporting should only need Assessment / Version / Execution / Compare / Progress — not raw mutable overrides.

---

## 10. Migration Strategy

### 10.1 Goals

- Zero downtime for existing Scan Center users during phased rollout.
- Preserve all historical `posture_scan_results`.
- Avoid dual finding engines.
- Make new Assessment path default once Phase 4–6 land.

### 10.2 Steps

1. **Schema additive only**  
   Add Assessment + Version collections; add nullable `assessmentId` / `versionId` on existing scan docs.

2. **Backfill (optional / on-read)**  
   For each application with historical scans:
   - Create a synthetic Assessment: `"Legacy scans — {appName}"`.
   - Create Version 1 with `configSnapshot` best-effort reconstructed from latest diagnostics / scanConfig (mark `migrated: true`, possibly `incompleteConfig: true`).
   - Attach historical scans as Executions under that Version **only when** diagnostics suggest compatible config; otherwise attach under Version with `configUnknown: true` and **disable compare** until user creates a clean Version 2.

   *Pragmatic alternative:* Do not auto-group legacy scans into one Version. Create Assessment shells per application and leave old scans as `executionId` without version compare eligibility until user starts a new Version. Prefer this if reconstruction is too lossy.

3. **Dual-write period**  
   New UI writes Assessment/Version/Execution. Legacy `scans/run` still works behind feature flag `AD_SECURITY_ASSESSMENT_REQUIRED=false`.

4. **Cutover**  
   Set `AD_SECURITY_ASSESSMENT_REQUIRED=true`: Scan Center requires Assessment selection; `scans/run` without versionId returns 400.

5. **Overrides demotion**  
   Stop writing app-global overrides from frozen executions; optional cleanup job later.

6. **Policy freeze**  
   Enable full `policySnapshotDocs` after scoring path is wired; until then store fingerprint + counts.

### 10.3 Data risk notes

- Incomplete historical config is expected — document in Version metadata.
- Cross-scan compares that previously spanned drifted configs should be blocked once version linking exists.
- Findings re-score drift: address with policy freeze before marketing “immutable Assessment results.”

---

## 11. Backward Compatibility Plan

| Area | Plan |
|---|---|
| Feature Registry | Unchanged |
| Finding discovery engines | Unchanged |
| Diagnostics | Unchanged; also copied under Execution |
| Summary / Overview APIs | Keep; enrich with Assessment context fields |
| Investigation / Remediate | Keep; pass executionId + assessmentId in metadata |
| Workflow / remediation queue | Keep; optional new fields on task payload |
| Shared components | Reuse; add readOnly prop / context providers |
| Routes | Keep security routes; add Assessment routes |
| `scanId` URL | Alias of `executionId` indefinitely |
| Compare fingerprint algorithm | Reuse; add guards + progress fields |
| Legacy scans without Assessment | Readable; execution/compare limited until migrated |
| Feature-config APIs | Remain for Draft/legacy; not used as execution authority after cutover |

**Avoid:** Parallel Scan Center, duplicate orchestrator, second findings store, rewriting LDAP modules.

---

## 12. Implementation Phases

Aligned to the requested phases; each phase should be independently demoable and mergeable.

### Phase 1 — Architecture Refactoring

- Introduce Assessment domain module boundaries (services, models folders).
- Extract “config used at run” assembly from FE upsert-before-run into a server-side “resolve execution config” helper.
- Enrich `scanConfig` persistence to include `queryOverrides` actually used (additive).
- Feature flag scaffolding: `AD_SECURITY_ASSESSMENT_CENTRIC`.
- **No UX gate yet.**

### Phase 2 — Assessment Entity

- Models + CRUD APIs for Assessment.
- Lifecycle status field + transition helpers.
- Wire Assessment list APIs.
- Minimal FE Assessment Selection page (behind flag) without blocking old flow.

### Phase 3 — Assessment Versioning

- Version model; draft update; freeze; clone-to-new-version.
- Immutability enforcement on frozen versions.
- Config snapshot schema includes features, overrides, settings, policy docs (or fingerprint initially).
- Stop treating app overrides as source of truth when Version is frozen.

### Phase 4 — Assessment Selection Experience

- Scan Center: Application → Assessment Selection → Create / Continue.
- Hide Feature Configuration until Assessment selected/created.
- Preserve visual language of existing components.

### Phase 5 — Assessment Workspace

- Bind existing feature workspace to Assessment + Version.
- Editable vs read-only modes.
- “Create New Version” instead of edit-on-frozen.
- AssessmentContextBar shows Assessment · Version · Execution.

### Phase 6 — Execution Model

- `POST .../executions` runs posture orchestrator from frozen snapshot.
- Persist `assessmentId` / `versionId` on `posture_scan_results`.
- Assessment status transitions: Ready → Running → Completed.
- Execution history UI under Assessment Workspace.
- Remove upsert-before-run for frozen versions.

### Phase 7 — Findings Integration

- Findings Explorer / Overview require Execution context under Assessment.
- Context bar and exports include Assessment / Version / Execution.
- Ensure no finding API path is Assessment-orphaned for new runs.

### Phase 8 — Comparison Refactoring

- Compare only within same `versionId`.
- UI picker constrained to Version executions.
- Progress metrics (resolved / remaining / new / reopened).
- API 400 on cross-version compare.
- Design Progress DTO for future Remediation Center consumption.

### Phase 9 — Validation

- Automated tests: lifecycle transitions, immutability, same-version compare guard, execution requires version, findings linkage.
- Migration dry-run on sample tenant data.
- Flag cutover checklist.
- Regression: feature registry scans, diagnostics, investigation, workflow create still work.
- Confirm Scan Center visual parity (interaction flow only).

---

## Success Criteria (Acceptance)

| Criterion | Met when |
|---|---|
| Assessment is central | All new AD Security runs require Assessment + Version |
| No scan without Assessment | FE gate + BE reject when flag on |
| Config immutable after creation/freeze | PATCH frozen version returns 400; Execute uses snapshot only |
| Config changes → new Version | Clone path only; history preserved |
| Executions are historical snapshots | New run = new Execution; prior findings untouched |
| Findings belong to Executions | Every new finding doc/path has `executionId` + `assessmentId` + `versionId` |
| Compare same Version only | API + UI enforced |
| UI largely preserved | Existing Scan Center components reused; flow gated |
| Remediation-ready | Progress/Compare/Execution APIs sufficient for future Remediation Center without model rewrite |
| Maximize reuse | Orchestrator, registry, findings engine, workflow integration retained |

---

## Recommended Decision Points (for approval)

Before coding, confirm:

1. **Legacy scan grouping:** Synthetic Assessment + incomplete Version vs orphan legacy executions (no compare) until new Version — **recommend orphan-safe approach**.
2. **Policy freeze timing:** At Version freeze (recommended) vs Execution start vs keep live re-score temporarily.
3. **Draft config storage:** Version draft document only (recommended) vs continue writing `application_security_query_overrides` during draft.
4. **UnderRemediation auto-transition:** Hook to workflow activity now vs defer until Remediation Center.
5. **Flag default:** Ship Phases 1–3 dark; enable Selection gate when Phase 4–6 ready.

---

## Appendix A — Key file map (current)

| Concern | Path |
|---|---|
| Scan model | `icm-backend/src/models/security/PostureScanResult.js` |
| Override model | `icm-backend/src/models/security/ApplicationSecurityQueryOverride.js` |
| Orchestrator | `icm-backend/src/services/posture/postureOrchestrator.js` |
| Scan store | `icm-backend/src/services/posture/postureScanResultsStore.js` |
| Findings / compare | `icm-backend/src/services/security/securityFindingsService.js` |
| Query overrides | `icm-backend/src/services/security/applicationSecurityQueryService.js` |
| Security routes | `icm-backend/src/routes/securityRoutes.js` |
| Scan Center | `icm-frontend/src/pages/security/scans/ScanCenter.jsx` |
| Feature workspace | `icm-frontend/src/components/security/ScanCenterFeatureWorkspace.jsx` |
| Feature actions | `icm-frontend/src/hooks/useSecurityFeatureActions.js` |
| Workspace context | `icm-frontend/src/pages/security/SecurityWorkspaceContext.jsx` |
| Context bar | `icm-frontend/src/components/security/AssessmentContextBar.jsx` |
| Compare UI | `icm-frontend/src/components/security/AssessmentComparePanel.jsx` |
| Findings | `icm-frontend/src/pages/security/findings/FindingsExplorer.jsx` |
| Related remediation analysis | `AD_SECURITY_REMEDIATION_ARCHITECTURE_ANALYSIS.md` |

## Appendix B — Relationship to Remediation Architecture

This document defines the **Assessment spine**.  
`AD_SECURITY_REMEDIATION_ARCHITECTURE_ANALYSIS.md` defines how a future Remediation Center composes hygiene-like UX over security findings and workflows.

**Dependency:** Remediation Center should consume Assessment → Version → Execution → Comparison → Progress from this model. Implementing Remediation before Assessment-centricity would entrench scan-centric ambiguity.

---

**Next step:** Await explicit approval of this analysis (and the decision points in the Recommended Decision Points section). No implementation until approved.
`)