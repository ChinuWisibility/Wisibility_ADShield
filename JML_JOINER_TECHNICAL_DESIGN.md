# Identity Sphere — JML Joiner Technical Design

> Design analysis only. No source code was modified.

**Audience:** Senior engineers / implementation agents preparing the first production Joiner MVP.  
**Inputs verified:** `LDAP_CONNECTOR_IMPLEMENTATION_GUIDE.md`, `CURRENT_ARCHITECTURE_AND_PROVISIONING_ANALYSIS.md`, and current source under `icm-backend` / `icm-frontend`.  
**Where docs and code differ, source code is authoritative** (discrepancies noted below).  
**AD server:** DOWN at design time — live create remains **IMPLEMENTED BUT NOT LIVE-TESTED**.

---

## 0. Discrepancies vs Prior Architecture Docs

| Prior statement | Current code reality |
| --------------- | -------------------- |
| “Global Ruleset” might be assumed usable for `dept=IT AND location=India` | **False.** Org-Admin **Global rule set** is a **hub of specialized rule packs**, not a general identity IF/THEN provisioning engine. |
| Joiner can key off `lifecycleState === NEW` from HRMS | **Partially false for OrangeHRM path.** `mapHrmsEmployeeToIdentityPayload` only sets `ACTIVE` / `INACTIVE` / `TERMINATED`. `NEW` is produced mainly via CSV/profile lifecycle mapping, not live OrangeHRM status mapping. |
| Provisioning worker can execute AD create | **False today.** `resolveConnector()` returns `null`. `createAdUser` exists but is only reached via test HTTP / script. |
| Identity↔account correlation is automatic after AD sync | **False.** Membership (account↔entitlement) correlation is automatic; identity correlation is **manual** (`POST /api/correlation/run/:applicationId`). |
| Single-identity correlation API | **Not found.** Full application scan only. |

---

## 1. Executive Design Summary

### Recommended Joiner MVP architecture (conceptual)

```text
HRMS Sync (existing)
  ↓
Joiner Candidate Detection (NEW — post-sync async, not inline per upsert)
  ↓
Identity Attribute Rule Evaluation (NEW evaluator; DO NOT overload Global Rule Set tiles)
  ↓
Provisioning Request JOINER (extend enqueue pattern from cert revoke)
  ↓
Remediation Workflow Engine (reuse) mapped for JOINER action (extend RemediationWorkflowRule)
  ↓
On approval / not-required → Provisioning Plan + Task(ADD_ACCOUNT)
  ↓
provisioningWorker.resolveConnector → AD adapter → createAdUser
  ↓
Persist result / task COMPLETED|FAILED
  ↓
(When AD up) AD Sync → Aggregation → Correlation refresh
```

### Critical design stance on “Global Ruleset”

**Do not pretend the current Global Rule Set page evaluates `memberOf = IT AND location = India`.**

That page today configures:

1. Identity posture scoring rules  
2. ISO reporting thresholds / risk bands  
3. Remediation action → workflow mappings (`ACCESS_REVOKE`, `IAM_ORPHAN_REVIEW`)  
4. Remediation queue scheduler  

The **closest reusable condition engine** in the repo is **DiscoveryPolicy** (+ `discoveryEvaluationService.evaluateCondition`), which already supports field/operator/AND/OR for USER entities — but it is used for **discovery classification**, not provisioning.

**FUNCTIONAL DECISION REQUIRED:** Whether Joiner “who gets AD” rules become:

- **A)** A new tenant rule pack under Global Rule Set UI (recommended product home), backed by a new model, reusing Discovery-style condition AST, **or**  
- **B)** Extension of `ProvisioningPolicy` (schema exists; no evaluator), **or**  
- **C)** Reuse DiscoveryPolicy (wrong semantic fit — scoped to one application discovery type).

---

## 2. Global Ruleset — Deep Analysis (Part 2)

### 2.1 What “Global Rule Set” actually is

**Frontend hub:** `icm-frontend/src/pages/admin/GlobalRuleSet.jsx`  
Route: `/org-admin/global-rule-set`  
Tiles:

| Tile | Path | Backend |
| ---- | ---- | ------- |
| Identity posture rules | `.../identity-posture` | `IdentityPostureRuleSet` + posture services |
| Iso reporting rule set | `.../reporting` | `ReportingRuleSet` + overrides |
| Remediation workflow rules | `.../remediation-workflow-rules` | `RemediationWorkflowRule` |
| Remediation queue scheduler | `.../remediation-queue-scheduler` | SchedulerConfig / queue services |

**There is also** `models/sod/GlobalRuleSetConfig.js` (`ruleType: NHI|PRIVILEGED|SOD`) — **separate** from the Org-Admin Global Rule Set UI hub; not the Joiner condition engine.

### 2.2 Remediation workflow rules (the only “action → workflow” mapping)

**Model:** `icm-backend/src/models/workflowTaskQueue/RemediationWorkflowRule.js`  
**Collection:** `remediation_workflow_rules`  
**Shape:**

