# LDAP / AD Connector Implementation Guide

> Analysis only. No source code was modified while generating this document.

**Generated:** 2026-08-12  
**Scope:** Read-only inspection of Identity Sphere (Wisibility IGA) for extending the Active Directory LDAP connector from read-only aggregation to future writable AD user creation (Joiner provisioning milestone 1).  
**LDAP library verified:** `ldapts@8.1.8` (declared in `icm-backend/package.json`; installed at workspace `node_modules/ldapts`).

---

## 1. Repository Architecture

### High-level layout

| Area | Path | Role |
| ---- | ---- | ---- |
| Backend API | `icm-backend/` | Express + MongoDB/Mongoose IGA platform |
| Frontend UI | `icm-frontend/` | React + Vite governance UI |
| Installer | `installer/` | Windows packaging (not AD connector runtime) |
| Docs / analysis | repo root `*.md` | Architecture notes (AD security, remediation, etc.) |

### Backend architecture (derived from code)

- **Runtime:** Node.js ESM (`"type": "module"`), Express app in `icm-backend/src/server.js`
- **Persistence:** MongoDB via Mongoose models under `icm-backend/src/models/`
- **HTTP:** Controllers + routes under `icm-backend/src/controllers/` and `icm-backend/src/routes/`
- **Services:** Business logic under `icm-backend/src/services/` (AD LDAP, sync, correlation, workflows, provisioning stubs)
- **Jobs/schedulers:** `icm-backend/src/jobs/` (certification, remediation queue, workflow remediation, generic scheduler poll)
- **Workflow engine:** `icm-backend/src/workflows/` (graph executor, step handlers, IGA adapter)
- **Connector catalog/dispatch:** `icm-backend/src/config/connectorCatalog.js` + `icm-backend/src/services/connectors/connectorDispatcher.js`
- **Logging:** HTTP via `morgan`; operational logs mostly `console.info` / `console.warn` / `console.error` (no Winston/Pino)
- **Tests:** Jest (`icm-backend` script `"test"`), co-located `*.test.js` files

### Where LDAP/AD fits

The AD connector is **not** a separate microservice. It is an in-process service layer used for:

1. **Directory aggregation / sync** (primary IGA path)
2. **Universal connector test/sync** (family `ldap_ad`)
3. **AD Security posture / LDAP query tests** (read-only searches with richer attributes)

```text
                    ┌─────────────────────────────────────┐
                    │         icm-frontend (React)         │
                    │  App Registry / AD Sync / Correlation │
                    └─────────────────┬───────────────────┘
                                      │ HTTP /api/*
                    ┌─────────────────▼───────────────────┐
                    │         icm-backend (Express)        │
                    │  routes → controllers → services     │
                    └─────────────────┬───────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
┌─────────▼─────────┐     ┌───────────▼──────────┐    ┌──────────▼──────────┐
│ AdConnector /     │     │ Universal Connector  │    │ Security / Posture  │
│ AdSyncJob pipeline│     │ Dispatcher           │    │ LDAP query runners  │
└─────────┬─────────┘     └───────────┬──────────┘    └──────────┬──────────┘
          │                           │                          │
          └─────────────┬─────────────┴──────────────────────────┘
                        │
              ┌─────────▼─────────┐
              │   adLdapService    │  normalizeAdConfig, withBoundClient,
              │   ldapNormalizer   │  fetchAdDirectory / fetchAdUsers
              └─────────┬─────────┘
                        │
              ┌─────────▼─────────┐
              │  ldapts Client    │  bind / searchPaginated / unbind
              │  (v8.1.8)         │  (add/modify/del exist in lib,
              └─────────┬─────────┘   unused by app today)
                        │
              ┌─────────▼─────────┐
              │  Active Directory │
              └───────────────────┘

Sync ingest path continues:

  fetchAdDirectory
       ↓
  adDirectorySyncService.ingestApplicationFromAdDirectory
       ↓
  reconciliation + dynamic app user collections
       ↓
  adAccountAggregationService → account_aggregations_v2
       ↓
  account↔entitlement membership correlation (automatic)
       ↓
  Identity↔account correlation (manual UI / API — NOT auto after sync)
```

### Orchestration / progress infrastructure (existing)

| Concern | Implementation |
| ------- | -------------- |
| AD sync jobs | `AdSyncJob` model + `adSyncJobService` + `runAdSyncPipeline` |
| Progress | `phase`, `percent`, `message` on job; stage timings array |
| In-process queue | `scheduleAdSyncJobRun(jobId)` fire-and-forget `setImmediate`-style async |
| Generic scheduler | `scheduler.job.js` polls `SchedulerConfig` → workflow task queue (remediation-oriented) |
| Provisioning worker | `provisioningWorker.js` (opt-in stub, `PROVISIONING_WORKER_ENABLED`) |

---

## 2. Locate the LDAP/AD Connector

### File inventory (important files)

