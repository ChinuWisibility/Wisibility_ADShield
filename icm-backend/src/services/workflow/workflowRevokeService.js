import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import IdentityAccountLink from "../../models/identity/IdentityAccountLink.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import {
  fetchCorrelatedEntitlementsForAccount,
  resolveLiveApplicationUser,
} from "../../controllers/correlation/identityAccountLinkController.js";
import { getIdentityEntitlementModelForTenantId } from "../../models/identityEntitlementModel.js";
import {
  fetchCorrelatedEntitlementsWithProjectionFallback,
} from "../../utils/identityEntitlementProjectionRead.js";

/** Raw account fields scanned by IdentityDetail when correlated entitlements are empty. */
const RAW_ACCOUNT_ENTITLEMENT_KEYS = [
  "member_of_entitlements",
  "sap_roles",
  "groups",
  "roles",
  "entitlements",
  "profiles",
  "permissions",
  "data_access",
  "responsibilities",
];

function extractRawAccountEntitlements(userDoc) {
  if (!userDoc || typeof userDoc !== "object") return [];

  const found = [];
  const seen = new Set();

  const pushValue = (raw) => {
    const text = String(raw).trim();
    if (!text) return;
    const norm = text.toLowerCase();
    if (seen.has(norm)) return;
    seen.add(norm);
    found.push(text);
  };

  const scan = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const key of RAW_ACCOUNT_ENTITLEMENT_KEYS) {
      const val = obj[key];
      if (!val) continue;
      if (Array.isArray(val)) {
        val.forEach(pushValue);
      } else if (typeof val === "string") {
        val.split(/[;|,]/).forEach(pushValue);
      }
    }
  };

  scan(userDoc);
  if (userDoc.rawData && typeof userDoc.rawData === "object") {
    scan(userDoc.rawData);
  }
  return found;
}

function toOid(value) {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null;
}

function normName(value) {
  return String(value || "").trim().toLowerCase();
}

function stripAppPrefix(rawName, applicationName) {
  if (!rawName || !applicationName) return String(rawName || "").trim();
  const prefix = applicationName.trim().toLowerCase() + ":";
  const raw = String(rawName).trim();
  if (raw.toLowerCase().startsWith(prefix)) {
    return raw.slice(applicationName.trim().length + 1).trim() || raw;
  }
  return raw;
}

function entitlementDisplayName(doc) {
  const app = doc.applicationName || "";
  const raw = doc.entitlementDisplayName || doc.entitlementValue || "";
  return stripAppPrefix(raw, app);
}

function matchesEntitlementLabel(label, entitlementName, applicationName = "") {
  const target = normName(entitlementName);
  if (!target || !label) return false;
  const raw = normName(label);
  if (raw === target) return true;
  if (applicationName && raw === normName(`${applicationName}:${entitlementName}`)) return true;
  if (raw.endsWith(`:${target}`)) return true;
  const suffix = raw.split(":").pop()?.trim();
  return suffix === target;
}

function matchesEntitlementName(doc, entitlementName) {
  const target = normName(entitlementName);
  if (!target) return false;
  const candidates = [
    entitlementDisplayName(doc),
    doc.entitlementDisplayName,
    doc.entitlementValue,
  ]
    .filter(Boolean)
    .map((v) => normName(v));
  return candidates.some((c) => c === target || c.endsWith(`:${target}`));
}