```text
tenantId: string (unique)
actionMappings: [{
  action: enum WORKFLOW_TASK_ACTIONS,  // ACCESS_REVOKE | IAM_ORPHAN_REVIEW
  workflowId: string,
  workflowName: string,
  enabled: boolean
}]
updatedBy
timestamps
```

**Service:** `remediationWorkflowRuleService.js` — get/put mappings; auto-seed default ACCESS_REVOKE workflow.

**Evaluation:** Not a condition AST. Evaluation = “lookup workflowId for action X for tenant”.

**Used by:** workflow task queue / certification revoke enqueue path.

### 2.3 Identity posture rules

**Model:** `IdentityPostureRuleSet` — `rules: Mixed`, tenant unique.  
**Purpose:** posture **scoring weights**, not access provisioning.  
**Evaluator:** posture services (`identityPostureService`, `postureRuleResolver`).  
**Cannot represent Joiner birthright conditions** without semantic abuse.

### 2.4 Reporting rule set

**Model:** `ReportingRuleSet` — thresholds, notifications, risk bands.  
**Not** identity attribute IF/THEN for AD create.

### 2.5 Can Global Ruleset represent `memberOf=IT AND location=India`?

| Question | Answer |
| -------- | ------ |
| Exact model/schema for identity IF/THEN? | **No such Global Ruleset model** |
| Conditions AND/OR? | **Not in GRS remediation mappings** |
| Nested conditions? | **No** (in GRS) |
| Operators? | **No** (in GRS) |
| Attribute types? | N/A for GRS action maps |
| Existing evaluator for identity attrs? | **No** in GRS |
| Frontend AST/JSON conditions for Joiner? | **No** |
| Tenant-scoped? | Yes (remediation rules, posture, reporting) |
| Priority/order? | Mapping list order only; not priority weights for Joiner |
| Enable/disable? | `enabled` on actionMappings |
| Versioning/effective date? | Reporting/posture have `version`; remediation mapping does not version Joiner-style |

**Verdict:** Current Global Rule Set **cannot** evaluate that rule. Closest engines elsewhere:

| Engine | AND/OR | Operators | Entity | Fit for Joiner “who”? |
| ------ | ------ | --------- | ------ | --------------------- |
| DiscoveryPolicy + `discoveryEvaluationService` | Steps AND/OR; field conditions AND/OR | contains, equals, startsWith, endsWith, regex, not* | USER / ENTITLEMENT / AD_GROUP **per application** | **Closest AST** — wrong product home / purpose |
| `adSuggestionRuleEngine` | Field blocks AND/OR | subset of discovery ops | AD groups | No |
| SoD conditions | per-condition | EQUALS/CONTAINS/REGEX | SoD | No |
| Security `policyConditions` | signal/threshold tokens | N/A | AD security signals | No |

**About `memberOf`:** On HRMS Identity, `memberOf` is **not** a first-class field. Typical Joiner inputs are `department`, `location`, `attributes.*`. Using literal AD `memberOf` **before** an AD account exists is **FUNCTIONAL DECISION REQUIRED** (likely means HR department/cost center, not LDAP memberOf).

---

## 3. Rule Action Semantics Today (Part 3)

### Existing “action” concepts

| Location | Action meaning |
| -------- | -------------- |
| `RemediationWorkflowRule.actionMappings.action` | Remediation **event type** → choose workflow (`ACCESS_REVOKE`, `IAM_ORPHAN_REVIEW`) |
| `ProvisioningPolicy.actions` | `Mixed[]` — **no schema, no evaluator, no consumers** |
| Workflow step types | RevokeAccess, CreateTicket, SendEmail, … — remediation |
| Role / RoleAssignment | Access catalog, not Joiner engine |

**Can action identify Application / operation / workflow / provisioning?**

- Remediation mapping: **workflow only** (no application, no ADD_ACCOUNT).
- ProvisioningPolicy: **applications[]** + **actions Mixed** + **approvalRequired** — intended shape, **unimplemented**.

### Smallest extension to represent “THEN AD account must exist”

**Recommended (design):**

1. Keep Global Rule Set as **product home**.  
2. Add a new tile/model: e.g. **Identity provisioning rules** (name TBD) with Discovery-like conditions + action:

```text
action.type = "ENSURE_ACCOUNT" | "ADD_ACCOUNT"
action.applicationId = <AD Application ObjectId>
action.workflowActionKey = "JOINER"   // maps via RemediationWorkflowRule-style mapping
action.provisioningPolicyId? = <optional HOW policy>
```

3. Extend `WORKFLOW_TASK_ACTIONS` / remediation mapping with `JOINER` (or `LIFECYCLE_JOINER`) → workflowId.

**Do not** put LDAP attribute maps in the Global Rule. That belongs in **ProvisioningPolicy** (HOW).

---

## 4. Application Assignment / Birthright (Part 4)

| Mechanism | Exists? | Means “should have account on App X”? |
| --------- | ------- | ------------------------------------- |
| `Role.type = "birthright"` | Enum only | **No automatic assignment engine found** |
| `RoleAssignment` | Model + deletion counters | Manual/catalog; not Joiner→AD |
| `AccessRequest` | Model CRUD | Request lifecycle; not wired to `createAdUser` |
| `ProvisioningPolicy.applications` | Schema | Intended, unused |
| DiscoveryPolicy | Yes | Classifies entities; does not provision |