| File | Responsibility | Important Functions / Symbols | Used By | Likely Provisioning Impact |
| ---- | -------------- | ----------------------------- | ------- | -------------------------- |
| `icm-backend/src/services/adLdapService.js` | Core AD/LDAP client ops: config normalize, bind wrapper, test, fetch users/groups/computers/directory | `normalizeAdConfig`, `createLdapClient`, `withBoundClient`, `testAdConnection`, `fetchAdUsers`, `fetchAdDirectory`, `mapAdEntryToUserDoc` | AD sync pipeline, connector dispatcher, controllers, posture | **YES — primary place for `client.add` create** |
| `icm-backend/src/services/ldapNormalizer.js` | Filters, attribute lists, paging, normalize user/group/computer | `fetchPagedSearchEntries`, `normalizeUser`, `DEFAULT_USER_FILTER`, `AD_SYNC_*_ATTRIBUTES` | `adLdapService` | YES — attribute lists / DN helpers for create payload validation |
| `icm-backend/src/utils/ldapEntryAttributes.js` | Attr read helpers, GUID decode, search scopes | `getAttrFirst`, `objectGuidToString`, `LDAP_SEARCH_SCOPE_*` | Normalizer + LDAP service | Low for create; needed for verify-after-create |
| `icm-backend/src/services/adSyncPipelineService.js` | Async AD sync job runner + progress | `runAdSyncPipeline`, `scheduleAdSyncJobRun`, `reportProgress` | `adConnectorController` | YES — post-create verification via existing sync/job pattern |
| `icm-backend/src/services/adDirectorySyncService.js` | Ingest LDAP directory into IS storage | `ingestApplicationFromAdDirectory`, `syncSourceApplicationAndDerivedFromDirectory` | Pipeline | YES — verification / re-ingest after create |
| `icm-backend/src/services/adAccountAggregationService.js` | Upsert AD users into `account_aggregations_v2` | `upsertAggregationsFromAdUserDocs`, `nativeAccountIdFromUser` | Directory sync | YES — native id = GUID preferred |
| `icm-backend/src/services/adDirectoryIngestService.js` | Membership enrichment, group→entitlement mapping | `enrichUserDocsWithMembership`, `mapAdGroupToEntitlementDoc` | LDAP directory fetch | Later (group assignment) |
| `icm-backend/src/services/adConnectorCorrelationService.js` | Auto account↔entitlement correlation after sync | `incrementalAdConnectorAccountEntitlementCorrelation` | Directory sync | Later (not identity correlation) |
| `icm-backend/src/services/connectors/connectorDispatcher.js` | Family-based test/sync dispatch | `dispatchTest`, `dispatchSync` | Universal connector controller | **YES — cleanest place to add write dispatch** |
| `icm-backend/src/config/connectorCatalog.js` | Connector labels → `connectorType` → family | `getConnectorDefinition`, `ACTIVE_DIRECTORY` → `ldap_ad` | Dispatcher, UI | Possibly capability metadata |
| `icm-backend/src/controllers/adConnectorController.js` | HTTP AD test + sync | `testAdConnection`, `syncAdUsersFromAd`, `resolveAdConfig` | `applicationRoutes` | Optional HTTP for create/test |
| `icm-backend/src/controllers/universalConnectorController.js` | Catalog / universal test / sync | `testUniversalConnection`, `syncUniversalConnector` | `applicationRoutes` | Optional |
| `icm-backend/src/routes/applicationRoutes.js` | Routes for AD + connectors | `POST /ad/test-connection`, `POST /:id/ad/sync` | Frontend | Optional new routes later |
| `icm-backend/src/models/application/Application.js` | App + `connectionConfig` (Mixed) | `connectionConfig.ad` | Everywhere | YES — may need write config keys (OU, UPN suffix) |
| `icm-backend/src/models/application/AdSyncJob.js` | Async sync job status | `jobId`, `phase`, `percent`, `stageTimings` | Pipeline | Pattern reuse for provisioning jobs |
| `icm-backend/src/models/application/ConnectorConfig.js` | Separate connector metadata (schedule/status) | `connectorType` enum includes `ACTIVE_DIRECTORY` | Rare / parallel model | Low — actual secrets live on Application |
| `icm-backend/src/utils/adSyncScope.js` | Active/disabled/total user filters | `resolveUserSearchFilterForSyncScope` | Sync pipeline | Low for create |
| `icm-backend/src/utils/crypto.js` | AES-GCM encrypt/decrypt | `encryptString`, `decryptString` | Email / connectionConfig routes — **not AD bind today** | YES if hardening secrets |
| `icm-backend/src/config/env.js` | `ldapRejectUnauthorized` | env flag | `createLdapClient` | TLS behavior |
| `icm-backend/src/services/correlationEngineService.js` | Identity ↔ AccountAggregation correlation | `runCorrelationEngine` | Only `identityCubeController` (unwired) | Relevant for post-create correlation design |
| `icm-backend/src/controllers/correlation/correlationController.js` | **Production** manual Identity ↔ app-user correlation | `runCorrelationForApp` | UI `POST /correlation/run/:applicationId` | YES — post-provision correlation refresh |
| `icm-backend/src/models/correlation/CorrelationRule.js` | Rule storage | `identityAttribute`, `accountAttribute`, `matchType` | Correlation | Config for HRMS↔AD match |
| `icm-backend/src/services/provisioning/provisioningWorker.js` | Stub connector worker | `resolveConnector` (returns null), `executeTask` contract | `server.js` startup | **YES — intended executor for ADD_ACCOUNT** |
| `icm-backend/src/services/provisioning/certRevokeProvisioningService.js` | Queues REMOVE_ENTITLEMENT tasks | `enqueueCertRevokeProvisioning` | Workflow IGA adapter | Pattern for enqueue CREATE |
| `icm-backend/src/models/provisioning/ProvisioningTask.js` | Task model | `operationType` includes `ADD_ACCOUNT` | Worker | YES — already has create op enum |
| `icm-backend/src/models/provisioning/ProvisioningRequest.js` | Request model | `requestType` includes `JOINER` | Worker / future JML | YES |
| `icm-backend/src/models/provisioning/ProvisioningPolicy.js` | Schema for JOINER policies | `triggerEvent`, `applications`, `actions` | **No service usage found** | Future orchestration |
| `icm-backend/src/models/identity/LifecycleEvent.js` | JOINER/MOVER/LEAVER events | `eventType`, `provisioningRequestId` | CRUD route only | Future orchestration |
| `icm-backend/src/services/workflow/workflowDispatcher.js` | Start/resume remediation workflows | `enqueueRevokeExecution`, `runExecution` | Certification revoke | Pattern for approval→callback |
| `icm-backend/src/workflows/adapters/igaAdapter.js` | Live workflow side-effects | `revokeEntitlement` → enqueue provisioning | Executor | Reuse pattern; no AD write |
| `icm-frontend/src/pages/applications/AppRegistry.jsx` | AD connection form fields | `adUrl`, `adBaseDn`, `adBindDn`, `adBindPassword`, … | UI | Config UX for write fields later |
| `icm-frontend/src/services/api.js` | `waitForAdSyncJob`, correlation run API | — | UI | Post-create verify/sync |

### Related posture/security LDAP (read-only; lower provisioning priority)

- `icm-backend/src/services/security/ldapQueryTestService.js`
- `icm-backend/src/services/posture/postureFeatureLdap.js`, `ldapFeatureScanRunner.js`, `postureLdapValidator.js`
- `icm-backend/src/services/posture/groupLdapSecurity.js`, `userAccountSecurity.js`, `computerSecurity.js`

These use the same bind/search patterns; none perform LDAP writes.

---

## 3. Trace the Complete LDAP Read Flow

### Production AD sync call chain (async job — default)

