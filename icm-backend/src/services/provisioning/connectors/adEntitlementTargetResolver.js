import mongoose from "mongoose";
import { getDynamicEntitlementModelForTenantId } from "../../../models/application/Entitlements.js";
import { normalizeDn } from "../../ad/ldapNormalizer.js";

const text = (value) =>
  value === undefined || value === null ? "" : String(value).trim();

const looksLikeDn = (value) =>
  /^(?:cn|ou|dc)=[^,]+(?:,.+=.+)+$/i.test(text(value));

/**
 * Resolve an AD entitlement reference only through the synchronized,
 * tenant/application-scoped catalog. Policy-supplied names and arbitrary DNs
 * are never used directly as LDAP write targets.
 */
export async function resolveAdEntitlementTarget({
  tenantId,
  application,
  entitlement,
  modelProvider = getDynamicEntitlementModelForTenantId,
} = {}) {
  if (!tenantId || !application?._id || !application?.name) {
    throw Object.assign(
      new Error("Tenant and application are required to resolve an AD entitlement."),
      { code: "ENTITLEMENT_CONTEXT_REQUIRED" },
    );
  }
  if (
    application.tenantId &&
    String(application.tenantId) !== String(tenantId)
  ) {
    throw Object.assign(
      new Error("AD entitlement application does not belong to the task tenant."),
      { code: "TENANT_MISMATCH" },
    );
  }

  const entitlementId = text(entitlement?.entitlementId);
  const nativeId = text(entitlement?.nativeId);
  if (!entitlementId && !nativeId) {
    throw Object.assign(
      new Error("A catalog entitlement ID or native ID is required."),
      { code: "INVALID_ENTITLEMENT" },
    );
  }

  const or = [];
  if (entitlementId && mongoose.isValidObjectId(entitlementId)) {
    or.push({ _id: new mongoose.Types.ObjectId(entitlementId) });
  }
  for (const candidate of [entitlementId, nativeId]) {
    if (!candidate) continue;
    or.push({ entitlement_id: candidate });
    or.push({ object_sid: candidate });
    or.push({ "rawData.object_sid": candidate });
  }
  if (looksLikeDn(nativeId)) {
    or.push({ source_dn: nativeId });
    or.push({ groupDN: nativeId });
    or.push({ "rawData.groupDN": nativeId });
  }

  const DynamicEntitlement = await modelProvider(
    application.name,
    tenantId,
  );
  const rows = await DynamicEntitlement.find({
    applicationId: application._id,
    $or: or,
  })
    .limit(3)
    .lean();

  if (!rows.length) {
    throw Object.assign(
      new Error("AD entitlement was not found in the application catalog."),
      { code: "ENTITLEMENT_NOT_FOUND" },
    );
  }
  if (rows.length > 1) {
    throw Object.assign(
      new Error("AD entitlement reference is ambiguous in the application catalog."),
      { code: "ENTITLEMENT_AMBIGUOUS" },
    );
  }

  const row = rows[0];
  if (String(row.applicationId) !== String(application._id)) {
    throw Object.assign(
      new Error("AD entitlement belongs to a different application."),
      { code: "ENTITLEMENT_APPLICATION_MISMATCH" },
    );
  }
  if (text(row.entitlement_type).toUpperCase() !== "AD_GROUP") {
    throw Object.assign(new Error("AD entitlement target is not an AD group."), {
      code: "ENTITLEMENT_NOT_AD_GROUP",
    });
  }

  const groupDn = text(row.source_dn || row.groupDN || row.rawData?.groupDN);
  if (!looksLikeDn(groupDn)) {
    throw Object.assign(
      new Error("AD group catalog row has no valid authoritative group DN."),
      { code: "ENTITLEMENT_GROUP_DN_MISSING" },
    );
  }
  if (looksLikeDn(nativeId) && normalizeDn(nativeId) !== normalizeDn(groupDn)) {
    throw Object.assign(
      new Error("Supplied entitlement DN does not match the catalog group DN."),
      { code: "ENTITLEMENT_TARGET_MISMATCH" },
    );
  }

  return {
    catalogId: String(row._id),
    objectSid: text(
      row.object_sid || row.entitlement_id || row.rawData?.object_sid,
    ),
    groupDn,
  };
}