**Closest existing mechanism:** none that automatically ensures an AD account.  
**Do not invent a second “Access Profile” product** until Joiner MVP proves ENSURE_ACCOUNT via rule → task → connector.

---

## 5. Identity `lifecycleState` (Part 5)

### OrangeHRM / `hrmsIdentitySyncService`

`mapHrmsEmployeeToIdentityPayload`:

```text
status string →
  TERMINATED (terminated|separation|ended|fired)
  INACTIVE   (inactive|disabled|suspended)
  ACTIVE     (default)
```

**Does not set `NEW`, `MOVER`, or `LEAVER`.**

### Identity Profile / CSV path

`identityProfileMappingUtils.mapLifecycleFromCsvValue` can map values like `NEW_HIRE`/`ONBOARDING` → `NEW`, leave-like → `LEAVER`, etc.

### Refresh service

`identityProfileRefreshService` defaults missing lifecycle to **`ACTIVE`**.

### Answers

| Question | Answer |
| -------- | ------ |
| What causes NEW? | CSV/profile lifecycle mapping primarily; **not** current OrangeHRM mapper |
| ACTIVE? | Default HRMS healthy status; profile default |
| MOVER? | Enum exists; **no automatic detector found** |
| LEAVER? | CSV mapping / governance uses; HRMS uses TERMINATED/INACTIVE |
| Calculated vs imported? | Mostly imported/mapped; not delta-based |
| Previous state stored? | `LifecycleEvent.previousState` schema exists; **no emitter found on HRMS sync** |
| Detect previous≠NEW → current=NEW? | **Not implemented**; would need read-before-write on upsert |
| Sync job ID? | HRMS doc has `lastIdentitySyncAt/Count/Error`; **no Joiner batch id** |
| Newly created during sync? | Upsert does not return `upserted` vs `updated` distinctly in the simple loop (**INFERENCE:** `findOneAndUpdate` result can expose, but code ignores it today) |
| Event emitter / post-sync hook? | After sync: `recomputeIdentityTenantStats` only — **no Joiner hook** |

**FUNCTIONAL DECISION REQUIRED — Joiner trigger definition:**

1. First-seen identity (insert on upsert) during HRMS sync batch, **or**  
2. Explicit lifecycle `NEW`, **or**  
3. HR status transition matrix, **or**  
4. Manual/API trigger for MVP.

**Recommendation (design):** Prefer **(1) insert detection + optional attribute rules**, because OrangeHRM path never sets `NEW`. Do **not** block MVP on lifecycleState alone.

---

## 6. HRMS Sync Execution & Joiner Insertion Point (Part 6)

### Flow (actual)

```text
POST /api/integrations/hrms/sync-identities
  → hrmsIntegrationController
  → sync identities service (hrmsIdentitySyncService)
       fetch employees (+ contact enrich)
       if identity profile mode: runOrangeHrmIdentityRefresh
       else: per-employee findOneAndUpdate upsert (tenant Identity + Legacy)
       save lastIdentitySync*
       recomputeIdentityTenantStats
```

**Scheduler:** HRMS sync is primarily **API-triggered** (route exists). Dedicated HRMS cron **UNKNOWN** / not required for design — Joiner should not assume a specific scheduler.

### Insertion point analysis

| Option | Pros | Cons | Verdict |
| ------ | ---- | ---- | ------- |
| A. After each upsert | Immediate | Blocks sync; N×rules×DB; LDAP risk if ever synced | **Reject for LDAP**; risky even for rule eval at 5k+ |
| B. After complete HRMS sync | Batch boundary clear | Large peak | **Good trigger to enqueue Joiner job** |
| C. After batch chunk | Scalable | Needs chunking refactor | Future |
| D. Separate async Joiner job | Non-blocking; retryable; matches AdSyncJob / worker patterns | Slight lag | **Recommended** |

**Recommended:**

```text
HRMS sync completes
  → enqueue JoinerEvaluationJob(tenantId, syncToken, candidateIdentityIds[])
  → worker/job evaluates rules offline
  → creates ProvisioningRequests (no LDAP in this phase)
```

Candidate set for MVP: identities **inserted** in this sync (capture IDs during upsert), or all identities with `lifecycleState=NEW` if product chooses that trigger.

---

## 7. Correlation Deep Analysis (Part 7)

### Production path

```text
UI Correlation Engine
  → POST /api/correlation/run/:applicationId
  → correlationController.runCorrelationForApp
  → Dynamic app user collection scan
  → Identity maps by attributes
  → IdentityAccountLink upsert / OrphanAccount
```

### Secondary unwired path

`correlationEngineService.runCorrelationEngine` (AccountAggregation) via `identityCubeController` — **not routed**.

### Answers

| Question | Answer |
| -------- | ------ |
| Automatic? | **No** (identity↔account) |
| Full app scan? | **Yes** for current API |
| Single-identity function? | **Not found** |
| After AD Sync safe? | Yes to **run existing full correlate**; expensive |
| Orphans / ambiguous / none | Orphan queue / ambiguous skip / unmatched orphan |

