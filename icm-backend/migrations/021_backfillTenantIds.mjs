import mongoose from "mongoose";

function toIdStr(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (typeof value === "object" && value._id) return toIdStr(value._id);
  return String(value);
}

async function buildLookupMap(collectionName, keyField, valueField) {
  const docs = await mongoose.connection.db
    .collection(collectionName)
    .find({}, { projection: { [keyField]: 1, [valueField]: 1 } })
    .toArray();

  const map = new Map();
  for (const d of docs) {
    const key = toIdStr(d[keyField]);
    const val = d[valueField] ?? null;
    if (key && val) {
      map.set(key, val);
    }
  }
  return map;
}

function pickTenantId({
  doc,
  appTenantById,
  campaignTenantById,
  reportTenantById,
  frameworkTenantById,
  userTenantById,
}) {
  if (doc.tenantId) return doc.tenantId;

  const appId = toIdStr(doc.applicationId);
  if (appId && appTenantById.has(appId)) return appTenantById.get(appId);

  const campaignId = toIdStr(doc.campaignId);
  if (campaignId && campaignTenantById.has(campaignId))
    return campaignTenantById.get(campaignId);

  const reportId = toIdStr(doc.reportId);
  if (reportId && reportTenantById.has(reportId))
    return reportTenantById.get(reportId);

  const frameworkId = toIdStr(doc.frameworkId);
  if (frameworkId && frameworkTenantById.has(frameworkId))
    return frameworkTenantById.get(frameworkId);

  const createdBy = toIdStr(doc.createdBy);
  if (createdBy && userTenantById.has(createdBy))
    return userTenantById.get(createdBy);

  const userId = toIdStr(doc.userId);
  if (userId && userTenantById.has(userId)) return userTenantById.get(userId);

  return null;
}

async function backfillCollectionTenantId(collectionName, resolver) {
  const cursor = mongoose.connection.db.collection(collectionName).find({
    $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
  });

  const ops = [];
  let scanned = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned += 1;

    const tenantId = resolver(doc);
    if (!tenantId) continue;

    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { tenantId } },
      },
    });

    if (ops.length >= 500) {
      await mongoose.connection.db
        .collection(collectionName)
        .bulkWrite(ops, { ordered: false });
      ops.length = 0;
    }
  }

  if (ops.length) {
    await mongoose.connection.db
      .collection(collectionName)
      .bulkWrite(ops, { ordered: false });
  }

  const remaining = await mongoose.connection.db
    .collection(collectionName)
    .countDocuments({
      $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
    });

  return { scanned, remaining };
}

export default async function backfillTenantIds() {
  const appTenantById = await buildLookupMap("applications", "_id", "tenantId");
  const userTenantById = await buildLookupMap("users", "_id", "tenantId");

  const campaigns = await mongoose.connection.db
    .collection("campaigns")
    .find(
      {},
      { projection: { _id: 1, tenantId: 1, applicationId: 1, createdBy: 1 } },
    )
    .toArray();

  const campaignTenantById = new Map();
  for (const c of campaigns) {
    const id = toIdStr(c._id);
    const appTenant = c.applicationId
      ? appTenantById.get(toIdStr(c.applicationId))
      : null;
    const ownerTenant = c.createdBy
      ? userTenantById.get(toIdStr(c.createdBy))
      : null;
    const tenantId = c.tenantId || appTenant || ownerTenant || null;

    if (id && tenantId) {
      campaignTenantById.set(id, tenantId);
    }
  }

  // Ensure campaigns are backfilled first since many collections depend on them.
  await backfillCollectionTenantId("campaigns", (doc) => {
    const id = toIdStr(doc._id);
    if (id && campaignTenantById.has(id)) return campaignTenantById.get(id);
    return pickTenantId({
      doc,
      appTenantById,
      campaignTenantById,
      reportTenantById: new Map(),
      frameworkTenantById: new Map(),
      userTenantById,
    });
  });

  const reportTenantById = await buildLookupMap(
    "certificationreports",
    "_id",
    "tenantId",
  );
  const frameworkTenantById = await buildLookupMap(
    "complianceframeworks",
    "_id",
    "tenantId",
  );

  const resolver = (doc) =>
    pickTenantId({
      doc,
      appTenantById,
      campaignTenantById,
      reportTenantById,
      frameworkTenantById,
      userTenantById,
    });

  const collections = [
    // Phase 1 platform
    "audits",
    "activities",
    "apikeys",
    "usersessions",

    // Phase 2 access
    "accounts",
    "accountaggregations",
    "accountlifecyclelogs",
    "approvalworkflows",
    "entitlements",
    "entitlementhierarchies",
    "entitlementownershipreviews",
    "roles",
    "roleassignments",
    "rolecompliancemappings",
    "roleentitlements",
    "rolehierarchies",
    "roleminingresults",
    "rolerequests",
    "rolereviewcycles",

    // Phase 3 certification
    "certificationresults",
    "certificationreports",
    "certificationschedules",
    "bulkdecisiontokens",
    "certificationescalations",
    "certificationsignoffs",
    "campaignreminderlogs",
    "emaildecisiontokens",
    "emailremindersettings",

    // Phase 3 compliance
    "complianceframeworks",
    "unifiedauditevents",
    "compliancemappings",
    "reportdefinitions",
    "reporthistories",
    "complianceevidences",
    "taskexecutions",

    // Phase 3 governance
    "policyexceptions",
    "riskmatrices",
    "auditcomments",
    "dataretentionpolicies",
    "governancepolicies",
  ];

  const existingCollections = new Set(
    (await mongoose.connection.db.listCollections().toArray()).map(
      (c) => c.name,
    ),
  );

  const summary = {};
  for (const name of collections) {
    if (!existingCollections.has(name)) {
      summary[name] = { skipped: true, reason: "collection not found" };
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const { scanned, remaining } = await backfillCollectionTenantId(
      name,
      resolver,
    );
    summary[name] = { scanned, remaining };
  }

  // eslint-disable-next-line no-console
  console.log("Tenant backfill summary:", summary);
  return summary;
}