```text
HTTP POST /api/applications/:id/ad/sync
  → adConnectorController.syncAdUsersFromAd
  → createAdSyncJob(...)
  → scheduleAdSyncJobRun(jobId)
  → runAdSyncPipeline(jobId)
       → Application.findById
       → normalizeAdConfig(application.connectionConfig.ad + job.syncConfig)
       → resolveUserSearchFilterForSyncScope(syncScope)
       → fetchAdDirectory(cfg)                    [adLdapService]
            → withBoundClient × N (users/groups/computers parallel binds)
            → fetchPagedSearchEntries             [ldapNormalizer]
            → normalizeUser / mapAdEntryToUserDoc
            → buildMembershipIndex + enrichUserDocsWithMembership
       → syncSourceApplicationAndDerivedFromDirectory
            → ingestApplicationFromAdDirectory
                 → optional csvImportMapping merge
                 → ingestApplicationUsersWithReconciliation
                 → upsertAggregationsFromAdUserDocs
                 → upsertApplicationEntitlementsFromRows (if syncGroups)
                 → incrementalAdConnectorAccountEntitlementCorrelation
            → refreshDerivedApplicationsFromAdDirectory
       → patchAdSyncJob(status=completed, result=…)
```

### Step-by-step

| Step | File | Function | Input | Output / transform | Errors | Logging / progress |
| ---- | ---- | -------- | ----- | ------------------ | ------ | ------------------ |
| 1. HTTP entry | `adConnectorController.js` | `syncAdUsersFromAd` | `req.params.id`, body AD overrides | Creates job or blocking sync | 400 incomplete config | HTTP JSON |
| 2. Job create | `adSyncJobService.js` | `createAdSyncJob` | app id, syncConfig | `AdSyncJob` queued | — | — |
| 3. Schedule | `adSyncPipelineService.js` | `scheduleAdSyncJobRun` | `jobId` | async `runAdSyncPipeline` | unhandled → console.error | `[ad-sync:jobId]` |
| 4. Progress | same | `reportProgress` | phase/percent/message | Mongo job patch | — | phase e.g. `ldap_fetch` |
| 5. Config | `adLdapService.js` | `normalizeAdConfig` | Mixed AD config | url, baseDn, bindDn, filters, pageSize, max* | — | — |
| 6. Bind | `adLdapService.js` | `withBoundClient` | cfg | bound `ldapts` Client | `wrapLdapError` (code 49 → invalid credentials) | — |
| 7. Search | `ldapNormalizer.js` | `fetchPagedSearchEntries` | client, baseDN, filter, attrs | Entry[] (paged) | LDAP errors bubble | optional `__ldapStats` |
| 8. Map users | `adLdapService.js` | `mapAdEntryToUserDoc` | Entry | user_id, email, status, rawData, … | missing attrs → empty strings | — |
| 9. Ingest | `adDirectorySyncService.js` | `ingestApplicationFromAdDirectory` | directory | users + entitlements + aggregations | throws | onProgress callbacks |
| 10. Aggregation | `adAccountAggregationService.js` | `upsertAggregationsFromAdUserDocs` | userDocs | `account_aggregations_v2` upserts; orphans marked | requires tenantId | — |
| 11. Membership correlation | `adConnectorCorrelationService.js` | incremental correlate | userDocs | account↔entitlement edges | — | progress `correlation` |

**Important:** Identity↔account correlation (`runCorrelationForApp` / `runCorrelationEngine`) is **not** invoked in this sync pipeline.

### Alternate read paths

| Path | Entry | Notes |
| ---- | ----- | ----- |
| Universal sync | `POST /applications/:id/connectors/sync` → `dispatchSync('ACTIVE_DIRECTORY'|…)` → `fetchAdUsers` | Users only (not full directory pipeline) |
| Connection test | `POST /applications/ad/test-connection` → `testAdConnection` | Small subtree search, sizeLimit 10 |
| Blocking sync | `?wait=1` on AD sync | Same LDAP fetch + ingest, HTTP waits |

---

## 4. LDAP Client Implementation

### Library

- **Package:** `ldapts`
- **Declared version:** `^8.1.8`
- **Installed version verified:** `8.1.8`
- **Import:** `import { Client } from "ldapts"` in `adLdapService.js`; `PagedResultsControl` imported in `ldapNormalizer.js` (paging actually uses `client.searchPaginated`)

### Connection

| Topic | Behavior in code |
| ----- | ---------------- |
| Protocol | Config `url` / `urls[]` — typically `ldap://host:389` or `ldaps://host:636` (UI field `adUrl`) |
| Host/port | Embedded in URL string; **no separate host/port fields** |
| TLS | If URL starts with `ldaps://` **or** `tlsInsecure` is set → `tlsOptions: { rejectUnauthorized }` |
| `rejectUnauthorized` | `false` when `tlsInsecure === true`; else `env.ldapRejectUnauthorized` (default true unless `LDAP_REJECT_UNAUTHORIZED=false`) |
| Bind method | Simple bind: `client.bind(cfg.bindDn, password)` |
| Service account | Bind DN + password from config (`bindDn` / `bindPassword`) |
| Client creation | `createLdapClient(cfg)` → `new Client({ url, timeout, connectTimeout, tlsOptions? })` |
| Timeouts | `timeout` default 120000 ms (clamp 30s–600s); `connectTimeout` default 15000 ms (clamp 5s–60s) |
| Pooling / reuse | **None.** Each operation creates a client, binds, runs, `unbind()` in `finally` |
| Parallelism | `fetchAdDirectorySingle` opens **separate binds** for users/groups/computers via `Promise.all` |
| Disconnect | Always `await client.unbind()`; errors ignored |

### Search

| Topic | Behavior |
| ----- | -------- |
| Search base | `cfg.baseDn` / `baseDns[]` (failover across bases) |
| Scope | Default subtree (`LDAP_SEARCH_SCOPE_SUBTREE` = `"sub"`) |
| User filter default | `(&(objectClass=user)(objectCategory=person))` |
| Group filter default | `(&(objectClass=group))` |
| Computer filter default | `(&(objectClass=computer))` |
| Sync scope overrides | `total` / `active` / `disabled` via `adSyncScope.js` (UAC bit 2) |
| Pagination | `client.searchPaginated` with `paged: { pageSize }` (default 1000, max 2000) |
| Attributes (sync users) | `AD_SYNC_USER_ATTRIBUTES` including sAMAccountName, UPN, mail, GUID, DN, memberOf, employeeID/Number, UAC, … |
| Size limits | Soft caps via `maxUsers` / `maxGroups` / `maxComputers` (app-level, not LDAP sizeLimit on paged sync) |
| Group membership | Prefer user `memberOf`; sync groups omit heavy `member` list (`AD_SYNC_GROUP_ATTRIBUTES`) |
| Failover | Nested loops over `urls × baseDns × filters`; first success wins; else aggregated error |