### Post-provision design (reuse)

```text
createAdUser success
  → scheduleAdSyncJobRun (existing)
  → on AdSyncJob completed
  → correlation refresh
```

**P0 MVP:** call existing full `runCorrelationForApp` for the AD application (acceptable at low Joiner volume).  
**P1:** add `correlateIdentityToApplication({ tenantId, identityId, applicationId })` to avoid full scans.

---

## 8. Provisioning Models (Part 8)

### ProvisioningRequest

- Enums: `GRANT|REVOKE|MODIFY|DEPROVISION|JOINER|LEAVER`
- Status: `PENDING|APPROVED|IN_PROGRESS|COMPLETED|FAILED|CANCELLED`
- `sourceType`: `CERTIFICATION|LIFECYCLE|ROLE_REQUEST|MANUAL`
- `approvalStatus`: `NOT_REQUIRED|PENDING|APPROVED|REJECTED`
- **No tenantId field on schema** — **gap / risk** (identityId implies tenant indirectly)

### ProvisioningPlan

- `operations: Mixed[]`, counts, status `COMPILED|EXECUTING|COMPLETED|PARTIAL|FAILED`

### ProvisioningTask

- Ops: `ADD_ACCOUNT|REMOVE_ACCOUNT|ADD_ENTITLEMENT|REMOVE_ENTITLEMENT|DISABLE|ENABLE`
- Status: `PENDING|RUNNING|COMPLETED|FAILED|RETRYING|SKIPPED`
- `retryCount` / `maxRetries=3`
- `targetAttributes: Mixed`
- **No unique idempotency key field** beyond opportunistic request reuse in cert revoke

### ProvisioningResult

- Per task: statusCode, responseBody, isSuccess, durationMs — **thin usage today**

### ProvisioningPolicy

- `triggerEvent` Joiner/…, `applications[]`, `actions Mixed`, `approvalRequired`, `isActive`
- **No tenantId**, **no evaluator**, **no CRUD routes found** dedicated beyond generic absence

### LifecycleEvent

- JOINER/MOVER/…, statuses, previous/new state, optional `provisioningRequestId`
- CRUD only via `/api/lifecycle`

### AccessRequest / WorkflowDefinition(provisioning)/WorkflowInstance

- Parallel schemas; **not** the live remediation workflow engine

### Existing consumer that builds Request→Plan→Task

**Only production builder found:** `enqueueCertRevokeProvisioning` (REVOKE / REMOVE_ENTITLEMENT).

**JOINER + ADD_ACCOUNT are already valid enum values** — unused by services.

---

## 9. ProvisioningTask State Machine (Part 9)

### Schema statuses

`PENDING | RUNNING | COMPLETED | FAILED | RETRYING | SKIPPED`

### Actual transitions today

```text
enqueueCertRevokeProvisioning → PENDING

provisioningWorker.processTask:
  if resolveConnector() null → leave PENDING (no transition)
  else PENDING → RUNNING
       → COMPLETED or FAILED
  (RETRYING / SKIPPED not written by worker today)
```

**Accurate implemented machine (when connector wired):**

```text
PENDING ──claim──► RUNNING ──► COMPLETED
                      └──► FAILED
```

**Declared but unused by worker:** `RETRYING`, `SKIPPED`.

**Missing for production:** atomic claim (`findOneAndUpdate` PENDING→RUNNING), lease/lock, idempotency key, SUCCEEDED alias (uses COMPLETED).

---

## 10. Provisioning Worker (Part 10)

**File:** `icm-backend/src/services/provisioning/provisioningWorker.js`

| Topic | Behavior |
| ----- | -------- |
| Startup | `server.js` → `startProvisioningWorker()` |
| Enable | `PROVISIONING_WORKER_ENABLED=true` |
| Interval | default 60s |
| Poll | `ProvisioningTask.find({ status: PENDING }).limit(25)` |
| Concurrency | sequential in tick; **no distributed lock** |
| Claim | status set RUNNING **after** connector resolved — race-prone |
| resolveConnector | **always null** |
| On success | update task/request/plan; `runExecution(executionId, { resume: "verify" })` if cert |

### Recommended connector resolution (matches existing architecture)

```text
resolveConnector(applicationId):
  load Application by id
  if !app → null
  family = getConnectorDefinition(app.connectorType).family
  if family === 'ldap_ad' (or ACTIVE_DIRECTORY / connectionConfig.ad):
    return AdProvisioningConnector { executeTask }
  return null
```

`executeTask` for `ADD_ACCOUNT`:

```text
load Identity by targetAttributes.identityId (+ tenant check)
merge ProvisioningPolicy / snapshot attrs from targetAttributes
normalizeAdConfig(app.connectionConfig.ad)
createAdUser(cfg, userSpec)
return { status: "COMPLETED"|"FAILED", message, detail }
```

**Do not** put LDAP in workflow handlers.

---

## 11. Idempotency / Duplicate Protection (Part 11)

### Existing patterns to reuse

