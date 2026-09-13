import { normalizeDn } from "../ad/ldapNormalizer.js";
import { GRAPH_NODE_TYPES } from "./graphConstants.js";

/**
 * Stable graph node id: tenant:application:type:key
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.tenantId
 * @param {string|import('mongoose').Types.ObjectId} params.applicationId
 * @param {string} params.nodeType
 * @param {string} params.stableKey
 */
export function buildGraphNodeId({ tenantId, applicationId, nodeType, stableKey }) {
  const t = String(tenantId || "").trim();
  const a = String(applicationId || "").trim();
  const type = String(nodeType || "").trim().toUpperCase();
  const key = normalizeStableKey(stableKey);
  if (!t || !a || !type || !key) return "";
  return `${t}:${a}:${type}:${key}`;
}

export function normalizeStableKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export function normalizeSid(sid) {
  return String(sid || "").trim();
}

export function normalizeGroupKey({ objectSid, groupDN, entitlementId, groupName }) {
  const sid = normalizeSid(objectSid);
  if (sid && /^S-\d/i.test(sid)) return `sid:${sid.toLowerCase()}`;
  const dn = normalizeDn(groupDN);
  if (dn) return `dn:${dn}`;
  const eid = normalizeStableKey(entitlementId || groupName);
  if (eid) return `eid:${eid}`;
  return "";
}

/**
 * @param {string} nodeId
 */
export function parseGraphNodeId(nodeId) {
  const parts = String(nodeId || "").split(":");
  if (parts.length < 4) return null;
  const [tenantId, applicationId, nodeType, ...rest] = parts;
  return {
    tenantId,
    applicationId,
    nodeType,
    stableKey: rest.join(":"),
  };
}

/**
 * @param {object} params
 */
export function resolveUserNodeId({ tenantId, applicationId, userId, nativeAccountId, email }) {
  const key =
    normalizeStableKey(userId) ||
    normalizeStableKey(nativeAccountId) ||
    normalizeStableKey(email);
  if (!key) return "";
  return buildGraphNodeId({
    tenantId,
    applicationId,
    nodeType: GRAPH_NODE_TYPES.USER,
    stableKey: key,
  });
}

/**
 * @param {object} params
 */
export function resolveGroupNodeId({
  tenantId,
  applicationId,
  objectSid,
  groupDN,
  entitlementId,
  groupName,
}) {
  const stableKey = normalizeGroupKey({
    objectSid,
    groupDN,
    entitlementId,
    groupName,
  });
  if (!stableKey) return "";
  return buildGraphNodeId({
    tenantId,
    applicationId,
    nodeType: GRAPH_NODE_TYPES.GROUP,
    stableKey,
  });
}

/**
 * @param {object} userDoc - dynamic application user
 */
export function resolveUserNodeFromDoc(tenantId, applicationId, userDoc) {
  const raw = userDoc?.rawData && typeof userDoc.rawData === "object" ? userDoc.rawData : {};
  return resolveUserNodeId({
    tenantId,
    applicationId,
    userId: userDoc?.user_id || raw.sAMAccountName || raw.samaccountname,
    nativeAccountId: raw.objectGUID || raw.objectguid,
    email: userDoc?.email || raw.mail || raw.userPrincipalName,
  });
}

/**
 * @param {object} entitlementDoc
 */
export function resolveGroupNodeFromEntitlement(tenantId, applicationId, entitlementDoc) {
  const raw =
    entitlementDoc?.rawData && typeof entitlementDoc.rawData === "object"
      ? entitlementDoc.rawData
      : {};
  return resolveGroupNodeId({
    tenantId,
    applicationId,
    objectSid: raw.objectSid || entitlementDoc?.objectSid,
    groupDN: raw.groupDN || raw.distinguishedName,
    entitlementId: entitlementDoc?.entitlement_id,
    groupName: entitlementDoc?.entitlement_name,
  });
}

/**
 * Extract direct group DNs from user rawData / member_of_entitlements.
 * @param {object} userDoc
 * @returns {string[]}
 */
export function extractUserGroupDns(userDoc) {
  const raw = userDoc?.rawData && typeof userDoc.rawData === "object" ? userDoc.rawData : {};
  const fromArray = Array.isArray(raw.ad_memberOf_dns) ? raw.ad_memberOf_dns : [];
  if (fromArray.length) {
    return [...new Set(fromArray.map((d) => String(d || "").trim()).filter(Boolean))];
  }
  const text = String(userDoc?.member_of_entitlements || raw.memberOf || "").trim();
  if (!text) return [];
  return text
    .split(/[;,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parent groups from memberOf (fast sync path when full member lists are not fetched).
 * LDAP raw often stores a single memberOf as a string — coerce to a list.
 * @param {object} entitlementDoc
 * @returns {string[]}
 */
export function extractGroupMemberOfDns(entitlementDoc) {
  const raw =
    entitlementDoc?.rawData && typeof entitlementDoc.rawData === "object"
      ? entitlementDoc.rawData
      : {};
  const memberOf = raw.memberOf ?? raw.member_of ?? [];
  const list = Array.isArray(memberOf)
    ? memberOf
    : memberOf != null && String(memberOf).trim()
      ? [memberOf]
      : [];
  return [...new Set(list.map((m) => String(m || "").trim()).filter(Boolean))];
}

/**
 * @param {object} entitlementDoc
 * @returns {string[]}
 */
export function extractGroupMemberDns(entitlementDoc) {
  const raw =
    entitlementDoc?.rawData && typeof entitlementDoc.rawData === "object"
      ? entitlementDoc.rawData
      : {};
  const members = raw.members || raw.member || [];
  const list = Array.isArray(members)
    ? members
    : members != null && String(members).trim()
      ? [members]
      : [];
  return [...new Set(list.map((m) => String(m || "").trim()).filter(Boolean))];
}
