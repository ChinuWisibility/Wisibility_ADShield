# AD Security Remediation Center — Implementation Deliverables

**Status:** Implemented (Phases 1–7)  
**Source of truth:** `AD_SECURITY_REMEDIATION_ARCHITECTURE_ANALYSIS.md`  
**Route:** `/security/remediation` (sidebar: AD SECURITY → Remediation)

---

## 1. Architecture mapping (Existing → New usage)

| Existing artifact | New usage |
|---|---|
| `SecurityWorkspaceProvider` | Scopes Remediation Center to `applicationId` + `scanId` |
| `AssessmentContextBar` | Assessment strip; extended with `extraChips` for baseline/current/progress |
| `AssessmentComparePanel` / Compare API | Progress math + feature buckets (not reinvented) |
| `DataHygieneWidgetCard` + Metrics/Applications toggle | Visual dashboard shell for feature / app progress cards |
| `RemediationKpiStrip` | Progress summary KPIs |
| `FindingsTable` | Current-findings bucket on feature detail |
| `RiskDrilldownDrawer` | Finding drill-down; extended with `remediationContext` |
| `SecurityFindingRemediateButton` / `QueueFirstRemediation*` | Queue-first remediate when orphan/account target exists |
| `useQueueTaskPageStatus` | Queue status chips on feature detail rows |
| `workflowTaskQueueApi.listTasks` | Recent queue activity section |
| `SecurityExportMenu` | Export from dashboard / feature detail |
| `EmptyStateSecurity` / `SecurityApplicationBar` | Empty states + app picker |
| `posture_scan_results` | Baseline / current executions |
| `securityFindingsService.compareSecurityScans` | Single comparison algorithm |

```
Application
  → Baseline Execution + Current Execution (pair selector)
  → Compare API
  → Progress + Feature widgets
  → Feature Detail → Findings / Queue / Workflow
  → Reassessment (new scan) → compare again
```

---

## 2. Files reused (as-is or thin wrap)

- `icm-frontend/src/pages/datahygine/components/DataHygieneWidgetCard.jsx` (extended props)
- `icm-frontend/src/features/remediation-events/components/RemediationKpiStrip.jsx`
- `icm-frontend/src/features/remediation-events/styles/remediation-events.css`
- `icm-frontend/src/components/security/FindingsTable.jsx`
- `icm-frontend/src/components/security/SecurityExportMenu.jsx`
- `icm-frontend/src/components/security/EmptyStateSecurity.jsx`
- `icm-frontend/src/pages/security/SecurityApplicationBar.jsx`
- `icm-frontend/src/pages/security/SecurityWorkspaceContext.jsx`
- `icm-frontend/src/hooks/useQueueTaskPageStatus.js`
- `icm-frontend/src/components/remediation/QueueFirstRemediationRowAction.jsx`
- `icm-backend/src/services/security/securityFindingsService.js` (compare engine)
- `icm-backend/src/services/posture/postureScanResultsStore.js`
- Collections: `posture_scan_results`, `workflow_task_queue`, `security_policies`

---

## 3. Files extended

| File | Change |
|---|---|
| `securityFindingsService.js` | Compare returns `remaining`, `reopened`, `baselineFindings`, `currentFindings`, `progressPercent`, `byFeature` |
| `securityController.js` | Remediation summary + tenant applications summary handlers |
| `securityRoutes.js` | New routes |
| `securityApi.js` | Client methods for new endpoints |
| `DataHygieneWidgetCard.jsx` | `detailBasePath`, `applicationAnalyticsBasePath`, `themeRegistry`, `linkQueryParams` |
| `AssessmentContextBar.jsx` | Optional `extraChips` |
| `RiskDrilldownDrawer.jsx` | Optional `remediationContext` section |
| `SecurityFindingRemediateButton.jsx` | `queuedInfo` / `onQueuedRefresh` passthrough |
| `AppRoutes.jsx` | `/security/remediation`, `/security/remediation/:featureId` |
| `Sidebar.jsx` | AD SECURITY → Remediation |

---

## 4. Files created

### Backend
- `icm-backend/src/services/security/securityRemediationSummaryService.js`