1. **Cert revoke:** reuse open Request by `sourceType + sourceId`  
2. **AD create:** pre-add duplicate search on sAMAccountName/UPN; LDAP 68 mapping  
3. **AdSyncJob:** inFlight job set per jobId  

### Required Joiner keys (design)

| Layer | Proposed key |
| ----- | ------------ |
| Lifecycle / Joiner detection | `(tenantId, identityId, triggerType=JOINER, syncToken?)` unique open event |
| ProvisioningRequest | `sourceType=LIFECYCLE`, `sourceId=joiner:{identityId}:{applicationId}` (or hash) |
| ProvisioningTask | unique on `(requestId, applicationId, operationType=ADD_ACCOUNT)` while open |
| Worker claim | atomic PENDING→RUNNING with `startedAt` |
| AD | existing duplicate check; treat DUPLICATE_ACCOUNT as **terminal success or SKIPPED** (**FUNCTIONAL DECISION**: success-if-exists vs fail) |

### Timeout after AD success

Snapshot `dn`, `objectGUID`, `sAMAccountName` into `ProvisioningResult` / `targetAttributes` **before** returning; on retry, if result exists or AD duplicate found → COMPLETED without second add.

---

## 12–14. Workflow Engine & Joiner Workflow (Parts 12–14)

### Reuse

- `enqueueRevokeExecution` / `runExecution` / WAITING / resume  
- `createIgaAdapter` pattern (side effects return `{success,error}`)  
- Global Rule Set **action→workflow** mapping pattern  
- Workflow task queue + scheduler (optional for Joiner; cert revoke uses queue-first)

### Smallest change for Joiner

1. Add action key `JOINER` to workflow task actions / remediation mapping UI.  
2. Build Joiner trigger payload (identityId, applicationId, requestId, tenantId).  
3. New adapter methods: `enqueueJoinerProvisioning` / `verifyAccountExists` — **no LDAP**.  
4. Workflow graph MVP:

```text
Start
  → (optional) Approval / WaitForDecision
  → EnqueueProvisionAccount   // creates/ensures Request→Plan→Task ADD_ACCOUNT
  → Wait / EndWaiting         // until task COMPLETED (poll or worker callback)
  → VerifyAccountLinked       // optional: check IdentityAccountLink or aggregation
  → EndSuccess / EndFailure
```

### Boundary recommendation (Part 13) — **B + service**

```text
Workflow (orchestration/approval)
  ↓
Provisioning Service enqueueJoinerProvision(...)
  ↓
Request → Plan → Task(ADD_ACCOUNT)
  ↓
Worker → Connector → createAdUser
```

**Not A** (workflow creating Task directly with LDAP knowledge).  
**Not C** (workflow calling LDAP).

### Approval questions

| Question | Answer |
| -------- | ------ |
| Every Joiner needs approval? | **FUNCTIONAL DECISION REQUIRED** — `ProvisioningPolicy.approvalRequired` defaults `true` but unused |
| Rules determine approval? | Not today; could be rule action flag or policy |
| Rejection? | Request `approvalStatus=REJECTED`; no task execution |
| Provision fail? | Task FAILED; workflow EndFailure / retry policy **FUNCTIONAL DECISION** |
| Worker knows when? | Task PENDING after enqueue (approval already done) **or** task created only after approval |

**Recommended:** create Request at rule match; workflow handles approval; **Task created only when approved** (or immediately if NOT_REQUIRED).

---

## 15. ProvisioningPolicy vs Global Ruleset (Part 15)

| Concern | Own | Content |
| ------- | --- | ------- |
| **WHO** | Identity Provisioning Rules (new under Global Rule Set UX) | Identity attribute conditions → ENSURE_ACCOUNT(applicationId) |
| **WHICH workflow** | Extend RemediationWorkflowRule mappings | JOINER → workflowId |
| **HOW** | ProvisioningPolicy (activate schema) | naming source, targetOuDn overrides, UPN, required attrs, approvalRequired |

This aligns with IdentityIQ split (Lifecycle/Business process vs Provisioning Policy) without copying IIQ project/provisioner internals.

**Validate:** Current `ProvisioningPolicy` lacks tenantId and condition AST — extend carefully.

---

## 16. Provisioning Payload Design (Part 16)

### Task.targetAttributes (recommended MVP snapshot)

```text
{
  tenantId,
  identityId,
  applicationId,
  applicationName,
  operationType: "ADD_ACCOUNT",
  ruleId,
  provisioningPolicyId?,
  workflowExecutionId?,
  requestId,
  // Snapshot for audit / offline worker (avoid drift):
  userSpec: {
    sAMAccountName,   // resolved
    userPrincipalName?,
    givenName, sn, displayName,
    mail, department, employeeID, ...
  },
  adConfigRef: { targetOuDn, upnSuffix, samAccountNameSource } // non-secret
}
```

**Do not** store bindPassword on the task. Worker loads secrets from `Application.connectionConfig.ad` at execution time.

`createAdUser(cfg, userSpec)` already matches this split.

---

## 17. Multi-Tenancy (Part 17)

