/**
 * Mongo suite driver — Framework v1 labels for Performance Observatory.
 * Extracted from page-perf-benchmark.mjs; does not connect or write files.
 */
import { ObjectId } from "mongodb";
import { bytesOf } from "../lib/bytes.mjs";
import { timeLabel } from "../lib/timing.mjs";
import { explainFind, explainAggregate } from "../lib/explain.mjs";

/**
 * @param {{ db: import("mongodb").Db, tenantId: string, pageSize?: number }} ctx
 * @returns {Promise<{ results: object[], meta: object }>}
 */
export async function runMongoSuite(ctx) {
  const db = ctx.db;
  const PAGE = ctx.pageSize || 10;
  const tid = ctx.tenantId instanceof ObjectId ? ctx.tenantId : new ObjectId(String(ctx.tenantId));
  const time = timeLabel;

  const apps =
    ctx.apps ||
    (await db
      .collection("applications")
      .find({ tenantId: tid })
      .project({ name: 1, slug: 1, type: 1, connectorType: 1 })
      .toArray());
  const appIds = apps.map((a) => a._id);
  const firstAppId = appIds[0];
  const adApp =
    apps.find((a) => /active.?directory/i.test(a.name)) ||
    apps.find((a) => /microsoft/i.test(a.name)) ||
    apps[0];


const results = [];

// --- Identities (UI default sort = displayName + _id; updatedAt kept as secondary metric) ---
const idColl = db.collection("app_wisibility_identities");
results.push(
  await time("AllIdentities_page10", async () => {
    const filter = { tenantId: tid };
    const uiSort = { displayName: 1, _id: 1 };
    const [total, rows] = await Promise.all([
      idColl.countDocuments(filter),
      idColl.find(filter).sort(uiSort).skip(0).limit(PAGE).toArray(),
    ]);
    const explain = await explainFind(idColl, filter, {
      sort: uiSort,
      limit: PAGE,
    });
    return {
      rows: rows.length,
      total,
      payloadBytes: bytesOf(rows),
      explain,
      collections: ["app_wisibility_identities"],
      meta: { sort: uiSort, note: "Matches IdentitiesList default sort (not updatedAt)" },
    };
  })
);
results.push(
  await time("AllIdentities_updatedAt_page10", async () => {
    const filter = { tenantId: tid };
    const sort = { updatedAt: -1, _id: 1 };
    const [total, rows] = await Promise.all([
      idColl.countDocuments(filter),
      idColl.find(filter).sort(sort).skip(0).limit(PAGE).toArray(),
    ]);
    const explain = await explainFind(idColl, filter, { sort, limit: PAGE });
    return {
      rows: rows.length,
      total,
      payloadBytes: bytesOf(rows),
      explain,
      collections: ["app_wisibility_identities"],
      meta: { sort, note: "Supported alternate sort path" },
    };
  })
);

results.push(
  await time("Dashboard_stats_limit1", async () => {
    const [idCount, appCount, idSample, appSample] = await Promise.all([
      idColl.countDocuments({ tenantId: tid }),
      db.collection("applications").countDocuments({ tenantId: tid }),
      idColl.find({ tenantId: tid }).limit(1).toArray(),
      db.collection("applications").find({ tenantId: tid }).limit(1).toArray(),
    ]);
    return {
      rows: 2,
      total: { identities: idCount, applications: appCount },
      payloadBytes: bytesOf({ idSample, appSample }),
      collections: ["app_wisibility_identities", "applications"],
    };
  })
);

// --- Profiles ---
results.push(
  await time("IdentityProfiles_list", async () => {
    const filter = { tenantId: tid };
    const rows = await db.collection("identity_profiles").find(filter).limit(PAGE).toArray();
    const total = await db.collection("identity_profiles").countDocuments(filter);
    return { rows: rows.length, total, payloadBytes: bytesOf(rows), collections: ["identity_profiles"] };
  })
);

// --- Applications ---
results.push(
  await time("Applications_page10", async () => {
    const filter = { tenantId: tid };
    const [total, rows] = await Promise.all([
      db.collection("applications").countDocuments(filter),
      db
        .collection("applications")
        .find(filter)
        .project({ name: 1, type: 1, connectorType: 1, tenantId: 1, updatedAt: 1, createdAt: 1 })
        .sort({ updatedAt: -1 })
        .limit(PAGE)
        .toArray(),
    ]);
    return { rows: rows.length, total, payloadBytes: bytesOf(rows), collections: ["applications"] };
  })
);

// --- Correlated (current optimized path) ---
results.push(
  await time("CorrelatedAccounts_page10", async () => {
    const match = { tenantId: tid, isActive: true };
    const [total, rows] = await Promise.all([
      db.collection("identity_account_links").countDocuments(match),
      db
        .collection("identity_account_links")
        .aggregate([
          { $match: match },
          { $sort: { updatedAt: -1 } },
          { $skip: 0 },
          { $limit: PAGE },
          {
            $lookup: {
              from: "applications",
              localField: "applicationId",
              foreignField: "_id",
              as: "application",
              pipeline: [{ $project: { name: 1, type: 1 } }],
            },
          },
          {
            $lookup: {
              from: "app_wisibility_identities",
              localField: "identityId",
              foreignField: "_id",
              as: "identity",
              pipeline: [{ $project: { displayName: 1, email: 1, employeeId: 1 } }],
            },
          },
        ])
        .toArray(),
    ]);
    const explain = await explainAggregate(db.collection("identity_account_links"), [
      { $match: match },
      { $sort: { updatedAt: -1 } },
      { $limit: PAGE },
    ]);
    return {
      rows: rows.length,
      total,
      payloadBytes: bytesOf(rows),
      explain,
      collections: ["identity_account_links", "applications", "app_wisibility_identities"],
    };
  })
);

// --- Orphans ---
results.push(
  await time("UncorrelatedAccounts_page10", async () => {
    const listQuery = { tenantId: tid, status: "OPEN" };
    const [total, highRiskOpenTotal, distinctRow, orphans] = await Promise.all([
      db.collection("orphan_accounts").countDocuments(listQuery),
      db.collection("orphan_accounts").countDocuments({
        ...listQuery,
        riskLevel: { $in: ["HIGH", "CRITICAL"] },
      }),
      db
        .collection("orphan_accounts")
        .aggregate([{ $match: listQuery }, { $group: { _id: "$applicationId" } }, { $count: "total" }])
        .toArray(),
      db
        .collection("orphan_accounts")
        .find(listQuery)
        .sort({ detectedAt: -1 })
        .skip(0)
        .limit(PAGE)
        .toArray(),
    ]);
    const explain = await explainFind(db.collection("orphan_accounts"), listQuery, {
      sort: { detectedAt: -1 },
      limit: PAGE,
    });
    return {
      rows: orphans.length,
      total,
      payloadBytes: bytesOf({ orphans, highRiskOpenTotal, distinctApps: distinctRow[0]?.total }),
      explain,
      collections: ["orphan_accounts"],
      meta: { highRiskOpenTotal, distinctApps: distinctRow[0]?.total ?? 0 },
    };
  })
);

// --- Duplicates (first app with data, else first app) ---
let dupAppId = firstAppId;
let maxDup = -1;
for (const a of apps) {
  const c = await db.collection("application_user_duplicates").countDocuments({
    applicationId: a._id,
  });
  if (c > maxDup) {
    maxDup = c;
    dupAppId = a._id;
  }
}
results.push(
  await time("DuplicateAppAccounts_page10", async () => {
    const filter = { applicationId: dupAppId };
    const [total, rows] = await Promise.all([
      db.collection("application_user_duplicates").countDocuments(filter),
      db
        .collection("application_user_duplicates")
        .find(filter)
        .sort({ updatedAt: -1 })
        .limit(PAGE)
        .toArray(),
    ]);
    return {
      rows: rows.length,
      total,
      payloadBytes: bytesOf(rows),
      collections: ["application_user_duplicates"],
      meta: { applicationId: String(dupAppId), appName: apps.find((a) => String(a._id) === String(dupAppId))?.name },
    };
  })
);

// --- Entitlements correlations (pick app with most users) ---
const userCols = (await db.listCollections().toArray())
  .map((c) => c.name)
  .filter((n) => /^app_iga_wisibility_.*_users$/.test(n) && !n.includes("_mapped_"));
let bestUserCol = null;
let bestUserCount = 0;
for (const name of userCols.slice(0, 40)) {
  const c = await db.collection(name).estimatedDocumentCount();
  if (c > bestUserCount) {
    bestUserCount = c;
    bestUserCol = name;
  }
}
const corrCols = (await db.listCollections().toArray())
  .map((c) => c.name)
  .filter((n) => /_correlation$/.test(n) && /wisibility|github|salesforce|workday|active/i.test(n));
results.push(
  await time("Entitlements_users_page10", async () => {
    if (!bestUserCol) return { rows: 0, total: 0, payloadBytes: 0, note: "no user collection" };
    const coll = db.collection(bestUserCol);
    const [total, rows] = await Promise.all([
      coll.estimatedDocumentCount(),
      coll.find({}).limit(PAGE).toArray(),
    ]);
    return {
      rows: rows.length,
      total,
      payloadBytes: bytesOf(rows),
      collections: [bestUserCol],
      meta: { note: "proxy for app users tab / entitlement fan-in source" },
    };
  })
);

// Correlation matrix sample if present
const corrName = corrCols[0];
results.push(
  await time("Entitlements_correlation_page10", async () => {
    if (!corrName) {
      return { rows: 0, total: 0, payloadBytes: 0, note: "no correlation collection for tenant apps" };
    }
    const coll = db.collection(corrName);
    const total = await coll.estimatedDocumentCount();
    const rows = await coll.find({}).limit(PAGE).toArray();
    return { rows: rows.length, total, payloadBytes: bytesOf(rows), collections: [corrName] };
  })
);

// --- Security ---
const postureFilter = adApp ? { applicationId: adApp._id } : {};
results.push(
  await time("SecurityFindings_page10", async () => {
    const coll = db.collection("posture_scan_results");
    const filter = { ...postureFilter };
    const [total, rows] = await Promise.all([
      coll.countDocuments(filter),
      coll.find(filter).sort({ scannedAt: -1, createdAt: -1 }).limit(PAGE).toArray(),
    ]);
    return {
      rows: rows.length,
      total,
      payloadBytes: bytesOf(rows),
      collections: ["posture_scan_results"],
      meta: { applicationId: adApp ? String(adApp._id) : null, appName: adApp?.name },
    };
  })
);

results.push(
  await time("SecurityScans_list", async () => {
    const coll = db.collection("posture_scan_results");
    const filter = adApp ? { applicationId: adApp._id } : {};
    // Distinct scan runs proxy: group by scanId / jobId if present
    const rows = await coll
      .aggregate([
        { $match: filter },
        { $sort: { createdAt: -1 } },
        { $limit: 200 },
        {
          $group: {
            _id: "$scanId",
            createdAt: { $first: "$createdAt" },
            findingCount: { $sum: 1 },
          },
        },
        { $sort: { createdAt: -1 } },
        { $limit: PAGE },
      ])
      .toArray();
    return {
      rows: rows.length,
      total: rows.length,
      payloadBytes: bytesOf(rows),
      collections: ["posture_scan_results"],
    };
  })
);

results.push(
  await time("SecurityPolicies_list", async () => {
    const filter = {};
    const rows = await db.collection("security_policies").find(filter).limit(100).toArray();
    const total = await db.collection("security_policies").countDocuments(filter);
    return { rows: rows.length, total, payloadBytes: bytesOf(rows), collections: ["security_policies"] };
  })
);

// --- SoD ---
results.push(
  await time("SodPolicies_list", async () => {
    const filter = { tenantId: tid };
    const [total, rows] = await Promise.all([
      db.collection("sod_policies").countDocuments(filter),
      db.collection("sod_policies").find(filter).sort({ updatedAt: -1 }).limit(PAGE).toArray(),
    ]);
    return { rows: rows.length, total, payloadBytes: bytesOf(rows), collections: ["sod_policies"] };
  })
);

results.push(
  await time("SodViolations_page10", async () => {
    const filter = { tenantId: tid };
    const [total, rows] = await Promise.all([
      db.collection("sod_violations").countDocuments(filter),
      db.collection("sod_violations").find(filter).sort({ detectedAt: -1, createdAt: -1 }).limit(PAGE).toArray(),
    ]);
    return { rows: rows.length, total, payloadBytes: bytesOf(rows), collections: ["sod_violations"] };
  })
);

// --- Workflows / transforms / discovery / certs ---
for (const [label, collName, filter] of [
  ["Workflows_list", "remediation_workflow_definitions", { tenantId: tid }],
  ["Transforms_list", "transforms", { tenantId: tid }],
  ["DiscoveryPolicies_list", "discovery_policies", { tenantId: tid }],
  ["AccessCertCampaigns_list", "access_certification_campaigns", { tenantId: tid }],
  ["Connectors_list", "connector_configs", {}],
  ["UsersRoles_list", "users", {}],
]) {
  results.push(
    await time(label, async () => {
      const coll = db.collection(collName);
      let total = 0;
      let rows = [];
      try {
        total = await coll.countDocuments(filter);
        rows = await coll.find(filter).limit(PAGE).toArray();
      } catch (e) {
        // try without tenantId
        total = await coll.countDocuments({});
        rows = await coll.find({}).limit(PAGE).toArray();
      }
      // redact secrets
      const safe = rows.map((r) => {
        const c = { ...r };
        delete c.password;
        delete c.secret;
        delete c.hashedPassword;
        delete c.apiKey;
        return c;
      });
      return { rows: safe.length, total, payloadBytes: bytesOf(safe), collections: [collName] };
    })
  );
}

results.push(
  await time("RemediationEvents_dual", async () => {
    const [execTotal, execRows, taskTotal, taskRows] = await Promise.all([
      db.collection("remediation_workflow_executions").countDocuments({ tenantId: tid }),
      db
        .collection("remediation_workflow_executions")
        .find({ tenantId: tid })
        .sort({ createdAt: -1 })
        .limit(PAGE)
        .toArray()
        .catch(() => []),
      db.collection("workflow_task_queue").countDocuments({ tenantId: tid }),
      db
        .collection("workflow_task_queue")
        .find({ tenantId: tid })
        .sort({ createdAt: -1 })
        .limit(PAGE)
        .toArray()
        .catch(() => []),
    ]);
    // fallback without tenant if empty
    let eRows = execRows;
    let eTotal = execTotal;
    let tRows = taskRows;
    let tTotal = taskTotal;
    if (eTotal === 0) {
      eTotal = await db.collection("remediation_workflow_executions").estimatedDocumentCount();
      eRows = await db.collection("remediation_workflow_executions").find({}).limit(PAGE).toArray();
    }
    if (tTotal === 0) {
      tTotal = await db.collection("workflow_task_queue").estimatedDocumentCount();
      tRows = await db.collection("workflow_task_queue").find({}).limit(PAGE).toArray();
    }
    return {
      rows: eRows.length + tRows.length,
      total: { executions: eTotal, tasks: tTotal },
      payloadBytes: bytesOf({ eRows, tRows }),
      collections: ["remediation_workflow_executions", "workflow_task_queue"],
    };
  })
);

// --- Audit / Activity ---
const auditCollName = (await db.listCollections({ name: "audits" }).hasNext())
  ? "audits"
  : (await db.listCollections({ name: "unified_audit_events" }).hasNext())
    ? "unified_audit_events"
    : "audits";
results.push(
  await time("AuditLog_page10", async () => {
    const coll = db.collection(auditCollName);
    const filter = { tenantId: tid };
    let total = await coll.countDocuments(filter).catch(() => 0);
    let rows = await coll.find(filter).sort({ createdAt: -1 }).limit(PAGE).toArray().catch(() => []);
    if (total === 0 && rows.length === 0) {
      total = await coll.estimatedDocumentCount();
      rows = await coll.find({}).sort({ createdAt: -1 }).limit(PAGE).toArray();
    }
    return { rows: rows.length, total, payloadBytes: bytesOf(rows), collections: [auditCollName] };
  })
);

results.push(
  await time("ActivityFeed_page10", async () => {
    const coll = db.collection("activities");
    const filter = { tenantId: tid };
    let total = await coll.countDocuments(filter).catch(() => 0);
    let rows = await coll.find(filter).sort({ createdAt: -1 }).limit(PAGE).toArray().catch(() => []);
    if (total === 0 && rows.length === 0) {
      total = await coll.estimatedDocumentCount();
      rows = await coll.find({}).sort({ createdAt: -1 }).limit(PAGE).toArray();
    }
    return { rows: rows.length, total, payloadBytes: bytesOf(rows), collections: ["activities"] };
  })
);

// --- Data Hygiene summary (warm snapshot hit) ---
results.push(
  await time("DataHygiene_summary", async () => {
    try {
      const cacheMod = await import("../../../src/services/datahygine/dataHygieneSummaryCacheService.js");
      const { getDataHygieneSummaryFast, recomputeDataHygieneSummary } = cacheMod;
      await recomputeDataHygieneSummary(tid);
      const hitResult = await getDataHygieneSummaryFast(tid, { forceRefresh: false });
      const hit = hitResult?.payload ?? hitResult;
      return {
        rows: 1,
        total: 1,
        payloadBytes: bytesOf(hit),
        collections: ["data_hygiene_tenant_summaries"],
        via: "getDataHygieneSummaryFast(cacheHit)",
      };
    } catch (e) {
      const [
        orphansOpen,
        linksActive,
        identities,
        appsCount,
      ] = await Promise.all([
        db.collection("orphan_accounts").countDocuments({ tenantId: tid, status: "OPEN" }),
        db.collection("identity_account_links").countDocuments({ tenantId: tid, isActive: true }),
        idColl.countDocuments({ tenantId: tid }),
        db.collection("applications").countDocuments({ tenantId: tid }),
      ]);
      return {
        rows: 1,
        total: 1,
        payloadBytes: bytesOf({ orphansOpen, linksActive, identities, appsCount }),
        collections: ["orphan_accounts", "identity_account_links", "app_wisibility_identities", "applications"],
        meta: { note: `cache service unavailable: ${e.message}; KPI counts measured` },
      };
    }
  })
);

results.push(
  await time("DataHygiene_summary_refresh", async () => {
    try {
      const cacheMod = await import("../../../src/services/datahygine/dataHygieneSummaryCacheService.js");
      const refreshResult = await cacheMod.getDataHygieneSummaryFast(tid, { forceRefresh: true });
      const summary = refreshResult?.payload ?? refreshResult;
      return {
        rows: 1,
        total: 1,
        payloadBytes: bytesOf(summary),
        collections: ["data_hygiene_tenant_summaries"],
        via: "getDataHygieneSummaryFast(forceRefreshSWR)",
        meta: refreshResult?.meta ?? null,
      };
    } catch (e) {
      return { rows: 0, total: 0, payloadBytes: 0, collections: [], error: e.message };
    }
  })
);

// ISO fan-out: apps list + orphan iso-summary style counts per app (first 3 apps)
results.push(
  await time("IsoReport_mount_fanout", async () => {
    const appList = await db
      .collection("applications")
      .find({ tenantId: tid })
      .project({ name: 1 })
      .toArray();
    const perApp = [];
    for (const a of appList.slice(0, 5)) {
      const orphanCount = await db.collection("orphan_accounts").countDocuments({
        tenantId: tid,
        applicationId: a._id,
        status: "OPEN",
      });
      perApp.push({ app: a.name, orphanCount });
    }
    return {
      rows: appList.length,
      total: appList.length,
      payloadBytes: bytesOf({ appList, perApp }),
      collections: ["applications", "orphan_accounts"],
      meta: { perApp, note: "mount = apps list; first 5 apps orphan counts (ISO section fan-out sample)" },
    };
  })
);

// Peer / Posture / Mindmap / Correlation mount share identities or apps
results.push(
  await time("CorrelationEngine_mount", async () => {
    const [appsRows, profiles] = await Promise.all([
      db.collection("applications").find({ tenantId: tid }).limit(100).toArray(),
      db.collection("identity_profiles").find({ tenantId: tid }).limit(50).toArray(),
    ]);
    return {
      rows: appsRows.length + profiles.length,
      total: { apps: appsRows.length, profiles: profiles.length },
      payloadBytes: bytesOf({ apps: appsRows.map((a) => ({ _id: a._id, name: a.name })), profiles }),
      collections: ["applications", "identity_profiles"],
    };
  })
);

results.push(
  await time("MindmapSearch_identities50", async () => {
    const rows = await idColl.find({ tenantId: tid }).limit(50).toArray();
    return { rows: rows.length, total: 50, payloadBytes: bytesOf(rows), collections: ["app_wisibility_identities"] };
  })
);



  // --- Observatory feature metrics (Applications detail tabs) ---
  results.push(...(await measureApplicationFeatures({ db, tid, apps, adApp, firstAppId, PAGE, time })));

  return {
    results,
    meta: {
      apps: apps.map((a) => ({ id: String(a._id), name: a.name })),
      adAppId: adApp ? String(adApp._id) : null,
      firstAppId: firstAppId ? String(firstAppId) : null,
    },
  };
}

