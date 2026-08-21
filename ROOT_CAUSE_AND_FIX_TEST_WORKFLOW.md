# Workflow Test vs Runtime Verification Analysis

This document records a code-level investigation of why **Test Workflow** incorrectly routed to **Notify User → Notify Manager** while **Live Remediation Run** correctly routed to **Notify IAM Team** for the same certification revoke scenario (access still present on the identity).

Evidence: Test Workflow screenshots show trigger output with empty `identityId`, `applicationId`, `entitlementId`, `identityName`, and `entitlementName`. All steps reported SUCCESS and execution followed the **Removed** branch.

---

# Root Cause

The workflow graph and branching logic are **correct**. The defect is in how **Verify Access Removed** behaves when executed with an empty test trigger in TEST mode.

When required identifiers are missing, the demo adapter's `hasEntitlement()` returned `false` (identity not found), which the handler interpreted as `stillPresent: false` and `verified: true`. The **Access Still Present?** CompareStrings node then evaluated `false === "true"` → no match → branch `"false"` (**Removed**), routing to Notify User → Notify Manager.

Live remediation runs use `buildTriggerFromReviewItem()` to populate real identifiers and `createIgaAdapter()` which calls `checkIdentityEntitlement()` against live IGA data. With access still present, `stillPresent: true` → branch `"true"` (**Still Present**) → Notify IAM Team.

**Single-sentence root cause:** Test Workflow executed with empty trigger data; missing identity/entitlement context was silently treated as "access not present," producing a false REMOVED outcome and wrong branch selection.

---

# Execution Trace

## Test Workflow path (incorrect — empty trigger)

| Step | File | Function | Input | Output | Branch |
|------|------|----------|-------|--------|--------|
| 1. UI loads template | `icm-frontend/.../TestWorkflowPanel.jsx` | `useEffect` → `workflowApi.sampleTriggers()` | — | Empty JSON in textarea | — |
| 2. Sample API | `icm-backend/.../remediationWorkflowController.js` | `getSampleTriggers` | — | `getTriggerTemplate()` with empty strings **(before fix)** | — |
| 3. User clicks Start test | `TestWorkflowPanel.jsx` | `runTest` | `JSON.parse(triggerJson)` | POST `{ trigger }` | — |
| 4. Test handler | `remediationWorkflowController.js` | `testWorkflowHandler` | `req.body.trigger` | `executeWorkflow(..., { mode: "TEST", adapter: createDemoAdapter({ trigger }) })` | — |
| 5. Demo adapter init | `demoAdapter.js` | `createDemoAdapter` | `identityId: ""` | **No identity seeded** in `identities` map | — |
| 6. Trigger step | `handlers.js` | `CertificationSignedOff.execute` | empty trigger | `{ decision: "Revoke", identityId: "", ... }` | `null` |
| 7. Get item | `handlers.js` | `GetCertificationItem.execute` | `identityId: ""` | `{ identity: null }` | `null` |
| 8. Verify access **(before fix)** | `handlers.js` | `VerifyAccessRemoved.execute` | `identityId: ""`, `entitlementId: ""` | `stillPresent: false`, `verified: true`, `status: SUCCESS` | `"false"` |
| 8. Demo lookup **(before fix)** | `demoAdapter.js` | `hasEntitlement("", ...)` | empty identityId | `false` (no identity in map) | — |
| 9. Compare | `handlers.js` | `CompareStrings.execute` | `left: false`, `right: "true"` | `{ match: false }` | `"false"` → **Removed** |
| 10. Routing | `graph.js` | `pickNextEdge` | `from: "stillPresent"`, `branch: "false"` | edge → `emailUser` | Notify User |
| 11. Continue | — | — | — | notify manager → End Success | — |

## Live remediation path (correct)

