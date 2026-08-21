# Identity Profile: Draft Save & Manager Correlation Preview

## Background

The Identity Profile creation flow currently requires users to:
1. Add attribute mappings on the **Mapping tab**
2. Navigate to the **Settings tab** → configure Manager Key Field + Reference Field → save
3. Only then does "Save Mappings" become enabled

The problem: any unsaved mappings are **lost on page refresh or navigation** before Settings are configured.

## User Review Required

> [!IMPORTANT]
> The existing final save validation logic is **NOT changing**. The `PUT /:id/mappings` endpoint will still reject calls without valid manager correlation fields. Only a separate draft persistence path is added.

> [!NOTE]
> **Manager Correlation Preview change (user clarification):** No "Preview" button is added. Instead, the correlation preview table renders **inline below the dropdown selectors** as soon as both fields are selected. This is inline behavior, not a modal.

---

## Feature 1 — Save as Draft

### How Draft Works

- Draft stores mapping rows to the **IdentityProfile document** using new schema fields (`mappingDraft.*`).
- Draft is **separate** from `attributeMappings` (which is the final committed state used for identity sync).
- On page load, if `mappingDraft.isDraft === true`, rows are auto-loaded from draft data instead of `attributeMappings`.
- On final Save (existing button), the draft data is cleared after successful commit.
- Auto-save every **30 seconds** if rows have changed since last save.
- "Unsaved changes" navigation guard using `beforeunload`.

---

## Proposed Changes

### Backend

---

#### [MODIFY] [IdentityProfile.js](file:///d:/Isphere/Wisibility_IGA/icm-backend/src/models/identity/IdentityProfile.js)

Add a `mappingDraft` subdocument to the schema:

```js
mappingDraft: {
  isDraft: { type: Boolean, default: false },
  draftSavedAt: { type: Date },
  draftVersion: { type: Number, default: 0 },
  mappingDraftData: { type: mongoose.Schema.Types.Mixed, default: [] },
}
```

---

#### [MODIFY] [identityProfileController.js](file:///d:/Isphere/Wisibility_IGA/icm-backend/src/controllers/identity/identityProfileController.js)

Add two new controller functions:

1. **`patchIdentityProfileDraft`** — saves draft (no manager correlation validation):
   - Accepts `{ mappingDraftData }` in body
   - Writes to `profile.mappingDraft.mappingDraftData`, sets `isDraft: true`, updates `draftSavedAt`, increments `draftVersion`
   - Returns updated `mappingDraft` object

2. **`clearIdentityProfileDraft`** — clears draft after final save (called automatically in `putIdentityProfileMappings` on success).

Modify **`putIdentityProfileMappings`** — after `await profile.save()` succeeds, also clear `mappingDraft.isDraft = false`, `mappingDraftData = []`.

Add **`getManagerCorrelationPreview`** controller — for inline preview table:
- Accepts query params: `profileId`, `managerAttribute`, `referenceAttribute`
- Fetches materialized identities for the profile's tenant
- Returns paginated rows: `{ employeeName, referenceField, managerField, isUnmatched }`
- Returns `{ rows, total, hasNoMatches }` 
- Query: find all identities where `managerAttribute` field is present; for each, attempt to find another identity matching `referenceAttribute = managerAttribute_value` → include match result

---

#### [MODIFY] [identityProfileRoutes.js](file:///d:/Isphere/Wisibility_IGA/icm-backend/src/routes/identityProfileRoutes.js)

Add routes:
```js
router.patch('/:id/draft', authenticate, patchIdentityProfileDraft);
router.delete('/:id/draft', authenticate, clearIdentityProfileDraft);
router.get('/:id/manager-correlation-preview', authenticate, getManagerCorrelationPreview);
```

---

### Frontend

---

#### [MODIFY] [api.js](file:///d:/Isphere/Wisibility_IGA/icm-frontend/src/services/api.js)

Add to `identityProfileAPI`:
```js
saveDraft: (id, data) => api.patch(`/identity-profiles/${id}/draft`, data),
clearDraft: (id) => api.delete(`/identity-profiles/${id}/draft`),
getManagerCorrelationPreview: (id, params) =>
  api.get(`/identity-profiles/${id}/manager-correlation-preview`, { params }),
```

---

#### [MODIFY] [IdentityProfileMappingTab.jsx](file:///d:/Isphere/Wisibility_IGA/icm-frontend/src/pages/identities/IdentityProfileMappingTab.jsx)

**New state:**
- `isDraft` — boolean, true if rows were loaded from draft
- `draftSaving` — loading state for the draft save button
- `lastDraftSavedAt` — timestamp string to show "Last saved at..."
- `hasUnsavedChanges` — dirty flag tracking if rows differ from last save/load

**Draft Load on mount:**
- In the existing `useEffect` that hydrates rows: check `profile.mappingDraft?.isDraft`. If `true` and `mappingDraft.mappingDraftData?.length > 0`, load from draft instead of `attributeMappings`.
- Show a toast/alert: "Draft restored — your previously saved draft has been loaded."

**Save as Draft button:**
- Placed beside "Save mappings" button, with `variant="outlined"` / secondary style
- Icon: `DraftsOutlined` or `SaveOutlined`
- Calls `identityProfileAPI.saveDraft(profileId, { mappingDraftData: payloadMappings() })`
- Shows toast: "Draft saved successfully"