### Authentication / credentials (no secrets exposed)

| Topic | Finding |
| ----- | ------- |
| Config keys | `connectionConfig.ad.bindDn`, `connectionConfig.ad.bindPassword` (aliases: `adBindDn`, `adBindPassword` in normalize) |
| Storage | Persisted on `Application.connectionConfig` (`Mixed`) from App Registry create/update |
| Encryption | **AD bind password is stored/used as plaintext in `connectionConfig.ad.bindPassword`.** `encryptString`/`decryptString` exist in `utils/crypto.js` and are used for email / generic connection-config routes — **not wired to AD bind password**. |
| Retrieval | Controllers merge body password over DB: `fromBody.bindPassword \|\| fromDb.bindPassword` |
| Delivery to client | Passed into `normalizeAdConfig` → `withBoundClient` → `client.bind` |

**FUNCTIONAL DECISION REQUIRED:** Whether future write ops should continue plaintext storage or adopt `CONNECTION_ENCRYPTION_KEY` encryption like other connectors.

---

## 5. Existing AD Account Data Model

### Layers of representation

1. **LDAP entry** → `normalizeUser` / `mapAdEntryToUserDoc`
2. **Dynamic application user collection** (per tenant/app) via reconciliation ingest
3. **`account_aggregations_v2`** (`AccountAggregation` model) for cube/aggregation
4. **`identity_account_links`** after identity correlation
5. **Identity** (`Identity` / tenant dynamic identity collection) — HRMS-side person

### `mapAdEntryToUserDoc` fields (source mapping)

| Doc field | Source |
| --------- | ------ |
| `user_id` | `sAMAccountName` (preferred) or DN |
| `employee_id` | `employeeNumber` or `employeeID` or UPN fallback |
| `username` | `givenName` or sAMAccountName |
| `email` | mail / UPN |
| `display_name` | displayName / given+sn |
| `status` | `disabled` if UAC & 2 else `active` |
| `department`, `title`, `manager_id`, `telephone` | LDAP attrs |
| `member_of_entitlements` | memberOf joined |
| `rawData` | full attribute map including objectGUID, DN, etc. |

### AccountAggregation

| Field | Role |
| ----- | ---- |
| `nativeAccountId` | Prefer `rawData.objectGUID`, else employeeNumber/ID, else user_id/email |
| `accountName` | user_id or email or native id |
| `status` | ACTIVE / DISABLED |
| `rawAttributes` | rawData + ldap_* mirrors |
| `correlatedIdentityId` | Set by aggregation correlation engine (if used) |
| `isOrphan` | Unmatched / removed / governance |
| `applicationId`, `tenantId` | Scope |

### Identity model (HRMS / authoritative person)

Key fields in `Identity.js`: `employeeId`, `email`, `displayName`, `firstName`, `lastName`, `department`, `title`, `manager*`, `lifecycleState`, `attributes` (Mixed), `isCorrelated`, `sourceApplication`.

### Field classification (for provisioning design)

| Category | Examples |
| -------- | -------- |
| Source AD attributes | sAMAccountName, userPrincipalName, mail, givenName, sn, displayName, department, title, manager, memberOf, userAccountControl, distinguishedName, objectGUID, objectSid, employeeID, employeeNumber |
| Correlation attributes | Configurable: typically Identity `employeeId` ↔ account `employeeNumber` / `employee_id` / sAMAccountName / email — **rules stored in DB, not hardcoded** |
| Target / native identifiers | `objectGUID` (preferred nativeAccountId), DN, sAMAccountName |
| Display attributes | displayName, email, accountName |

### How AD account links to Identity

**Production UI path:**

1. Accounts live in dynamic app user collection after sync.
2. Operator runs Correlation Engine UI → `POST /api/correlation/run/:applicationId` with rule pairs.
3. `runCorrelationForApp` creates/updates `IdentityAccountLink` rows and orphan records.

**Secondary / unwired path:**

- `runCorrelationEngine` matches `AccountAggregation` ↔ Identity using `CorrelationRule` documents.
- Exposed only via `identityCubeController.js`, which is **not imported by any route** (dead controller as of this analysis).

---

## 6. Correlation Interaction

### Rule storage

| Store | Used by | Notes |
| ----- | ------- | ----- |
| Request body rules (UI) | `runCorrelationForApp` | Primary UX; rules passed per run |
| `correlation_rules` collection (`CorrelationRule`) | `runCorrelationEngine` | Documented for aggregation path; CRUD under `/api/correlation/rules` |

Schema fields: `identityAttribute`, `accountAttribute`, `matchType` (`EXACT`|`CONTAINS`|`REGEX`), `priority`, `isEnabled`, `applicationId`, `tenantId`.

### Evaluation

- Values normalized trim + lowercase.
- EXACT: hash maps Identity attribute → ids.
- CONTAINS/REGEX: linear scan (capped for aggregation engine).
- First matching rule wins (sequential priority).
- Ambiguous (multiple identities) → orphan / AMBIGUOUS, no link.
- No match → orphan / UNMATCHED.

**There is no hardcoded `empid = sAMAccountName`.** That mapping is a **tenant configuration choice** in the Correlation Engine UI (example error text in `runCorrelationEngine` suggests `employeeId` ↔ `employeeNumber`).

### When there is no match

- Account remains uncorrelated / orphan queue.
- Identity may remain `isCorrelated: false` until linked.

### After AD account appears

1. AD sync ingests account into app users + aggregations.
2. Account↔group entitlement correlation may run automatically.
3. **Identity correlation does not auto-run** after aggregation.
4. Operator (or future job) must call correlation run.

### Single-identity correlation

- **No dedicated “correlate one identity” API found** for the aggregation engine.
- Manual orphan remediation exists: `POST /api/correlation/orphans/:orphanId/remediate`.
- Entitlement sync has per-identity helpers elsewhere; not the same as HRMS↔AD account correlation.

