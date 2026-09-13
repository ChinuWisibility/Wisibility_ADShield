import mongoose from "mongoose";
import ReviewItem from "../../models/certification/ReviewItem.js";
import CertificationReviewerAssignment from "../../models/certification/CertificationReviewerAssignment.js";
import CertificationScopeSnapshot from "../../models/certification/CertificationScopeSnapshot.js";
import User from "../../models/platform/User.js";
import Identity from "../../models/identity/Identity.js";
import {
  collectScopeItemAliasCandidates,
  collectUserPrimaryIdentifiers,
  itemIdsMatch,
  normalizeItemIdKey,
  resolveCanonicalItemKey,
} from "../../utils/access-certification/certificationItemId.js";
import { tokenizeAndNormalize } from "../../utils/accessMemberOfTokens.js";
import { adaptUserToSnapshotRow } from '../../utils/access-certification/certificationUserAdapter.js';

function ensureMap(maybeMap) {
  if (maybeMap instanceof Map) return maybeMap;
  return new Map(Object.entries(maybeMap || {}));
}

/** PROFILE + IDENTITY campaigns certify identities from the entitlement cube. */
export function isProfileIdentityCampaign(campaign) {
  return (
    String(campaign?.certificationScope || "").toUpperCase() === "PROFILE" &&
    String(campaign?.category || "").toUpperCase() === "IDENTITY"
  );
}

function stripEntitlementAppPrefix(rawName, applicationName) {
  if (!rawName) return rawName || "";
  if (!applicationName) return String(rawName).trim();
  const prefix = applicationName.trim().toLowerCase() + ":";
  const raw = String(rawName).trim();
  if (raw.toLowerCase().startsWith(prefix)) {
    const stripped = raw.slice(applicationName.trim().length + 1).trim();
    return stripped || raw;
  }
  return raw;
}

/** Extract clean application + entitlement from a PROFILE scope row. */
function extractEntitlementFromScopeRow(row) {
  const applicationName = String(row.applicationName || "").trim();
  let entitlementName = "";
  if (Array.isArray(row.itemAccessDetails) && row.itemAccessDetails.length > 0) {
    entitlementName = stripEntitlementAppPrefix(
      String(row.itemAccessDetails[0]).trim(),
      applicationName,
    );
  } else if (Array.isArray(row.displayAccess) && row.displayAccess.length > 0) {
    entitlementName = stripEntitlementAppPrefix(
      String(row.displayAccess[0]).trim(),
      applicationName,
    );
  } else if (
    Array.isArray(row.displayGroupsLabel) &&
    row.displayGroupsLabel.length > 0
  ) {
    entitlementName = stripEntitlementAppPrefix(
      String(row.displayGroupsLabel[0]).trim(),
      applicationName,
    );
  }
  return {
    applicationName,
    entitlementName,
    entitlementSnapshot: row.entitlementSnapshot || null,
    provisioningPayload: row.provisioningPayload || null,
    provisioningAction: row.provisioningAction || null,
  };
}

/**
 * Merge PROFILE+IDENTITY scope rows (one per entitlement) into one row per identity
 * with all entitlements attached for a single ReviewItem.
 */
export function aggregateProfileIdentityScopeRows(scopeRows = []) {
  /** @type {Map<string, object>} */
  const byIdentity = new Map();

  for (const row of scopeRows) {
    const identityKey = String(row.userId || row.id || row.mongoId || "").trim();
    if (!identityKey) continue;

    const ent = extractEntitlementFromScopeRow(row);
    const hasEntitlement = Boolean(ent.entitlementName || ent.applicationName);

    if (!byIdentity.has(identityKey)) {
      byIdentity.set(identityKey, {
        ...row,
        applicationName: "",
        displayAccess: undefined,
        displayGroupsLabel: undefined,
        itemAccessDetails: [],
        _profileIdentityEntitlements: [],
      });
    }

    const merged = byIdentity.get(identityKey);

    if (!merged.reviewerEmail && row.reviewerEmail) {
      merged.reviewerEmail = row.reviewerEmail;
    }
    if (!merged.reviewerIdentityId && row.reviewerIdentityId) {
      merged.reviewerIdentityId = row.reviewerIdentityId;
    }
    if (!merged.managerEmail && row.managerEmail) {
      merged.managerEmail = row.managerEmail;
    }
    if (!merged.manager && row.manager) {
      merged.manager = row.manager;
    }

    if (!hasEntitlement) continue;

    const dedupeKey = `${ent.applicationName.toLowerCase()}::${ent.entitlementName.toLowerCase()}`;
    if (
      merged._profileIdentityEntitlements.some((e) => e._dedupeKey === dedupeKey)
    ) {
      continue;
    }

    merged._profileIdentityEntitlements.push({
      ...ent,
      _dedupeKey: dedupeKey,
    });
    if (ent.entitlementName) {
      merged.itemAccessDetails.push(ent.entitlementName);
    }

    if (!merged.entitlementSnapshot && ent.entitlementSnapshot) {
      merged.entitlementSnapshot = ent.entitlementSnapshot;
    }
    if (!merged.provisioningPayload && ent.provisioningPayload) {
      merged.provisioningPayload = ent.provisioningPayload;
    }
    if (!merged.provisioningAction && ent.provisioningAction) {
      merged.provisioningAction = ent.provisioningAction;
    }
  }

  return [...byIdentity.values()];
}

/** Count granular decisions across review items (defaults to 1 when no entitlementDecisions). */
export function countEntitlementsInReviewItems(reviewItems = []) {
  let total = 0;
  for (const ri of reviewItems) {
    if (
      Array.isArray(ri.entitlementDecisions) &&
      ri.entitlementDecisions.length > 0
    ) {
      total += ri.entitlementDecisions.length;
    } else {
      total += 1;
    }
  }
  return total;
}

