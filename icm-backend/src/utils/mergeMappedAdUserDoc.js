import { classifyAccountStatusRaw } from "../services/application/applicationUserStatusCountsService.js";

/**
 * After csvImportMapping, re-attach LDAP fields dropped when mapping used rawData-only rows.
 * @param {object} mappedDoc
 * @param {object | undefined} sourceDoc - pre-map AD user doc from mapAdEntryToUserDoc
 */
export function mergeMappedAdUserDoc(mappedDoc, sourceDoc) {
  if (!sourceDoc) return mappedDoc;

  const rawData = { ...(mappedDoc.rawData || {}) };
  const sourceRaw = sourceDoc.rawData || {};

  const hasScopedMembership =
    Array.isArray(sourceRaw.ad_memberOf_dns) && sourceRaw.ad_memberOf_dns.length > 0;

  if (hasScopedMembership) {
    rawData.ad_memberOf_dns = sourceRaw.ad_memberOf_dns;
    rawData.memberOf =
      sourceRaw.memberOf != null && sourceRaw.memberOf !== ""
        ? sourceRaw.memberOf
        : sourceRaw.ad_memberOf_dns.length === 1
          ? sourceRaw.ad_memberOf_dns[0]
          : sourceRaw.ad_memberOf_dns;
  }

  for (const key of Object.keys(sourceRaw)) {
    if (key === "memberOf" && hasScopedMembership) continue;
    if (key === "ad_memberOf_dns" && hasScopedMembership) continue;
    if (rawData[key] == null || rawData[key] === "") {
      rawData[key] = sourceRaw[key];
    }
  }

  let status = mappedDoc.status;
  if (status == null || String(status).trim() === "") {
    status = sourceDoc.status;
  } else if (/^\d+$/.test(String(status).trim())) {
    const bucket = classifyAccountStatusRaw(status);
    if (bucket === "active") status = "active";
    else if (bucket === "inactive") status = "disabled";
  } else if (sourceDoc.status && classifyAccountStatusRaw(status) === "unknown") {
    status = sourceDoc.status;
  }

  const memberOfEntitlements =
    sourceDoc.member_of_entitlements != null &&
    String(sourceDoc.member_of_entitlements).trim() !== ""
      ? sourceDoc.member_of_entitlements
      : mappedDoc.member_of_entitlements;

  const standardFields = [
    "user_id",
    "employee_id",
    "username",
    "email",
    "display_name",
    "department",
    "title",
    "manager_id",
    "telephone",
  ];
  const topLevel = { ...mappedDoc };
  for (const field of standardFields) {
    const mappedVal = topLevel[field];
    const sourceVal = sourceDoc[field];
    if (
      (mappedVal == null || String(mappedVal).trim() === "") &&
      sourceVal != null &&
      String(sourceVal).trim() !== ""
    ) {
      topLevel[field] = sourceVal;
    }
  }

  return {
    ...topLevel,
    status,
    member_of_entitlements: memberOfEntitlements,
    rawData,
  };
}