**FUNCTIONAL DECISION REQUIRED:** After Joiner create, whether to auto-trigger full-app correlation, single-account correlation (new), or wait for next scheduled run.

---

## 7. Connector Abstraction

### What exists

There is **no OOP interface/base class** like `class Connector { createAccount() }`.

Instead:

1. **Catalog** maps UI label / `connectorType` → **family** (`ldap_ad`, `ldap_generic`, `jdbc`, …).
2. **Dispatcher** switch on family for:
   - `dispatchTest(connectorType, connectionConfig)`
   - `dispatchSync(connectorType, connectionConfig, options)`
3. **AD-specific controllers** call `adLdapService` directly for the rich directory sync path.
4. **Provisioning worker contract** (stub) documents:

```text
async executeTask(task) => { status: "COMPLETED" | "FAILED", message?: string }
```

with `task.operationType` including `ADD_ACCOUNT`, `REMOVE_ACCOUNT`, `ADD_ENTITLEMENT`, `REMOVE_ENTITLEMENT`, `DISABLE`, `ENABLE`.

### Supported concepts today

| Concept | Supported? | Where |
| ------- | ---------- | ----- |
| testConnection | YES | `dispatchTest` / `testAdConnection` |
| authenticate (bind) | YES (internal) | `withBoundClient` |
| aggregateAccounts / sync users | YES | `fetchAdUsers` / `fetchAdDirectory` + ingest |
| aggregateGroups | YES (AD sync) | groups in `fetchAdDirectory` |
| getAccounts/getGroups (generic CRUD API) | Partial | sync returns docs; no general “get one account” API |
| create / modify / delete | **NO** in app code | ldapts Client API supports add/modify/del |

### Cleanest location for write capabilities

**Recommendation (architecture only):**

1. **Implement LDAP write primitives** next to existing bind/search in `adLdapService.js` (reuse `withBoundClient`, `normalizeAdConfig`, error wrapping).
2. **Expose a family-level operation** from `connectorDispatcher.js` (e.g. `dispatchProvision` / `dispatchExecuteTask`) so other families can stub/no-op without breaking read-only connectors.
3. **Wire `provisioningWorker.resolveConnector(applicationId)`** to an AD connector adapter that implements `executeTask` for `ADD_ACCOUNT` when `connectorType === 'ACTIVE_DIRECTORY'`.

Do **not** force read-only connectors to implement writes — dispatcher switch + null connector already supports that.

---

## 8. Search for Existing Write Operations

### Repository-wide search results

Searched for LDAP modify/add/delete, AD PowerShell user cmdlets, connector provisioning writes, password set on AD, etc.

| Pattern | Result |
| ------- | ------ |
| `client.add` / `client.modify` / `client.del` in app source | **Not used** |
| `New-ADUser` / `Set-ADUser` / `Add-ADGroupMember` | **Not used** for provisioning (PowerShell appears in installer/verify tooling only) |
| AD user creation | **None** |
| AD group membership modification | **None** |
| Account disable/enable against AD | **None** (UAC is **read** for status only) |
| Password operations against AD | **None** |
| Provisioning that mutates target systems | **Stub only** — `provisioningWorker.resolveConnector` returns `null`; tasks stay `PENDING` |
| Remediation / workflow | Enqueues **ProvisioningRequest** / ITSM ticket; adapter comments state it **never mutates target system directly** |

### ldapts capability (library only)

Installed `ldapts@8.1.8` **does** expose:

- `Client.add(dn, attributes)`
- `Client.modify(dn, changes)`
- `Client.del(dn)`
- `Client.modifyDN(dn, newDN)`

These are available for future use but have **zero call sites** in Identity Sphere application code.

### Reuse recommendation

Reuse:

- `withBoundClient` / `createLdapClient` / `normalizeAdConfig` / `wrapLdapError`
- Provisioning task/request/plan models (`ADD_ACCOUNT` already in enum)
- `enqueueCertRevokeProvisioning` pattern for enqueueing
- `AdSyncJob` progress patterns for async verify
- Workflow engine for approvals (remediation pattern)

Do **not** invent a second LDAP stack or PowerShell bridge unless AD admin requirements force it.

---

## 9. AD User Creation Requirements

Based **only** on current codebase availability.

### Already available

| Item | Where |
| ----- | ----- |
| LDAP URL(s), base DN, bind DN, bind password, tlsInsecure | `connectionConfig.ad` |
| User/group search filters, pageSize, maxUsers | same |
| Identity attributes: employeeId, email, firstName, lastName, displayName, department, title, phone, manager* | `Identity` model / HRMS sync |
| AD attribute vocabulary known to IS | sync attribute lists |
| objectClass filter knowledge (`user`/`person`) | DEFAULT_USER_FILTER |
| Native id strategy after create | objectGUID preferred in aggregation |

### Not currently available (in connector config / services)

| Item | Status |
| ----- | ------ |
| Target OU / container DN for new users | **Not in config** (only search `baseDn`) |
| UPN suffix / domain DNS name for UPN construction | **Not stored** |
| Username / sAMAccountName generation rules | **None** |
| Initial password / password policy handling | **None** |
| Mandatory create attribute set | **None** defined for writes |
| Manager DN resolution (Identity manager → AD DN) | Manager stored as identity refs / strings; AD manager is DN |
| Default groups to assign on join | **None** for provisioning |
| `unicodePwd` / LDAPS requirement documentation | **None** in app |

### Unknown / requires functional decision

| Topic | Tag |
| ----- | --- |
| sAMAccountName algorithm (employeeId? email local-part? other?) | **FUNCTIONAL DECISION REQUIRED** |
| userPrincipalName construction | **FUNCTIONAL DECISION REQUIRED** |
| CN / displayName format | **FUNCTIONAL DECISION REQUIRED** |
| Whether employeeID or employeeNumber is written | **FUNCTIONAL DECISION REQUIRED** |
| Enabled vs disabled on create (UAC) | **FUNCTIONAL DECISION REQUIRED** |
| Must-change-password flag | **FUNCTIONAL DECISION REQUIRED** |
| Target OU selection (static config vs rule vs HR location) | **FUNCTIONAL DECISION REQUIRED** |
| Whether create uses ldapts `add` only or also set password via `modify` | **FUNCTIONAL DECISION REQUIRED** + **AD ADMIN CONFIRMATION REQUIRED** |