/** Pending entitlement units for one review item (legacy items count as 1). */
export function countPendingEntitlementsInReviewItem(reviewItem) {
  const eds = Array.isArray(reviewItem?.entitlementDecisions)
    ? reviewItem.entitlementDecisions
    : [];
  if (eds.length > 0) {
    return eds.filter(
      (ed) => String(ed?.status || "PENDING").toUpperCase() === "PENDING",
    ).length;
  }
  return String(reviewItem?.status || "").toUpperCase() === "PENDING" ? 1 : 0;
}

/** Map reviewerEmail → pending entitlement count for a campaign. */
export async function countPendingEntitlementsByReviewerForCampaign(campaignId) {
  const items = await ReviewItem.find({ campaignId })
    .select("reviewerEmail entitlementDecisions status")
    .lean();
  const map = {};
  for (const ri of items) {
    const email = String(ri.reviewerEmail || "").trim().toLowerCase();
    if (!email) continue;
    const pending = countPendingEntitlementsInReviewItem(ri);
    if (pending > 0) map[email] = (map[email] || 0) + pending;
  }
  return map;
}

function identityDisplayName(identity) {
  if (!identity) return "";
  return (
    String(identity.displayName || "").trim() ||
    [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim()
  );
}

/**
 * Per-reviewer entitlement progress and display names from ReviewItem rows.
 * When entitlementDecisions[] exists, each entry counts as one review unit.
 */
export function buildEntitlementProgressMaps(reviewItems = []) {
  const countMap = new Map();
  const nameByEmail = new Map();

  for (const item of reviewItems) {
    const email = String(item.reviewerEmail || "").toLowerCase();
    if (!email) continue;

    const displayName = String(item.reviewerName || item.itemManager || "").trim();
    if (displayName && !nameByEmail.has(email)) {
      nameByEmail.set(email, displayName);
    }

    if (!countMap.has(email)) {
      countMap.set(email, { total: 0, approved: 0, revoked: 0, pending: 0 });
    }
    const bucket = countMap.get(email);
    const eds = item.entitlementDecisions;

    if (Array.isArray(eds) && eds.length > 0) {
      for (const ed of eds) {
        bucket.total += 1;
        const st = String(ed.status || "PENDING");
        if (st === "PENDING") bucket.pending += 1;
        else if (st === "APPROVED") bucket.approved += 1;
        else if (st === "REVOKED" || st === "REVOKE_IN_PROGRESS") bucket.revoked += 1;
      }
    } else {
      bucket.total += 1;
      const st = String(item.status || "PENDING");
      if (st === "PENDING") bucket.pending += 1;
      else if (st === "APPROVED" || st === "DELEGATED" || st === "EXCEPTION") {
        bucket.approved += 1;
      } else if (st === "REVOKED" || st === "REVOKE_IN_PROGRESS") bucket.revoked += 1;
    }
  }

  return { countMap, nameByEmail };
}

/** Resolve reviewer display names from Identity warehouse when missing on ReviewItems. */
async function enrichReviewerNamesByEmail(nameByEmail, tenantId, reviewerEmails = []) {
  if (!tenantId) return nameByEmail;
  const emails = new Set(
    reviewerEmails.map((e) => String(e || "").toLowerCase()).filter(Boolean),
  );
  for (const email of nameByEmail.keys()) emails.add(email);

  const emailsNeedingName = [...emails].filter((email) => !nameByEmail.get(email));
  if (emailsNeedingName.length === 0) return nameByEmail;

  const identities = await Identity.find({
    tenantId,
    email: { $in: emailsNeedingName },
  })
    .select("email displayName firstName lastName")
    .lean();

  for (const identity of identities) {
    const email = String(identity.email || "").toLowerCase();
    const name = identityDisplayName(identity);
    if (email && name) nameByEmail.set(email, name);
  }
  return nameByEmail;
}

/** Attach reviewer display names to lean ReviewItem docs (API + repair flows). */
export async function enrichReviewerNamesForReviewItems(reviewItems = [], tenantId) {
  if (!Array.isArray(reviewItems) || reviewItems.length === 0) return reviewItems;

  const { nameByEmail } = buildEntitlementProgressMaps(reviewItems);
  const reviewerEmails = reviewItems
    .map((ri) => String(ri.reviewerEmail || "").toLowerCase())
    .filter(Boolean);
  await enrichReviewerNamesByEmail(nameByEmail, tenantId, reviewerEmails);

  return reviewItems.map((ri) => {
    const email = String(ri.reviewerEmail || "").toLowerCase();
    const resolvedName = ri.reviewerName || nameByEmail.get(email) || "";
    const mgrEmail = String(ri.itemManagerEmail || "").toLowerCase();
    const itemManager =
      ri.itemManager ||
      (resolvedName && mgrEmail && mgrEmail === email ? resolvedName : ri.itemManager);

    return {
      ...ri,
      reviewerName: resolvedName || ri.reviewerName,
      itemManager,
      reviewerSnapshot: ri.reviewerSnapshot
        ? { ...ri.reviewerSnapshot, name: ri.reviewerSnapshot.name || resolvedName || undefined }
        : ri.reviewerSnapshot,
    };
  });
}

/** Stamp reviewerName / itemManager on docs using Identity refs before insert. */
async function enrichReviewerNamesOnDocs(docs, tenantId) {
  if (!docs.length) return;

  const identityIds = [
    ...new Set(
      docs
        .filter((d) => d.reviewerIdentityId)
        .map((d) => String(d.reviewerIdentityId)),
    ),
  ];
  const emails = [
    ...new Set(
      docs
        .filter((d) => d.reviewerEmail && !d.reviewerName)
        .map((d) => String(d.reviewerEmail).toLowerCase()),
    ),
  ];

  const identityById = new Map();
  const identityByEmail = new Map();

  if (identityIds.length) {
    const objectIds = identityIds
      .map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null))
      .filter(Boolean);
    if (objectIds.length) {
      const found = await Identity.find({ _id: { $in: objectIds } })
        .select("_id email displayName firstName lastName")
        .lean();
      for (const identity of found) {
        identityById.set(String(identity._id), identity);
        const email = String(identity.email || "").toLowerCase();
        if (email) identityByEmail.set(email, identity);
      }
    }
  }

  const missingEmails = emails.filter((e) => !identityByEmail.has(e));
  if (missingEmails.length && tenantId) {
    const found = await Identity.find({
      tenantId,
      email: { $in: missingEmails },
    })
      .select("_id email displayName firstName lastName")
      .lean();
    for (const identity of found) {
      identityById.set(String(identity._id), identity);
      const email = String(identity.email || "").toLowerCase();
      if (email) identityByEmail.set(email, identity);
    }
  }

  for (const doc of docs) {
    if (doc.reviewerName) continue;
    const identity =
      (doc.reviewerIdentityId &&
        identityById.get(String(doc.reviewerIdentityId))) ||
      (doc.reviewerEmail &&
        identityByEmail.get(String(doc.reviewerEmail).toLowerCase())) ||
      null;
    const name = identityDisplayName(identity);
    if (name) {
      doc.reviewerName = name;
      const mgrEmail = String(doc.itemManagerEmail || "").toLowerCase();
      if (
        !doc.itemManager &&
        mgrEmail &&
        mgrEmail === String(doc.reviewerEmail || "").toLowerCase()
      ) {
        doc.itemManager = name;
      }
    }
  }
}

