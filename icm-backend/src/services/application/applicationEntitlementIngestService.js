import { getDynamicEntitlementModelForTenantId } from "../../models/application/Entitlements.js";
import { buildEntitlementDocsFromMappedRows } from "./delimitedApplicationUserSync.js";
import { validateEntitlementMappings } from "../../utils/applicationMappingValidation.js";

const DEFAULT_AD_ENTITLEMENT_MAPPING_DRAFT = [
  {
    csvColumn: "entitlement_id",
    standardField: "entitlement_id",
    dataType: "String",
    displayName: "Entitlement ID",
    isPrimaryKey: true,
  },
  {
    csvColumn: "entitlement_name",
    standardField: "entitlement_name",
    dataType: "String",
    displayName: "Entitlement Name",
  },
  {
    csvColumn: "entitlement_description",
    standardField: "entitlement_description",
    dataType: "String",
    displayName: "Description",
  },
  {
    csvColumn: "entitlement_type",
    standardField: "entitlement_type",
    dataType: "String",
    displayName: "Entitlement Type",
  },
  {
    csvColumn: "is_privilege",
    standardField: "is_privilege",
    dataType: "Boolean",
    displayName: "Is Privilege",
  },
  {
    csvColumn: "source",
    standardField: "source",
    dataType: "String",
    displayName: "Source",
  },
  {
    csvColumn: "is_active",
    standardField: "is_active",
    dataType: "Boolean",
    displayName: "Is Active",
  },
  {
    csvColumn: "source_dn",
    standardField: "source_dn",
    dataType: "String",
    displayName: "Source DN",
  },
  {
    csvColumn: "object_sid",
    standardField: "object_sid",
    dataType: "String",
    displayName: "Object SID",
  },
  {
    csvColumn: "member_count",
    standardField: "member_count",
    dataType: "Number",
    displayName: "Member Count",
  },
];

function trimString(value) {
  return String(value || "").trim();
}

export function getDefaultAdEntitlementMappings() {
  const result = validateEntitlementMappings(
    DEFAULT_AD_ENTITLEMENT_MAPPING_DRAFT,
  );
  if (!result.ok) {
    throw new Error(result.message || "Invalid default AD entitlement mappings");
  }
  return result.normalized.map((mapping) => ({ ...mapping }));
}

export function ensureDefaultAdEntitlementMappings(application) {
  if (
    Array.isArray(application?.entitlementMappings) &&
    application.entitlementMappings.length > 0
  ) {
    return application.entitlementMappings;
  }
  const mappings = getDefaultAdEntitlementMappings();
  application.entitlementMappings = mappings;
  return mappings;
}

export function buildAdEntitlementRows(groups, options = {}) {
  const source = trimString(options.source) || "ad_sync";
  return (groups || []).map((group) => {
    const entitlementId =
      trimString(group?.objectSid) ||
      trimString(group?.groupDN) ||
      trimString(group?.groupName);
    const entitlementName =
      trimString(group?.groupName) ||
      trimString(group?.groupDN) ||
      entitlementId;
    const memberCountRaw = Number(
      options.memberCountByDn?.get?.(trimString(group?.groupDN)) ??
        group?.memberCount ??
        (Array.isArray(group?.members) ? group.members.length : 0),
    );

    return {
      entitlement_id: entitlementId,
      entitlement_name: entitlementName,
      entitlement_description: trimString(group?.description),
      entitlement_type: "AD_GROUP",
      is_privilege: "false",
      source,
      is_active: "true",
      source_dn: trimString(group?.groupDN),
      groupDN: trimString(group?.groupDN),
      object_sid: trimString(group?.objectSid),
      // Persist both sides of nesting. Sync often has empty `members` and relies on
      // `memberOf` for NESTED_MEMBER_OF edges (nested privileged / escalation paths).
      // Coerce single-value LDAP strings to arrays.
      members: Array.isArray(group?.members)
        ? group.members
        : group?.members
          ? [group.members]
          : [],
      memberOf: Array.isArray(group?.memberOf)
        ? group.memberOf
        : group?.memberOf
          ? [group.memberOf]
          : [],
      member_count:
        Number.isFinite(memberCountRaw) && memberCountRaw >= 0
          ? memberCountRaw
          : 0,
    };
  });
}