| Object | Tenant field today | Joiner requirement |
| ------ | ------------------ | ------------------ |
| Identity | yes | filter always |
| Application | yes | must match identity.tenantId |
| RemediationWorkflowRule | tenantId string | yes |
| ProvisioningRequest/Task | **missing tenantId** | **add or always join via identity** (P0 risk) |
| Ad create endpoint | app by id | verify tenant (**UNKNOWN** if middleware enforces) |

Propagate `tenantId` explicitly on Request/Plan/Task for Joiner.

---

## 18. Concurrency / Scale (Part 18)

### Avoid

- Evaluating 50 rules × 5000 identities with per-rule DB hits inside HRMS sync  
- Synchronous `createAdUser` during HRMS sync  
- Full correlation after every single Joiner at high volume (use batched / single-identity later)

### Prefer (no new brokers)

- Candidate ID list from sync  
- Async Joiner evaluation job (in-process like AdSyncJob or worker tick)  
- Preload rules + AD application config once per job  
- Bulk identity fetch by `_id ∈ candidates`  
- Dedup Request by sourceId  
- Worker limit 25/tick already  
- Cap concurrent LDAP creates (**FUNCTIONAL**: serial per tenant initially)

---

## 19. Failure / Recovery Matrix (Part 19)

| Failure | Expected State | Retry? | Workflow | User Action |
| ------- | -------------- | ------ | -------- | ----------- |
| HRMS sync failure | No Joiner job | N/A | — | Fix HRMS; re-sync |
| Rule eval failure | Job FAILED; no requests | Job retry | — | Fix rule/attrs |
| No rule match | No request (audit optional) | No | — | Adjust rules |
| Workflow start fail | Request PENDING; no execution | Retry enqueue | — | Ops |
| Approval rejected | Request REJECTED | No | EndFailure/Skipped | — |
| Task create fail | Request IN_PROGRESS stuck | Compensating | Fail | Ops |
| LDAP unavailable | Task FAILED/RETRYING | Yes (maxRetries) | Wait/Fail | Wait for AD |
| LDAP 50 denied | Task FAILED | No auto | Fail | AD ADMIN |
| Duplicate AD | COMPLETED or SKIPPED | No | Success path | **FUNCTIONAL** |
| Timeout after create | Retry finds duplicate/GUID | Yes safe | Resume | — |
| AD Sync fail | Account in AD; not in IS | Re-run sync | Verify wait | Ops |
| Correlation fail | Account orphan | Re-run correlate | — | Ops |
| Worker crash mid-run | RUNNING stale | Reaper → RETRYING | — | **CODE TODO** reaper |

---

## 20. Audit / Observability (Part 20)

### Existing

- `morgan` HTTP logs  
- `console.*` with tags (`[ad-create]`, `[ad-sync:jobId]`, `[provisioningWorker]`)  
- `UnifiedAuditEvent` includes `PROV_COMPLETE` enum — limited writers  
- `RemediationAuditLog` for remediation  

### Recommended event chain (MVP subset first)

Must-have MVP: `JOINER_DETECTED`, `RULE_MATCHED`, `PROVISIONING_REQUEST_CREATED`, `WORKFLOW_STARTED`, `TASK_STARTED`, `AD_CREATE_SUCCESS|FAILED`, `JOINER_COMPLETED`.

Defer full list until after live AD path works.

---

## 21. Frontend Requirements (Part 21)

### Existing GRS UI

Cannot configure ENSURE_ACCOUNT without new tile/fields.

### Minimum UI for MVP

1. **New Global Rule Set tile:** Identity provisioning rules (conditions + application + optional workflow).  
2. Extend Remediation workflow rules with **JOINER** mapping.  
3. **Optional MVP:** no new status dashboard — use existing provisioning CRUD APIs / Mongo; add status UI in P2.

### Not required for first MVP

Full Joiner operations console (nice-to-have P2).

---

## 22. Test Strategy (Part 22)

### Unit

- Condition AST eval (reuse discovery evaluateCondition)  
- Joiner candidate detection (insert vs update)  
- Request idempotency key  
- Payload builder (existing `adUserCreatePayload` tests)  
- resolveConnector family routing  
- Task state transitions  

### Integration (no AD)

- HRMS sync fixture → candidate IDs  
- Rule match → Request created once  
- Approval NOT_REQUIRED → Task PENDING  
- Worker + **mock connector** returning COMPLETED  
- Duplicate sourceId reuse  

### Live AD (when up)

- `createAdUser` → sync → aggregation GUID → correlation  

### E2E

As in user Definition of Done (section 29).

---

## 23. AD Outage Strategy (Part 23)

| Implement now | Defer live |
| ------------- | ---------- |
| Joiner detection job | Real LDAP add |
| Rules model + evaluator | Permission matrix on OU |
| Request/Plan/Task wiring | GUID from real AD |
| Worker + mock connector | Password/enable |
| Workflow JOINER mapping | — |
| Idempotency | — |

Mock connector: in-test double only; production `resolveConnector` never returns mock.

---

## 24. SailPoint Functional Mapping (Part 24)

