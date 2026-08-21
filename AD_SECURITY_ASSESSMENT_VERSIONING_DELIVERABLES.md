# AD Security Assessment Versioning — Implementation Deliverables

## 1. Architecture Mapping

```
Application
  └── Assessment                    (business object — name, purpose, owner, status)
        └── Assessment Version      (immutable configuration authority)
              └── Execution         (PostureScanResult + assessmentVersionId)
                    └── Findings
                          └── Compare (same Version only)
                                └── Remediation
```

| Layer | Owns | Does not own |
|---|---|---|
| Assessment | Versions, lifecycle status | Configuration |
| Assessment Version | Frozen `configSnapshot` | Findings / runtime |
| Execution (`PostureScanResult`) | Timing, status, findings, diagnostics | Configuration |
| Application overrides | Draft working configuration | Execution authority |

**Execution rule:** Run reads configuration only from the Assessment Version snapshot. Mutable application overrides are never used at execute time.

---

## 2. Files Reused

- `ScanCenterFeatureWorkspace`, `FeatureQueryConfigurationPanel`, `SecurityFeatureDetailPanel`
- `AssessmentContextBar`, `ScanCenterHeader`, `SecurityWorkspaceProvider`
- `AssessmentComparePanel`, `AssessmentSelectionPanel`
- `postureOrchestrator`, `postureScanResultsStore`, `securityFindingsService`
- `applicationSecurityQueryService` (`buildFeatureConfigPayload` for snapshot source)
- Feature Registry, LDAP modules, existing scan pipeline
- Remediation Center (consumes compare; now same-version pairs)

---

## 3. Files Extended

| File | Change |
|---|---|
| `PostureScanResult.js` | `assessmentVersionId` |
| `AdSecurityAssessment.js` | Lifecycle statuses (`configured`, `under_remediation`, …) |
| `postureScanResultsStore.js` | Persist/list/count by `assessmentVersionId` |
| `postureOrchestrator.js` | Pass `assessmentVersionId` into payload / `scanConfig` |
| `securityFindingsService.js` | Cross-version compare guard |
| `securityController.js` | Version CRUD; execute from snapshot |
| `securityRoutes.js` | Version routes |
| `securityRemediationSummaryService.js` | Prefer same-version execution pairs |
| `SecurityWorkspaceContext.jsx` | `versionId`, save/run Version |
| `ScanCenter.jsx` | Version selection gate, Save Version, read-only mode |
| `ScanCenterHeader.jsx` | Save Version / Execute Version |
| `AssessmentContextBar.jsx` | Version field |
| `AssessmentComparePanel.jsx` | Scope by `versionId` |
| `FeatureQueryConfigurationPanel.jsx` / `SecurityFeatureDetailPanel.jsx` / `ScanCenterFeatureWorkspace.jsx` | `readOnly` |
| `securityApi.js` / `securityNavigation.js` | Version APIs + `versionId` query param |

---

## 4. Files Created

| File | Purpose |
|---|---|
| `icm-backend/src/models/security/AdSecurityAssessmentVersion.js` | Version model |
| `icm-backend/src/services/security/assessmentVersionService.js` | Snapshot build/save/execute helpers + legacy Version 0 |
| `icm-backend/src/services/security/assessmentVersionService.test.js` | Unit checks |
| `icm-frontend/src/components/security/AssessmentVersionSelectionPanel.jsx` | Create / Open Version gate |
| `AD_SECURITY_ASSESSMENT_VERSIONING_DELIVERABLES.md` | This document |

---

## 5. Frontend Changes

**Scan Center workflow**

1. Select Assessment  
2. Select / Create Assessment Version  
3. Draft → edit Feature Workspace (writes draft working config = application overrides)  
4. **Save Version** → freezes snapshot; workspace becomes read-only  
5. **Execute Version** → new `PostureScanResult` bound to Version  
6. History lists executions for the open Version  

**URL params:** `applicationId` + `assessmentId` + `versionId` + `scanId`

---

## 6. Backend Changes

- Version CRUD, save (freeze), config load, execute alias
- `POST …/scans/run` requires `assessmentId` **and** `assessmentVersionId`
- Query overrides / enabled features come from `configSnapshot` only
- Compare rejects cross-version pairs (`ASSESSMENT_VERSION_COMPARE_MISMATCH`)

---

## 7. Database Changes

**Collection:** `ad_security_assessment_versions`

Key fields: `assessmentId`, `applicationId`, `versionNumber`, `status` (`draft|saved|executed|archived`), `configSnapshot`, `executionCount`, `latestExecutionId`, `savedAt`, `createdBy`

**Indexes:** unique `(assessmentId, versionNumber)`; `(assessmentVersionId, completedAt)` on executions

**`PostureScanResult`:** additive nullable `assessmentVersionId`

---

## 8. API Changes

| Method | Path |
|---|---|
| GET | `/assessments/:assessmentId/versions` |
| POST | `/assessments/:assessmentId/versions` |
| GET | `/assessments/:assessmentId/versions/:versionId` |
| POST | `/…/versions/:versionId/save` |
| GET | `/…/versions/:versionId/config` |
| POST | `/…/versions/:versionId/execute` |
| POST | `/assessments/:assessmentId/migrate-legacy-versions` |

Extended: `GET …/scans?assessmentVersionId=`, `GET …/scans/compare?assessmentVersionId=`

Existing Assessment / Findings / Dashboard / Remediation routes preserved.

---

## 9. Migration Strategy

1. Existing Assessments continue to work.  
2. `migrate-legacy-versions` (also invoked when listing versions in Scan Center) creates **Version 0** and attaches executions missing `assessmentVersionId`.  
3. Version 0 snapshot is marked `migrated: true` (incomplete config; execute of Version 0 is allowed only if status is executed/saved with a snapshot — Version 0 is `executed` with empty feature list; new work should Create Version 1).  
4. Dashboard / Findings remain keyed by `scanId` and are unchanged.

---

## 10. Validation Report

| Check | Status |
|---|---|
| Assessment Version model + indexes | Done |
| Snapshot from draft working config | Done |
| Save freezes; draft not executable | Done (unit + API) |
| Execute binds `assessmentVersionId` | Done |
| Open saved Version → read-only UI | Done |
| Executions listed per Version | Done |
| Compare same Version | Done |
| Reject cross-Version compare | Done |
| Remediation prefers same-Version pair | Done |
| Unit: `assessmentVersionService.test.js` | PASS |
| Syntax check on changed backend modules | PASS |

Manual UI validation still recommended on a live AD application (Create → Save → Execute ×2 → Compare → Remediation).

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Legacy executions lack version | Version 0 migration |
| Remediation previously compared newest two scans across versions | Same-version pair picker |
| Users expect draft to run | Explicit Save Version + disabled Execute |
| Empty Version 0 snapshot not useful for re-execute | Prompt Create Version for new baselines |
| Feature settings in snapshot vs live app | Snapshot copies `securityScanSettings` at save; connection credentials still from Application |

---

## 12. Future Enhancements

- Policy snapshot reference freeze at Save Version  
- Diff UI between Version N and N+1 configuration  
- Archive Versions; promote “baseline” Version  
- Clone Version → new draft with copied snapshot  
- Expand Version accordion in History (all Versions + nested executions)  
- Export Version snapshot as JSON for audit