function appCorrelationCollectionSlug(appName) {
  return String(appName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_");
}

/**
 * Load entitlements the same way the Identity Accounts tab does (correlation + projection + raw fields).
 */
export async function fetchLiveEntitlementsForAccount({
  tenantId,
  identityId,
  applicationId,
}) {
  const appOid = toOid(applicationId);
  const idOid = toOid(identityId);
  if (!appOid || !idOid) {
    return { entitlements: [], link: null, userDoc: null, app: null, userObjectId: null };
  }

  const app = await Application.findById(appOid).select("name tenantId").lean();
  if (!app) {
    return { entitlements: [], link: null, userDoc: null, app: null, userObjectId: null };
  }

  const link = await IdentityAccountLink.findOne({
    identityId: idOid,
    applicationId: appOid,
    isActive: { $ne: false },
  }).lean();

  if (!link) {
    return { entitlements: [], link: null, userDoc: null, app, userObjectId: null };
  }

  let userDoc = null;
  let userObjectId = null;
  try {
    const DynamicUserModel = await getDynamicUserModelForTenantId(app.name, app.tenantId);
    userDoc = await resolveLiveApplicationUser(DynamicUserModel, link, app);
    userObjectId = userDoc?._id || null;
  } catch {
    userDoc = null;
  }

  let entitlements = [];
  const db = mongoose.connection.db;
  const effectiveTenantId = app.tenantId || tenantId;

  if (db && userObjectId) {
    // Match getLinksForIdentity: correlation table first, projection only when correlation is empty.
    const correlated = await fetchCorrelatedEntitlementsForAccount(
      db,
      app.name,
      appOid,
      userObjectId,
      effectiveTenantId,
    );
    if (correlated.length) {
      entitlements = correlated;
    } else {
      const projected = await fetchCorrelatedEntitlementsWithProjectionFallback({
        identityId,
        applicationId: appOid,
        accountId: userObjectId,
        tenantId: effectiveTenantId,
        legacyFetch: async () => [],
      });
      entitlements = projected || [];
    }
  }

  if (!entitlements.length && userDoc) {
    entitlements = extractRawAccountEntitlements(userDoc).map((value) => ({
      entitlementId: null,
      entitlementName: value,
      displayName: value,
      source: "raw_field",
    }));
  }

  return { entitlements, link, userDoc, app, userObjectId, applicationId: appOid };
}

async function removeFromProjectionCube({ tenantId, identityId, applicationId, entitlementName, accountId }) {
  const tenantOid = toOid(tenantId);
  const idOid = toOid(identityId);
  if (!tenantOid || !idOid || !entitlementName) return { deletedCount: 0 };

  try {
    const EntModel = await getIdentityEntitlementModelForTenantId(tenantId);
    const filter = { tenantId: tenantOid, identityId: idOid };
    const appOid = toOid(applicationId);
    if (appOid) filter.applicationId = appOid;
    if (accountId) filter.accountId = toOid(accountId);

    const docs = await EntModel.find(filter).lean();
    const targets = docs.filter((doc) => matchesEntitlementName(doc, entitlementName));
    if (!targets.length) return { deletedCount: 0 };

    const result = await EntModel.deleteMany({ _id: { $in: targets.map((d) => d._id) } });
    return { deletedCount: result.deletedCount || 0 };
  } catch {
    return { deletedCount: 0 };
  }
}

async function removeFromCorrelationTable({
  appName,
  applicationId,
  userObjectId,
  tenantId,
  entitlementName,
}) {
  const db = mongoose.connection.db;
  if (!db || !appName || !applicationId || !userObjectId) {
    return { deletedCount: 0 };
  }

  const corrColl = db.collection(`app_${appCorrelationCollectionSlug(appName)}_correlation`);
  const ents = await fetchCorrelatedEntitlementsForAccount(
    db,
    appName,
    applicationId,
    userObjectId,
    tenantId,
  );
  const matching = ents.filter((e) =>
    matchesEntitlementLabel(e.displayName || e.entitlementName, entitlementName, appName),
  );
  if (!matching.length) return { deletedCount: 0 };

  let deletedCount = 0;
  for (const ent of matching) {
    const entOid = toOid(ent.entitlementId);
    if (!entOid) continue;
    const result = await corrColl.deleteMany({
      applicationId,
      userId: userObjectId,
      entitlementId: entOid,
    });
    deletedCount += result.deletedCount || 0;
  }
  return { deletedCount };
}

function buildUserDocEntitlementUpdates(userDoc, entitlementName) {
  const target = normName(entitlementName);
  const updates = {};

  const scrubValue = (val) => {
    if (Array.isArray(val)) {
      const next = val.filter((item) => !matchesEntitlementLabel(String(item), entitlementName));
      return next.length !== val.length ? next : null;
    }
    if (typeof val === "string" && val.trim()) {
      const parts = val.split(/[;|,]/).map((p) => p.trim()).filter(Boolean);
      const next = parts.filter((p) => !matchesEntitlementLabel(p, entitlementName));
      if (next.length === parts.length) return null;
      return next.length ? next.join(";") : "";
    }
    return null;
  };

  const applyScrub = (obj, prefix = "") => {
    if (!obj || typeof obj !== "object") return;
    for (const key of RAW_ACCOUNT_ENTITLEMENT_KEYS) {
      const next = scrubValue(obj[key]);
      if (next !== null) {
        updates[`${prefix}${key}`] = next;
      }
    }
  };

  applyScrub(userDoc, "");
  if (userDoc.rawData && typeof userDoc.rawData === "object") {
    applyScrub(userDoc.rawData, "rawData.");
  }

  return updates;
}

async function removeFromApplicationUserDoc({ app, userDoc, entitlementName }) {
  if (!app || !userDoc?._id) return { updated: false };
  const updates = buildUserDocEntitlementUpdates(userDoc, entitlementName);
  if (!Object.keys(updates).length) return { updated: false };

  try {
    const DynamicUserModel = await getDynamicUserModelForTenantId(app.name, app.tenantId);
    await DynamicUserModel.updateOne({ _id: userDoc._id }, { $set: updates });
    return { updated: true };
  } catch {
    return { updated: false };
  }
}

/**
 * Resolve application + entitlement context for a per-entitlement revoke on a ReviewItem.
 */
export async function resolveRevokeContext({ reviewItem, entitlementName, tenantId }) {
  const identityId = toOid(reviewItem?.userId);
  const nameLower = normName(entitlementName);

  let applicationName = "";
  let applicationId = null;

  const eds = Array.isArray(reviewItem?.entitlementDecisions)
    ? reviewItem.entitlementDecisions
    : [];
  const ed = eds.find((e) => normName(e.entitlementName) === nameLower);
  if (ed) {
    applicationName = ed.applicationName || "";
    applicationId = toOid(ed.applicationId);
  }

  const pp = reviewItem?.provisioningPayload || {};
  const snap = reviewItem?.entitlementSnapshot || {};

  if (!applicationName) {
    applicationName =
      pp.applicationName || snap.applicationName || reviewItem?.itemApplicationName || "";
  }
  if (!applicationId) {
    applicationId = toOid(reviewItem?.applicationId || pp.applicationId || snap.applicationId);
  }

  if (tenantId && identityId && nameLower) {
    try {
      const live = await fetchLiveEntitlementsForAccount({
        tenantId,
        identityId: String(identityId),
        applicationId: applicationId ? String(applicationId) : undefined,
      });
      if (live.app?._id) {
        applicationId = live.app._id;
        applicationName = live.app.name || applicationName;
      }
      const match = live.entitlements.find((e) =>
        matchesEntitlementLabel(e.displayName || e.entitlementName, entitlementName, applicationName),
      );
      if (match?.entitlementId) {
        return {
          identityId: String(identityId),
          applicationId: applicationId ? String(applicationId) : "",
          applicationName,
          entitlementId: String(match.entitlementId),
          entitlementName: entitlementName || ed?.entitlementName || "",
          nativeIdentity: pp.nativeIdentity || "",
        };
      }
    } catch (err) {
      console.warn("[workflowRevokeService] live lookup failed:", err.message);
    }
  }

  if (!applicationId && applicationName && tenantId) {
    const app = await Application.findOne({
      tenantId: toOid(tenantId),
      name: new RegExp(`^${applicationName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    })
      .select("_id name")
      .lean();
    if (app) {
      applicationId = app._id;
      applicationName = app.name;
    }
  }

  return {
    identityId: identityId ? String(identityId) : String(reviewItem?.userId || ""),
    applicationId: applicationId ? String(applicationId) : "",
    applicationName,
    entitlementId: pp.entitlementId || snap.entitlementId || "",
    entitlementName: entitlementName || ed?.entitlementName || "",
    nativeIdentity: pp.nativeIdentity || "",
  };
}

/** Split a display name into first / last for ticket population. */
function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Per-entitlement decision (comment / reviewedAt) matching the revoked entitlement. */
function resolveEntitlementDecision(reviewItem, entitlementName) {
  const decisions = Array.isArray(reviewItem?.entitlementDecisions)
    ? reviewItem.entitlementDecisions
    : [];
  if (entitlementName) {
    const match = decisions.find(
      (d) => String(d.entitlementName || "").toLowerCase() === String(entitlementName).toLowerCase(),
    );
    if (match) return match;
  }
  return null;
}

/** Build trigger payload using per-entitlement context (async). */
export async function buildTriggerFromReviewItem(reviewItem, entitlementName, campaignName, tenantId) {
  const ctx = await resolveRevokeContext({ reviewItem, entitlementName, tenantId });
  const identityName = reviewItem?.itemName || "";
  const { firstName, lastName } = splitName(identityName);
  const decision = resolveEntitlementDecision(reviewItem, ctx.entitlementName || entitlementName);
  const reviewedAt = decision?.reviewedAt || reviewItem?.reviewedAt || null;
  return {
    decision: "Revoke",
    identityId: ctx.identityId,
    identityName,
    firstName,
    lastName,
    identityEmail: reviewItem?.itemEmail || "",
    managerEmail: reviewItem?.itemManagerEmail || "",
    managerName: reviewItem?.itemManager || "",
    applicationId: ctx.applicationId,
    applicationName: ctx.applicationName,
    entitlementId: ctx.entitlementId,
    entitlementName: ctx.entitlementName || entitlementName || "",
    campaignId: String(reviewItem?.campaignId || ""),
    campaignName: campaignName || "",
    reviewItemId: String(reviewItem?._id || ""),
    reviewerName: reviewItem?.reviewerName || reviewItem?.reviewerSnapshot?.name || "",
    reviewerEmail: reviewItem?.reviewerEmail || reviewItem?.reviewerSnapshot?.email || "",
    reviewDate: reviewedAt ? new Date(reviewedAt).toISOString() : "",
    comment: decision?.comment || reviewItem?.comment || "",
    provisioningAction: reviewItem?.provisioningAction || "REMOVE_ENTITLEMENT",
    nativeIdentity: ctx.nativeIdentity,
  };
}

import {
  VERIFICATION_STATUS,
  validateVerificationContext,
} from "../../workflows/verification/verificationStatus.js";

/** Check live account entitlements (same source as Identity Accounts tab). */
export async function checkIdentityEntitlement({
  tenantId,
  identityId,
  applicationId,
  entitlementId,
  entitlementName,
  applicationName = "",
}) {
  const validation = validateVerificationContext({
    identityId,
    entitlementId,
    entitlementName,
  });
  if (!validation.ok) {
    return {
      verificationStatus: VERIFICATION_STATUS.VERIFICATION_FAILED,
      stillPresent: null,
      reason: validation.reason,
    };
  }

  try {
    const live = await fetchLiveEntitlementsForAccount({ tenantId, identityId, applicationId });
    if (!live?.userDoc && !live?.entitlements?.length) {
      return {
        verificationStatus: VERIFICATION_STATUS.VERIFICATION_FAILED,
        stillPresent: null,
        reason: "identity_or_account_not_found",
      };
    }
    const appLabel = applicationName || live.app?.name || "";
    const stillPresent = live.entitlements.some((e) =>
      matchesEntitlementLabel(e.displayName || e.entitlementName, entitlementName, appLabel),
    );
    return {
      verificationStatus: stillPresent
        ? VERIFICATION_STATUS.STILL_PRESENT
        : VERIFICATION_STATUS.REMOVED,
      stillPresent,
      reason: null,
    };
  } catch (err) {
    return {
      verificationStatus: VERIFICATION_STATUS.VERIFICATION_FAILED,
      stillPresent: null,
      reason: err?.message || "connector_lookup_failed",
    };
  }
}

/** @deprecated boolean wrapper — use checkIdentityEntitlement for workflow verification */
export async function hasIdentityEntitlement(params) {
  const result = await checkIdentityEntitlement(params);
  if (result.verificationStatus === VERIFICATION_STATUS.VERIFICATION_FAILED) {
    return true;
  }
  return Boolean(result.stillPresent);
}

/** Remove entitlement from projection, correlation, and account raw fields. */
export async function removeIdentityEntitlement({
  tenantId,
  identityId,
  applicationId,
  entitlementName,
  applicationName = "",
}) {
  if (!identityId || !entitlementName) {
    return { removed: false, reason: "missing_context" };
  }

  try {
    const live = await fetchLiveEntitlementsForAccount({ tenantId, identityId, applicationId });
    const appLabel = applicationName || live.app?.name || "";

    const hadAccess = live.entitlements.some((e) =>
      matchesEntitlementLabel(e.displayName || e.entitlementName, entitlementName, appLabel),
    );
    if (!hadAccess) {
      return { removed: false, reason: "not_found_on_account" };
    }

    const cubeResult = await removeFromProjectionCube({
      tenantId,
      identityId,
      applicationId: live.app?._id || applicationId,
      entitlementName,
      accountId: live.userObjectId,
    });

    let corrDeleted = 0;
    if (live.app && live.userObjectId) {
      const corrResult = await removeFromCorrelationTable({
        appName: live.app.name,
        applicationId: live.app._id,
        userObjectId: live.userObjectId,
        tenantId: live.app.tenantId || tenantId,
        entitlementName,
      });
      corrDeleted = corrResult.deletedCount;
    }

    let userUpdated = false;
    if (live.app && live.userDoc) {
      const userResult = await removeFromApplicationUserDoc({
        app: live.app,
        userDoc: live.userDoc,
        entitlementName,
      });
      userUpdated = userResult.updated;
    }

    const stillPresent = await hasIdentityEntitlement({
      tenantId,
      identityId,
      applicationId: live.app?._id || applicationId,
      entitlementName,
      applicationName: appLabel,
    });

    return {
      removed: !stillPresent,
      reason: stillPresent ? "still_present_after_removal" : undefined,
      cubeDeleted: cubeResult.deletedCount,
      correlationDeleted: corrDeleted,
      userDocUpdated: userUpdated,
    };
  } catch (err) {
    return { removed: false, reason: err.message || "delete_failed" };
  }
}
