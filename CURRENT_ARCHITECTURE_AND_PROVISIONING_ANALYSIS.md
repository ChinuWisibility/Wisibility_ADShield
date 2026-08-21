# Identity Sphere — Current Architecture & Provisioning Analysis

> Analysis only. **No source code was modified** while generating this document.  
> AD server status at analysis time: **DOWN / unreachable** — LDAP WRITE is **IMPLEMENTED BUT NOT LIVE-TESTED**.  
> Related prior analysis: `LDAP_CONNECTOR_IMPLEMENTATION_GUIDE.md` (connector-focused). This document covers the full platform architecture for JML provisioning readiness.

**Generated:** 2026-08-12  
**Codebase:** Wisibility IGA (`icm-backend` + `icm-frontend`)  
**LDAP library:** `ldapts@8.1.8`

---

## 1. Executive Summary

Identity Sphere is a **multi-tenant IGA platform** (Express + MongoDB backend, React frontend) with mature capabilities for:

- Identity aggregation (HRMS, CSV, connectors)
- Application account aggregation (especially Active Directory LDAP **read** / sync)
- Identity↔account correlation (manual UI-driven)
- Access certification + **remediation workflows** (revoke path)
- AD Security posture scanning
- Data hygiene / SoD / governance modules

**Provisioning toward target systems is largely scaffolding + one connector-level write capability:**


| Capability                                   | Status                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| AD LDAP **READ** (sync, test, posture)       | **IMPLEMENTED** and used in production paths                                           |
| AD LDAP **WRITE** (`Client.add` create user) | **IMPLEMENTED BUT NOT LIVE-TESTED** (AD down); connector-level only                    |
| Provisioning models (Request/Plan/Task)      | **IMPLEMENTED** (schema + CRUD + cert-revoke enqueue)                                  |
| Provisioning worker → connector              | **PARTIALLY IMPLEMENTED** — worker polls tasks but `resolveConnector()` returns `null` |
| Workflow engine                              | **IMPLEMENTED** for **certification revoke / remediation**, not Joiner                 |
| Global provisioning rules / Joiner detection | **NOT IMPLEMENTED** (schemas + CRUD only)                                              |
| End-to-end Joiner → AD create                | **NOT IMPLEMENTED**                                                                    |


**Bottom line for JML:** The platform has the **identity spine**, **AD read sync**, a **new AD create-user primitive**, a **remediation workflow engine**, and **provisioning data models**. It does **not** yet connect: Joiner detection → rules → workflow approval → provisioning worker → `createAdUser`.

---



## 2. Repository Structure

```text
Wisibility_IGA/
├── icm-backend/          # Express API, MongoDB, LDAP, workflows, jobs
├── icm-frontend/         # React + Vite SPA
├── installer/            # Windows packaging (not IGA runtime logic)
├── docs/, scripts/, cert/
├── LDAP_CONNECTOR_IMPLEMENTATION_GUIDE.md   # prior connector analysis
└── package.json          # npm workspaces root
```



### `icm-backend/src` map (responsibilities from code)


| Area        | Path           | Responsibility                                                             |
| ----------- | -------------- | -------------------------------------------------------------------------- |
| Entry       | `server.js`    | Express app, route mount, start workers/schedulers                         |
| Config      | `config/`      | env, connector catalog, production config, DB                              |
| Routes      | `routes/`      | HTTP API surface (`/api/...`)                                              |
| Controllers | `controllers/` | Request handlers (apps, AD, identity, cert, security…)                     |
| Services    | `services/`    | Business logic (AD LDAP, sync, correlation, HRMS, provisioning, workflow…) |
| Models      | `models/`      | Mongoose schemas (identity, access, provisioning, workflow, security…)     |
| Workflows   | `workflows/`   | Graph executor, step handlers, persistence, adapters                       |
| Jobs        | `jobs/`        | Polling schedulers (cert, remediation, workflow task queue)                |
| Middleware  | `middleware/`  | Auth, permissions, audit, errors                                           |
| Utils       | `utils/`       | Tenant scope, crypto, LDAP DN helpers, correlation helpers                 |
| Licensing   | `licensing/`   | Offline product license                                                    |
| Scripts     | `scripts/`     | Ops/QA; includes `scripts/ad/liveCreateAndSyncVerify.js`                   |




### `icm-frontend/src` (relevant)


| Area                                   | Responsibility                                |
| -------------------------------------- | --------------------------------------------- |
| `pages/applications/`                  | App Registry, AD sync UI, schema mapping      |
| `pages/identities/`                    | Identities, Correlation Engine                |
| `features/workflows/`                  | Workflow builder (remediation-oriented)       |
| `features/workflow-remediation-queue/` | Remediation queue UI                          |
| `services/api.js`                      | Axios API client (AD sync, correlation, etc.) |


---