| Step | File | Function | Input | Output | Branch |
|------|------|----------|-------|--------|--------|
| 1. Revoke decision | `workflowDispatcher.js` | `enqueueRevokeExecution` | ReviewItem + entitlement | — | — |
| 2. Trigger build | `workflowRevokeService.js` | `buildTriggerFromReviewItem` | review item fields | populated `identityId`, `applicationId`, `entitlementName`, etc. | — |
| 3. Execution | `workflowDispatcher.js` | `runExecution` | real trigger | `mode: "LIVE"`, `adapter: createIgaAdapter()` | — |
| 4. Verify access | `handlers.js` | `VerifyAccessRemoved.execute` | real identifiers | `stillPresent: true`, `verified: false` | `"true"` |
| 5. Live lookup | `igaAdapter.js` → `workflowRevokeService.js` | `checkIdentityEntitlement` | identityId + entitlementName | entitlement found in live view | — |
| 6. Compare | `handlers.js` | `CompareStrings.execute` | `left: true`, `right: "true"` | `{ match: true }` | `"true"` → **Still Present** |
| 7. Routing | `graph.js` | `pickNextEdge` | `branch: "true"` | edge → `emailIam` | Notify IAM Team |

## Value computation (before fix)

| Field | Test (empty trigger) | Live (access present) |
|-------|----------------------|------------------------|
| `stillPresent` | `false` (demo: identity not found) | `true` (live lookup match) |
| `verified` | `true` (`!stillPresent`) | `false` |
| `verificationStatus` | *(did not exist)* | *(did not exist)* |
| CompareStrings `match` | `false` | `true` |
| Final branch | `"false"` → Removed | `"true"` → Still Present |

---

# Affected Files

| File | Role |
|------|------|
| [`icm-backend/src/workflows/engine/sampleTriggers.js`](icm-backend/src/workflows/engine/sampleTriggers.js) | Default test trigger template |
| [`icm-frontend/src/features/workflows/components/isc/TestWorkflowPanel.jsx`](icm-frontend/src/features/workflows/components/isc/TestWorkflowPanel.jsx) | Test UI — loads and submits trigger JSON |
| [`icm-backend/src/controllers/remediationWorkflowController.js`](icm-backend/src/controllers/remediationWorkflowController.js) | `testWorkflowHandler`, `getSampleTriggers` |
| [`icm-backend/src/workflows/adapters/demoAdapter.js`](icm-backend/src/workflows/adapters/demoAdapter.js) | TEST-mode entitlement lookup |
| [`icm-backend/src/workflows/adapters/igaAdapter.js`](icm-backend/src/workflows/adapters/igaAdapter.js) | LIVE-mode entitlement lookup |
| [`icm-backend/src/workflows/steps/handlers.js`](icm-backend/src/workflows/steps/handlers.js) | `VerifyAccessRemoved`, `CompareStrings` |
| [`icm-backend/src/services/workflow/workflowRevokeService.js`](icm-backend/src/services/workflow/workflowRevokeService.js) | `buildTriggerFromReviewItem`, `checkIdentityEntitlement` |
| [`icm-backend/src/workflows/engine/executor.js`](icm-backend/src/workflows/engine/executor.js) | Graph walk, branch routing, fail handling |
| [`icm-backend/src/workflows/engine/graph.js`](icm-backend/src/workflows/engine/graph.js) | `pickNextEdge` branch selection |
| [`icm-backend/src/workflows/templates/cert-revoke-simple-test.json`](icm-backend/src/workflows/templates/cert-revoke-simple-test.json) | Reference workflow graph |

---

# Current Behavior

## Missing data handling (before fix)

| Condition | Location | Return value | Interpreted as |
|-----------|----------|--------------|----------------|
| `identityId` empty | `demoAdapter.hasEntitlement` | `false` | Access removed |
| `identityId` empty | `hasIdentityEntitlement` (live) | `false` | Access removed |
| `entitlementName` empty (live) | `hasIdentityEntitlement` | `false` | Access removed |
| Identity not in demo map | `demoAdapter.hasEntitlement` | `false` | Access removed |
| Connector exception (live) | `hasIdentityEntitlement` catch | `true` | Still present (conservative) |
| Any verify result | `VerifyAccessRemoved` handler | `status: "SUCCESS"` always | Continues to CompareStrings |

## Branch routing

[`graph.js`](icm-backend/src/workflows/engine/graph.js) `pickNextEdge(fromId, branch)` selects the edge where `edge.branch === branch`. Template [`cert-revoke-simple-test.json`](icm-backend/src/workflows/templates/cert-revoke-simple-test.json):

- `stillPresent` branch `"true"` → Notify IAM Team
- `stillPresent` branch `"false"` → Notify User

---

# Why Test Workflow Produces Wrong Branch