/**
 * Find assignment key for a scope row. `campaign` must carry a Map of itemId → assignment
 * (same shape as former currentReview: at least reviewerEmail per key).
 */
export function findMatchingItemKeyForScopeRow(row, campaign) {
  const cr = ensureMap(campaign?.currentReview);
  if (cr.size === 0) {
    const primary =
      collectUserPrimaryIdentifiers(row)[0] ||
      collectScopeItemAliasCandidates(row)[0] ||
      row?.id ||
      row?.userId ||
      row?.mongoId ||
      "";
    return resolveCanonicalItemKey({
      rawId: primary,
      campaign,
    });
  }

  // Prefer user / account keys so shared entitlement labels (e.g. app name) do not steal the first map hit.
  const primaryIds = collectUserPrimaryIdentifiers(row);
  for (const c of primaryIds) {
    for (const [key] of cr.entries()) {
      if (itemIdsMatch(String(key), String(c))) return String(key);
    }
  }

  const candidates = collectScopeItemAliasCandidates(row);
  for (const c of candidates) {
    for (const [key] of cr.entries()) {
      if (itemIdsMatch(String(key), String(c))) return String(key);
    }
  }

  const primary =
    primaryIds[0] ||
    candidates[0] ||
    row?.id ||
    row?.userId ||
    row?.mongoId ||
    "";
  return resolveCanonicalItemKey({
    rawId: primary,
    campaign,
  });
}

function reviewItemBelongsToScopeRow(ri, row) {
  const ru = String(ri?.userId || "").trim();
  if (!ru) return true;
  const ids = collectUserPrimaryIdentifiers(row);
  if (ids.length === 0) return true;
  return ids.some((c) => itemIdsMatch(ru, c));
}

/** Match assignment map entry when Map keys and scope identifiers differ only by format/case/ObjectId. */
function findAssignmentEntryForRow(row, map, campaignForKeys) {
  const m = ensureMap(map);
  const ordered = [
    findMatchingItemKeyForScopeRow(row, campaignForKeys),
    ...collectUserPrimaryIdentifiers(row),
  ];
  const seen = new Set();
  for (const c of ordered) {
    const cs = String(c || "").trim();
    if (!cs) continue;
    const sig = cs.toLowerCase();
    if (seen.has(sig)) continue;
    seen.add(sig);
    for (const [mk, val] of m.entries()) {
      if (itemIdsMatch(String(mk), cs)) return val || {};
    }
  }
  return {};
}

/**
 * Resolve reviewer email for a scope row during ReviewItem generation.
 * Order: assignment map → scope row → EXTERNAL/INTERNAL pool → DEFAULT manager fallback.
 */