| IdentityIQ Concept | Identity Sphere Concept | Existing? | Extension |
| ------------------ | ----------------------- | --------- | --------- |
| Identity | `Identity` | Yes | — |
| Identity Refresh | HRMS sync / profile refresh | Yes | Joiner hook after |
| Lifecycle Event | `LifecycleEvent` | Schema/CRUD | Emitter |
| Joiner | requestType JOINER + detection | Partial | Detector + rules |
| Business Process / Workflow | Remediation workflow engine | Yes (revoke) | JOINER template |
| Provisioning Policy | `ProvisioningPolicy` | Schema | HOW fields + tenant |
| Provisioning Plan | `ProvisioningPlan` | Yes | ADD_ACCOUNT ops |
| Provisioning Project | — | No | **Do not add** |
| Provisioner | `provisioningWorker` | Stub | Wire connectors |
| Connector | `adLdapService` / dispatcher | Read + createUser | Worker adapter |
| Account Request | Task ADD_ACCOUNT + userSpec | Partial | Snapshot attrs |
| Attribute Request | userSpec / policy map | Partial | Policy |
| Provisioning Result | `ProvisioningResult` | Thin | Write on execute |
| Aggregation | AD Sync pipeline | Yes | Post-create |
| Correlation | Manual run API | Yes | Auto/single later |

---

## 25. Exact Implementation Design (Part 25)

```text
HRMS Sync (hrmsIdentitySyncService)
  → capture inserted identityIds + tenantId + syncToken
  → enqueue JoinerEvaluationJob  [NEW]

JoinerEvaluationJob  [NEW]
  → load Identity Provisioning Rules (tenant)  [NEW model]
  → evaluateCondition via discoveryEvaluationService (reuse)
  → for each match where ENSURE_ACCOUNT(applicationId):
        if IdentityAccountLink already exists for app → skip
        enqueueJoinerProvisioning(...)  [NEW, clone cert revoke]

enqueueJoinerProvisioning  [NEW]
  → idempotent ProvisioningRequest (JOINER, sourceType=LIFECYCLE)
  → if approval required: start JOINER workflow (mapping)
  → else: compile Plan + Task(ADD_ACCOUNT) immediately

Workflow (reuse engine)
  → Approval?
  → adapter.enqueueJoinerProvisioningTasks / mark APPROVED
  → wait for task completion (poll ProvisioningTask or resume hook)

provisioningWorker (EXISTING — extend)
  → resolveConnector(applicationId)  [CHANGE]
  → AdConnector.executeTask  [NEW module]
  → createAdUser (EXISTING)

Result
  → ProvisioningResult + task COMPLETED
  → optional scheduleAdSyncJobRun
  → optional correlation run
```

### Error behavior summary

- Detection/rules: fail job, no partial LDAP  
- Duplicate request: reuse  
- LDAP fail: task FAILED, workflow failure path  
- LDAP duplicate: policy-defined COMPLETED/SKIPPED  

---

## 26. File-by-File Change Plan (Part 26)

| Priority | File | Existing Responsibility | Proposed Change | Risk |
| -------- | ---- | ----------------------- | --------------- | ---- |
| P0 | `services/provisioning/provisioningWorker.js` | Poll tasks | Implement `resolveConnector` + claim | Medium |
| P0 | `services/provisioning/adProvisioningConnector.js` **(new)** | — | `executeTask` → `createAdUser` | Low |
| P0 | `services/provisioning/enqueueJoinerProvisioning.js` **(new)** | — | Clone cert revoke for JOINER/ADD_ACCOUNT | Low |
| P0 | `services/joiner/joinerEvaluationJob.js` **(new)** | — | Post-sync evaluation | Medium |
| P0 | `services/hrmsIdentitySyncService.js` | HRMS upsert | Capture inserts; enqueue job | Medium |
| P0 | New rules model + service + routes | — | WHO rules | Medium |
| P0 | `constants/workflowTaskQueue.js` + remediation rule service/UI | Action maps | Add JOINER | Low |
| P1 | `workflows/adapters/igaAdapter.js` | Revoke side effects | Joiner enqueue / verify (no LDAP) | Medium |
| P1 | Joiner workflow template JSON | — | Seed like access-revoke-option2 | Low |
| P1 | `models/provisioning/ProvisioningRequest.js` (+ Task) | Schemas | Add `tenantId`, idempotency index | Low |
| P1 | Activate `ProvisioningPolicy` HOW fields | Schema | CRUD + resolve into userSpec | Medium |
| P1 | Correlation single-identity helper | Full scan only | Optional optimize | Medium |
| P2 | Frontend GlobalRuleSet tile | Hub | Provisioning rules UI | Medium |
| P2 | Audit writers | Thin | Joiner events | Low |
| P2 | Task reaper for stuck RUNNING | — | RETRYING | Low |
| P3 | Mover/Leaver | — | Out of scope | — |

**Do not modify** AD sync read path, posture, reporting rules, or cert revoke behavior except additive action enum.

---

## 27. Non-Goals / Anti-Overengineering (Part 27)

No Kafka/Redis/microservices.  
No second LDAP stack.  
No IIQ Provisioning Project.  
No full Access Profile product in MVP.  
One rule → one AD app → one account.