---

## 10. Connector Configuration

### Current `connectionConfig.ad` shape (from UI + `normalizeAdConfig`)

| Key | Purpose |
| --- | ------- |
| `url` / `urls` | LDAP(S) endpoint(s) |
| `baseDn` / `baseDns` | Search base(s) |
| `bindDn` | Service account DN |
| `bindPassword` | Service account password (plaintext today) |
| `tlsInsecure` | Relax TLS verification |
| `deployment` | `on_prem` or `cloud` (Azure AD LDAP label still uses `ldap_ad`) |
| `userSearchFilter` / `userSearchFilters` | User LDAP filter |
| `groupSearchFilter` / `groupSearchFilters` | Group filter |
| `pageSize` | Paging (1–2000) |
| `maxUsers` / `maxGroups` / `maxComputers` | Soft caps |
| `syncGroups` | Whether to sync groups |

### Tenant association

- Via parent `Application.tenantId` (not inside `ad` block).

### Attribute mapping

- Application `userMappings` / `csvImportMapping` map LDAP/raw fields into standard account fields during ingest — **ingest mapping, not create mapping**.

### Config required for write operations (not present yet)

| Key (conceptual) | Why |
| ---------------- | --- |
| `userCreateOu` / `targetOuDn` | Parent DN for `add` |
| `upnSuffix` or `dnsDomain` | Build UPN |
| `samAccountNameSource` / naming policy | Username |
| Optional: `defaultUserGroups[]` | Post-create membership |
| Optional: encrypted bind secret | Hardening |
| Optional: `createEnabled` capability flag | Safety |

Do not change configuration in this analysis phase.

---

## 11. Permissions Required for Write

Assume a dedicated AD service account used by the connector.

| Permission class | Needed for Create User? | Notes |
| ---------------- | ----------------------- | ----- |
| LDAP connection / bind | YES | Already required for sync |
| LDAP search | YES | Verify after create; check duplicates |
| Create child objects on target OU | YES | **AD ADMIN CONFIRMATION REQUIRED** — Create User / Create all child objects on OU |
| Write attributes on new user | YES | sn, givenName, sAMAccountName, UPN, employeeID, mail, etc. — **AD ADMIN CONFIRMATION REQUIRED** |
| Reset password / set `unicodePwd` | Likely YES for usable account | Often requires LDAPS + special rights — **AD ADMIN CONFIRMATION REQUIRED** |
| Enable account (UAC) | Likely YES | **AD ADMIN CONFIRMATION REQUIRED** |
| Group membership (`member` on group) | Only if Joiner assigns groups | Later milestone — **AD ADMIN CONFIRMATION REQUIRED** |
| Delete / disable | Not for first create milestone | — |

**Do not assume** the existing read/sync service account already has create rights.

---

## 12. Scheduler / Job / Progress Architecture

### Existing mechanisms

| Mechanism | Purpose | Fit for provisioning |
| --------- | ------- | -------------------- |
| `AdSyncJob` + `runAdSyncPipeline` | Async AD aggregation with percent/phase/stageTimings | Excellent pattern for **verify sync** after create |
| `ProvisioningTask` + `provisioningWorker` | Poll PENDING tasks every 60s (opt-in) | **Primary intended executor** for connector writes |
| `SchedulerConfig` + `scheduler.job.js` | Polls every 30s → workflow task queue | Remediation-oriented; not AD sync |
| `RemediationWorkflowExecution` | Workflow run state, WAITING + `nextPollAt` | Approval / verify loops |
| DistributedLock | Scheduler concurrency | Available if multi-node |

### Identifiers already used

- `jobId` (AD sync)
- `executionId` (workflow / remediation, UUID)
- `tenantId`
- `applicationId`
- `runId` (workflow engine)
- Provisioning `requestId` / `planId` / task `_id`

### Retry

- `ProvisioningTask.retryCount` / `maxRetries` fields exist; worker currently does not implement sophisticated retry beyond status FAILED.
- AD sync: fail job, no automatic retry loop found.

### How provisioning could fit (design only)

```text
ProvisioningTask(ADD_ACCOUNT, PENDING)
  → provisioningWorker tick
  → resolveConnector(AD) → executeTask
  → adLdapService.createAdUser(...)
  → mark COMPLETED
  → optional: scheduleAdSyncJobRun / targeted search verify
  → correlation refresh
```

---

## 13. Workflow Integration

### Current remediation flow (existing)

```text
Certification revoke decision
  → enqueueRevokeExecution({ workflowId, reviewItem, ... })
  → RemediationWorkflowExecution (PENDING)
  → runExecution(executionId)
  → executeWorkflow(..., { adapter: createIgaAdapter(...) })
  → steps (e.g. RevokeAccess → CreateTicket → Wait → VerifyAccessRemoved → EndSuccess/Failure)
```

### How workflows start

- `enqueueRevokeExecution` creates execution row + fire-and-forget `runExecution`.
- Trigger payload built from ReviewItem (`buildTriggerFromReviewItem`).

### Context / completion

| State | Meaning |
| ----- | ------- |
| RUNNING | Engine executing |
| WAITING / WAITING_ITSM | Parked; `checkpointNodeId`, `nextPollAt` for re-verify |
| COMPLETED | Mapped from engine SUCCESS |
| FAILED | Engine failure / EndFailure |
| SKIPPED | Disabled workflow / filter |

### Callback / event mechanism

- **No generic webhook callback bus** for “workflow completed → arbitrary listener”.
- Completion is persisted on `RemediationWorkflowExecution` and synced onto `ReviewItem` remediation/provisioning status fields.
- Provisioning worker can **resume** workflow via `runExecution(executionId, { resume: "verify" })` after connector task completes (cert revoke V2 path).

### Adapter contract

`createIgaAdapter` methods return `{ success, error }` and **do not throw** into the engine. Revoke enqueues provisioning; it does not call LDAP.

### Reuse for Joiner provisioning

Reuse:

1. Workflow definition + `executeWorkflow` for **approval** graph.
2. On approval completion / dedicated step → enqueue `ProvisioningRequest` (`requestType: 'JOINER'`) + `ProvisioningTask` (`ADD_ACCOUNT`) — mirror `enqueueCertRevokeProvisioning`.
3. `provisioningWorker` performs LDAP create.
4. Optional: new workflow step or post-task hook for verify + correlation.