export function resolveReviewerEmailForScopeRow({
  campaign,
  category,
  row,
  assignmentEntry = {},
  reviewerEmails = [],
  index = 0,
  reviewerNameByEmail,
}) {
  const catUpper = String(category || "").toUpperCase();
  const routingMode = String(campaign?.reviewerRoutingMode || "DEFAULT").toUpperCase();
  const isDefaultManagerRouting = routingMode === "DEFAULT";
  const isStaticReviewerMode = routingMode === "EXTERNAL" || routingMode === "INTERNAL";

  const reviewerPool = Array.isArray(campaign?.reviewersAssigned)
    ? campaign.reviewersAssigned
    : [];
  const isManagerRoutedCampaign =
    catUpper === "MANAGER" ||
    routingMode === "DEFAULT" ||
    reviewerPool.some(
      (r) => String(r?.reviewerType || "").toUpperCase() === "MANAGER",
    );

  let reviewerEmail = String(
    assignmentEntry.reviewerEmail ||
      assignmentEntry.email ||
      assignmentEntry.assignedTo ||
      row?.reviewerEmail ||
      row?.currentReview?.reviewerEmail ||
      "",
  )
    .trim()
    .toLowerCase();

  if (!reviewerEmail && isStaticReviewerMode && reviewerEmails.length > 0) {
    reviewerEmail =
      reviewerEmails.length === 1
        ? reviewerEmails[0]
        : reviewerEmails[index % reviewerEmails.length];
  }

  const avoidPoolRoundRobinMisassign =
    isManagerRoutedCampaign &&
    ["IDENTITY", "ACCESS_ITEMS", "ROLE_COMPOSITION", "UNCORRELATED_ACCOUNTS"].includes(
      catUpper,
    );

  if (
    !reviewerEmail &&
    reviewerEmails.length > 0 &&
    !avoidPoolRoundRobinMisassign &&
    !isStaticReviewerMode
  ) {
    reviewerEmail =
      reviewerEmails.length === 1
        ? reviewerEmails[0]
        : reviewerEmails[index % reviewerEmails.length];
  }

  if (
    !reviewerEmail &&
    isDefaultManagerRouting &&
    (isManagerRoutedCampaign || catUpper === "IDENTITY")
  ) {
    const managerReviewerEmail = String(
      row?.currentReview?.reviewerEmail || row?.managerEmail || "",
    )
      .trim()
      .toLowerCase();

    if (managerReviewerEmail && managerReviewerEmail.includes("@")) {
      reviewerEmail = managerReviewerEmail;
      if (reviewerNameByEmail && !reviewerNameByEmail.has(reviewerEmail)) {
        const mgrName = String(row.manager || row.managerName || "").trim();
        if (mgrName) reviewerNameByEmail.set(reviewerEmail, mgrName);
      }
    } else {
      const backup = String(
        campaign?.backupManagerReviewerEmail ||
          campaign?.backupManagerReviewer?.email ||
          "",
      )
        .trim()
        .toLowerCase();
      if (backup && backup.includes("@")) {
        reviewerEmail = backup;
        if (reviewerNameByEmail && !reviewerNameByEmail.has(backup)) {
          const backupName = String(
            campaign?.backupManagerReviewerName ||
              campaign?.backupManagerReviewer?.name ||
              "",
          ).trim();
          if (backupName) reviewerNameByEmail.set(backup, backupName);
        }
      }
    }
  }

  return reviewerEmail;
}

/**
 * Bulk-create ReviewItems. Pass assignmentMap (itemId → { reviewerEmail, assignedAt }) from buildReviewerAssignmentMap.
 */
