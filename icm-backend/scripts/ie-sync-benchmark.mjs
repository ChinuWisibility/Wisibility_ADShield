/**
 * Measure identity entitlement sync against live MongoDB.
 *
 * Usage:
 *   IDENTITY_ENTITLEMENT_SYNC_METRICS=1 node scripts/ie-sync-benchmark.mjs --phase=before
 *   IDENTITY_ENTITLEMENT_SYNC_METRICS=1 node scripts/ie-sync-benchmark.mjs --phase=after
 *   IDENTITY_ENTITLEMENT_SYNC_METRICS=1 node scripts/ie-sync-benchmark.mjs --phase=before --applicationId=...
 *   IDENTITY_ENTITLEMENT_SYNC_METRICS=1 node scripts/ie-sync-benchmark.mjs --synthetic --identities=100
 *
 * Writes JSON to docs/ie-sync-optimization/raw-{phase}.json
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
const dbName = process.env.DB_NAME || "IGA-V3";
if (!uri) {
  console.error("Missing MONGODB_URI");
  process.exit(1);
}

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const phase = argValue("phase") || "measure";
const filterAppId = argValue("applicationId");
const synthetic = hasFlag("synthetic");
const identityCount = Number(argValue("identities") || 100);
const outDir = join(__dirname, "..", "docs", "ie-sync-optimization");
fs.mkdirSync(outDir, { recursive: true });

process.env.IDENTITY_ENTITLEMENT_SYNC_METRICS = "1";

const {
  setSyncMetricsEnabled,
  beginSyncMetrics,
  endSyncMetrics,
  recordMongoCommand,
  recordBulkWriteOps,
  recordDeleteMany,
} = await import("../src/services/identityEntitlementSyncMetrics.js");

setSyncMetricsEnabled(true);

await mongoose.connect(uri, {
  dbName,
  serverSelectionTimeoutMS: 60000,
  monitorCommands: true,
});
mongoose.connection.on("commandStarted", recordMongoCommand);

const Application = (await import("../src/models/application/Application.js")).default;
const IdentityAccountLink = (await import("../src/models/identity/IdentityAccountLink.js")).default;
const {
  syncAllForApplication,
  syncForIdentity,
} = await import("../src/services/identityEntitlementSyncService.js");
const { getIdentityEntitlementModelForTenantId } = await import(
  "../src/models/identityEntitlementModel.js"
);

const results = {
  phase,
  measuredAt: new Date().toISOString(),
  dbName,
  node: process.version,
  samples: [],
};

async function measure(label, fn) {
  beginSyncMetrics(label);
  const t0 = Date.now();
  let outcome;
  let error = null;
  try {
    outcome = await fn();
  } catch (e) {
    error = e?.message || String(e);
  }
  const wallMs = Date.now() - t0;
  const metrics = endSyncMetrics({ wallMs, error, outcome }) || {
    label,
    wallMs,
    error,
    outcome,
  };
  results.samples.push(metrics);
  console.log(
    JSON.stringify({
      label,
      durationMs: metrics.durationMs ?? wallMs,
      commands: metrics.commands,
      find: metrics.find,
      bulkWrite: metrics.bulkWrite,
      bulkWriteOps: metrics.bulkWriteOps,
      deleteMany: metrics.deleteMany,
      heapDeltaMb: metrics.heapDeltaMb,
      cpuMs: metrics.cpuMs,
      error,
      upserted: outcome?.upserted,
    }),
  );
  return metrics;
}

if (synthetic) {
  console.log(`[benchmark] synthetic mode identities=${identityCount} — skipped (use ie-sync-regression.mjs)`);
} else {
  let apps = [];
  if (filterAppId) {
    const app = await Application.findById(filterAppId).select("_id name tenantId").lean();
    if (app) apps = [app];
  } else {
    const top = await IdentityAccountLink.aggregate([
      { $match: { isActive: { $ne: false } } },
      { $group: { _id: "$applicationId", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 3 },
    ]);
    // Prefer mid-size (~1k–8k links) for tractable wall time; fall back to largest.
    const mid = top.filter((t) => t.n >= 500 && t.n <= 9000);
    const chosen = (mid.length ? mid : top).slice(0, 1);
    for (const row of chosen) {
      const app = await Application.findById(row._id).select("_id name tenantId").lean();
      if (app) apps.push(app);
    }
  }
  if (!apps.length) {
    console.error("No applications found");
    await mongoose.disconnect();
    process.exit(1);
  }

  for (const app of apps) {
    const linkCount = await IdentityAccountLink.countDocuments({
      applicationId: app._id,
      isActive: { $ne: false },
    });
    let projectionCountBefore = null;
    try {
      const Proj = await getIdentityEntitlementModelForTenantId(app.tenantId);
      projectionCountBefore = await Proj.countDocuments({ applicationId: app._id });
    } catch (e) {
      projectionCountBefore = `error:${e.message}`;
    }
    results.samples.push({
      label: "app-meta",
      applicationId: String(app._id),
      appName: app.name,
      tenantId: String(app.tenantId),
      linkCount,
      projectionCountBefore,
    });

    await measure(`syncAllForApplication:${app.name}`, () => syncAllForApplication(app._id));

    let projectionCountAfter = null;
    try {
      const Proj = await getIdentityEntitlementModelForTenantId(app.tenantId);
      projectionCountAfter = await Proj.countDocuments({ applicationId: app._id });
    } catch (e) {
      projectionCountAfter = `error:${e.message}`;
    }
    results.samples.push({
      label: "projection-count-after-syncAll",
      applicationId: String(app._id),
      projectionCountAfter,
    });

    const sampleLinks = await IdentityAccountLink.find({
      applicationId: app._id,
      isActive: { $ne: false },
    })
      .select("identityId")
      .limit(10)
      .lean();

    for (const link of sampleLinks.slice(0, 5)) {
      await measure(`syncForIdentity:${app.name}:${String(link.identityId).slice(-6)}`, () =>
        syncForIdentity(link.identityId, app._id),
      );
    }

    // Simulate duplicate path cost: N identity syncs after full app sync (before optimization)
    if (sampleLinks.length >= 3) {
      const ids = sampleLinks.slice(0, 3).map((l) => l.identityId);
      await measure(`duplicatePattern:syncAll+3xIdentity:${app.name}`, async () => {
        const a = await syncAllForApplication(app._id);
        let extra = 0;
        for (const id of ids) {
          const r = await syncForIdentity(id, app._id);
          extra += r.upserted || 0;
        }
        return { upserted: (a.upserted || 0) + extra, linksProcessed: a.linksProcessed };
      });
    }
  }
}

const outPath = join(outDir, `raw-${phase}.json`);
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`[benchmark] wrote ${outPath}`);

await mongoose.disconnect();
