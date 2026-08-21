import mongoose from "mongoose";
import RemediationTicketItem from "../../models/remediation/RemediationTicketItem.js";
import RemediationValidation from "../../models/remediation/RemediationValidation.js";
import RemediationQueue from "../../models/remediation/RemediationQueue.js";
import RemediationQueueItem from "../../models/remediation/RemediationQueueItem.js";
import IdentityAccountLink from "../../models/identity/IdentityAccountLink.js";
import Application from "../../models/application/Application.js";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import {
  getAppUsersCollectionName,
  resolveTenantSlugFromTenantId,
} from "../../utils/applicationDynamicCollections.js";
import { extractEntitlementTokensFromAppUser } from "../../utils/sod/sodAppUserEntitlements.js";
import { isAppUserMissingManager } from "../../utils/datahygine/appUserMissingManager.js";
import { updateStage } from "./remediationTrackingService.js";
import { updateQueueStatus } from "./remediationQueueService.js";
import { asObjectId } from "../../controllers/access-certification/certificationControllerHelpers.js";

const DEFAULT_VALIDATION_DAYS = 7;

const EVENT_VALIDATION_MODE = {
  REVOKE_ACCESS: "AUTO",
  MISSING_MANAGER: "MANUAL",
  ORPHAN_ACCOUNT: "MANUAL",
  INACTIVE_USER_ACCESS: "AUTO",
};

function defaultDueDate(days = DEFAULT_VALIDATION_DAYS) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

export async function createValidationForTicketItem(ticketItem, queue, options = {}) {
  const mode =
    options.validationMode ||
    EVENT_VALIDATION_MODE[queue?.eventType] ||
    "MANUAL";

  const validation = await RemediationValidation.create({
    tenantId: String(queue?.tenantId || ticketItem.tenantId),
    queueId: queue?._id,
    ticketId: ticketItem.ticketId,
    ticketItemId: ticketItem._id,
    validationMode: mode,
    validationOwnerEmail:
      options.validationOwnerEmail || queue?.metadata?.validationOwnerEmail || "",
    validationStatus: "PENDING",
    validationStartDate: new Date(),
    validationDueDate: options.validationDueDate || defaultDueDate(),
  });

  if (queue?.eventId) {
    await updateQueueStatus(queue._id, "VALIDATION_PENDING");
    await updateStage(queue.eventId, "validation", "PENDING");
  }

  return validation;
}

async function validateRevokeAccess(ticketItem, queueItem) {
  const appOid = asObjectId(ticketItem.applicationId || queueItem?.applicationId);
  const entitlementName = String(
    ticketItem.entitlementName || queueItem?.entitlementName || "",
  ).trim();

  if (!appOid) {
    return { passed: false, reason: "Missing application reference" };
  }

  const userId = ticketItem.userId || queueItem?.identityId || queueItem?.accountId;
  const orClauses = [];
  if (userId) orClauses.push({ accountId: String(userId) });
  if (ticketItem.itemEmail || queueItem?.identityEmail) {
    orClauses.push({ accountId: String(ticketItem.itemEmail || queueItem.identityEmail) });
  }

  if (orClauses.length) {
    const link = await IdentityAccountLink.findOne({
      applicationId: appOid,
      $or: orClauses,
    }).lean();

    if (link?.accessState === "revoked" || link?.remediationStatus === "denied") {
      return { passed: true, reason: "Access link shows revoked/denied state" };
    }
  }

  if (entitlementName && userId) {
    try {
      const app = await Application.findById(appOid).select("name tenantId").lean();
      const tenantSlug = await resolveTenantSlugFromTenantId(app?.tenantId);
      if (app?.name && tenantSlug) {
        const coll = getAppUsersCollectionName(app.name, tenantSlug);
        const appUser = await mongoose.connection.db
          .collection(coll)
          .findOne({ applicationId: appOid, user_id: String(userId) });
        if (appUser) {
          const tokens = extractEntitlementTokensFromAppUser(appUser);
          const stillHas = tokens.some(
            (t) => String(t).toLowerCase() === entitlementName.toLowerCase(),
          );
          if (!stillHas) {
            return { passed: true, reason: "Entitlement no longer present on app user" };
          }
          return { passed: false, reason: "Entitlement still present on app user" };
        }
      }
    } catch {
      // fall through
    }
  }

  return { passed: false, reason: "Could not verify entitlement removal" };
}