export async function generateReviewItems(
  campaign,
  scopeRows = [],
  assignmentMap,
) {
  const campaignId = campaign._id;
  const tenantId = campaign.tenantId || null;
  const applicationId = campaign.applicationId?._id || campaign.applicationId;
  const category = campaign.category || "";
  const reviewerPool = Array.isArray(campaign?.reviewersAssigned)
    ? campaign.reviewersAssigned
    : [];
  const reviewerEmails = reviewerPool
    .map((r) =>
      String(r?.email || r?.reviewerEmail || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);

  // Build email → name lookup so reviewerName is stored on each ReviewItem
  const reviewerNameByEmail = new Map();
  // Build email → id lookup for pool reviewers (INTERNAL/EXTERNAL routing)
  const reviewerIdByEmail = new Map();
  for (const r of reviewerPool) {
    const e = String(r?.email || r?.reviewerEmail || "").trim().toLowerCase();
    const n = String(r?.name || r?.reviewerName || "").trim();
    if (e && n) reviewerNameByEmail.set(e, n);
    const rid = r?.reviewerId?._id || r?.reviewerId;
    if (e && rid) reviewerIdByEmail.set(e, rid);
  }

  // Resolved at creation time — used for both snapshot and CertificationReviewerAssignment.
  const resolveReviewerSource = (camp, email) => {
    const mode = camp.reviewerRoutingMode;
    if (mode === "EXTERNAL") return "EXTERNAL";
    if (mode === "INTERNAL") return "INTERNAL";
    const backup = String(camp.backupManagerReviewerEmail || "").trim().toLowerCase();
    if (backup && email === backup) {
      return camp.backupReviewerSource === "INTERNAL"
        ? "BACKUP_MANAGER_INTERNAL"
        : "BACKUP_MANAGER_EXTERNAL";
    }
    return "MANAGER";
  };

  const map =
    assignmentMap instanceof Map
      ? assignmentMap
      : ensureMap(campaign?.currentReview);

  const campaignForKeys = {
    ...campaign,
    currentReview: map,
  };

  const normalizedRows = scopeRows.map(adaptUserToSnapshotRow);
  const profileIdentity = isProfileIdentityCampaign(campaign);
  const rowsToProcess = profileIdentity
    ? aggregateProfileIdentityScopeRows(normalizedRows)
    : normalizedRows;

  // Process rows in chunks so we never hold millions of docs in memory at once.
  // Each chunk is built, User-ID-resolved, snapshot-stamped, and inserted independently.
  // CertificationReviewerAssignment is small (one entry per reviewer) so it is
  // accumulated across chunks and written in a single bulkWrite at the end.
  const CHUNK_SIZE = 500;
  const seen = new Set();
  const snapshotAt = new Date();
  const reviewerMap = new Map(); // accumulated across chunks
  let totalCreated = 0;

  const pickStr = (...vals) => {
    for (const v of vals) {
      const s = String(v ?? "").trim();
      if (s && s !== "—" && s !== "-") return s;
    }
    return undefined;
  };

  for (
    let chunkStart = 0;
    chunkStart < rowsToProcess.length;
    chunkStart += CHUNK_SIZE
  ) {
    const chunkRows = rowsToProcess.slice(chunkStart, chunkStart + CHUNK_SIZE);
    const chunkDocs = [];

    for (let ci = 0; ci < chunkRows.length; ci++) {
      const index = chunkStart + ci; // global index — needed for correct round-robin
      const row = chunkRows[ci];
      const itemKey = findMatchingItemKeyForScopeRow(row, campaignForKeys);
      const userId = String(row.userId || row.id || row.mongoId || "").trim();
      const dedupeKey = `${userId || "__nouser__"}::${itemKey}`;
      if (!itemKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const entry = findAssignmentEntryForRow(row, map, campaignForKeys);
      const catUpper = String(category || "").toUpperCase();
      const reviewerEmail = resolveReviewerEmailForScopeRow({
        campaign,
        category,
        row,
        assignmentEntry: entry,
        reviewerEmails,
        index,
        reviewerNameByEmail,
      });

      const itemName = pickStr(
        row.name, row.displayName, row.display_name,
        row.identityName, row.userName, row.email,
      );
      const itemEmail = pickStr(row.email, row.identityEmail);
      const itemDepartment = pickStr(row.department);
      const itemTitle = pickStr(row.title, row.role);
      const itemManager = pickStr(row.manager, row.managerName);
      const itemManagerEmail = pickStr(row.managerEmail);
      const itemApplicationName = profileIdentity
        ? undefined
        : pickStr(row.applicationName, campaign.applicationName);

      let itemAccessDetails;
      let entitlementDecisions;

      if (
        profileIdentity &&
        Array.isArray(row._profileIdentityEntitlements)
      ) {
        itemAccessDetails = row._profileIdentityEntitlements
          .map((e) => e.entitlementName)
          .filter(Boolean);
        entitlementDecisions = row._profileIdentityEntitlements.map((e) => ({
          entitlementName: e.entitlementName,
          applicationName: e.applicationName || undefined,
          applicationId: e.provisioningPayload?.applicationId || undefined,
          status: "PENDING",
        }));
      } else {
        itemAccessDetails =
          Array.isArray(row.itemAccessDetails) && row.itemAccessDetails.length > 0
            ? row.itemAccessDetails
            : Array.isArray(row.displayAccess) && row.displayAccess.length > 0
              ? row.displayAccess
              : Array.isArray(row.displayGroupsLabel) &&
                  row.displayGroupsLabel.length > 0
                ? row.displayGroupsLabel
                : undefined;
        if (
          !itemAccessDetails?.length &&
          row.memberOf &&
          catUpper !== "ACCESS_ITEMS" &&
          catUpper !== "ROLE_COMPOSITION"
        ) {
          const fromMember = tokenizeAndNormalize(row.memberOf);
          if (fromMember.length) itemAccessDetails = fromMember;
        }
        entitlementDecisions = (itemAccessDetails || []).map((name) => ({
          entitlementName: String(name),
          applicationName: itemApplicationName || undefined,
          status: "PENDING",
        }));
      }

      const reviewItemType =
        profileIdentity && (!itemAccessDetails || itemAccessDetails.length === 0)
          ? "NO_ACCESS"
          : "ENTITLEMENT";

      chunkDocs.push({
        campaignId,
        tenantId,
        userId: userId || itemKey,
        userPrimaryKey:    pickStr(row.user_id, row.primaryKey)             || undefined,
        managerPrimaryKey: pickStr(row.rawData?.manager_id, row.manager_id) || undefined,
        applicationId: applicationId || undefined,
        category,
        itemId: String(itemKey),
        itemName,
        itemEmail,
        itemDepartment,
        itemTitle,
        itemManager,
        itemManagerEmail,
        itemApplicationName,
        itemAccessDetails,
        entitlementDecisions,
        entitlementSnapshot: row.entitlementSnapshot || undefined,
        provisioningAction: row.provisioningAction || undefined,
        provisioningPayload: row.provisioningPayload || undefined,
        reviewerEmail,
        reviewerName: reviewerNameByEmail.get(reviewerEmail) || undefined,
        reviewerIdentityId: row.reviewerIdentityId || undefined,
        // reviewerIdByEmail is a cross-chunk cache: pool entries + previously resolved managers
        reviewerId: reviewerEmail ? (reviewerIdByEmail.get(reviewerEmail) || undefined) : undefined,
        reviewItemType,
        status: "PENDING",
      });
    }

    if (chunkDocs.length === 0) continue;

    await enrichReviewerNamesOnDocs(chunkDocs, tenantId);

    // Resolve User ObjectIds for reviewer emails not yet in the cache.
    const emailsNeedingId = [
      ...new Set(
        chunkDocs.filter(d => d.reviewerEmail && !d.reviewerId).map(d => d.reviewerEmail),
      ),
    ];
    if (emailsNeedingId.length > 0) {
      try {
        const found = await User.find({ email: { $in: emailsNeedingId } })
          .select("_id email")
          .lean();
        for (const u of found) {
          const e = String(u.email || "").toLowerCase();
          if (e && u._id) reviewerIdByEmail.set(e, u._id); // cache for later chunks
        }
        for (const d of chunkDocs) {
          if (d.reviewerEmail && !d.reviewerId) {
            const id = reviewerIdByEmail.get(d.reviewerEmail);
            if (id) d.reviewerId = id;
          }
        }
      } catch { /* best-effort */ }
    }

    // Stamp immutable reviewerSnapshot and accumulate reviewer tallies.
    for (const d of chunkDocs) {
      if (d.reviewerEmail) {
        d.reviewerSnapshot = {
          reviewerId: d.reviewerId,
          email:      d.reviewerEmail,
          name:       d.reviewerName,
          source:     resolveReviewerSource(campaign, d.reviewerEmail),
          snapshotAt,
        };
      }

      // Accumulate reviewer map for CertificationReviewerAssignment (written after all chunks).
      const email = String(d.reviewerEmail || "").toLowerCase();
      if (email) {
        if (!reviewerMap.has(email)) {
          reviewerMap.set(email, {
            reviewerEmail: email,
            reviewerName: d.reviewerName || "",
            reviewerSource: resolveReviewerSource(campaign, email),
            userIdSet: new Set(),
            itemCount: 0,
          });
        }
        const rm = reviewerMap.get(email);
        rm.userIdSet.add(d.userId);
        rm.itemCount += (d.entitlementDecisions?.length || 1);
      }
    }

    // Insert review items for this chunk.
    let chunkInserted = [];
    try {
      chunkInserted = await ReviewItem.insertMany(chunkDocs, { ordered: false });
    } catch (err) {
      if (err?.code === 11000 || err?.writeErrors) {
        chunkInserted = err.insertedDocs ?? [];
      } else {
        throw err;
      }
    }
    totalCreated += chunkInserted.length;

    // Scope snapshots for this chunk — written immediately to avoid a second full pass.
    try {
      const snapshotDocs = [];
      for (const item of chunkInserted) {
        const userSnapshot = {
          userId:      item.userId,
          userName:    item.itemName,
          userEmail:   item.itemEmail,
          title:       item.itemTitle,
          department:  item.itemDepartment,
          managerName: item.itemManager,
          managerEmail: item.itemManagerEmail,
        };
        if (Array.isArray(item.entitlementDecisions) && item.entitlementDecisions.length > 0) {
          for (const ed of item.entitlementDecisions) {
            snapshotDocs.push({
              tenantId: campaign.tenantId,
              campaignId: campaign._id,
              reviewItemId: item._id,
              userSnapshot,
              accessSnapshot: {
                entitlementName: ed.entitlementName,
                applicationName: ed.applicationName || item.itemApplicationName,
                isPrivileged: false,
              },
              capturedAt: snapshotAt,
            });
          }
        } else {
          snapshotDocs.push({
            tenantId: campaign.tenantId,
            campaignId: campaign._id,
            reviewItemId: item._id,
            userSnapshot,
            accessSnapshot: { applicationName: item.itemApplicationName },
            capturedAt: snapshotAt,
          });
        }
      }
      if (snapshotDocs.length) {
        await CertificationScopeSnapshot.insertMany(snapshotDocs, { ordered: false });
      }
    } catch (err) {
      console.error("[generateReviewItems] CertificationScopeSnapshot chunk failed:", err.message);
    }
  } // end chunk loop

  if (totalCreated === 0) return { created: 0 };

  // CertificationReviewerAssignment — one upsert per reviewer, written once after all chunks.
  try {
    const assignmentOps = [...reviewerMap.values()].map((r) => ({
      updateOne: {
        filter: { campaignId: campaign._id, reviewerEmail: r.reviewerEmail },
        update: {
          $setOnInsert: {
            tenantId: campaign.tenantId,
            campaignId: campaign._id,
            reviewerEmail: r.reviewerEmail,
            reviewerName: r.reviewerName,
            reviewerSource: r.reviewerSource,
            assignedAt: new Date(),
            assignmentStatus: "ACTIVE",
            approvedCount: 0,
            revokedCount: 0,
            completionPercentage: 0,
          },
          $set: {
            assignedUsersCount: r.userIdSet.size,
            assignedItemsCount: r.itemCount,
            pendingCount: r.itemCount,
          },
        },
        upsert: true,
      },
    }));
    if (assignmentOps.length) {
      await CertificationReviewerAssignment.bulkWrite(assignmentOps, { ordered: false });
    }
  } catch (err) {
    console.error("[generateReviewItems] CertificationReviewerAssignment upsert failed:", err.message);
  }

  return { created: totalCreated };
}

export async function getReviewItemsForReviewer(
  campaignId,
  reviewerEmail,
  { status, reviewerId } = {},
) {
  const email = String(reviewerEmail || "").trim().toLowerCase();
  // Prefer reviewerId when available — survives email renames.
  const reviewerClause = reviewerId
    ? { $or: [{ reviewerId }, { reviewerEmail: email }] }
    : { reviewerEmail: email };
  const q = { campaignId, ...reviewerClause };
  if (status) q.status = status;
  return ReviewItem.find(q).sort({ itemName: 1, itemId: 1 }).lean();
}

/** Fields required by the paginated review board (smaller payload, faster reads). */
export const REVIEW_ITEM_BOARD_PROJECTION =
  "itemId userId itemName itemEmail itemDepartment itemTitle itemManager itemManagerEmail itemApplicationName itemAccessDetails status decision entitlementDecisions reviewerEmail reviewerName reviewerSnapshot reviewerIdentityId entitlementSnapshot reviewItemType reviewedAt comment";

const REVIEWED_ITEM_STATUSES = ["APPROVED", "REVOKED", "DELEGATED", "EXCEPTION"];

/**
 * Map UI scope status to a Mongo filter on ReviewItem.status.
 * REVIEWED = any non-PENDING decision (matches dashboard "reviewed" semantics).
 */
export function applyReviewItemStatusFilter(query, status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (!normalized) return;

  if (normalized === "REVIEWED") {
    query.status = { $in: REVIEWED_ITEM_STATUSES };
    return;
  }

  if (normalized === "PENDING") {
    query.status = "PENDING";
    return;
  }

  query.status = normalized;
}

export async function getReviewItemsByCampaign(
  campaignId,
  {
    status,
    q,
    reviewItemType,
    page = 1,
    limit = 500,
    projection = REVIEW_ITEM_BOARD_PROJECTION,
  } = {},
) {
  const query = { campaignId };
  applyReviewItemStatusFilter(query, status);
  if (reviewItemType) query.reviewItemType = String(reviewItemType || "").trim().toUpperCase();
  const term = String(q || "").trim();
  if (term) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [
      { itemName: re },
      { itemEmail: re },
      { itemId: re },
      { userId: re },
    ];
  }
  const skip =
    Math.max(0, (Number(page) || 1) - 1) * Math.min(500, Number(limit) || 500);
  const take = Math.min(500, Math.max(1, Number(limit) || 500));

  let itemQuery = ReviewItem.find(query)
    .sort({ reviewerEmail: 1, itemId: 1 })
    .skip(skip)
    .limit(take);
  if (projection) {
    itemQuery = itemQuery.select(projection);
  }

  const [items, total] = await Promise.all([
    itemQuery.lean(),
    ReviewItem.countDocuments(query),
  ]);

  return { items, total, page: Number(page) || 1, limit: take };
}

/**
 * completed = non-PENDING (includes APPROVED, REVOKED, DELEGATED, EXCEPTION).
 * DELEGATED / EXCEPTION count toward completed and toward `approved` for dashboard tallies.
 */
export async function getProgress(campaignId) {
  const oid = mongoose.Types.ObjectId.isValid(String(campaignId))
    ? new mongoose.Types.ObjectId(String(campaignId))
    : campaignId;
  const rows = await ReviewItem.aggregate([
    { $match: { campaignId: oid } },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  let total = 0;
  let pending = 0;
  let completed = 0;
  let approved = 0;
  let revoked = 0;

  for (const r of rows) {
    const c = r.count || 0;
    total += c;
    const st = String(r._id || "");
    if (st === "PENDING") pending += c;
    else {
      completed += c;
      if (st === "APPROVED" || st === "DELEGATED" || st === "EXCEPTION")
        approved += c;
      if (st === "REVOKED") revoked += c;
    }
  }

  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    total,
    completed,
    approved,
    revoked,
    pending,
    percentage,
  };
}

export async function countReviewItemsForCampaign(campaignId) {
  return ReviewItem.countDocuments({ campaignId });
}

/**
 * Count items whose reviewerEmail is not in the campaign's reviewersAssigned list.
 * Used by the dashboard to surface "Missing Reviewer" metric.
 */
export async function getMissingReviewerCount(campaign) {
  const campaignId =
    campaign && typeof campaign === "object" ? campaign._id : campaign;
  if (!campaignId) return 0;
  // Count PENDING items that have no reviewer email assigned (independent of routing mode)
  return ReviewItem.countDocuments({
    campaignId,
    status: "PENDING",
    $or: [
      { reviewerEmail: { $exists: false } },
      { reviewerEmail: null },
      { reviewerEmail: "" },
    ],
  });
}

/**
 * Per-reviewer progress breakdown for the dashboard Assigned Reviewers card.
 * Returns the campaign's reviewersAssigned array enriched with live progress counts.
 */
export async function getReviewerProgress(campaign) {
  const reviewItems = await ReviewItem.find({ campaignId: campaign._id })
    .select(
      "reviewerEmail reviewerName reviewerIdentityId itemManager itemManagerEmail entitlementDecisions status",
    )
    .lean();

  let { countMap, nameByEmail } = buildEntitlementProgressMaps(reviewItems);
  nameByEmail = await enrichReviewerNamesByEmail(
    nameByEmail,
    campaign.tenantId,
    [...countMap.keys()],
  );

  // Primary: CertificationReviewerAssignment — populated on campaign activation
  const assignments = await CertificationReviewerAssignment.find(
    { campaignId: campaign._id },
    "reviewerEmail reviewerName reviewerId reviewerType reviewerSource assignmentStatus assignedBy assignedAt assignedItemsCount pendingCount",
  ).lean();

  // Fallback: old campaigns that predate CertificationReviewerAssignment population
  const reviewerList =
    assignments.length > 0
      ? assignments.map((a) => ({
          reviewerId: a.reviewerId,
          reviewerType: a.reviewerType,
          reviewerSource: a.reviewerSource,
          assignmentStatus: a.assignmentStatus,
          email: String(a.reviewerEmail || "").toLowerCase(),
          name:
            a.reviewerName ||
            nameByEmail.get(String(a.reviewerEmail || "").toLowerCase()) ||
            "",
          assignedBy: a.assignedBy || null,
          assignedAt: a.assignedAt || null,
        }))
      : (campaign.reviewersAssigned || []).map((r) => ({
          reviewerId: r.reviewerId,
          reviewerType: r.reviewerType,
          reviewerSource: null,
          assignmentStatus: null,
          email: String(r.email || "").toLowerCase(),
          name:
            r.name ||
            nameByEmail.get(String(r.email || "").toLowerCase()) ||
            "",
          assignedBy: r.assignedBy || null,
          assignedAt: r.assignedAt || null,
        }));

  // Include reviewers present on ReviewItems but missing from assignment records.
  for (const [email, counts] of countMap.entries()) {
    if (!reviewerList.some((r) => String(r.email || "").toLowerCase() === email)) {
      reviewerList.push({
        reviewerId: null,
        reviewerType: null,
        reviewerSource: "MANAGER",
        assignmentStatus: "ACTIVE",
        email,
        name: nameByEmail.get(email) || "",
        assignedBy: null,
        assignedAt: null,
      });
    }
  }

  return reviewerList.map((r) => {
    const email = String(r.email || "").toLowerCase();
    const counts = countMap.get(email) || {
      total: 0,
      approved: 0,
      revoked: 0,
      pending: 0,
    };
    const completion =
      counts.total > 0
        ? Math.round(((counts.approved + counts.revoked) / counts.total) * 100)
        : 0;
    return {
      reviewerId: r.reviewerId,
      reviewerType: r.reviewerType,
      reviewerSource: r.reviewerSource,
      assignmentStatus: r.assignmentStatus,
      email: r.email,
      name: r.name || nameByEmail.get(email) || "",
      assignedBy: r.assignedBy,
      assignedAt: r.assignedAt,
      progress: { ...counts, completion },
    };
  });
}

/**
 * Attach ReviewItem ids/status to scope rows (alias-aware).
 */
export function mergeReviewItemsIntoScopeData(
  scopeData,
  campaign,
  reviewItems,
) {
  const catUpper = String(campaign?.category || "").toUpperCase();
  const isAccessScopedCat =
    catUpper === "ACCESS_ITEMS" || catUpper === "ROLE_COMPOSITION";

  const list = Array.isArray(reviewItems) ? reviewItems : [];
  const assignmentMap = new Map();
  for (const r of list) {
    assignmentMap.set(String(r.itemId), {
      reviewerEmail: r.reviewerEmail,
    });
  }
  const campaignForKeys = { ...campaign, currentReview: assignmentMap };
  return scopeData.map((row) => {
    const key = findMatchingItemKeyForScopeRow(row, campaignForKeys);
    const pool = list.filter((r) => reviewItemBelongsToScopeRow(r, row));
    const searchList = pool.length > 0 ? pool : list;

    let ri = searchList.find((r) => String(r.itemId) === String(key));
    if (!ri) {
      ri = searchList.find(
        (r) =>
          itemIdsMatch(String(r.itemId), String(key)) ||
          collectScopeItemAliasCandidates(row).some((c) =>
            itemIdsMatch(String(r.itemId), c),
          ),
      );
    }
    if (!ri) return row;

    const decision =
      ri.decision ||
      (ri.status === "REVOKED"
        ? "Revoked"
        : ri.status === "PENDING"
          ? null
          : ri.status === "APPROVED"
            ? "Approved"
            : ri.status === "DELEGATED"
              ? "Delegate"
              : ri.status === "EXCEPTION"
                ? "Exception"
                : null);

    const snapshotOverrides = {};
    const rowName = String(row.name ?? "").trim();
    const riName = String(ri.itemName ?? "").trim();
    const riItemId = String(ri.itemId ?? "").trim();
    const rowHasRealName = rowName && rowName !== "Unknown User";
    const riNameIsTechnical =
      !riName ||
      (riItemId && itemIdsMatch(riName, riItemId)) ||
      (riName && riItemId && normalizeItemIdKey(riName) === normalizeItemIdKey(riItemId));

    if (
      (!rowName || rowName === "Unknown User") &&
      riName &&
      !riNameIsTechnical
    ) {
      snapshotOverrides.name = riName;
    } else if (rowHasRealName && riNameIsTechnical) {
      snapshotOverrides.name = rowName;
    } else if ((!rowName || rowName === "Unknown User") && riName) {
      snapshotOverrides.name = riName;
    }

    const rowEmail = String(row.email ?? "").trim();
    const riEmail = String(ri.itemEmail ?? "").trim();
    const emailLooksValid = (s) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
    const rowHasRealEmail = emailLooksValid(rowEmail);
    const riEmailIsWeak = !riEmail || !emailLooksValid(riEmail);

    if (!rowEmail && riEmail) {
      snapshotOverrides.email = riEmail;
    } else if (rowHasRealEmail && riEmailIsWeak) {
      snapshotOverrides.email = rowEmail;
    }
    const rowManager = String(row.manager ?? "").trim();
    const riManager = String(ri.itemManager ?? "").trim();
    if (!rowManager && riManager) {
      snapshotOverrides.manager = riManager;
    }
    const rowManagerEmail = String(row.managerEmail ?? "").trim();
    const riManagerEmail = String(ri.itemManagerEmail ?? "").trim();
    if (!rowManagerEmail && riManagerEmail) {
      snapshotOverrides.managerEmail = riManagerEmail;
    }

    const fromRiAccess = Array.isArray(ri.itemAccessDetails)
      ? ri.itemAccessDetails.map((x) => String(x || "").trim()).filter(Boolean)
      : [];

    const rowAccess =
      Array.isArray(row.displayAccess) && row.displayAccess.length > 0
        ? row.displayAccess
        : [];
    const rowGroups =
      Array.isArray(row.displayGroupsLabel) && row.displayGroupsLabel.length > 0
        ? row.displayGroupsLabel
        : [];
    const baseAccess = rowAccess.length > 0 ? rowAccess : rowGroups;
    const hasRowAccess = baseAccess.length > 0;

    const accessPatch = {};
    if (fromRiAccess.length > 0) {
      if (isAccessScopedCat && hasRowAccess) {
        // Scope rows already carry only matched catalog access; keep review UI identical to wizard.
        accessPatch.displayAccess = [...baseAccess];
        accessPatch.displayGroupsLabel = [...baseAccess];
      } else if (!hasRowAccess) {
        accessPatch.displayAccess = fromRiAccess;
        accessPatch.displayGroupsLabel = fromRiAccess;
      } else {
        const seen = new Set(
          baseAccess.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean),
        );
        const merged = [...baseAccess];
        for (const s of fromRiAccess) {
          const k = String(s).trim().toLowerCase();
          if (!k || seen.has(k)) continue;
          seen.add(k);
          merged.push(s);
        }
        accessPatch.displayAccess = merged;
        accessPatch.displayGroupsLabel = merged;
      }
    }

    return {
      ...row,
      ...snapshotOverrides,
      ...accessPatch,
      reviewItemId: ri._id,
      reviewItemStatus: ri.status,
      reviewItemKey: ri.itemId,
      reviewItemType: ri.reviewItemType,
      aggregatedDecision: decision ?? row.aggregatedDecision,
      currentReview: {
        decision,
        reviewerEmail: ri.reviewerEmail,
        reviewedAt: ri.reviewedAt,
        comment: ri.comment,
      },
    };
  });
}
