# AD Security Assessment Architecture — Implementation Deliverables

**Status:** Implemented (Assessment → Execution; versioning deferred)  
**Date:** 2026-07-22  
**Constraint:** Reuse `PostureScanResult` as Execution; no duplicate engine; no immutable versioning in this release  

---

## Hierarchy delivered

```
Assessment
  ↓
Execution  (= PostureScanResult + assessmentId)
  ↓
Findings
  ↓
Compare (same Assessment)
  ↓
Remediation (unchanged consumer of execution pairs)
```

---

## 1. Files reused

| File | Role |
|---|---|
| `postureOrchestrator.js` | Execution engine (unchanged modules) |
| `postureScanResultsStore.js` | Execution persistence |
| `securityFindingsService.js` compare fingerprint | Compare algorithm |
| `ScanCenterHeader.jsx` | App picker + execute controls |
| `AssessmentContextBar.jsx` | Context strip |
| `ScanCenterFeatureWorkspace.jsx` + LDAP panels | Feature configuration |
| `AssessmentComparePanel.jsx` | Compare UI |
| Remediation Center | Continues to use scan/execution ids |

---

## 2. Files extended

### Backend
- `models/security/PostureScanResult.js` — added `assessmentId` + indexes
- `services/posture/postureScanResultsStore.js` — persist/return `assessmentId`; list/count filter by assessment
- `services/posture/postureOrchestrator.js` — write `assessmentId` on payload
- `services/security/securityFindingsService.js` — compare same-Assessment guard
- `controllers/securityController.js` — Assessment CRUD; require `assessmentId` on run; list/compare filters
- `routes/securityRoutes.js` — Assessment routes

### Frontend
- `services/securityApi.js` — Assessment client methods
- `utils/securityNavigation.js` — `assessmentId` URL param
- `pages/security/SecurityWorkspaceContext.jsx` — `assessmentId` + require on `runScan`
- `pages/security/scans/ScanCenter.jsx` — Assessment gate + executions history
- `components/security/ScanCenterHeader.jsx` — `runDisabled`; Execute labels
- `components/security/AssessmentComparePanel.jsx` — filter/compare by Assessment
- `components/security/AssessmentContextBar.jsx` — already supports `extraChips` (prior)

---

## 3. Files created

| File | Purpose |
|---|---|
| `icm-backend/src/models/security/AdSecurityAssessment.js` | Assessment model |
| `icm-backend/src/services/security/assessmentService.js` | CRUD + status + orphan attach |
| `icm-frontend/src/components/security/AssessmentSelectionPanel.jsx` | Create / Open Assessment gate |
| `AD_SECURITY_ASSESSMENT_IMPLEMENTATION_DELIVERABLES.md` | This document |

---

## 4. Database changes

### New collection: `ad_security_assessments`

| Field | Type |
|---|---|
| `name`, `description`, `purpose` | String |
| `applicationId`, `tenantId` | ObjectId |
| `ownerUserId`, `createdBy` | ObjectId |
| `status` | `draft` \| `ready` \| `running` \| `completed` |
| `latestExecutionId` | String (`scanId`) |
| `executionCount` | Number |
| timestamps | createdAt / updatedAt |

### Extended: `posture_scan_results`

| Field | Notes |
|---|---|
| `assessmentId` | ObjectId → AdSecurityAssessment, **nullable** for legacy |

Indexes: `{ assessmentId, completedAt }`, `{ applicationId, assessmentId, completedAt }`

**No new execution collection.** No version collection (deferred).

---

## 5. API changes

| Method | Path | Change |
|---|---|---|
| GET | `/applications/:id/assessments` | **New** — list |
| POST | `/applications/:id/assessments` | **New** — create (`attachOrphanScans` optional) |
| GET | `/applications/:id/assessments/:assessmentId` | **New** |
| PATCH | `/applications/:id/assessments/:assessmentId` | **New** — metadata |
| POST | `.../assessments/:assessmentId/attach-orphan-scans` | **New** — migration helper |
| POST | `/applications/:id/scans/run` | **Requires** `assessmentId` |
| GET | `/applications/:id/scans` | Optional `?assessmentId=` |
| GET | `/applications/:id/scans/compare` | Optional `assessmentId`; rejects cross-Assessment pairs |

---

## 6. Migration strategy

1. **Additive schema** — `assessmentId` nullable; legacy scans keep working for Dashboard/Findings via `scanId`.
2. **Scan Center gate** — new executions require Assessment.
3. **Optional attach** — on Create Assessment, checkbox “Attach existing unlinked scan snapshots”, or `POST …/attach-orphan-scans`.
4. **Remediation** — no change; still compares execution (scan) pairs. Prefer pairs that share `assessmentId` when both are linked.
5. **Versioning** — not migrated; architecture leaves room for future `AssessmentVersion` without replacing Execution.

---

## 7. Validation report

| Check | Result |
|---|---|
| Assessment model + collection | Done |
| Execution = PostureScanResult + `assessmentId` | Done |
| `scanId` retained | Done |
| No second execution engine | Confirmed |
| No versioning / freeze | Confirmed out of scope |
| Scan Center: Assessment selection before Feature Workspace | Done |
| Config remains editable | Done |
| History = Assessment executions (filtered) | Done |
| Compare same Assessment | Done (API 400 on mismatch) |
| Remediation unchanged | Confirmed |
| Backend syntax check | Pass |

### Manual validation

1. Open Scan Center → select Application → see Assessment list (not Feature Workspace).
2. Create Assessment → Feature Workspace appears; Execute works; `assessmentId` on new scan doc.
3. Change Assessment → returns to selection.
4. Executions table lists only that Assessment’s scans.
5. Compare two executions of same Assessment → OK; different Assessments → 400.
6. Remediation Center still loads baseline/current scan ids.
7. Legacy scans without `assessmentId` remain readable; use attach helper to link.

---

## Explicitly deferred (prepare only)

- Assessment Versions
- Immutable configuration
- Frozen policy documents
- Read-only config mode for existing Assessments