async function validateMissingManager(queueItem) {
  const tid = asObjectId(queueItem?.tenantId);
  const appOid = asObjectId(queueItem?.applicationId);
  const accountId = queueItem?.accountId || queueItem?.identityId;
  if (!tid || !appOid || !accountId) {
    return { passed: false, reason: "Missing application account reference" };
  }

  const app = await Application.findById(appOid).select("name tenantId").lean();
  if (!app?.name) {
    return { passed: false, reason: "Application not found" };
  }

  const tenantSlug = await resolveTenantSlugFromTenantId(tid);
  if (!tenantSlug) {
    return { passed: false, reason: "Tenant context unavailable" };
  }

  let usersColl;
  try {
    usersColl = getAppUsersCollectionName(app.name, tenantSlug);
  } catch {
    return { passed: false, reason: "Application user store unavailable" };
  }

  const db = mongoose.connection.db;
  const orClauses = [{ user_id: String(accountId) }];
  if (mongoose.Types.ObjectId.isValid(String(accountId))) {
    orClauses.push({ _id: new mongoose.Types.ObjectId(String(accountId)) });
  }

  const user = await db.collection(usersColl).findOne({
    applicationId: appOid,
    $or: orClauses,
  });

  if (!user) {
    return { passed: false, reason: "Application user not found" };
  }

  return isAppUserMissingManager(user)
    ? { passed: false, reason: "Manager still missing on target application" }
    : { passed: true, reason: "Manager present on target application" };
}

async function validateOrphanAccount(queueItem) {
  const appOid = asObjectId(queueItem?.applicationId);
  const accountId = queueItem?.accountId;
  if (!appOid || !accountId) {
    return { passed: false, reason: "Missing account reference" };
  }

  const link = await IdentityAccountLink.findOne({
    applicationId: appOid,
    accountId: String(accountId),
  }).lean();

  return link
    ? { passed: true, reason: "Account is correlated to an identity" }
    : { passed: false, reason: "Account remains uncorrelated" };
}

async function validateInactiveUserAccess(ticketItem, queueItem) {
  const appOid = asObjectId(ticketItem.applicationId || queueItem?.applicationId);
  const userId = ticketItem.userId || queueItem?.accountId || queueItem?.identityId;
  if (!appOid || !userId) {
    return { passed: false, reason: "Missing user reference" };
  }

  try {
    const app = await Application.findById(appOid).select("name tenantId").lean();
    const tenantSlug = await resolveTenantSlugFromTenantId(app?.tenantId);
    if (!app?.name || !tenantSlug) {
      return { passed: false, reason: "Application not resolvable" };
    }
    const coll = getAppUsersCollectionName(app.name, tenantSlug);
    const appUser = await mongoose.connection.db
      .collection(coll)
      .findOne({ applicationId: appOid, user_id: String(userId) });

    if (!appUser) {
      return { passed: true, reason: "App user record removed" };
    }

    const active =
      appUser.is_active === true ||
      appUser.is_active === "true" ||
      String(appUser.status || "").toUpperCase() === "ACTIVE";

    if (!active) {
      const tokens = extractEntitlementTokensFromAppUser(appUser);
      if (!tokens.length) {
        return { passed: true, reason: "User inactive with no entitlements" };
      }
      return { passed: false, reason: "User inactive but still has entitlements" };
    }
    return { passed: false, reason: "User account still active" };
  } catch (err) {
    return { passed: false, reason: err.message || "Validation error" };
  }
}

