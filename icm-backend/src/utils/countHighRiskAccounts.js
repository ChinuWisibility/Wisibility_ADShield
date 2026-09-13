import mongoose from "mongoose";
import { extractEntitlementTokensFromAppUser } from "./sod/sodAppUserEntitlements.js";
import { getAppCorrelationCollectionName } from "./applicationDynamicCollections.js";
import { getIdentityEntitlementModelForTenantId } from "../models/identityEntitlementModel.js";
import { matchPrivilegedForApplication } from "./privilegeMatchFilter.js";
import { applicationIdInClause } from "../services/application/applicationUserIngestService.js";
import SodUserEntitlement from "../models/sod/SodUserEntitlement.js";

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function entitlementTokens(ent) {
  return [
    ent?.entitlement_name,
    ent?.entitlement_id,
    ent?.displayName,
    ent?.display_name,
    ent?.name,
    ent?.entitlementName,
    ent?._id != null ? String(ent._id) : "",
  ]
    .map(normalizeToken)
    .filter(Boolean);
}

function toOidList(ids) {
  return [...ids]
    .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) =>
      (id instanceof mongoose.Types.ObjectId
        ? id
        : new mongoose.Types.ObjectId(String(id))),
    );
}

/**
 * Count high-risk accounts: privileged-flagged users OR holders of privileged entitlements.
 * Sources (max of): correlation links, identity_entitlements, sod_user_entitlements, member_of scan.
 */
export async function countHighRiskAccountsForApplication({
  UsersModel,
  EntitlementsModel,
  applicationId,
  applicationName,
  tenantId,
  privilegedUsersCount = null,
}) {
  const appOid = mongoose.Types.ObjectId.isValid(String(applicationId))
    ? new mongoose.Types.ObjectId(String(applicationId))
    : applicationId;
  const appIdClause = applicationIdInClause(appOid);
  const privMatch = matchPrivilegedForApplication(appOid);

  const privilegedUsers =
    privilegedUsersCount != null
      ? Number(privilegedUsersCount) || 0
      : await UsersModel.countDocuments(privMatch).catch(() => 0);

  const privEnts = await EntitlementsModel.find(privMatch)
    .select("entitlement_name entitlement_id displayName display_name name entitlementName")
    .limit(200)
    .lean()
    .catch(() => []);

  const privEntIds = toOidList((privEnts || []).map((e) => e?._id));
  const privEntIdStrings = privEntIds.map((id) => String(id));

  const tokenSet = new Set();
  for (const e of privEnts || []) {
    for (const t of entitlementTokens(e)) tokenSet.add(t);
  }

  let holdersFromCorrelation = 0;
  if (privEntIds.length && applicationName) {
    try {
      const db = mongoose.connection.db;
      const collName = getAppCorrelationCollectionName(applicationName);
      const distinctUsers = await db.collection(collName).distinct("userId", {
        applicationId: appIdClause,
        entitlementId: { $in: [...privEntIds, ...privEntIdStrings] },
      });
      holdersFromCorrelation = Array.isArray(distinctUsers) ? distinctUsers.length : 0;
    } catch {
      holdersFromCorrelation = 0;
    }
  }

  let holdersFromIdentityEnt = 0;
  if (tenantId) {
    try {
      const IdentityEntModel = await getIdentityEntitlementModelForTenantId(tenantId);
      const accounts = await IdentityEntModel.distinct("accountId", {
        applicationId: appIdClause,
        "entitlementSnapshot.isPrivileged": true,
      });
      holdersFromIdentityEnt = Array.isArray(accounts) ? accounts.length : 0;
    } catch {
      holdersFromIdentityEnt = 0;
    }
  }

  let holdersFromSod = 0;
  try {
    const sodUsers = await SodUserEntitlement.distinct("userId", {
      applicationId: appOid,
      isPrivileged: true,
    });
    holdersFromSod = Array.isArray(sodUsers) ? sodUsers.length : 0;
  } catch {
    holdersFromSod = 0;
  }

  let holdersFromScan = 0;
  const linkedHolders = Math.max(
    holdersFromCorrelation,
    holdersFromIdentityEnt,
    holdersFromSod,
  );
  if (tokenSet.size && linkedHolders === 0) {
    const cursor = UsersModel.find({ applicationId: appIdClause })
      .select("member_of_entitlements entitlements roles groups organization_role rawData")
      .lean()
      .cursor({ batchSize: 500 });
    let scanned = 0;
    for await (const user of cursor) {
      scanned += 1;
      const raw = user.rawData && typeof user.rawData === "object" ? user.rawData : {};
      const tokens = extractEntitlementTokensFromAppUser(user, raw);
      if (tokens.some((t) => tokenSet.has(normalizeToken(t)))) {
        holdersFromScan += 1;
      }
      if (scanned >= 50000) break;
    }
  }

  const privilegedEntitlementHolders = Math.max(linkedHolders, holdersFromScan);
  const highRiskAccounts = Math.max(privilegedUsers, privilegedEntitlementHolders);

  return {
    highRiskAccounts,
    privilegedUsers,
    privilegedEntitlementHolders,
  };
}