### Frontend
- `icm-frontend/src/pages/security/remediation/SecurityRemediationDashboard.jsx`
- `icm-frontend/src/pages/security/remediation/SecurityRemediationFeatureDetail.jsx`
- `icm-frontend/src/pages/security/remediation/securityRemediationTheme.js`
- `icm-frontend/src/pages/security/remediation/components/AssessmentPairSelector.jsx`
- `icm-frontend/src/pages/security/remediation/components/SecurityRemediationProgressWidget.jsx`
- `icm-frontend/src/pages/security/remediation/components/SecurityRemediationQueueActivity.jsx`
- `icm-frontend/src/pages/security/remediation/components/SecurityRemediationStatusChip.jsx`

### Docs
- `AD_SECURITY_REMEDIATION_CENTER_DELIVERABLES.md` (this file)

---

## 5. Backend changes

- Extended Compare payload (additive fields only; fingerprint algorithm unchanged).
- `GET /api/security/applications/:applicationId/remediation-summary?baseline=&current=`
  - Maps Compare → progress + feature widgets + application tile.
- `GET /api/security/remediation/applications-summary?tenantId=`
  - Applications view: latest two scans per application → progress tiles.

No duplicate comparison logic. No new Mongo collections.

---

## 6. Frontend changes

- New Remediation Center under Security workspace.
- Metrics / Applications toggle (`?view=application`) mirroring Data Hygiene.
- Assessment pair selector (URL `baselineScanId` + `scanId`, sessionStorage persistence).
- Progress summary via `RemediationKpiStrip`.
- Feature cards via reused `DataHygieneWidgetCard`.
- Feature detail with Compare buckets + FindingsTable + queue/remediate actions.
- Recent queue activity from workflow task queue API.

---

## 7. API changes

| Method | Path | Notes |
|---|---|---|
| GET | `/security/applications/:id/remediation-summary` | **New** |
| GET | `/security/remediation/applications-summary` | **New** |
| GET | `/security/applications/:id/scans/compare` | **Extended response** (backward compatible) |

Existing overview / findings / scans / workflow-task-queue APIs unchanged.

---

## 8. Database changes

**None.** Reuses `posture_scan_results` and `workflow_task_queue`.  
Baseline pairing is URL + `sessionStorage` (`icm:securityRemediationPair:v1:<applicationId>`), not a new collection (matches analysis “only if required”).

---

## 9. Migration notes

- No data migration.
- Historical scans participate automatically once two executions exist for an application.
- Pairwise Compare cannot compute **Reopened** without an intermediate execution → always `0` today (documented in API/UI hints).
- Queue-first Remediate remains available when findings expose orphan/account ids (existing bridge). Generic `AD_SECURITY_FINDING` task action is **not** introduced in this phase (analysis gap deferred; avoid parallel remediation engine).
- Data Hygiene behavior unchanged unless optional card props are passed (defaults preserve `/datahygine` paths).

---

## 10. Validation report

| Check | Result |
|---|---|
| Route `/security/remediation` registered under `SecurityCenter` | Done |
| Sidebar AD SECURITY → Remediation | Done |
| Assessment context + pair selector | Done |
| Progress summary (Compare-derived) | Done |
| Metrics feature cards | Done |
| Applications view (tenant tiles) | Done |
| Feature drill-down | Done |
| Finding drill-down (`RiskDrilldownDrawer` + remediation context) | Done |
| Workflow launch (queue-first when target id present) | Done |
| Queue activity section | Done |
| Compare API reused (no new algorithm) | Done |
| Progress % = resolved / baseline | Done |
| Export menu on dashboard / detail | Done |
| Backend syntax check | Pass |
| No Data Hygiene / Findings Explorer / Scan Center rewrite | Confirmed |

### Manual validation checklist (runtime)

1. Open `/security/remediation` with an AD app that has ≥2 scans.
2. Confirm Baseline/Current pair and Progress KPIs.
3. Toggle Metrics ↔ Applications.
4. Click a feature card row → feature detail buckets.
5. Open a finding → remediation status + Remediate (when orphan/account linked).
6. Confirm queue activity and link to Remediation Events.
7. Confirm Data Hygiene `/datahygine` still navigates to hygiene detail paths.

---

## Known follow-ups (out of this delivery)

- First-class `AD_SECURITY_FINDING` workflow task action + security-specific templates.
- Durable baseline pairing store (optional).
- Reopened detection across 3+ executions.
- Assessment Version entity (separate Assessment-centric program).