**Gaps:** No Joiner workflow starter exists today; event types on remediation executions are ACCESS_REVOKE-centric; `ProvisioningPolicy` / `LifecycleEvent` are schema-only.

**FUNCTIONAL DECISION REQUIRED:** Whether Joiner uses the same RemediationWorkflowExecution model or a separate workflow instance type.

---

## 14. Logging and Audit

### Conventions observed

| Layer | Pattern |
| ----- | ------- |
| HTTP | `morgan` combined/dev |
| AD sync | `console.info(\`[ad-sync:${jobId}] stage=...\`)` |
| Provisioning worker | `console.log` / `console.warn` with `[provisioningWorker]` |
| Workflow | `console.warn` / `console.error` with `[workflowDispatcher]` |
| Correlation | `console.error('[Manual correlation] ...')` |

### Structured audit models

- `UnifiedAuditEvent` — includes `PROV_COMPLETE`, `correlationId` field
- `RemediationAuditLog` — remediation actions (CREATE/UPDATE/…)
- No dedicated AD LDAP audit table for writes (none exist yet)

### Recommended identifiers for future provisioning logs (reuse conventions)

Carry: `tenantId`, `applicationId`, `identityId`, `provisioningRequestId`, `planId`, `taskId`, `executionId` (if workflow), `jobId` (if verify sync), and never log bind passwords or initial passwords.

---

## 15. Error Handling

### Patterns in `adLdapService`

| Scenario | Handling |
| -------- | -------- |
| Missing URL / bind DN / base DN | Throw clear Error before bind |
| Missing bind password | Throw before bind |
| Invalid credentials | `wrapLdapError`: detect `/invalid credentials/i` or `err.code === 49` |
| Endpoint failures | Failover across urls/bases/filters; final Error with JSON sample of failures |
| Search / timeout | Propagated as wrapped LDAP message; client timeouts configured |
| Invalid filter | LDAP server error → wrapped message (no special classifier) |
| Missing attributes | Mapped to empty strings; account may be skipped if no nativeAccountId |
| Duplicate objects | **Not handled** (no create path) |
| Permission errors | Would surface as LDAP error message today; no dedicated code |
| Unbind failures | Swallowed |

### Reusable pattern for writes

Keep `withBoundClient` + `wrapLdapError`; add classifiers for entryAlreadyExists (LDAP 68), insufficientAccessRights (50), constraintViolation, etc., when implementing create — **as extension of existing wrap, not a new framework**.

---

## 16. Testing Architecture

### Framework

- Jest (`icm-backend` `"test": "node --experimental-vm-modules ../node_modules/jest/bin/jest.js --passWithNoTests"`)
- Co-located unit tests (`*.test.js`)

### Existing LDAP-adjacent tests

| File | Focus |
| ---- | ----- |
| `ldapEntryAttributes.test.js` | Attr/GUID helpers |
| `adSyncThroughput.test.js` | page size, membership index (no live LDAP) |
| `postureFeatureLdap.test.js`, `groupLdapSecurity.test.js`, `kerberosDelegationLdap.test.js` | Posture logic |
| Sync/hash tests | reconciliation / account hash (Mongo-oriented) |

### Mocking approach

- Unit tests typically mock pure functions / in-memory structures.
- **No ldapts mock harness or integration AD fixture framework found** in-repo for connector writes.

### Minimum tests recommended for future Create AD User (do not write yet)

1. **Unit:** payload builder from Identity + config → LDAP attributes (pure).
2. **Unit:** DN construction / escaping.
3. **Unit:** duplicate detection filter builder (`sAMAccountName=` / `userPrincipalName=`).
4. **Unit:** `wrapLdapError` / create-specific error mapping.
5. **Integration (opt-in):** bind + add + search + delete against lab AD (env-gated).
6. **Worker:** `executeTask(ADD_ACCOUNT)` with mocked `adLdapService.create*`.
7. **Regression:** ensure `dispatchTest` / `fetchAdDirectory` unchanged.

---

## 17. Proposed Minimal Change Surface

### Required for basic AD user creation

| Priority | File/Component | Change Needed | Reason |
| -------- | -------------- | ------------- | ------ |
| P0 | `adLdapService.js` | Add create-user helper using `client.add` inside `withBoundClient` | Only LDAP write surface |
| P0 | New small payload builder module (or function in adLdapService) | Map Identity + config → DN + attributes | Keep create logic testable |
| P0 | `provisioningWorker.js` `resolveConnector` | Return AD adapter implementing `executeTask` for `ADD_ACCOUNT` | Existing orchestration hook |
| P1 | `connectorDispatcher.js` | Optional `dispatchExecuteTask` / provision switch for `ldap_ad` | Keep family pattern |
| P1 | Application `connectionConfig.ad` usage (read new keys) | Target OU, UPN suffix | Cannot create without OU |

### Required for production hardening

| Priority | File/Component | Change Needed | Reason |
| -------- | -------------- | ------------- | ------ |
| P1 | Verify-after-create | Search by sAMAccountName/GUID; optional AdSyncJob | Confirm success |
| P1 | Correlation trigger | Call existing correlation or single-account link | Close Joiner loop |
| P1 | Secret handling | Encrypt bind password (and never log passwords) | Match other connectors |
| P2 | Audit event | `UnifiedAuditEvent` PROV_COMPLETE | Compliance |
| P2 | Frontend App Registry | OU / UPN suffix fields | Operability |
| P2 | Error taxonomy | LDAP constraint/exists/access mapping | Supportability |

### Not required for the first implementation

| Item | Why defer |
| ---- | --------- |
| Full JML rule engine / ProvisioningPolicy evaluator | Schema only; large scope |
| Group assignment on create | Separate entitlement ops |
| Disable/delete/modify APIs | Beyond CREATE milestone |
| PowerShell AD module integration | ldapts already sufficient if permissions allow |
| Rewriting connector to OOP classes | Dispatcher pattern already works |
| Identity cube unwired controller cleanup | Unrelated |

---

## 18. Proposed Future API/Method Contract

Aligned with **existing** naming (`dispatchTest`/`dispatchSync`, `executeTask`, `ADD_ACCOUNT`) — not invented textbook names blindly.

### Milestone 1 — CREATE AD USER only

