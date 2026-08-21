/**
 * Profile Certification Scope Service
 *
 * Owns all scope-building logic for PROFILE-scope certifications:
 *   - IDENTITY Certification: 1 review item per (identity × entitlement) from the
 *     pre-computed identity_entitlements cube.
 *   - MANAGER Certification: same granularity but filtered to direct reports of
 *     selected managers; each manager is auto-assigned as the reviewer for their team.
 *
 * certificationScopeService.js delegates here for all PROFILE campaigns, keeping
 * that file as a thin router and preventing it from becoming a monolith.
 */

import mongoose from "mongoose";
import Identity from "../../models/identity/Identity.js";
import IdentityProfile from "../../models/identity/IdentityProfile.js";
import { getIdentityEntitlementModelForTenantId } from "../../models/identityEntitlementModel.js";
import {
  getRawMappedValueFromIdentity,
  normalizeReferenceLookupKey,
} from "../../utils/managerCorrelationEngine.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function asObjectId(value) {
  if (!value) return null;
  try {
    return mongoose.Types.ObjectId.isValid(value)
      ? new mongoose.Types.ObjectId(String(value))
      : null;
  } catch {
    return null;
  }
}

// ─── Snapshot builders ────────────────────────────────────────────────────────

/**
 * Strip an "ApplicationName:" prefix from an entitlement name.
 *
 * Source systems (GitHub, Jira, etc.) often store access as a compound value like
 * "GIT HUB:member" where the application name is prepended. Since applicationName is
 * stored separately on the document, the entitlement name should just be "member".
 *
 * Comparison is case-insensitive so "git hub:member" and "GIT HUB:member" both work.
 *
 * @param {string} rawName      - The raw entitlement name (may include app prefix).
 * @param {string} applicationName - The application name to strip.
 * @returns {string}            - Clean entitlement name without the app prefix.
 */
function stripEntitlementAppPrefix(rawName, applicationName) {
  if (!rawName) return rawName;
  if (!applicationName) return rawName;
  const prefix = applicationName.trim().toLowerCase() + ":";
  const raw    = rawName.trim();
  if (raw.toLowerCase().startsWith(prefix)) {
    const stripped = raw.slice(applicationName.trim().length + 1).trim();
    return stripped || raw; // guard against empty remainder
  }
  return raw;
}

/**
 * Resolve the clean entitlement name from an entitlement cube document.
 * Prefers entitlementDisplayName over entitlementValue, then strips any "APP:" prefix.
 *
 * @param {object} entDoc
 * @returns {string}
 */
function cleanEntitlementName(entDoc) {
  const raw  = entDoc.entitlementDisplayName || entDoc.entitlementValue || "";
  const app  = entDoc.applicationName || "";
  return stripEntitlementAppPrefix(raw, app);
}

/**
 * Build a frozen entitlementSnapshot from an identity_entitlements cube document.
 * Stored on ReviewItem at activation time so reviewers always see what existed then.
 *
 * @param {object} entDoc - A lean document from the identity_entitlements collection.
 * @returns {object}
 */
export function freezeEntitlementSnapshot(entDoc) {
  return {
    applicationId:   entDoc.applicationId   || null,
    applicationName: entDoc.applicationName || "",
    entitlementId:   entDoc.entitlementId
      ? String(entDoc.entitlementId)
      : (entDoc._id ? String(entDoc._id) : ""),
    entitlementName: cleanEntitlementName(entDoc),
    riskLevel:       entDoc.entitlementSnapshot?.riskLevel   || "NONE",
    isPrivileged:    Boolean(entDoc.entitlementSnapshot?.isPrivileged),
    snapshotAt:      new Date(),
  };
}

/**
 * Build the immutable provisioning payload for a review item.
 * Captured at item creation so the provisioning engine never needs to re-query live data.
 *
 * @param {object} identity - Lean Identity document.
 * @param {object} entDoc   - Lean identity_entitlements cube document.
 * @returns {object}
 */