1. **Default trigger is empty** — `getTriggerTemplate()` returned all-empty identifier fields; TestWorkflowPanel loaded this without user edits.
2. **Demo adapter seeds no identity** — `createDemoAdapter` only adds to `identities` when `t.identityId` is truthy ([`demoAdapter.js`](icm-backend/src/workflows/adapters/demoAdapter.js) lines 10–24).
3. **`hasEntitlement` returned false for unknown identity** — indistinguishable from "entitlement removed."
4. **Handler set `verified: true`** — `verified: !stillPresent` with `stillPresent: false`.
5. **No validation gate** — handler always returned `status: "SUCCESS"` and proceeded to CompareStrings.
6. **CompareStrings routed to Removed** — `false` vs `"true"` → branch `"false"`.

The screenshot evidence (empty trigger output, SUCCESS on all steps, Notify User → notify manager path) matches this trace exactly.

---

# Security / Audit Risk Assessment

**Should missing verification context ever be interpreted as "Access Removed"?**

**No.** For an Identity Governance platform this is a critical safety defect:

- **False revocation notifications** — Users and managers may be told access was removed when it was never verified.
- **Missed IAM escalation** — Still-present access that requires manual remediation would not reach the IAM team.
- **Audit trail corruption** — Workflow runs complete as SUCCESS on the wrong branch, implying compliance when access remains.
- **SoD / compliance exposure** — Certification revoke decisions appear enforced in workflow audit logs while entitlements remain active.
- **Silent failure** — Empty test data masking production-like behavior gives false confidence in workflow design.

Missing context must be **VERIFICATION_FAILED**, not REMOVED. The prior live-path behavior of returning `false` on missing `identityId`/`entitlementName` had the same semantic bug (treated as removed). Connector failures should also be VERIFICATION_FAILED, not assumed still-present or removed without evidence.

---

# Recommended Architecture

Introduce explicit **`verificationStatus`** on all Verify Access Removed outcomes:

| Status | Meaning |
|--------|---------|
| `REMOVED` | Identity and entitlement context valid; live/test lookup confirms entitlement absent |
| `STILL_PRESENT` | Context valid; entitlement still exists on identity account |
| `VERIFICATION_FAILED` | Cannot determine state — missing context, identity not found, connector error |

### REMOVED

- `identityId` present
- `entitlementId` or `entitlementName` present
- Lookup succeeds
- Entitlement not found on identity account view

### STILL_PRESENT

- Same context requirements as REMOVED
- Lookup succeeds
- Entitlement matched on identity account view

### VERIFICATION_FAILED

- Missing `identityId`
- Missing both `entitlementId` and `entitlementName`
- Identity/account not found in lookup scope
- Demo adapter: identity not seeded in test context
- Connector timeout or exception
- Any condition where presence cannot be determined

**Routing rules:**

- `STILL_PRESENT` → branch `"true"` → Notify IAM Team
- `REMOVED` → branch `"false"` → Notify User / Manager
- `VERIFICATION_FAILED` → step `FAILED`, workflow stops, downstream SKIPPED — never success branches

---

# Required Code Changes

Changes **implemented** in this remediation:

| File | Previous behavior | New behavior | Reason |
|------|-------------------|--------------|--------|
| `verification/verificationStatus.js` | *(new)* | Constants, validation, output builder | Central verification model |
| `verification/checkEntitlement.js` | *(new)* | Demo entitlement check with VERIFICATION_FAILED | TEST parity |
| `handlers.js` — VerifyAccessRemoved | Always SUCCESS; boolean only | Validates context; returns `verificationStatus`; FAILED on VERIFICATION_FAILED | Prevent false REMOVED |
| `demoAdapter.js` | `hasEntitlement` → boolean | Structured result; `simulateAccessRemoved` flag; uses `checkDemoEntitlement` | Realistic test modeling |
| `igaAdapter.js` | Delegates to boolean `hasIdentityEntitlement` | Delegates to `checkIdentityEntitlement` | Structured live results |
| `workflowRevokeService.js` | `hasIdentityEntitlement` returns false on missing context | `checkIdentityEntitlement` returns VERIFICATION_FAILED; boolean wrapper retained for legacy | Safe live verification |
| `executor.js` | VerifyAccessRemoved FAILED ignored for fail-fast | Stops workflow on VERIFICATION_FAILED; surfaces `verificationReason` | Block wrong-branch completion |
| `sampleTriggers.js` | Empty default template | Realistic default + scenarios (stillPresent, removed, empty) | Accurate test defaults |
| `remediationWorkflowController.js` | Returns empty template only | Returns template, scenarios, emptyTemplate | API support for UI |
| `TestWorkflowPanel.jsx` | JSON paste only | Scenario buttons, load-from-execution, empty-field warning | Better test UX |
| `workflowDispatcher.js` | No VERIFY_FAILED classification | `deriveFailureReason` handles VERIFICATION_FAILED | Dashboard accuracy |
| `stepConfigCatalog.js` | Boolean output schema | Includes `verificationStatus` | Builder documentation |