async function measureApplicationFeatures({ db, tid, apps, adApp, firstAppId, PAGE, time }) {
  const out = [];
  const targetApp = adApp || apps[0];
  if (!targetApp) return out;
  const appId = targetApp._id;
  // Accounts — prefer largest app_*_users collection for this tenant pattern
  const userCols = (await db.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => /^app_iga_wisibility_.*_users$/.test(n) && !n.includes("_mapped_"));
  let bestUserCol = null;
  let bestCount = 0;
  for (const name of userCols.slice(0, 40)) {
    const c = await db.collection(name).estimatedDocumentCount();
    if (c > bestCount) {
      bestCount = c;
      bestUserCol = name;
    }
  }
  out.push(
    await time("Applications_Accounts_page10", async () => {
      if (!bestUserCol) {
        return { rows: 0, total: 0, payloadBytes: 0, note: "no users collection", collections: [] };
      }
      const coll = db.collection(bestUserCol);
      const filter = {};
      const [total, rows] = await Promise.all([
        coll.estimatedDocumentCount(),
        coll.find(filter).limit(PAGE).toArray(),
      ]);
      const explain = await explainFind(coll, filter, { limit: PAGE }).catch(() => null);
      return {
        rows: rows.length,
        total,
        payloadBytes: bytesOf(rows),
        explain,
        collections: [bestUserCol],
        meta: { applicationId: String(appId), tab: "users" },
      };
    }),
  );

  // Entitlements
  const entCols = (await db.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => /_entitlements$/.test(n) && /wisibility|iga/i.test(n));
  const entCol = entCols[0];
  out.push(
    await time("Applications_Entitlements_page10", async () => {
      if (!entCol) {
        // fallback: generic entitlements by applicationId
        const coll = db.collection("entitlements");
        const filter = { applicationId: appId };
        let total = await coll.countDocuments(filter).catch(() => 0);
        let rows = await coll.find(filter).limit(PAGE).toArray().catch(() => []);
        if (!rows.length) {
          total = await coll.estimatedDocumentCount().catch(() => 0);
          rows = await coll.find({}).limit(PAGE).toArray().catch(() => []);
        }
        return {
          rows: rows.length,
          total,
          payloadBytes: bytesOf(rows),
          collections: ["entitlements"],
          meta: { applicationId: String(appId), tab: "entitlements" },
        };
      }
      const coll = db.collection(entCol);
      const total = await coll.estimatedDocumentCount();
      const rows = await coll.find({}).limit(PAGE).toArray();
      return {
        rows: rows.length,
        total,
        payloadBytes: bytesOf(rows),
        collections: [entCol],
        meta: { applicationId: String(appId), tab: "entitlements" },
      };
    }),
  );

  // Reconciliation history
  out.push(
    await time("Applications_ReconHistory_page10", async () => {
      const coll = db.collection("reconciliation_runs");
      const filter = { applicationId: appId };
      let total = await coll.countDocuments(filter).catch(() => 0);
      let rows = await coll.find(filter).sort({ createdAt: -1 }).limit(PAGE).toArray().catch(() => []);
      if (!rows.length) {
        total = await coll.estimatedDocumentCount().catch(() => 0);
        rows = await coll.find({}).sort({ createdAt: -1 }).limit(PAGE).toArray().catch(() => []);
      }
      return {
        rows: rows.length,
        total,
        payloadBytes: bytesOf(rows),
        collections: ["reconciliation_runs"],
        meta: { applicationId: String(appId), tab: "reconHistory" },
      };
    }),
  );

  // Change logs (delta_changes)
  out.push(
    await time("Applications_ChangeLogs_page10", async () => {
      const coll = db.collection("delta_changes");
      const filter = { applicationId: appId };
      let total = await coll.countDocuments(filter).catch(() => 0);
      let rows = await coll.find(filter).sort({ createdAt: -1 }).limit(PAGE).toArray().catch(() => []);
      if (!rows.length) {
        total = await coll.estimatedDocumentCount().catch(() => 0);
        rows = await coll.find({}).sort({ createdAt: -1 }).limit(PAGE).toArray().catch(() => []);
      }
      return {
        rows: rows.length,
        total,
        payloadBytes: bytesOf(rows),
        collections: ["delta_changes"],
        meta: { applicationId: String(appId), tab: "deltaChanges" },
      };
    }),
  );

  // Correlation config / results for app
  out.push(
    await time("Applications_Correlation_page10", async () => {
      const corrCols = (await db.listCollections().toArray())
        .map((c) => c.name)
        .filter((n) => /_correlation$/.test(n));
      const name = corrCols[0];
      if (!name) {
        return { rows: 0, total: 0, payloadBytes: 0, note: "no correlation collection", collections: [] };
      }
      const coll = db.collection(name);
      const total = await coll.estimatedDocumentCount();
      const rows = await coll.find({}).limit(PAGE).toArray();
      return {
        rows: rows.length,
        total,
        payloadBytes: bytesOf(rows),
        collections: [name],
        meta: { applicationId: String(appId), tab: "correlation" },
      };
    }),
  );

  // AD Suggestions (AD attribute suggestion docs if present)
  out.push(
    await time("Applications_AdSuggestions_page10", async () => {
      const candidates = ["ad_attribute_suggestions", "ad_suggestions", "application_ad_suggestions"];
      let collName = null;
      for (const n of candidates) {
        if (await db.listCollections({ name: n }).hasNext()) {
          collName = n;
          break;
        }
      }
      if (!collName) {
        return {
          rows: 0,
          total: 0,
          payloadBytes: 0,
          note: "no ad suggestions collection",
          collections: [],
          meta: { applicationId: String(appId), tab: "adSuggestions" },
        };
      }
      const coll = db.collection(collName);
      const filter = { applicationId: appId };
      let total = await coll.countDocuments(filter).catch(() => 0);
      let rows = await coll.find(filter).limit(PAGE).toArray().catch(() => []);
      if (!rows.length) {
        total = await coll.estimatedDocumentCount();
        rows = await coll.find({}).limit(PAGE).toArray();
      }
      return {
        rows: rows.length,
        total,
        payloadBytes: bytesOf(rows),
        collections: [collName],
        meta: { applicationId: String(appId), tab: "adSuggestions" },
      };
    }),
  );

  // Settings — application document load (config surface)
  out.push(
    await time("Applications_Settings_load", async () => {
      const coll = db.collection("applications");
      const row = await coll.findOne({ _id: appId });
      const safe = row ? { ...row } : null;
      if (safe) {
        delete safe.password;
        delete safe.secret;
        delete safe.connectionConfig?.ad?.password;
      }
      return {
        rows: safe ? 1 : 0,
        total: 1,
        payloadBytes: bytesOf(safe),
        collections: ["applications"],
        meta: { applicationId: String(appId), tab: "settings" },
      };
    }),
  );

  return out;
}