export function buildProvisioningPayload(identity, entDoc) {
  return {
    identityId:      identity._id,
    applicationId:   entDoc.applicationId   || null,
    entitlementId:   entDoc.entitlementId ? String(entDoc.entitlementId) : "",
    entitlementName: cleanEntitlementName(entDoc),
    nativeIdentity:  entDoc.nativeIdentity  || identity.employeeId || identity.email || "",
    applicationName: entDoc.applicationName || "",
  };
}

// ─── Entitlement row loader ───────────────────────────────────────────────────

/**
 * Batch-fetch entitlements for a list of identity ObjectIds from the
 * pre-computed identity_entitlements cube collection.
 *
 * @param {mongoose.Types.ObjectId[]} identityObjectIds
 * @param {unknown} tenantId - Used to resolve the tenant slug and dynamic model.
 * @returns {Promise<Map<string, object[]>>} Map keyed by identityId string → entitlement docs
 */
export async function buildEntitlementRows(identityObjectIds, tenantId) {
  if (!identityObjectIds || identityObjectIds.length === 0) {
    return new Map();
  }

  const IdentityEntitlementModel = await getIdentityEntitlementModelForTenantId(tenantId);

  const docs = await IdentityEntitlementModel
    .find({ identityId: { $in: identityObjectIds } })
    .lean();

  /** @type {Map<string, object[]>} */
  const byIdentityId = new Map();
  for (const doc of docs) {
    const key = String(doc.identityId);
    if (!byIdentityId.has(key)) byIdentityId.set(key, []);
    byIdentityId.get(key).push(doc);
  }
  return byIdentityId;
}

// ─── Reviewer resolver ────────────────────────────────────────────────────────

/**
 * Resolve the reviewer for an identity under DEFAULT (manager) routing.
 *
 * Fallback chain (ID-first throughout):
 *   1. managerId → look up in managerById → manager has email → use manager
 *   2. managerId found but manager has no email → fall through (don't return empty email)
 *   3. identity.managerEmail (from import schema mapping) → try to resolve ID via managerByEmail
 *   4. campaign.backupManagerReviewerEmail
 *
 * @param {object}              identity      - Lean Identity document of the person being certified.
 * @param {object}              campaign      - Campaign document.
 * @param {Map<string, object>} managerById   - Pre-fetched manager docs keyed by id string.
 * @param {Map<string, object>} managerByEmail - Pre-fetched manager docs keyed by lowercase email.
 * @returns {{ reviewerIdentityId: mongoose.Types.ObjectId|null, reviewerEmail: string }}
 */
export function resolveReviewer(
  identity,
  campaign,
  managerById,
  managerByEmail,
  managerByEmpId,
  managerByKeyRaw,
) {
  const managerId = identity.managerId ? String(identity.managerId) : null;

  // Path 1: managerId (ObjectId FK) → manager doc → valid email
  // Primary path — requires manager correlation to have run.
  if (managerId && managerById.has(managerId)) {
    const mgr   = managerById.get(managerId);
    const email = (mgr.email || "").toLowerCase().trim();
    if (email && email.includes("@")) {
      return { reviewerIdentityId: mgr._id, reviewerEmail: email };
    }
    // manager doc exists but email is blank or not a valid address — fall through
  }

  // Path 2: managerEmployeeId → look up manager by employeeId in Identity warehouse.
  // Handles AD/HRMS sources where manager_id is a raw employee ID, not yet correlated.
  if (!managerId && identity.managerEmployeeId && managerByEmpId?.size) {
    const empId = String(identity.managerEmployeeId).trim();
    const mgr   = managerByEmpId.get(empId) || null;
    if (mgr) {
      const email = (mgr.email || "").toLowerCase().trim();
      if (email && email.includes("@")) {
        return { reviewerIdentityId: mgr._id, reviewerEmail: email };
      }
    }
  }

  // Path 3: managerKeyRaw → look up manager by the raw unresolved reference string.
  // Handles identities where correlation ran but left an unresolved reference (e.g.
  // manager not yet imported, or DN format that needs further normalization).
  if (!managerId && identity.managerKeyRaw && managerByKeyRaw?.size) {
    const rawKey = String(identity.managerKeyRaw).trim();
    const mgr    = managerByKeyRaw.get(rawKey) || null;
    if (mgr) {
      const email = (mgr.email || "").toLowerCase().trim();
      if (email && email.includes("@")) {
        return { reviewerIdentityId: mgr._id, reviewerEmail: email };
      }
    }
  }

  // Path 4: identity.managerEmail — directly mapped from schema (e.g. SCIM sources that
  // include a manager email field). Guard: validate it is a real email address, not a
  // display name accidentally mapped from schema (e.g. "Jun Roberts").
  if (identity.managerEmail) {
    const email = identity.managerEmail.toLowerCase().trim();
    if (email.includes("@")) {
      const mgr = managerByEmail?.get(email) || null;
      return { reviewerIdentityId: mgr?._id || null, reviewerEmail: email };
    }
  }

  // Path 5: no usable manager email found — use configured backup reviewer
  return {
    reviewerIdentityId: null,
    reviewerEmail: (campaign.backupManagerReviewerEmail || "").toLowerCase().trim(),
  };
}