**Auto-save (30 sec interval):**
- `useEffect` with `setInterval(30_000)` — if `hasUnsavedChanges && rows.length > 0`, fire silent draft save (no toast, just update `lastDraftSavedAt`)

**Draft badge/tag:**
- Near the profile title in the header: a small `Chip` with label `"Draft"`, color `warning`, only visible when `isDraft === true`

**Navigation guard:**
- `useEffect(() => { window.onbeforeunload = hasUnsavedChanges ? () => 'You have unsaved changes...' : null; return () => { window.onbeforeunload = null; }; }, [hasUnsavedChanges])`

**On final Save success:**
- Call `identityProfileAPI.clearDraft(profileId)` after `putMappings` returns OK
- Set `isDraft = false`, `hasUnsavedChanges = false`

---

#### [MODIFY] [IdentityProfileDetail.jsx](file:///d:/Isphere/Wisibility_IGA/icm-frontend/src/pages/identities/IdentityProfileDetail.jsx)

**Manager Correlation Preview (inline below dropdowns):**

When both `correlation.managerAttribute` and `correlation.referenceAttribute` are non-empty strings (and they differ), automatically fetch the preview via `identityProfileAPI.getManagerCorrelationPreview(profileId, { managerAttribute, referenceAttribute, page, limit })`.

Display inline beneath the two dropdowns (no modal, no button):
- Skeleton loader while fetching
- A table: `Employee Name | Reference Field Value | Manager Field Value | Status`
- "Status" column: `✓ Matched` (green chip) or `⚠ Unmatched` (orange/amber chip)
- Pagination controls (< 1 / N >) 
- Search/filter input above table
- Warning alert if `hasNoMatches === true`: _"No valid manager correlation found. Verify the selected fields form valid relationships."_
- Highlighted rows for unmatched references

**State added:**
- `correlationPreview` — `{ rows, total, hasNoMatches }`
- `correlationPreviewLoading`
- `correlationPreviewPage` (default 1)
- `correlationPreviewSearch` — filter string

**Trigger:** `useEffect` that watches `[correlation.managerAttribute, correlation.referenceAttribute]` with debounce (500ms). Only fires when `profileRecord` exists and both fields are set.

---

## API Contract

### `PATCH /identity-profiles/:id/draft`
**Body:**
```json
{ "mappingDraftData": [ { "targetKey": "...", "targetLabel": "...", "applicationId": "...", "sourceAttribute": "...", "transform": "none" } ] }
```
**Response 200:**
```json
{ "success": true, "data": { "isDraft": true, "draftSavedAt": "2026-05-18T...", "draftVersion": 3 } }
```

### `DELETE /identity-profiles/:id/draft`
**Response 200:** `{ "success": true }`

### `GET /identity-profiles/:id/manager-correlation-preview`
**Query params:** `managerAttribute`, `referenceAttribute`, `page` (default 1), `limit` (default 10), `search`
**Response 200:**
```json
{
  "success": true,
  "data": {
    "rows": [
      { "employeeName": "John Doe", "referenceValue": "1001", "managerValue": "1000", "managerName": "Jane Smith", "isUnmatched": false },
      { "employeeName": "Alice Lee", "referenceValue": "1003", "managerValue": "9999", "managerName": null, "isUnmatched": true }
    ],
    "total": 45,
    "page": 1,
    "limit": 10,
    "hasNoMatches": false
  }
}
```

---

## Database Schema Update

```js
// Added to identityProfileSchema
mappingDraft: {
  isDraft: { type: Boolean, default: false },
  draftSavedAt: { type: Date, default: null },
  draftVersion: { type: Number, default: 0 },
  mappingDraftData: { type: mongoose.Schema.Types.Mixed, default: [] },
}
```

No migration script needed — MongoDB will default these fields for existing documents.

---

## Draft Lifecycle

```
[User adds rows] 
    → hasUnsavedChanges = true
    → Auto-save every 30s (silent) 
    → OR user clicks "Save as Draft" (toast shown)
    → PATCH /identity-profiles/:id/draft
    → isDraft = true, badge shown
    → On next page load: rows restored from draft
    → User completes Settings tab → managerCorrelation saved
    → User clicks "Save Mappings" (existing button)
    → PUT /identity-profiles/:id/mappings succeeds
    → DELETE /identity-profiles/:id/draft (auto-called)
    → isDraft = false, draft badge removed
```

---

## Verification Plan

### Automated
- Manual testing via browser: add rows → refresh → verify draft restores
- Add rows → navigate away → confirm browser `beforeunload` warning appears
- Complete settings → click Save Mappings → confirm draft badge disappears

### Manual Verification
- Draft badge appears on profile page title after "Save as Draft"
- Auto-save fires silently after 30 seconds
- Manager correlation preview renders inline below dropdowns upon field selection
- Unmatched rows highlighted in amber/orange
- No-matches warning alert shown when appropriate
- Existing "Save Mappings" validation still enforces managerCorrelation prerequisite

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Draft exists but final mappings saved by another tab | On load: if `isDraft === false`, use `attributeMappings` (draft was cleared) |
| Empty rows on draft save | Allow — saves empty draft array (user may have deleted all rows) |
| Draft version conflict | `draftVersion` is monotonically incremented; UI uses server-returned value (no optimistic locking needed) |
| Manager correlation preview on profile with no synced identities | API returns `rows: []`, `hasNoMatches: true`, UI shows warning |
| Both fields same value | Frontend already prevents (existing: `ma !== ra` check) |
| Profile with no `tenantId` | Preview API returns 400 with friendly message |