**Low-level (LDAP service):**

```text
createAdUser(rawAdConfig, userSpec) → {
  dn: string,
  attributesWritten: object,
  // after optional read-back:
  objectGUID?: string,
  sAMAccountName?: string,
  userPrincipalName?: string
}
```

**Dispatcher (optional):**

```text
dispatchProvision(connectorType, connectionConfig, {
  operation: 'ADD_ACCOUNT',
  targetAttributes: { ... }
})
```

**Worker-facing (already documented):**

```text
connector.executeTask(task)
// task.operationType === 'ADD_ACCOUNT'
// task.targetAttributes includes identityId, nativeIdentity hints, applicationName, tenantId, ...
→ { status: 'COMPLETED' | 'FAILED', message? }
```

Defer `modifyAccount` / `disableAccount` / `deleteAccount` until later; enums already exist on `ProvisioningTask` for DISABLE/ENABLE/REMOVE_ACCOUNT when needed.

---

## 19. End-to-End Future Flow

```text
[EXISTING] HRMS Delta / hrmsIdentitySyncService
    ↓
[EXISTING] Identity documents (employeeId, names, email, …)
    ↓
[EXISTING] Aggregation of AD (ad sync pipeline) — shows account missing
    ↓
[EXISTING] Correlation run — no AD match → candidate Joiner
    ↓
[NEW] Global Provisioning Rules / LifecycleEvent JOINER detection
    ↓
[NEW] ProvisioningRequest (JOINER) + Plan + Task(ADD_ACCOUNT)
    ↓
[EXISTING — EXTEND] Workflow Engine (approval graph)
    ↓
[EXISTING pattern] Approval complete → enqueue/resume toward executor
    ↓
[EXISTING — EXTEND] provisioningWorker.resolveConnector → AD adapter
    ↓
[EXISTING — EXTEND] Writable adLdapService (ldapts Client.add)
    ↓
[EXISTING] Active Directory
    ↓
[EXISTING — REUSE] Verification search and/or AdSyncJob ingest
    ↓
[EXISTING — REUSE] Correlation run / link refresh
```

### Legend

| Kind | Components |
| ---- | ---------- |
| Existing | HRMS sync, Identity, AD read sync, correlation UI/API, workflow engine, provisioning models, ldapts |
| Needs extension | `adLdapService`, `provisioningWorker.resolveConnector`, possibly dispatcher + AD config keys |
| New | Joiner detection/rules engine, create payload policy, target OU config, possibly workflow template for JOINER |

---

## 20. Risks and Unknowns

| Issue | Classification |
| ----- | -------------- |
| Username / sAMAccountName generation | **FUNCTIONAL DECISION REQUIRED** |
| Target OU | **FUNCTIONAL DECISION REQUIRED** + **AD ADMIN CONFIRMATION REQUIRED** |
| Mandatory AD attributes for create in this domain | **AD ADMIN CONFIRMATION REQUIRED** |
| Initial password + delivery channel | **FUNCTIONAL DECISION REQUIRED** |
| LDAPS required for password set | **AD ADMIN CONFIRMATION REQUIRED** |
| Service account create permissions | **AD ADMIN CONFIRMATION REQUIRED** |
| Duplicate sAMAccountName / UPN handling | **FUNCTIONAL DECISION REQUIRED** |
| Workflow approval requirements for Joiner | **FUNCTIONAL DECISION REQUIRED** |
| Retry / compensating rollback if add succeeds but verify fails | **FUNCTIONAL DECISION REQUIRED** |
| Correlation auto vs manual after create | **FUNCTIONAL DECISION REQUIRED** |
| Which correlation engine path is authoritative (manual app-user vs AccountAggregation) | **UNKNOWN** / clarify with product — both exist; UI uses manual |
| Whether `identityCubeController` / `runCorrelationEngine` will be revived | **UNKNOWN** |
| Bind password encryption migration | **FUNCTIONAL DECISION REQUIRED** |
| Group assignment on Joiner | **FUNCTIONAL DECISION REQUIRED** (likely out of milestone 1) |
| Multi-domain / multi-baseDn which OU wins | **FUNCTIONAL DECISION REQUIRED** |
| Azure AD DS / cloud deployment create semantics vs on-prem | **UNKNOWN** — same `ldap_ad` family today |

---

## 21. FINAL RECOMMENDATION

### Recommended Implementation Order

```text
1. Confirm AD admin permissions + target OU + naming + password policy
   (blockers outside code)

2. Extend connectionConfig.ad with write settings (OU, UPN suffix)
   — config only when implementation starts

3. Add createAdUser (ldapts Client.add) in adLdapService using withBoundClient
   + duplicate pre-check search

4. Add Identity → AD attribute payload builder (pure, unit-tested)

5. Implement AD resolveConnector/executeTask for ADD_ACCOUNT in provisioningWorker
   (keep other connectors returning null)

6. Lab integration test: create → search → (delete cleanup)

7. Add verify-after-create (LDAP search and/or scheduleAdSyncJobRun)

8. Trigger correlation refresh using existing POST /correlation/run/:applicationId
   or a new single-account helper

9. Only then integrate Workflow Engine approval → enqueue JOINER ProvisioningRequest
   (reuse enqueueCertRevokeProvisioning pattern)

10. Production hardening: encrypt secrets, audit events, retries, monitoring
```

This order prefers **proving LDAP write against AD** before investing in full JML orchestration.

---

## Implementation Readiness

- Repository architecture understood: **YES**
- LDAP connector flow understood: **YES**
- LDAP library/version verified: **YES** (`ldapts@8.1.8`; `Client.add` available, unused)
- Connector abstraction identified: **YES** (family dispatcher + provisioning `executeTask` stub; no OOP base class)
- Existing write operations identified: **YES** — **none against AD/LDAP in application code**
- AD account model identified: **YES**
- Workflow integration identified: **YES** (remediation-centric; reusable patterns; no Joiner starter yet)
- Scheduler/job architecture identified: **YES** (AdSyncJob + ProvisioningTask worker + remediation schedulers)
- Required implementation files identified: **YES**
- Functional decisions still required: **username/UPN/OU/password/UAC/correlation-auto/Joiner approval model/secret encryption**
- AD administrator confirmations required: **create permissions on OU, password set rights, LDAPS, mandatory attributes, group rights if needed**
