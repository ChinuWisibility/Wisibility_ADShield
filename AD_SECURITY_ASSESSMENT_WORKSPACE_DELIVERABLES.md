# AD Security Assessment Workspace — Working Configuration + Auto-Versioning

## 1. Updated Architecture Diagram

```
Application
    │
    ▼
Assessment
    │
    ├── Working Configuration   (editable draft — owned by Assessment)
    │         │
    │         │ Execute Assessment
    │         ▼
    │   ┌─ config unchanged? ──► reuse latest Assessment Version
    │   └─ config changed?   ──► freeze → create Version N+1
    │
    └── Assessment Version (immutable snapshot — system-generated)
              │
              ▼
        Execution (PostureScanResult)
              │
              ▼
        Findings → Compare (same Version) → Remediation
```

| Concept | Role |
|---|---|
| Assessment | Business object |
| Working Configuration | Editable draft; never execution authority |
| Assessment Version | Immutable configuration snapshot |
| Execution | Historical measurement bound to a Version |

Users never create or edit Versions. Execute Assessment decides reuse vs auto-freeze.

---

## 2. Files Reused

- `ScanCenterFeatureWorkspace`, `FeatureQueryConfigurationPanel`, `SecurityFeatureDetailPanel`
- `AssessmentContextBar`, `AssessmentSelectionPanel`, `AssessmentComparePanel`, `ScanCenterHeader`
- `SecurityWorkspaceProvider`, Feature Registry, LDAP modules
- `postureOrchestrator`, `postureScanResultsStore`, `securityFindingsService`
- Remediation Center, Findings Explorer, Dashboard

---

## 3. Files Extended

| File | Change |
|---|---|
| `AdSecurityAssessment.js` | `workingConfiguration`, `latestVersionId/Number` |
| `AdSecurityAssessmentVersion.js` | Immutable-only (no draft lifecycle); `contentFingerprint`, `createdFromVersionId` |
| `assessmentService.js` | Seed Working Configuration on create |
| `assessmentVersionService.js` | Working config CRUD, fingerprint, `resolveVersionForExecution` |
| `securityController.js` / `securityRoutes.js` | Working-config APIs; Execute auto-versions |
| `useSecurityFeatureActions.js` | Saves to Working Configuration when Assessment selected |
| `SecurityWorkspaceContext.jsx` | `viewVersionId` for read-only viewer; no Save Version |
| `ScanCenter.jsx` | Assessment Workspace flow |
| `ScanCenterHeader.jsx` | Execute Assessment (no Save Version) |
| `AssessmentContextBar.jsx` | Configuration mode field |
| `securityApi.js` / `securityNavigation.js` | Working-config + clone APIs |

---

## 4. Files Created

| File | Purpose |
|---|---|
| `AssessmentVersionHistoryPanel.jsx` | Version accordion + nested executions + clone |
| `AD_SECURITY_ASSESSMENT_WORKSPACE_DELIVERABLES.md` | This document |

Removed: `AssessmentVersionSelectionPanel.jsx` (manual Version create/open gate)

---

## 5. Frontend Changes

**Workflow:** Application → Assessment → Assessment Workspace (Working Configuration) → Execute

- Feature Workspace edits Working Configuration only
- No Create Version / Save Version buttons
- Optional `viewVersionId` opens read-only Version snapshot
- Version history: expand Version → executions → View / Clone to Working Configuration / Back to Working Configuration
- Execute disabled while viewing a Version snapshot

---

## 6. Backend Changes

**Execute (`POST …/scans/run` or `…/assessments/:id/execute`)**

1. Load Assessment Working Configuration  
2. Fingerprint vs latest Version  
3. Unchanged → reuse Version  
4. Changed / none → create Version N+1 from Working Configuration  
5. Run scan bound to that Version  

**Working Configuration APIs**

- `GET/PUT …/working-configuration`
- `PUT …/working-configuration/features/:featureKey`
- `POST …/working-configuration/reset`
- `POST …/versions/:versionId/clone-to-working`

---

## 7. Database Changes

**Assessment:** `workingConfiguration` (Mixed), `latestVersionId`, `latestVersionNumber`

**AssessmentVersion:** required `configSnapshot`, `contentFingerprint`, `createdFromVersionId`; draft/saved/executed status removed

**PostureScanResult:** unchanged (`assessmentId` + `assessmentVersionId`)

---

## 8. API Changes

| Method | Path | Notes |
|---|---|---|
| GET/PUT | `…/working-configuration` | Editable draft |
| PUT | `…/working-configuration/features/:featureKey` | Feature upsert |
| POST | `…/working-configuration/reset` | Reset from app overrides |
| GET | `…/versions` | `includeExecutions` (default true) |
| GET | `…/versions/:id/config` | Read-only snapshot |
| POST | `…/versions/:id/clone-to-working` | Clone into draft |
| POST | `…/assessments/:id/execute` | Auto-version + run |
| POST | `…/scans/run` | Requires `assessmentId` only; auto-versions |

Removed user-facing Create Version / Save Version / Execute Version endpoints.

---

## 9. Migration Strategy

1. Existing Assessments: Working Configuration seeded from application overrides on first open (`ensureWorkingConfiguration`) or create  
2. Legacy executions → Version 0 via `migrate-legacy-versions` (called when opening Assessment)  
3. Next Execute with config creates Version 1+ automatically  
4. Dashboard / Findings / Compare / Remediation unchanged (still keyed by `scanId` / same-Version compare)

---

## 10. Validation Report

| Check | Status |
|---|---|
| Working Configuration on Assessment | Done |
| Versions immutable (no draft) | Done |
| Execute unchanged → reuse Version | Done (fingerprint) |
| Execute changed → auto Version N+1 | Done |
| Multiple executions under same Version | Done |
| Version history + nested executions | Done |
| Read-only Version viewer + clone | Done |
| Compare same Version only | Preserved |
| Unit fingerprint tests | PASS |
| Syntax checks | PASS |

Manual: Create Assessment → edit Working Config → Execute twice without edits (same Version) → change LDAP → Execute (new Version) → view/clone Version → Remediation.

---

## 11. Risk Analysis

| Risk | Mitigation |
|---|---|
| Existing draft Versions in DB | New schema ignores status; migrate by treating as history; new Versions require snapshot |
| Fingerprint false positives/negatives | Stable JSON stringify of maps/overrides/settings only |
| Partial feature execute vs full Working Config freeze | Freeze still uses full Working Config; feature list filters execution set |
| Users expect Save Version | Messaging: Execute auto-versions; Reset / Clone for draft control |

---

## 12. Future Enhancement Opportunities

- Diff Working Configuration vs Version N / vs previous Version  
- Export / import Working Configuration JSON  
- Soft-archive Versions  
- Cross-Version compare (explicitly deferred)  
- Policy snapshot freeze at Version creation  
- Discard Working Configuration changes (revert to latest Version without clone round-trip)