## 3. Current System Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        icm-frontend (React)                      │
│  App Registry │ Identities │ Correlation │ Workflows │ Certs     │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP /api/*
┌───────────────────────────────▼─────────────────────────────────┐
│                     icm-backend (Express)                         │
│  Auth/JWT │ Controllers │ Services │ Workflow Engine │ Jobs       │
└───────┬───────────────────┬───────────────────┬─────────────────┘
        │                   │                   │
        ▼                   ▼                   ▼
   MongoDB             ldapts Client        External HRMS
   (tenant data,       (AD LDAP R/W)        (OrangeHRM / CSV)
    jobs, workflows)
```

**Evidence:** `icm-backend/src/server.js` mounts `/api/applications`, `/api/identities`, `/api/correlation`, `/api/provisioning`, `/api/lifecycle`, `/api/remediation-workflows`, `/api/integrations/hrms`, etc., and starts `startProvisioningWorker()` + `startSchedulerJob()`.

---



## 4. Identity Ingestion Architecture

Identity data enters through **multiple sources**. There is no single universal “aggregator” class; each source has its own service path.

### 4.1 HRMS → Identity

```text
POST /api/integrations/hrms/sync-identities
  → hrmsIntegrationController.syncHrmsIdentities
  → hrmsIdentitySyncService / identityProfileRefreshService
  → Identity documents (tenant dynamic collection + legacy)
```

**Evidence:**

- `icm-backend/src/routes/hrmsIntegrationRoutes.js` — `POST /sync-identities`
- `icm-backend/src/services/hrmsIdentitySyncService.js` — maps HRMS employees → identity fields (`employeeId`, names, email, `lifecycleState`, …)
- `icm-backend/src/models/identity/Identity.js` — person of record



### 4.2 Delimited / CSV → Identity or Application users

CSV import / Map & import flows via application controllers and `delimitedApplicationUserSync.js` / `identityProfileRefreshService.js`.

### 4.3 AD LDAP → Application accounts (not HRMS identity)

```text
POST /api/applications/:id/ad/sync
  → adConnectorController.syncAdUsersFromAd
  → AdSyncJob + runAdSyncPipeline
  → fetchAdDirectory (LDAP READ)
  → ingestApplicationFromAdDirectory
       → reconciliation / dynamic app user collection
       → upsertAggregationsFromAdUserDocs (account_aggregations_v2)
       → entitlements + account↔entitlement correlation
```

**Evidence:** `adSyncPipelineService.js`, `adDirectorySyncService.js`, `adAccountAggregationService.js`, `adLdapService.js`.

### 4.4 Universal connector sync (other families)

```text
POST /api/applications/:id/connectors/sync
  → connectorDispatcher.dispatchSync(family)
  → family-specific fetch (LDAP AD users-only, JDBC, REST, SCIM, Graph, …)
```

**Evidence:** `connectorDispatcher.js`, `connectorCatalog.js`.

### Actual identity lifecycle spine (current)

```text
HRMS / CSV / Profile import
        ↓
Identity create/update (Mongo)
        ↓
[Manual] Correlation Engine UI
        ↓
IdentityAccountLink / OrphanAccount
        ↓
Identity cube / Accounts UI / Cert campaigns
```

**AD sync does NOT auto-run identity↔account correlation.** It auto-runs **account↔entitlement (membership)** correlation only.

---



## 5. Identity / Account / Entitlement Model



### Core entities


| Model                                | Collection / location                | Role                                                                                |
| ------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------- |
| `Identity`                           | tenant dynamic + legacy `identities` | Authoritative person                                                                |
| `IdentityAccountLink`                | `identity_account_links`             | Identity ↔ app account link                                                         |
| `AccountAggregation`                 | `account_aggregations_v2`            | Cube/aggregation of accounts                                                        |
| Dynamic app users                    | per-tenant/app collections           | Live application accounts                                                           |
| `Entitlement` / dynamic entitlements | app-scoped                           | Groups/roles as entitlements                                                        |
| `Application`                        | `applications`                       | Connector + `connectionConfig`                                                      |
| `CorrelationRule`                    | `correlation_rules`                  | Attribute match rules (aggregation engine path)                                     |
| `OrphanAccount`                      | orphan queue                         | Uncorrelated accounts                                                               |
| `Role`                               | roles                                | Includes `type: birthright` enum — **no Joiner engine consumes this for AD create** |




### Identity important fields

`displayName`, `firstName`, `lastName`, `email`, `employeeId`, `department`, `title`, `manager*`, `lifecycleState` (`NEW|ACTIVE|MOVER|LEAVER|TERMINATED|QUARANTINE|INACTIVE`), `isCorrelated`, `tenantId`, `attributes` (Mixed), `sourceApplication`.

**Evidence:** `icm-backend/src/models/identity/Identity.js`.

### AccountAggregation important fields

`tenantId`, `applicationId`, `nativeAccountId` (prefers `objectGUID`), `accountName`, `status`, `rawAttributes`, `correlatedIdentityId`, `isOrphan`.

**Evidence:** `icm-backend/src/models/access/AccountAggregation.js`, `adAccountAggregationService.js` → `nativeAccountIdFromUser()`.

### Relationship overview (ASCII)

```text
Tenant
  ├── Identity (1..n)
  │     └── IdentityAccountLink ──► Application Account (dynamic / aggregation)
  ├── Application
  │     ├── connectionConfig.ad
  │     ├── userMappings / csvImportMapping
  │     ├── dynamic users + entitlements
  │     └── AccountAggregation
  ├── CorrelationRule (optional / parallel path)
  └── LifecycleEvent / Provisioning* (mostly unused for JML)
```

---



## 6. AD / LDAP Connector Architecture



### Library & connection


| Topic          | Actual implementation                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| Library        | `ldapts@8.1.8`                                                                                              |
| Client factory | `createLdapClient()` in `adLdapService.js`                                                                  |
| Bind           | Simple bind in `withBoundClient()`                                                                          |
| Pooling        | **None** — new client per operation; unbind in `finally`                                                    |
| TLS            | `ldaps://` or `tlsInsecure` → `tlsOptions.rejectUnauthorized` from `env.ldapRejectUnauthorized`             |
| Config         | `Application.connectionConfig.ad` via `normalizeAdConfig()`                                                 |
| Credentials    | `bindDn` + `bindPassword` (plaintext in AD config today; crypto helpers exist but are not wired to AD bind) |


**Evidence:** `icm-backend/src/services/adLdapService.js`, `icm-backend/package.json`, `icm-backend/src/config/env.js`.

### Connector registration

- Catalog: `connectorCatalog.js` — `ACTIVE_DIRECTORY` → family `ldap_ad`
- Dispatcher: `dispatchTest` / `dispatchSync` only (no write dispatch)
- Rich AD sync bypasses dispatcher and uses dedicated controller/pipeline

---



### 6.1 LDAP Read

**IMPLEMENTED** and production-used.


| Operation        | Function                                | Notes                              |
| ---------------- | --------------------------------------- | ---------------------------------- |
| Test bind+search | `testAdConnection`                      | sizeLimit 10 sample                |
| Fetch users      | `fetchAdUsers`                          | paged                              |
| Fetch directory  | `fetchAdDirectory`                      | parallel user/group/computer binds |
| Paging           | `fetchPagedSearchEntries`               | `searchPaginated`, pageSize ≤ 2000 |
| Normalize        | `normalizeUser` / `mapAdEntryToUserDoc` | status from UAC bit 2              |
| Sync job         | `runAdSyncPipeline`                     | progress on `AdSyncJob`            |


**Search defaults:** subtree; user filter `(&(objectClass=user)(objectCategory=person))`.

**Posture / security:** separate read paths (`postureFeatureLdap.js`, `ldapQueryTestService.js`) — still read-only.

---



### 6.2 LDAP Write

**IMPLEMENTED BUT NOT LIVE-TESTED.**


| Operation                  | Status                                               |
| -------------------------- | ---------------------------------------------------- |
| Create user (`Client.add`) | **IMPLEMENTED**                                      |
| Modify attributes          | **NOT IMPLEMENTED**                                  |
| Enable / disable           | **NOT IMPLEMENTED** (create forces disabled UAC 514) |
| Password / `unicodePwd`    | **NOT IMPLEMENTED** (explicitly avoided)             |
| Group membership write     | **NOT IMPLEMENTED**                                  |
| Delete / deprovision       | **NOT IMPLEMENTED**                                  |


**Evidence:** only `client.add` call site in app source is `createAdUser()` in `adLdapService.js`. Grep shows no `client.modify` / `client.del` usage.

---



### 6.3 Write Operations (detail)

**Entry points that can invoke write today:**

1. **Service:** `createAdUser(rawAdConfig, userSpec)` — `adLdapService.js`
2. **HTTP:** `POST /api/applications/:id/ad/test-create-user` — `testCreateAdUser` (requires `confirm: true`, `application.write`)
3. **Script:** `icm-backend/src/scripts/ad/liveCreateAndSyncVerify.js` (create + sync verify; blocked without AD)

**Does NOT invoke write today:**

- `provisioningWorker.resolveConnector()` → always `null`
- Workflow IGA adapter (revokes enqueue provisioning tasks only; no LDAP write)
- AD sync pipeline (read-only)

**Create flow (code):**

```text
normalizeAdConfig (requires targetOuDn, bind, url)
  → buildAdUserCreatePayload (pure)
  → withBoundClient
       → assertTargetOuExists (base search)
       → findDuplicateAdUser (sAMAccountName | UPN)
       → client.add(dn, attributes)
       → base search read-back (require visible entry)
```

**Payload attributes (typical):**  
`objectClass` [top, person, organizationalPerson, user], `cn`, `sAMAccountName`, `userPrincipalName`, `sn`, `displayName`, optional givenName/mail/department/title/employeeID/…, `userAccountControl=514` (disabled).

**Config keys added for write:** `targetOuDn`, `upnSuffix`, `samAccountNameSource` (`explicit` | `employeeId`).

**DN escaping:** `icm-backend/src/utils/ldapDn.js`.

---



### 6.4 Current Testing Status


| Test type                                                         | Status                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Unit tests (payload, DN escape, error classify, duplicate filter) | Present — `adUserCreatePayload.test.js`, `ldapDn.test.js`       |
| Live LDAP create against real AD                                  | **Blocked** — AD unreachable; prior attempt failed connectivity |
| Integration via AD Sync after create                              | **Blocked** (depends on live create)                            |
| Claim “write works in production AD”                              | **Must not be claimed** — no successful live evidence in repo   |


---



## 7. Provisioning Architecture



### What exists

```text
Certification revoke decision
  → workflow RevokeAccess step
  → igaAdapter.revokeEntitlement
  → enqueueCertRevokeProvisioning
       → ProvisioningRequest (REVOKE)
       → ProvisioningPlan (REMOVE_ENTITLEMENT)
       → ProvisioningTask (PENDING)
  → [optional] provisioningWorker tick
       → resolveConnector() === null  → task stays PENDING
  → ITSM ticket / manual remediation (V1 path)
```

**Evidence:**

- `certRevokeProvisioningService.js` → `enqueueCertRevokeProvisioning`
- `workflows/adapters/igaAdapter.js` → `revokeEntitlement`
- `provisioningWorker.js` → stub `resolveConnector`
- `routes/provisioningRoutes.js` → generic CRUD only (no “execute Joiner” API)



### Target-shaped pipeline vs reality


| Stage           | Target | Current                                                          |
| --------------- | ------ | ---------------------------------------------------------------- |
| Request         | Yes    | Yes (model + cert-revoke create; CRUD API)                       |
| Plan            | Yes    | Yes (model; compiled ops array)                                  |
| Workflow        | Yes    | Yes for **revoke remediation**, not Joiner                       |
| Approval        | Yes    | Cert decision is governance input; workflow waits on ITSM/verify |
| Task            | Yes    | Yes                                                              |
| Worker          | Yes    | Polling stub; **no connector**                                   |
| Connector write | Yes    | AD create exists **outside** worker                              |
| Result          | Yes    | `ProvisioningResult` model + CRUD; thin usage                    |




### AccessRequest model

`AccessRequest` exists (`ACCESS|ROLE|APPLICATION`) with status including `PROVISIONING` — **no evidence of a service that drives Joiner AD create from AccessRequest**.

### ProvisioningPolicy model

Schema supports `triggerEvent: JOINER|MOVER|LEAVER|…` and `applications` / `actions` — **no service evaluates policies**. Only model export found.

---



## 8. Workflow Architecture



### Engine location

`icm-backend/src/workflows/` — graph executor, step registry, handlers, persistence.

### How workflows are stored / run

- Definitions: workflow store (`workflows/persistence/workflowStore.js` → `getWorkflowById`)
- Live executions: `RemediationWorkflowExecution` model
- Start: `enqueueRevokeExecution` → fire-and-forget `runExecution(executionId)`
- Resume: `runExecution(id, { resume: "verify" | "itsm_closed" })`
- Adapter: `createIgaAdapter` — side effects return `{ success, error }`, do not throw into engine

**Evidence:** `workflowDispatcher.js`, `workflows/engine/executor.js`, `igaAdapter.js`.

### Step types (examples from handlers)

`RevokeAccess`, `VerifyAccessRemoved`, `CreateTicket`, `SendEmail`, `WaitForIAMDecision`, `EndSuccess`, `EndFailure`, …

**Primary event type:** `ACCESS_REVOKE` (certification remediation).

### Parallel “provisioning WorkflowDefinition” model

`models/provisioning/WorkflowDefinition.js` / `WorkflowInstance.js` exist as Mongo schemas — **separate from** the live remediation workflow engine. No evidence these drive Joiner.

### Reuse for JML

**Reusable:** graph executor, approval/wait patterns, persistence, email/ITSM steps, adapter pattern.  
**Not present:** Joiner trigger payload builder, “provision account” step that calls `createAdUser`, completion → correlation refresh.

---



## 9. Rules / Policy / Entitlement Architecture



### What can express access today


| Mechanism                     | Purpose                            | Can it drive “dept=IT → create AD”? |
| ----------------------------- | ---------------------------------- | ----------------------------------- |
| Correlation rules             | Match identity attr ↔ account attr | **No** (linking only)               |
| Role `birthright` type        | Role classification enum           | **No** automated Joiner engine      |
| SoD rules                     | Segregation of duties              | Detection, not provision            |
| Certification scope           | Who/what is reviewed               | Revoke path, not create             |
| ProvisioningPolicy schema     | Intended JML policies              | **Schema only**                     |
| AD suggestion / posture rules | Security recommendations           | Not account create                  |




### How “IF department==IT AND location==India THEN provision AD” would look **today**

**UNKNOWN / NOT REPRESENTABLE as an executable rule.** Closest artifacts:

- Identity fields `department`, `location`/`attributes` exist on Identity
- `ProvisioningPolicy.actions` is `Mixed[]` with no evaluator
- No rule engine binds conditions → `ADD_ACCOUNT` task → `createAdUser`

---



## 10. API Architecture



### Mount points (from `server.js`)


| Prefix                       | Domain                                 |
| ---------------------------- | -------------------------------------- |
| `/api/auth`                  | Login/session                          |
| `/api/applications`          | Apps, AD sync, connector sync, posture |
| `/api/identities`            | Identity CRUD/list                     |
| `/api/identity-profiles`     | Profiles / mapping                     |
| `/api/correlation`           | Rules CRUD + manual run                |
| `/api/integrations/hrms`     | HRMS config + sync                     |
| `/api/provisioning`          | Request/Plan/Task CRUD                 |
| `/api/lifecycle`             | LifecycleEvent CRUD                    |
| `/api/remediation-workflows` | Remediation workflow runs              |
| `/api/workflow-task-queue`   | Scheduler queue                        |
| `/api/access-certification`  | Campaigns / reviews                    |
| `/api/security`              | AD security assessments                |
| `/api/connectors`            | Connector configs                      |




### AD / LDAP endpoints (critical)


| Method | Path                                        | Purpose                  | Auth                                                |
| ------ | ------------------------------------------- | ------------------------ | --------------------------------------------------- |
| POST   | `/api/applications/ad/test-connection`      | LDAP test                | authenticate                                        |
| POST   | `/api/applications/:id/ad/sync`             | AD sync job              | authenticate                                        |
| GET    | `/api/applications/:id/ad-sync-jobs/:jobId` | Sync progress            | authenticate                                        |
| POST   | `/api/applications/:id/ad/test-create-user` | **Controlled AD create** | authenticate + `application.write` + `confirm:true` |
| POST   | `/api/applications/connectors/test`         | Universal test           | authenticate                                        |
| POST   | `/api/applications/:id/connectors/sync`     | Universal sync           | authenticate                                        |




### Provisioning endpoints

Generic CRUD under `/api/provisioning/requests|plans|tasks|results|deprovisioning` — **no dedicated “run Joiner” or “execute ADD_ACCOUNT against AD” orchestration API** beyond the AD test-create endpoint.

### Correlation endpoints


| Method | Path                                      | Purpose                                                       |
| ------ | ----------------------------------------- | ------------------------------------------------------------- |
| POST   | `/api/correlation/run/:applicationId`     | Manual identity↔app-user correlation (**production UI path**) |
| POST   | `/api/correlation/preview/:applicationId` | Dry-run                                                       |
| CRUD   | `/api/correlation/rules`                  | Rule documents                                                |


**Note:** `identityCubeController.runCorrelation` → `runCorrelationEngine` (AccountAggregation path) is **unwired** (no route import found).

---



## 11. Frontend Architecture

Relevant flows:

```text
App Registry
  → create AD app (connectionConfig.ad)
  → applicationAPI.syncAdUsers / waitForAdSyncJob
  → Current accounts table

Correlation Engine page
  → POST /correlation/run/:applicationId
  → correlated accounts / orphans UI

Workflow builder (features/workflows)
  → remediation-oriented steps (revoke / verify / ticket)
  → NOT Joiner provisioning

Certification UI
  → revoke decisions → remediation workflow enqueue
```

**Frontend does not yet expose** `test-create-user` in `api.js` (backend route exists; no `test-create-user` client helper found).

---



## 12. Async / Worker Architecture


| Mechanism                   | File                    | Behavior                                                                         |
| --------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| AD Sync job                 | `adSyncPipelineService` | In-process async after HTTP 202; progress on `AdSyncJob`                         |
| Provisioning worker         | `provisioningWorker.js` | `setInterval` 60s; **opt-in** `PROVISIONING_WORKER_ENABLED=true`; connector null |
| Scheduler job               | `jobs/scheduler.job.js` | 30s poll → workflow task queue for remediation                                   |
| Cert/remediation schedulers | `jobs/*Scheduler.js`    | Campaigns, reminders, workflow remediation events                                |
| Workflow execution          | `runExecution`          | Fire-and-forget; WAITING + `nextPollAt` for verify                               |




### How AD create happens today

**Synchronously** inside the HTTP request / script call to `createAdUser` (single LDAP bind session).  
**Not** via provisioning queue (unless future wiring).

---



## 13. Multi-Tenant Architecture


| Concern             | Current pattern                                          | Risk notes                                                                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant id           | `tenantId` on Identity, Application, aggregations, links | Helpers in `utils/tenantScope.js`                                                                                                                                                                                                                              |
| Dynamic collections | Per-tenant identity / app user collections               | `applicationDynamicCollections.js`                                                                                                                                                                                                                             |
| Auth                | JWT user → tenant; superAdmin can override               | Controllers resolve tenant from user                                                                                                                                                                                                                           |
| AD config           | Per Application (tenant-owned)                           | Write endpoint loads app by id — **must ensure caller’s tenant matches app** (verify in controller — currently loads by id only; **INFERENCE:** rely on app ACLs / permissions elsewhere — mark **UNKNOWN** if no explicit tenant check in `testCreateAdUser`) |
| Background jobs     | Tenant fields on scheduler/queue                         | Scheduler skips invalid orgId                                                                                                                                                                                                                                  |


**Documented concern (not fixed):** `testCreateAdUser` finds Application by `req.params.id` without an explicit `tenantId` equality check in the handler body — confirm whether global middleware enforces tenant isolation for application access (**UNKNOWN** without deeper authz audit).

---



## 14. Current JML Architecture



### 14.1 Joiner

**Currently implemented:**

- Identity `lifecycleState` can be `NEW` / mapped from HRMS
- `LifecycleEvent` schema includes `JOINER`
- `ProvisioningRequest.requestType` includes `JOINER`
- `ProvisioningPolicy.triggerEvent` includes `JOINER`
- AD **create user** connector capability (`createAdUser`) — **IMPLEMENTED BUT NOT LIVE-TESTED**
- Test HTTP endpoint for controlled create

**Partially implemented:**

- Provisioning Request/Plan/Task pipeline (used for revoke, not Joiner)
- Workflow engine (revoke, not Joiner)

**Not implemented:**

- Automatic Joiner detection from HRMS delta
- Global provisioning rule evaluation
- Joiner workflow template
- Worker → `createAdUser` wiring
- Post-create correlation automation
- Birthright entitlement assignment on join

**Cannot currently be tested because:**

- AD server down for live create
- End-to-end Joiner orchestration does not exist

---



### 14.2 Mover

**Currently implemented:**

- `lifecycleState: MOVER` on Identity
- Schema enums on LifecycleEvent / ProvisioningPolicy

**Not implemented:**

- Mover detection engine
- Attribute sync / OU move / group change provisioning
- LDAP modify

**Cannot currently be tested because:** no mover pipeline; AD down for any write.

---



### 14.3 Leaver

**Currently implemented:**

- `lifecycleState: LEAVER|TERMINATED|…`
- Governance orphan logic when inactive identity still has active account (`correlationGovernance.js`)
- Cert revoke / disable-oriented remediation workflows (access removal, not full AD disable write)
- `ProvisioningRequest` types `LEAVER` / `DEPROVISION` (schema)
- Task ops `DISABLE` / `REMOVE_ACCOUNT` (enum only)

**Not implemented:**

- LDAP disable/delete write
- Automated leaver → disable AD account

---



## 15. Current End-to-End Flow



### What works today (evidence-backed)

```text
HRMS sync → Identities
AD sync → App users + aggregations + membership correlation
Manual correlation → IdentityAccountLink
Certification → Revoke → Workflow → enqueue REMOVE_ENTITLEMENT task
(Worker does nothing without connector)
ITSM / manual remediation
```



### AD create path that exists but is isolated

```text
Admin/API confirm
  → POST .../ad/test-create-user
  → createAdUser (LDAP add, disabled)
  → [manual] AD Sync
  → [manual] Correlation
```



### Target Joiner path — not present as a connected pipeline

```text
HRMS Joiner → Rules → Workflow → Plan/Task → Worker → createAdUser → Sync → Correlate
```

---



## 16. Target Architecture

```text
HRMS / Authoritative Source
        ↓
Identity Aggregation
        ↓
Identity Creation / Update
        ↓
Correlation
        ↓
Lifecycle / JML Detection
        ↓
Global Provisioning Rules
        ↓
Provisioning Request
        ↓
Existing Workflow Engine
        ↓
Approval / Workflow Actions
        ↓
Provisioning Plan / Task
        ↓
Provisioning Worker
        ↓
Application Connector
        ↓
AD / LDAP WRITE
        ↓
Provisioning Result
        ↓
Audit / Status
        ↓
Identity & Account Reconciliation (AD Sync + Correlation)
```

---



## 17. Current vs Target Gap Analysis


| Target Component            | Current Implementation                      | Status                              | Evidence                                                                     | Gap                                           |
| --------------------------- | ------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| HRMS / authoritative source | HRMS integration + CSV/profile import       | **IMPLEMENTED**                     | `hrmsIntegrationRoutes`, `hrmsIdentitySyncService`                           | —                                             |
| Identity aggregation        | Identity upsert / refresh services          | **IMPLEMENTED**                     | `Identity` model, profile refresh                                            | —                                             |
| Correlation                 | Manual UI + optional aggregation engine     | **PARTIALLY IMPLEMENTED**           | `correlationController.runCorrelationForApp`; unwired `runCorrelationEngine` | Auto after provision; single-identity refresh |
| Lifecycle / JML detection   | lifecycleState fields + CRUD LifecycleEvent | **PARTIALLY IMPLEMENTED**           | schemas only for events                                                      | Detector / event emitter                      |
| Global provisioning rules   | `ProvisioningPolicy` schema                 | **NOT IMPLEMENTED**                 | model only; no evaluator                                                     | Rule engine                                   |
| Provisioning Request        | Model + CRUD + cert revoke enqueue          | **PARTIALLY IMPLEMENTED**           | `ProvisioningRequest`, `enqueueCertRevokeProvisioning`                       | Joiner request creator                        |
| Workflow engine             | Remediation graph executor                  | **PARTIALLY IMPLEMENTED**           | `workflowDispatcher`, handlers                                               | Joiner workflow + provision step              |
| Approval                    | Cert decision + wait steps                  | **PARTIALLY IMPLEMENTED**           | revoke-centric                                                               | Joiner approval template                      |
| Plan / Task                 | Models + revoke compile                     | **PARTIALLY IMPLEMENTED**           | `ProvisioningPlan/Task`                                                      | ADD_ACCOUNT plan builder                      |
| Provisioning Worker         | Poller stub                                 | **PARTIALLY IMPLEMENTED**           | `resolveConnector` returns null                                              | Wire AD connector                             |
| Application Connector write | `createAdUser`                              | **IMPLEMENTED BUT NOT LIVE-TESTED** | `adLdapService.createAdUser`                                                 | Integrate with worker; live AD                |
| AD LDAP READ / recon        | Full sync pipeline                          | **IMPLEMENTED**                     | `runAdSyncPipeline`                                                          | Use post-create                               |
| Provisioning Result / Audit | Models + remediation audit                  | **PARTIALLY IMPLEMENTED**           | CRUD; limited auto-write                                                     | Structured PROV audit on create               |
| Birthright entitlements     | Role type enum                              | **NOT IMPLEMENTED** for Joiner      | `Role.type=birthright`                                                       | Assignment engine                             |


---



## 18. What Can Be Tested Without AD


| Area                                      | How                                         |
| ----------------------------------------- | ------------------------------------------- |
| Payload builder                           | Unit tests (`buildAdUserCreatePayload`)     |
| DN / filter escaping                      | Unit tests (`ldapDn`)                       |
| LDAP error classification                 | Unit tests (`wrapLdapError`)                |
| Duplicate filter construction             | Unit tests                                  |
| HTTP validation for test-create           | Missing confirm / missing targetOuDn / auth |
| ProvisioningRequest/Plan/Task persistence | CRUD + `enqueueCertRevokeProvisioning`      |
| Workflow revoke path                      | Existing smoke scripts / remediation tests  |
| Correlation engine (Mongo)                | Manual run against existing accounts        |
| HRMS identity sync                        | If HRMS reachable (independent of AD)       |
| Worker “no connector” behavior            | Tasks remain PENDING                        |
| Config normalization                      | `normalizeAdConfig` unit/manual             |


---



## 19. What Requires Live AD


| Area                                      | Why                    |
| ----------------------------------------- | ---------------------- |
| LDAP bind to real DC                      | Network + credentials  |
| `assertTargetOuExists`                    | Directory truth        |
| Duplicate check against live objects      | Search                 |
| `Client.add` success / schema constraints | AD-specific            |
| Permission errors (LDAP 50)               | Service account rights |
| objectGUID generation / read-back         | AD                     |
| Post-create AD Sync ingest                | Fetch new user         |
| Aggregation nativeAccountId = GUID        | Real GUID              |
| Password enable path (future)             | LDAPS + unicodePwd     |
| Group membership writes (future)          | AD                     |


---



## 20. Critical Gaps



### P0 — Blocking for Joiner → AD

1. **Live AD unavailable** — cannot validate WRITE
2. `provisioningWorker.resolveConnector` **not wired to AD** `createAdUser`
3. **No Joiner detection / rule evaluation → ADD_ACCOUNT task**
4. **No Joiner workflow** that ends in provisioning execute



### P1 — Required for production Joiner

1. Persist/configure `targetOuDn` + `upnSuffix` per AD application (UI)
2. Post-create AD Sync + correlation refresh automation
3. Tenant-safe authorization audit on write endpoints
4. Secret handling for bind password (encryption)
5. Audit event on provision complete



### P2 — Enhancement

1. Password / enable lifecycle
2. Group birthright assignment
3. Mover/Leaver LDAP modify/disable
4. Dispatcher-level `dispatchProvision` for multi-connector symmetry

---



## 21. Recommended Implementation Sequence

Derived from **this** codebase (not a generic textbook order):

```text
Phase 1 — Confirm architecture (this document) ✅

Phase 2 — Live AD validation of connector write
          (when DC up): test-create-user OR liveCreateAndSyncVerify.js
          → AD Sync → aggregation GUID check

Phase 3 — Wire provisioningWorker.resolveConnector
          for ACTIVE_DIRECTORY → executeTask(ADD_ACCOUNT) → createAdUser
          (still no Joiner UI; enqueue tasks manually/script)

Phase 4 — Joiner ProvisioningRequest/Plan/Task builder
          (sourceType LIFECYCLE, operation ADD_ACCOUNT)

Phase 5 — Minimal Joiner workflow (reuse executor)
          approval optional → on success enqueue/execute ADD_ACCOUNT

Phase 6 — Rule evaluation MVP (ProvisioningPolicy or new evaluator)
          department/location → require AD app account

Phase 7 — Joiner detection from HRMS delta / lifecycleState NEW
          emit LifecycleEvent JOINER → enqueue request

Phase 8 — Post-provision reconciliation
          scheduleAdSyncJobRun + correlation refresh

Phase 9 — Audit / status surfaces

Phase 10 — End-to-end Joiner validation on live AD
```

**Do not** build Mover/Leaver writes before Joiner create is proven live.

---



## 22. Files / Components Relevant to Next Phase


| Priority | Path                                                     | Why                                 |
| -------- | -------------------------------------------------------- | ----------------------------------- |
| P0       | `services/adLdapService.js`                              | `createAdUser`                      |
| P0       | `services/adUserCreatePayload.js`                        | Payload contract                    |
| P0       | `services/provisioning/provisioningWorker.js`            | Wire connector                      |
| P0       | `services/provisioning/certRevokeProvisioningService.js` | Pattern to clone for Joiner enqueue |
| P0       | `models/provisioning/ProvisioningTask.js`                | `ADD_ACCOUNT` already in enum       |
| P1       | `services/workflow/workflowDispatcher.js`                | Start/resume workflows              |
| P1       | `workflows/adapters/igaAdapter.js`                       | Add provision-account side effect   |
| P1       | `controllers/adConnectorController.js`                   | test-create entry                   |
| P1       | `services/adSyncPipelineService.js`                      | Post-create verify                  |
| P1       | `controllers/correlation/correlationController.js`       | Correlation refresh                 |
| P2       | `models/provisioning/ProvisioningPolicy.js`              | Future rules                        |
| P2       | `models/identity/LifecycleEvent.js`                      | Future Joiner events                |
| P2       | `services/hrmsIdentitySyncService.js`                    | Joiner signal source                |


---



## 23. Open Questions / Unknowns


| Question                                                                                         | Classification                                      |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Exact target OU(s) per customer AD                                                               | **FUNCTIONAL / AD ADMIN**                           |
| UPN suffix per domain                                                                            | **FUNCTIONAL**                                      |
| Username generation beyond explicit/employeeId                                                   | **FUNCTIONAL**                                      |
| Whether Joiner accounts should start disabled (current) vs enabled+password                      | **FUNCTIONAL**                                      |
| Which correlation path is authoritative long-term (manual app-user vs AccountAggregation engine) | **UNKNOWN** / product                               |
| Does application middleware enforce tenant match on `testCreateAdUser`?                          | **UNKNOWN** — verify before multi-tenant prod write |
| Will `ProvisioningPolicy.actions` schema be reused or replaced?                                  | **UNKNOWN**                                         |
| Azure AD DS / cloud `deployment` create semantics                                                | **UNKNOWN**                                         |


---



## 24. Final Architecture Summary

Identity Sphere today is a **strong identity governance / certification / AD read-aggregation platform** with a **new connector-level AD user create capability** that is **not yet integrated into the provisioning worker or JML orchestration**, and **not yet proven against a live AD** (server currently down).

```text
CURRENT STRENGTHS                 CURRENT GAPS
─────────────────                 ────────────
HRMS → Identity                   Joiner detection
AD LDAP READ sync                 Rules → ADD_ACCOUNT
Manual correlation                Worker → createAdUser
Cert revoke workflows             Joiner workflow
Provisioning models               Live AD proof
createAdUser (code)               Password/enable/groups
```

**For the next engineer/AI:**  
Treat `createAdUser` as the **AD write primitive**. Treat `enqueueCertRevokeProvisioning` + `provisioningWorker` + remediation `runExecution` as the **patterns to extend**, not replace. Do not invent a second LDAP stack. Do not claim live AD success until Phase 2 passes with VPN/DC up.

---



## Appendix A — LDAP Write call chain (exact)

```text
POST /api/applications/:id/ad/test-create-user
  authenticate + requirePermission(APPLICATION_WRITE)
  adConnectorController.testCreateAdUser
    confirm === true
    resolveAdConfig(application, req)  // merge connectionConfig.ad + body.ad
    pickTestCreateUserSpec(body)       // allowlisted fields only
    createAdUser(cfg, userSpec)
      normalizeAdConfig
      buildAdUserCreatePayload
      withBoundClient
        assertTargetOuExists
        findDuplicateAdUser
        client.add
        read-back search
```

**Not connected:** `provisioningWorker.processTask` → `resolveConnector` → (null).

---



## Appendix B — Status legend used in this document


| Status                          | Meaning                                          |
| ------------------------------- | ------------------------------------------------ |
| IMPLEMENTED                     | Code path exists and is used or clearly callable |
| PARTIALLY IMPLEMENTED           | Models/UI/paths exist but incomplete wiring      |
| NOT IMPLEMENTED                 | No executable path found                         |
| IMPLEMENTED BUT NOT LIVE-TESTED | Code exists; no successful live AD evidence      |
| UNKNOWN                         | Insufficient evidence                            |
| INFERENCE                       | Reasonable conclusion, not directly proven       |


---

*End of analysis.*