---

# Test Workflow Improvements

| Option | Description | Assessment |
|--------|-------------|------------|
| **A — Manual JSON paste** | User edits trigger JSON manually | Flexible but error-prone; caused this incident |
| **B — Load from remediation execution** | Pull `triggerPayload` from existing execution | **Best for reproducing live scenarios** — implemented in TestWorkflowPanel |
| **C — Run test using live adapter** | TEST mode calls real IGA connector | Highest fidelity but side effects, tenant coupling, slower |
| **D — Seeded sample trigger** | Realistic default with identity + entitlement | **Best default** — implemented as default template + scenarios |

**Recommendation:** **D as default + B for reproduction + A as override.**

- Default realistic sample routes to Notify IAM Team (access still present), matching the common revoke-during-certification scenario.
- "Access removed" scenario uses `simulateAccessRemoved: true`.
- "Empty (invalid)" scenario demonstrates VERIFICATION_FAILED.
- Load-from-execution reproduces exact live payloads for debugging.

Option C remains optional future enhancement for pre-production validation against real connectors.

---

# Implementation Plan

1. **Verification model** — Add `verificationStatus.js` and `checkEntitlement.js` ✅
2. **Harden VerifyAccessRemoved** — Validate context; structured output; FAILED on VERIFICATION_FAILED ✅
3. **Adapter parity** — Demo and IGA adapters return structured results ✅
4. **Executor guard** — Stop workflow on VERIFICATION_FAILED; skip downstream ✅
5. **Test defaults** — Realistic sample trigger and scenarios ✅
6. **UI improvements** — Scenario picker, load-from-execution, warnings ✅
7. **Dashboard** — VERIFY_FAILED failure reason ✅
8. **QA** — Empty-trigger guard in smoke script ✅

---

# Expected Behavior After Fix

| Scenario | Trigger | verificationStatus | Workflow path | Final status |
|----------|---------|-------------------|---------------|--------------|
| Test — default sample (access present) | Populated IDs, `simulateAccessRemoved: false` | `STILL_PRESENT` | Verify → Compare → **Notify IAM Team** | SUCCESS |
| Test — removed scenario | Populated IDs, `simulateAccessRemoved: true` | `REMOVED` | Verify → Compare → **Notify User** | SUCCESS |
| Test — empty trigger | Empty identityId/entitlement | `VERIFICATION_FAILED` | Verify **FAILED**; downstream SKIPPED | FAILED |
| Live — access still present | `buildTriggerFromReviewItem` | `STILL_PRESENT` | Verify → Compare → **Notify IAM Team** | SUCCESS |
| Live — access removed | Real trigger, entitlement gone | `REMOVED` | Verify → Compare → **Notify User** | SUCCESS |
| Live — connector failure | Real trigger, lookup throws | `VERIFICATION_FAILED` | Verify **FAILED**; downstream SKIPPED | FAILED |

Verified locally (isolated engine test):

```
stillPresent: status=SUCCESS → Notify IAM Team
removed:      status=SUCCESS → Notify User
empty:        status=FAILED  → VERIFICATION_FAILED at Verify step (no Notify User)
```

---

# Conclusion

The workflow design is correct. The Test Workflow misrouting was caused by empty test trigger data combined with verification logic that treated "identity not found" as "access removed." Fixes introduce explicit `verificationStatus`, fail closed on missing context, provide realistic test defaults, and align TEST and LIVE verification semantics so the same access state produces the same branch in both modes.