---

## 28. Security (Part 28)

| Risk | Mitigation |
| ---- | ---------- |
| Cross-tenant app create | Enforce `identity.tenantId === application.tenantId` |
| Unauthorized Joiner | Org-admin for rules; existing authz for workflows |
| Secrets on tasks | Never persist bindPassword on Task |
| Confirm gate bypass | Keep test-create confirm; production via worker only |
| Rule editors | Org-admin only (match GRS) |
| AD create permissions | AD ADMIN REQUIRED |

---

## 29. Final Recommendation

### Recommended Architecture

Separate **WHO** (new identity provisioning rules), **WHICH workflow** (extend remediation mapping with JOINER), **HOW** (ProvisioningPolicy), **EXECUTE** (worker → `createAdUser`).

### Recommended Data Flow

Post-HRMS async evaluation → idempotent JOINER Request → workflow approval → Plan/Task → worker → AD → (later) sync/correlate.

### Recommended State Machines

- Task: PENDING → RUNNING → COMPLETED|FAILED (+ later RETRYING)  
- Request: PENDING → APPROVED/IN_PROGRESS → COMPLETED|FAILED|CANCELLED  

### Recommended Implementation Order

1. Mock-backed worker + enqueueJoinerProvisioning (no AD)  
2. Joiner detection + rules evaluator (no AD)  
3. Workflow JOINER mapping + approval path  
4. Live AD create validation when DC up  
5. AD Sync + correlation automation  
6. UI for rules + audit hardening  

### Functional Decisions Required

1. Joiner trigger (insert vs lifecycle NEW vs other)  
2. Meaning of `memberOf` in business rule (HR field vs AD group — **cannot be AD memberOf pre-account**)  
3. Approval required default  
4. Duplicate AD account = success or failure  
5. Whether Task is created before or after approval  
6. WHO rules model home (new vs ProvisioningPolicy vs Discovery)  

### AD Admin Decisions Required

1. `targetOuDn`  
2. `upnSuffix`  
3. Create permissions on OU  
4. Disabled-without-password acceptable for MVP?  

### Technical Unknowns

1. Tenant check on application write endpoints  
2. HRMS scheduled sync existence  
3. Whether to revive AccountAggregation correlation engine  

### Risks

- Misusing Global Rule Set posture/reporting for Joiner conditions  
- Blocking HRMS sync with LDAP  
- Double create without idempotency keys  
- Full correlation cost after each Joiner  

### Tests Required

See Part 22; prioritize unit + mock worker before live AD.

### Definition of Done (Joiner MVP)

1. New HRMS identity arrives and is persisted.  
2. Joiner candidate detected **exactly once** per identity/application.  
3. Identity provisioning rule evaluates (`department`/`location`-style attrs as configured).  
4. Match yields ENSURE_ACCOUNT for AD application.  
5. `ProvisioningRequest` (JOINER) created idempotently.  
6. Workflow starts via JOINER mapping (or NOT_REQUIRED path).  
7. Approval works when configured; rejection blocks tasks.  
8. Plan compiled with ADD_ACCOUNT.  
9. Task PENDING created once.  
10. Worker claims exactly once (atomic).  
11. Connector resolves to AD.  
12. `createAdUser` invoked (live when AD up; mock in CI).  
13. Result persisted; task COMPLETED/FAILED.  
14. Duplicate execution prevented (request + AD duplicate).  
15. When AD available: AD Sync discovers account; objectGUID in aggregation.  
16. Correlation can link Identity↔account (full run MVP).  
17. Status visible via provisioning APIs / logs.  
18. Failures recoverable per matrix.  
19. Existing AD aggregation + cert remediation **unchanged**.  
20. No secrets in logs/tasks.  

---

# Design Readiness

- Current architecture understood: **YES**
- Global Ruleset understood: **YES** (hub ≠ Joiner IF/THEN engine)
- Joiner trigger understood: **PARTIAL** — HRMS does not set NEW; insert-based trigger recommended; **FUNCTIONAL DECISION REQUIRED**
- Provisioning models understood: **YES**
- Worker understood: **YES** (stub; wiring design clear)
- Workflow integration understood: **YES** (reuse remediation engine + action mapping)
- Correlation understood: **YES** (manual full-scan; post-provision design defined)
- AD write integration understood: **YES** (`createAdUser`; not worker-wired; not live-tested)
- Multi-tenant implications understood: **YES** (Request/Task tenantId gap noted)
- Idempotency strategy defined: **YES** (design; not implemented)
- Failure strategy defined: **YES**
- Scale strategy defined: **YES** (async post-sync evaluation)
- Test strategy defined: **YES**
- Functional decisions remaining: trigger definition; rule attribute semantics (`memberOf`); approval defaults; duplicate-as-success; WHO model placement
- Technical blockers: none for offline implementation; **AD down** blocks live create/sync/correlate proof
- AD-dependent validation: `createAdUser`, OU permissions, sync visibility, GUID aggregation, correlation after create

---

*End of design document. Implementation must not begin until functional decisions above are confirmed for MVP scope.*