// ─── Shared row builder ───────────────────────────────────────────────────────

/**
 * Build one scope row per (identity × entitlement) pair.
 * Each row maps directly to one ReviewItem on activation.
 *
 * @param {object} identity
 * @param {object} entDoc
 * @param {{ reviewerIdentityId: mongoose.Types.ObjectId|null, reviewerEmail: string }} reviewer
 * @returns {object}
 */
function buildScopeRow(identity, entDoc, reviewer) {
  const applicationName = entDoc.applicationName || "";
  // Strip "ApplicationName:" compound prefix — source systems store access as "APP:ROLE".
  // applicationName is stored separately so the entitlement field should just be "ROLE".
  const entitlementName = cleanEntitlementName(entDoc);

  return {
    // Identity fields
    id:              String(identity._id),
    userId:          String(identity._id),
    name:            identity.displayName
                       || [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim()
                       || identity.email
                       || "",
    email:           identity.email          || "",
    title:           identity.title          || "",
    department:      identity.department     || "",
    manager:         identity.manager        || "",
    managerEmail:    identity.managerEmail   || "",
    employeeId:      identity.employeeId     || "",
    status:          identity.isActive === false ? "inactive" : "active",
    lifecycleState:  identity.lifecycleState || "",
    identityType:    identity.identityType   || "",

    // Entitlement fields — stored in itemAccessDetails for the review item
    applicationName,
    displayAccess:      [`${applicationName}:${entitlementName}`],
    itemAccessDetails:  [entitlementName],

    // Reviewer (ID-first)
    reviewerIdentityId: reviewer.reviewerIdentityId || null,
    reviewerEmail:      reviewer.reviewerEmail       || "",

    // Frozen snapshot — persisted on ReviewItem at creation time
    entitlementSnapshot:  freezeEntitlementSnapshot(entDoc),

    // Provisioning prep — immutable at item creation
    provisioningAction:  "REMOVE_ENTITLEMENT",
    provisioningPayload: buildProvisioningPayload(identity, entDoc),
  };
}

// ─── Readiness summary builder ────────────────────────────────────────────────

/**
 * Aggregate a readiness summary from built scope rows.
 * Used by checkCampaignReadiness and returned alongside scopeData.
 */
function buildReadinessSummary(
  identities,
  entitlementsByIdentityId,
  campaign,
  managerById,
  managerByEmail,
  managerByEmpId,
  managerByKeyRaw,
) {
  let managerResolved = 0, managerMissing = 0, emailMissing = 0, totalEntitlements = 0;
  const backupEmail = (campaign.backupManagerReviewerEmail || "").toLowerCase().trim();

  for (const identity of identities) {
    const ents = entitlementsByIdentityId.get(String(identity._id)) || [];
    totalEntitlements += ents.length;

    if (!identity.email) emailMissing += 1;

    // Delegate to resolveReviewer so readiness EXACTLY mirrors what activation does.
    // Any divergence between readiness and actual routing led to misleading 100%
    // Manager Coverage while backup was still used (e.g. managerEmail set to a display
    // name like "Jun Roberts" — truthy but not a valid email).
    const { reviewerEmail } = resolveReviewer(
      identity, campaign, managerById, managerByEmail, managerByEmpId, managerByKeyRaw,
    );
    const isBackup = !reviewerEmail || reviewerEmail === backupEmail;
    if (isBackup) managerMissing  += 1;
    else          managerResolved += 1;
  }

  return {
    totalIdentities:     identities.length,
    totalEntitlements,
    managerResolved,
    managerMissing,
    emailMissing,
    backupReviewerEmail: backupEmail,
  };
}

// ─── Public scope builders ────────────────────────────────────────────────────

/**
 * Build scope rows for a PROFILE + IDENTITY certification.
 *
 * Certifies ALL identities in the selected identity profile.
 * Returns 1 scope row per (identity × entitlement) from the identity_entitlements cube.
 * Reviewer routing follows campaign.reviewerRoutingMode:
 *   - DEFAULT: routed to each identity's direct manager (with backup fallback)
 *   - INTERNAL / EXTERNAL: reviewer emails come from campaign.reviewersAssigned
 *
 * @param {object} campaign    - Lean or plain campaign document.
 * @param {unknown} tenantId
 * @returns {Promise<{ scopeData: object[], readinessSummary: object, normalizedCampaign: object }>}
 */
export async function buildIdentityScope(campaign, tenantId) {
  const profileId = asObjectId(campaign.identityProfileId);
  if (!profileId) {
    return { scopeData: [], readinessSummary: {}, normalizedCampaign: campaign };
  }

  const routingMode = String(campaign.reviewerRoutingMode || "DEFAULT").toUpperCase();
  const identityMode = String(campaign.identityMode || "ALL").toUpperCase();

  // 1. Fetch identities in the profile — ALL or SPECIFIC subset
  const identityQuery = {
    tenantId,
    identityProfileId: profileId,
  };

  if (identityMode === "SPECIFIC" && Array.isArray(campaign.selectedIds) && campaign.selectedIds.length > 0) {
    // Filter to the admin-selected identity IDs
    const selectedObjectIds = campaign.selectedIds
      .map((id) => asObjectId(id))
      .filter(Boolean);
    if (selectedObjectIds.length > 0) {
      identityQuery._id = { $in: selectedObjectIds };
    }
  }

  const identities = await Identity.find(identityQuery)
    .select(
      "_id displayName firstName lastName email employeeId department title " +
      "manager managerId managerEmail managerEmployeeId managerKeyRaw lifecycleState identityType isActive isNHI " +
      "attributes",  // needed for uid-correlated profiles (identity.attributes.uid)
    )
    .sort({ displayName: 1, email: 1 })
    .lean();

  if (identities.length === 0) {
    return {
      scopeData: [],
      readinessSummary: {
        totalIdentities: 0, totalEntitlements: 0,
        managerResolved: 0, managerMissing: 0, emailMissing: 0,
        backupReviewerEmail: campaign.backupManagerReviewerEmail || "",
      },
      normalizedCampaign: campaign,
    };
  }

  // 2. Batch-fetch entitlements from the identity_entitlements cube
  const identityObjectIds = identities.map((i) => i._id);
  const entitlementsByIdentityId = await buildEntitlementRows(identityObjectIds, tenantId);

  // 2a. Determine the reference attribute used for manager lookups.
  //
  // Manager references (e.g. "matteo.shah" from manager_id) must be resolved against
  // whatever attribute uniquely identifies identities in this profile's source system.
  //
  //   AD / uid-primary profiles  → referenceAttribute = "uid"  → key stored in identity.attributes.uid
  //   HRMS / employee-id primary → referenceAttribute = "employeeId" → identity.employeeId
  //   SCIM / email-primary       → referenceAttribute = "email"      → identity.email
  //
  // Priority: explicit managerCorrelation.referenceAttribute > profile.correlationTargetKey > "employeeId"
  const profileDoc = await IdentityProfile.findById(profileId)
    .select("managerCorrelation correlationTargetKey")
    .lean();
  const mcCfg = profileDoc?.managerCorrelation;
  const referenceAttr =
    (mcCfg?.referenceAttribute ? String(mcCfg.referenceAttribute).trim() : "") ||
    profileDoc?.correlationTargetKey ||
    "employeeId";

  // 3. Pre-fetch manager Identity docs for DEFAULT routing (avoid N+1 queries)
  /** @type {Map<string, object>} */
  const managerById      = new Map();   // managerId hex → Identity doc
  /** @type {Map<string, object>} */
  const managerByEmail   = new Map();   // lowercase email → Identity doc
  /** @type {Map<string, object>} */
  const managerByEmpId   = new Map();   // managerEmployeeId string → Identity doc
  /** @type {Map<string, object>} */
  const managerByKeyRaw  = new Map();   // managerKeyRaw string → Identity doc
  if (routingMode === "DEFAULT") {
    // Collect unique manager ObjectIds (must use ObjectIds for reliable $in lookup)
    const rawManagerObjectIds = identities
      .filter((i) => i.managerId)
      .map((i) => asObjectId(String(i.managerId)))
      .filter(Boolean);

    const uniqueManagerObjectIds = [
      ...new Map(rawManagerObjectIds.map((id) => [String(id), id])).values(),
    ];

    if (uniqueManagerObjectIds.length > 0) {
      const mgrs = await Identity.find({ _id: { $in: uniqueManagerObjectIds } })
        .select("_id email displayName firstName lastName")
        .lean();
      for (const m of mgrs) {
        managerById.set(String(m._id), m);
        if (m.email) managerByEmail.set(m.email.toLowerCase().trim(), m);
      }
    }

    // Second pass: resolve managers by managerEmployeeId / managerKeyRaw for identities
    // where managerId FK is null (correlation not yet run).
    //
    // Key insight: the manager reference value (e.g. "matteo.shah") must be matched against
    // the SAME attribute that uniquely identifies identities in this profile's source system
    // (referenceAttr: "uid" | "employeeId" | "email").
    //
    // For AD uid-primary profiles:
    //   manager_id = "matteo.shah" (the manager's user_id / uid)
    //   → look up the identity where attributes.uid = "matteo.shah"
    //   → NOT by employeeId (which is "EMP200002")
    //
    // Managers are usually co-located in the SAME profile, so we resolve from the
    // already-fetched `identities` array in memory first (zero extra DB queries).
    const unresolved = identities.filter((i) => !i.managerId);
    if (unresolved.length > 0) {
      // Build a lookup keyed by the profile's reference attribute value.
      // For uid:        key = identity.attributes.uid  ("matteo.shah")
      // For employeeId: key = identity.employeeId      ("EMP200002")
      // For email:      key = identity.email.toLowerCase()
      const identityByRef = new Map();
      for (const i of identities) {
        const refVal = getRawMappedValueFromIdentity(i, referenceAttr);
        const refKey = normalizeReferenceLookupKey(referenceAttr, refVal);
        if (refKey) identityByRef.set(refKey, i);
      }

      const empIds  = [...new Set(
        unresolved.map((i) => String(i.managerEmployeeId || "").trim()).filter(Boolean),
      )];
      const keyRaws = [...new Set(
        unresolved.map((i) => String(i.managerKeyRaw || "").trim()).filter(Boolean),
      )];
      const allRefIds = [...new Set([...empIds, ...keyRaws])];

      if (allRefIds.length > 0) {
        // Step 1: resolve from in-memory index (O(1), zero extra DB queries)
        const crossProfileIds = [];
        for (const refId of allRefIds) {
          const mgr = identityByRef.get(refId) || null;
          if (mgr) {
            managerByEmpId.set(refId, mgr);
            managerByKeyRaw.set(refId, mgr);
            const idKey = String(mgr._id);
            if (!managerById.has(idKey)) {
              managerById.set(idKey, mgr);
              if (mgr.email) managerByEmail.set(mgr.email.toLowerCase().trim(), mgr);
            }
          } else {
            crossProfileIds.push(refId);  // manager may be in a different profile
          }
        }

        // Step 2: DB query only for managers NOT found in the same profile.
        // Use the correct MongoDB field for the reference attribute.
        //   uid        → "attributes.uid"  (indexed: { tenantId, "attributes.uid" })
        //   employeeId → "employeeId"       (indexed: { tenantId, employeeId })
        //   email      → "email"            (indexed: { tenantId, email })
        if (crossProfileIds.length > 0) {
          const refDbField = referenceAttr === "uid"   ? "attributes.uid"
                           : referenceAttr === "email"  ? "email"
                           :                              "employeeId";

          const refMgrs = await Identity.find({
            tenantId: String(tenantId),
            [refDbField]: { $in: crossProfileIds },
          })
            .select("_id email employeeId attributes displayName firstName lastName")
            .lean();

          for (const m of refMgrs) {
            const mRefVal = getRawMappedValueFromIdentity(m, referenceAttr);
            const mRefKey = normalizeReferenceLookupKey(referenceAttr, mRefVal);
            if (mRefKey) {
              managerByEmpId.set(mRefKey, m);
              managerByKeyRaw.set(mRefKey, m);
            }
            const idKey = String(m._id);
            if (!managerById.has(idKey)) {
              managerById.set(idKey, m);
              if (m.email) managerByEmail.set(m.email.toLowerCase().trim(), m);
            }
          }
        }
      }
    }
  }

  // 4. Resolve static reviewer for INTERNAL / EXTERNAL modes
  //    (same reviewer for every row — never fall back to identity manager)
  let staticReviewer = null;
  if (routingMode !== "DEFAULT") {
    const first = (campaign.reviewersAssigned || [])[0];
    const reviewerId = first?.reviewerId?._id || first?.reviewerId || null;
    staticReviewer = {
      reviewerIdentityId:
        routingMode === "INTERNAL" && reviewerId ? reviewerId : null,
      reviewerEmail: String(first?.email || first?.reviewerEmail || "")
        .toLowerCase()
        .trim(),
    };
  }

  const pickScopeReviewer = (identity) => {
    if (routingMode !== "DEFAULT" && staticReviewer?.reviewerEmail) {
      return staticReviewer;
    }
    if (routingMode === "DEFAULT") {
      return resolveReviewer(
        identity,
        campaign,
        managerById,
        managerByEmail,
        managerByEmpId,
        managerByKeyRaw,
      );
    }
    return staticReviewer || { reviewerIdentityId: null, reviewerEmail: "" };
  };

  // 5. Build scope rows: 1 per (identity × entitlement)
  const scopeData = [];
  for (const identity of identities) {
    const ents = entitlementsByIdentityId.get(String(identity._id)) || [];

    // Identities with no entitlements are still included with an empty-access placeholder
    if (ents.length === 0) {
      const reviewer = pickScopeReviewer(identity);
      scopeData.push({
        id:              String(identity._id),
        userId:          String(identity._id),
        name:            identity.displayName
                           || [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim()
                           || identity.email || "",
        email:           identity.email || "",
        title:           identity.title || "",
        department:      identity.department || "",
        manager:         identity.manager || "",
        managerEmail:    identity.managerEmail || "",
        employeeId:      identity.employeeId || "",
        status:          identity.isActive === false ? "inactive" : "active",
        lifecycleState:  identity.lifecycleState || "",
        identityType:    identity.identityType || "",
        applicationName: "",
        displayAccess:   [],
        itemAccessDetails: [],
        reviewerIdentityId: reviewer.reviewerIdentityId,
        reviewerEmail:      reviewer.reviewerEmail,
        entitlementSnapshot:  null,
        provisioningAction:   null,
        provisioningPayload:  null,
      });
      continue;
    }

    for (const entDoc of ents) {
      const reviewer = pickScopeReviewer(identity);
      scopeData.push(buildScopeRow(identity, entDoc, reviewer));
    }
  }

  const readinessSummary = buildReadinessSummary(
    identities, entitlementsByIdentityId, campaign,
    managerById, managerByEmail, managerByEmpId, managerByKeyRaw,
  );

  return { scopeData, readinessSummary, normalizedCampaign: campaign };
}

/**
 * Build scope rows for a PROFILE + MANAGER certification.
 *
 * Scope is restricted to direct reports of the managers listed in
 * campaign.scopeFilters.managerIds. Each selected manager is automatically
 * the reviewer for their own team's review items (no manual reviewer selection).
 *
 * @param {object} campaign
 * @param {unknown} tenantId
 * @returns {Promise<{ scopeData: object[], readinessSummary: object, normalizedCampaign: object }>}
 */
export async function buildManagerScope(campaign, tenantId) {
  const profileId = asObjectId(campaign.identityProfileId);
  const rawManagerIds = campaign.scopeFilters?.managerIds || [];

  const selectedManagerIds = rawManagerIds
    .map((id) => asObjectId(id))
    .filter(Boolean);

  if (!profileId || selectedManagerIds.length === 0) {
    return { scopeData: [], readinessSummary: {}, normalizedCampaign: campaign };
  }

  // 1. Look up manager Identity docs (manager = reviewer)
  const managerDocs = await Identity.find({ _id: { $in: selectedManagerIds } })
    .select("_id email displayName firstName lastName department")
    .lean();

  /** @type {Map<string, object>} */
  const managerById = new Map();
  for (const m of managerDocs) {
    managerById.set(String(m._id), m);
  }

  // 2. Fetch direct reports within this profile
  const identities = await Identity.find({
    tenantId,
    identityProfileId: profileId,
    managerId: { $in: selectedManagerIds },
  })
    .select(
      "_id displayName firstName lastName email employeeId department title " +
      "manager managerId managerEmail lifecycleState identityType isActive isNHI",
    )
    .sort({ displayName: 1, email: 1 })
    .lean();

  if (identities.length === 0) {
    return {
      scopeData: [],
      readinessSummary: {
        totalIdentities: 0, totalEntitlements: 0,
        managerResolved: 0, managerMissing: 0, emailMissing: 0,
        backupReviewerEmail: "",
      },
      normalizedCampaign: campaign,
    };
  }

  // 3. Batch-fetch entitlements
  const identityObjectIds = identities.map((i) => i._id);
  const entitlementsByIdentityId = await buildEntitlementRows(identityObjectIds, tenantId);

  // 4. Build scope rows — reviewer = the identity's manager
  const scopeData = [];
  for (const identity of identities) {
    const ents = entitlementsByIdentityId.get(String(identity._id)) || [];

    // Reviewer is always the identity's direct manager
    const mgrId = identity.managerId ? String(identity.managerId) : null;
    const mgr = mgrId ? managerById.get(mgrId) : null;
    const reviewer = {
      reviewerIdentityId: mgr ? mgr._id : null,
      reviewerEmail: mgr ? (mgr.email || "").toLowerCase().trim() : "",
    };

    if (ents.length === 0) {
      scopeData.push({
        id:              String(identity._id),
        userId:          String(identity._id),
        name:            identity.displayName
                           || [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim()
                           || identity.email || "",
        email:           identity.email || "",
        title:           identity.title || "",
        department:      identity.department || "",
        manager:         identity.manager || "",
        managerEmail:    identity.managerEmail || "",
        employeeId:      identity.employeeId || "",
        status:          identity.isActive === false ? "inactive" : "active",
        lifecycleState:  identity.lifecycleState || "",
        identityType:    identity.identityType || "",
        applicationName: "",
        displayAccess:   [],
        itemAccessDetails: [],
        reviewerIdentityId: reviewer.reviewerIdentityId,
        reviewerEmail:      reviewer.reviewerEmail,
        entitlementSnapshot:  null,
        provisioningAction:   null,
        provisioningPayload:  null,
      });
      continue;
    }

    for (const entDoc of ents) {
      scopeData.push(buildScopeRow(identity, entDoc, reviewer));
    }
  }

  // Readiness for manager cert: all identities should have a manager (by definition),
  // but email coverage may still be incomplete.
  const readinessSummary = {
    totalIdentities:   identities.length,
    totalEntitlements: scopeData.filter((r) => r.entitlementSnapshot).length,
    managerResolved:   identities.length,  // all have managerId (that's the filter)
    managerMissing:    0,
    emailMissing:      identities.filter((i) => !i.email).length,
    backupReviewerEmail: "",
  };

  return { scopeData, readinessSummary, normalizedCampaign: campaign };
}