const ENTITLEMENT_BULK_CHUNK = 500;

function resolveEntitlementPkField(mappings) {
  const pk = (mappings || []).find((m) => m.isPrimaryKey);
  return trimString(pk?.standardField) || "entitlement_id";
}

/**
 * Diff-based entitlement sync: bulk upsert by primary key, then remove stale rows.
 * Avoids full collection delete + insert on every AD sync.
 */
export async function upsertApplicationEntitlementsFromRows(
  application,
  rows,
  mappings = application?.entitlementMappings || [],
) {
  if (!application?._id) {
    throw new Error("Application is required for entitlement ingestion");
  }
  if (!Array.isArray(mappings) || mappings.length === 0) {
    throw new Error(
      "No entitlement schema (entitlementMappings) defined. Configure Entitlement schema first.",
    );
  }

  const documentsToInsert = buildEntitlementDocsFromMappedRows(
    rows || [],
    mappings,
    application._id,
  );
  const pkField = resolveEntitlementPkField(mappings);
  const appId = application._id;

  const DynamicModel = await getDynamicEntitlementModelForTenantId(
    application.name,
    application.tenantId,
  );

  const incomingIds = new Set();
  const ops = [];
  for (const doc of documentsToInsert) {
    const pkVal = trimString(doc[pkField]);
    if (!pkVal) continue;
    incomingIds.add(pkVal);
    ops.push({
      updateOne: {
        filter: { applicationId: appId, [pkField]: pkVal },
        update: { $set: doc },
        upsert: true,
      },
    });
  }

  let upserted = 0;
  for (let i = 0; i < ops.length; i += ENTITLEMENT_BULK_CHUNK) {
    const chunk = ops.slice(i, i + ENTITLEMENT_BULK_CHUNK);
    if (chunk.length === 0) continue;
    const res = await DynamicModel.bulkWrite(chunk, { ordered: false });
    upserted +=
      (res.upsertedCount || 0) +
      (res.modifiedCount || 0) +
      (res.matchedCount || 0);
  }

  await DynamicModel.collection
    .createIndex({ applicationId: 1, [pkField]: 1 }, { background: true })
    .catch(() => {});

  let removed = 0;
  const staleBatch = [];
  const cursor = DynamicModel.find({ applicationId: appId })
    .select(pkField)
    .lean()
    .cursor();
  for await (const row of cursor) {
    const id = trimString(row[pkField]);
    if (!id || incomingIds.has(id)) continue;
    staleBatch.push(id);
    if (staleBatch.length >= ENTITLEMENT_BULK_CHUNK) {
      const del = await DynamicModel.deleteMany({
        applicationId: appId,
        [pkField]: { $in: staleBatch },
      });
      removed += del.deletedCount || 0;
      staleBatch.length = 0;
    }
  }
  if (staleBatch.length > 0) {
    const del = await DynamicModel.deleteMany({
      applicationId: appId,
      [pkField]: { $in: staleBatch },
    });
    removed += del.deletedCount || 0;
  }

  application.entitlementCount = incomingIds.size;
  application.lastUpload = new Date();
  await application.save();

  return {
    inserted: incomingIds.size,
    upserted,
    removed,
    documentsToInsert,
  };
}

export async function replaceApplicationEntitlementsFromRows(
  application,
  rows,
  mappings = application?.entitlementMappings || [],
) {
  if (!application?._id) {
    throw new Error("Application is required for entitlement ingestion");
  }
  if (!Array.isArray(mappings) || mappings.length === 0) {
    throw new Error(
      "No entitlement schema (entitlementMappings) defined. Configure Entitlement schema first.",
    );
  }

  const documentsToInsert = buildEntitlementDocsFromMappedRows(
    rows || [],
    mappings,
    application._id,
  );

  const DynamicModel = await getDynamicEntitlementModelForTenantId(
    application.name,
    application.tenantId,
  );
  await DynamicModel.deleteMany({ applicationId: application._id });
  if (documentsToInsert.length > 0) {
    await DynamicModel.insertMany(documentsToInsert);
  }

  application.entitlementCount = documentsToInsert.length;
  application.lastUpload = new Date();
  await application.save();

  return {
    inserted: documentsToInsert.length,
    documentsToInsert,
  };
}
