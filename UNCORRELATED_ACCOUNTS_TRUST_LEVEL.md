# Uncorrelated Accounts — Automatic Trust Level

## Summary

Automatic **Trust Level** calculation for the Uncorrelated Accounts page (`/identities/accounts/uncorrelated`). Trust is derived from account lifecycle status and privileged entitlements, returned by the API, shown in the Trust column, and persisted as `OrphanAccount.riskLevel` so filters and HIGH RISK stats stay accurate.

Trust is also **explainable and auditable**: hover tooltips on the Trust chip and a **Trust Analysis** panel in the expanded row use enrichment fields from the same list API (no extra calls on expand).

Previously, every orphan was created with `riskLevel: 'HIGH'`, so the Trust column did not reflect real risk.

---

## Business rules

Scenario evaluation is fixed. Default Trust Levels (overridable via Global Rule Set → Uncorrelated Account Trust Mapping):

| Scenario | Default Trust |
|----------|---------------|
| Inactive Account | **LOW** |
| Active + privileged entitlements | **HIGH** |
| Active + no privileged entitlements | **MEDIUM** |

```
scenario = determineScenario(account)   // unchanged
trust    = tenantTrustMapping[scenario] // defaults when no config
```

If the live application user document cannot be loaded, Trust defaults to **HIGH** (conservative).

API enrichment also returns `trustScenario`, `configuredTrustLevel`, and Applied Trust Mapping fields for tooltip / Trust Analysis.
---

## Investigation (pre-implementation)

| Item | Finding |
|------|---------|
| Frontend route | `/identities/accounts/uncorrelated` → `OrphanAccounts.jsx` |
| Trust chip | `RiskBadge` in the Trust column (and Matching context) |
| Expanded row | Inline `Collapse` under **Audit detail** (same page; not a separate component) |
| Tooltips | MUI `Tooltip` used for actions / Last activity; Trust chip had none |
| API | `GET /api/correlation/orphans` → `getOrphanAccounts` |
| Account storage | Dynamic `app_iga_*_*_users` (status / UAC on the user doc) |
| Entitlement storage | Dynamic `app_iga_*_*_entitlements` |
| Queue row | `OrphanAccount` — Trust UI historically read `riskLevel` |
| Privilege detection | Existing `privilegeMatchFilter` + catalog flags + `PRIVILEGED_NAME_TOKENS` |
| Prior Trust field | None — `riskLevel` was hardcoded `HIGH` on upsert |

`OrphanAccount.status` is queue state (`OPEN`, `REMEDIATED`, …), **not** Active/Inactive. Lifecycle status lives on the application user document.

**Additional enrichment required for explainability:** entitlement name lists, `trustReason` / tooltip lines, and `trustSummary` (boolean privilege alone was insufficient for analyst UX).

---

## Exact implementation

### 1. Shared calculator — `orphanAccountTrust.js`

- `resolveOrphanAccountLifecycleStatus(accountDoc)` — Active / Inactive
- `accountHasPrivilegedEntitlement` / `classifyAccountEntitlements` — privilege + privileged vs normal lists
- `loadPrivilegedEntitlementCatalog` — batch privileged catalog (`tokenSet` + id/name map)
- `calculateOrphanTrustLevel` / `buildOrphanTrustExplanation` / `resolveOrphanTrustFromAccountDoc`

### 2. List enrichment — `orphanAccountDisplayEnrichment.js`

Batch-loads app users + privileged catalogs per application, computes Trust once, attaches explainability fields, syncs `riskLevel`.

### 3. Correlation upsert — `correlationController.js`

Persists computed `riskLevel` on orphan create; maps explainability fields to the client.

### 4. Frontend — tooltip + Trust Analysis

- Trust chip: MUI `Tooltip` with `TrustChipTooltipTitle` (no new library)
- Expanded **Audit detail**: third panel `TrustAnalysisPanel` (status, badge, reason, entitlements, summary)
- No extra API calls on row expand

### Badge colors

- **Low** → green (`#16A34A`)
- **Medium** → orange (`#D97706`)
- **High** → red (`#DC2626`)

---

## Updated API response (trust fields)

```json
{
  "trustLevel": "HIGH",
  "riskLevel": "HIGH",
  "accountStatus": "Active",
  "trustReason": ["Account is Active", "Privileged entitlement detected"],
  "trustTooltipLines": [
    "Account is Uncorrelated",
    "Account Status: Active",
    "Privileged entitlement detected"
  ],
  "trustAnalysisLines": [
    "Account is active.",
    "One or more privileged entitlements detected."
  ],
  "trustSummary": "This account is classified as HIGH Trust because it is active and has privileged access within the application.",
  "hasPrivilegedEntitlement": true,
  "privilegedEntitlements": [{ "id": "...", "name": "SAP_ALL" }],
  "normalEntitlements": [{ "id": "...", "name": "Employee" }]
}
```

---

## Performance

- No N+1: users and privileged catalogs loaded **once per application** on the page
- Trust computed **once** during enrichment
- Expand uses row data already in memory

---

## Files modified / added

| File | Change |
|------|--------|
| `icm-backend/src/utils/datahygine/orphanAccountTrust.js` | Trust calc + explainability |
| `icm-backend/src/utils/datahygine/orphanAccountTrust.test.js` | Unit tests |
| `icm-backend/src/utils/datahygine/orphanAccountDisplayEnrichment.js` | Enrich + persist |
| `icm-backend/src/controllers/correlation/correlationController.js` | Upsert + API mapping |
| `icm-frontend/src/pages/identities/OrphanAccounts.jsx` | Tooltip + Trust Analysis |
| `icm-frontend/src/theme/palette.js` | High → red |

---

## Tests

```bash
cd icm-backend
node --experimental-vm-modules ../node_modules/jest/bin/jest.js \
  src/utils/datahygine/orphanAccountTrust.test.js
```