export async function runAutoValidation(validationId) {
  const validation = await RemediationValidation.findById(validationId);
  if (!validation || validation.validationStatus !== "PENDING") {
    return validation;
  }

  const [queue, ticketItem] = await Promise.all([
    RemediationQueue.findById(validation.queueId).lean(),
    RemediationTicketItem.findById(validation.ticketItemId).lean(),
  ]);

  let queueItem = null;
  if (ticketItem?.queueItemId) {
    queueItem = await RemediationQueueItem.findById(ticketItem.queueItemId).lean();
  }

  let result = { passed: false, reason: "Unknown event type" };
  switch (queue?.eventType) {
    case "REVOKE_ACCESS":
      result = await validateRevokeAccess(ticketItem, queueItem);
      break;
    case "MISSING_MANAGER":
      result = await validateMissingManager(queueItem || ticketItem);
      break;
    case "ORPHAN_ACCOUNT":
      result = await validateOrphanAccount(queueItem || ticketItem);
      break;
    case "INACTIVE_USER_ACCESS":
      result = await validateInactiveUserAccess(ticketItem, queueItem);
      break;
    default:
      result = { passed: false, reason: `No auto validation for ${queue?.eventType}` };
  }

  validation.autoValidationResult = result;
  validation.validationCompletedDate = new Date();
  validation.validationStatus = result.passed ? "PASSED" : "FAILED";
  validation.comments = result.reason;
  await validation.save();

  if (queue?.eventId) {
    await updateStage(
      queue.eventId,
      "validation",
      result.passed ? "VALIDATED" : "FAILED",
    );
  }

  if (result.passed && queue?._id) {
    await updateQueueStatus(queue._id, "VALIDATED");
    await updateStage(queue.eventId, "reporting", "VALIDATED");
  } else if (!result.passed && queue?._id) {
    await updateQueueStatus(queue._id, "FAILED");
  }

  return validation;
}

export async function respondToValidation(validationId, tenantId, { passed, comments }) {
  const validation = await RemediationValidation.findOne({
    _id: validationId,
    tenantId: String(tenantId),
  });
  if (!validation) throw new Error("Validation not found");

  validation.validationStatus = passed ? "PASSED" : "FAILED";
  validation.validationCompletedDate = new Date();
  validation.comments = comments || validation.comments;
  await validation.save();

  const queue = await RemediationQueue.findById(validation.queueId).lean();
  if (queue?.eventId) {
    await updateStage(queue.eventId, "validation", passed ? "VALIDATED" : "FAILED");
    if (passed) {
      await updateQueueStatus(queue._id, "VALIDATED");
      await updateStage(queue.eventId, "reporting", "VALIDATED");
    } else {
      await updateQueueStatus(queue._id, "FAILED");
    }
  }

  return validation;
}

export async function listValidations(tenantId, { status, page = 1, limit = 20 } = {}) {
  const filter = { tenantId: String(tenantId) };
  if (status) filter.validationStatus = String(status).toUpperCase();

  const pg = Math.max(1, Number(page) || 1);
  const cap = Math.min(100, Math.max(1, Number(limit) || 20));

  const [items, total] = await Promise.all([
    RemediationValidation.find(filter)
      .sort({ validationDueDate: 1 })
      .skip((pg - 1) * cap)
      .limit(cap)
      .lean(),
    RemediationValidation.countDocuments(filter),
  ]);

  return {
    items,
    pagination: { page: pg, limit: cap, total, pages: Math.ceil(total / cap) || 0 },
  };
}

export async function runValidationsForExecutedItem(ticketItemId) {
  const validations = await RemediationValidation.find({
    ticketItemId,
    validationStatus: "PENDING",
    validationMode: { $in: ["AUTO", "HYBRID"] },
  });

  const results = [];
  for (const v of validations) {
    results.push(await runAutoValidation(v._id));
  }
  return results;
}
