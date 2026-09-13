import { normalizeDn } from "./ldapNormalizer.js";
import {
  buildAdEntitlementRows,
  ensureDefaultAdEntitlementMappings,
  replaceApplicationEntitlementsFromRows,
} from "../application/applicationEntitlementIngestService.js";

/**
 * AD security group → dynamic entitlement document.
 * @param {object} group - output of normalizeGroup
 * @param {import('mongoose').Types.ObjectId} applicationId
 */
export function mapAdGroupToEntitlementDoc(group, applicationId = null) {
  const id =
    String(group.objectSid || "").trim() ||
    String(group.groupDN || "").trim() ||
    String(group.groupName || "").trim();
  const members = Array.isArray(group.members)
    ? group.members
    : group.members
      ? [group.members]
      : [];
  const memberOf = Array.isArray(group.memberOf)
    ? group.memberOf
    : group.memberOf
      ? [group.memberOf]
      : [];
  const doc = {
    entitlement_id: id,
    entitlement_name: group.groupName || group.groupDN || id,
    entitlement_description: group.description || "",
    entitlement_type: "AD_GROUP",
    is_active: "true",
    source: "ad_sync",
    // Spread raw first, then force normalized membership arrays (raw often
    // stores single memberOf as a string which breaks nested-edge builders).
    rawData: {
      ...(group._raw || {}),
      groupDN: group.groupDN,
      objectSid: group.objectSid,
      members,
      memberOf,
    },
  };
  if (applicationId) doc.applicationId = applicationId;
  return doc;
}

/**
 * @param {object[]} groups
 * @returns {Map<string, string>} normalized group DN → display name
 */
export function buildGroupDnToNameMap(groups) {
  const map = new Map();
  for (const g of groups || []) {
    const norm = normalizeDn(g.groupDN);
    if (!norm) continue;
    map.set(norm, g.groupName || g.groupDN || norm);
  }
  return map;
}

/**
 * Apply merged membership index onto ingest-ready user docs.
 * @param {object[]} userDocs - from mapAdEntryToUserDoc
 * @param {Map<string, string[]>} userToGroups
 * @param {Map<string, string>} groupDnToName
 */
export function enrichUserDocsWithMembership(userDocs, userToGroups, groupDnToName) {
  if (!userToGroups?.size) return userDocs;
  return userDocs.map((doc) => {
    const uid = String(doc.user_id || "").trim();
    if (!uid) return doc;
    const groupDns = userToGroups.get(uid);
    if (!groupDns?.length) return doc;
    const labels = groupDns.map(
      (dn) => groupDnToName.get(normalizeDn(dn)) || dn,
    );
    return {
      ...doc,
      member_of_entitlements: labels.join("; "),
      rawData: {
        ...(doc.rawData || {}),
        ad_memberOf_dns: groupDns,
      },
    };
  });
}

/**
 * Replace application entitlements with AD group catalog using the shared mapped-row ingestion path.
 * @param {import('../../models/application/Application.js').default} application
 * @param {object[]} groups
 */
export async function ingestAdEntitlements(application, groups, options = {}) {
  const mappings = ensureDefaultAdEntitlementMappings(application);
  const rows = buildAdEntitlementRows(groups, options);
  return replaceApplicationEntitlementsFromRows(application, rows, mappings);
}
