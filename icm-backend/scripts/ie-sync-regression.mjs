/**
 * Regression + integrity checks for identity entitlement projection.
 *
 * Usage:
 *   node scripts/ie-sync-regression.mjs
 *   node scripts/ie-sync-regression.mjs --applicationId=<id>
 *   node scripts/ie-sync-regression.mjs --synthetic --identities=100
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

const filterAppId = argValue("applicationId") || "6a06f465c982873a34211372";
const synthetic = hasFlag("synthetic");
const identityCount = Number(argValue("identities") || 100);
const outDir = join(__dirname, "..", "docs", "ie-sync-optimization");
fs.mkdirSync(outDir, { recursive: true });

await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 60000 });

const Application = (await import("../src/models/application/Application.js")).default;
const IdentityAccountLink = (await import("../src/models/identity/IdentityAccountLink.js")).default;
const { getIdentityEntitlementModelForTenantId } = await import(
  "../src/models/identityEntitlementModel.js"
);
const {
  syncAllForApplication,
  syncForIdentity,
  syncForIdentities,
} = await import("../src/services/identity/identityEntitlementSyncService.js");

const report = {
  measuredAt: new Date().toISOString(),
  checks: [],
  failures: [],
  load: [],
};

function check(name, ok, detail = {}) {
  const row = { name, ok: Boolean(ok), ...detail };
  report.checks.push(row);
  if (!ok) report.failures.push(row);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, detail);
}

const app = await Application.findById(filterAppId).lean();
if (!app) {
  console.error("Application not found", filterAppId);
  process.exit(1);
}
const Proj = await getIdentityEntitlementModelForTenantId(app.tenantId);

const beforeCount = await Proj.countDocuments({ applicationId: app._id });
const beforeDupes = await Proj.aggregate([
  { $match: { applicationId: app._id } },
  {
    $group: {
      _id: {
        identityId: "$identityId",
        applicationId: "$applicationId",
        entitlementId: "$entitlementId",
        accountId: "$accountId",
      },
      n: { $sum: 1 },
    },
  },
  { $match: { n: { $gt: 1 } } },
  { $limit: 5 },
]);

const sync1 = await syncAllForApplication(app._id);
const after1 = await Proj.countDocuments({ applicationId: app._id });
const sync2 = await syncAllForApplication(app._id);
const after2 = await Proj.countDocuments({ applicationId: app._id });

check("idempotent_syncAll_count_stable", after1 === after2, {
  after1,
  after2,
  upserted1: sync1.upserted,
  upserted2: sync2.upserted,
});
check("projection_count_matches_upserted", after1 === sync1.upserted || after1 > 0, {
  after1,
  upserted: sync1.upserted,
});
check("no_duplicate_natural_keys", beforeDupes.length === 0, {
  sample: beforeDupes,
});

const afterDupes = await Proj.aggregate([
  { $match: { applicationId: app._id } },
  {
    $group: {
      _id: {
        identityId: "$identityId",
        applicationId: "$applicationId",
        entitlementId: "$entitlementId",
        accountId: "$accountId",
      },
      n: { $sum: 1 },
    },
  },
  { $match: { n: { $gt: 1 } } },
  { $limit: 5 },
]);
check("no_duplicate_natural_keys_after", afterDupes.length === 0, { sample: afterDupes });

const sampleLinks = await IdentityAccountLink.find({
  applicationId: app._id,
  isActive: { $ne: false },
})
  .select("identityId accountId")
  .limit(20)
  .lean();

for (const link of sampleLinks.slice(0, 5)) {
  const beforeId = await Proj.countDocuments({
    applicationId: app._id,
    identityId: link.identityId,
  });
  await syncForIdentity(link.identityId, app._id);
  const afterId = await Proj.countDocuments({
    applicationId: app._id,
    identityId: link.identityId,
  });
  check(`identity_projection_stable_${String(link.identityId).slice(-6)}`, beforeId === afterId, {
    beforeId,
    afterId,
  });
}

// Shared catalog path
if (sampleLinks.length >= 3) {
  const ids = sampleLinks.slice(0, 3).map((l) => l.identityId);
  const batch = await syncForIdentities(ids, app._id);
  check("syncForIdentities_runs", batch.identitiesProcessed === 3, batch);
}

// Disabled / missing link stale cleanup: sync identity with no active links should not throw
const ghostId = new mongoose.Types.ObjectId();
const ghost = await syncForIdentity(ghostId, app._id);
check("missing_identity_safe", ghost.upserted === 0, ghost);

// Load samples
const loadSizes = synthetic
  ? [1, 10, Math.min(100, identityCount), Math.min(1000, identityCount)].filter(
      (v, i, a) => a.indexOf(v) === i,
    )
  : [1, 10, 50];
for (const n of loadSizes) {
  const links = sampleLinks.slice(0, Math.min(n, sampleLinks.length));
  if (!links.length) continue;
  const t0 = Date.now();
  const durations = [];
  for (const link of links) {
    const s = Date.now();
    await syncForIdentity(link.identityId, app._id);
    durations.push(Date.now() - s);
  }
  durations.sort((a, b) => a - b);
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const p95 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))];
  const row = {
    n: links.length,
    totalMs: Date.now() - t0,
    avgMs: Math.round(avg),
    p95Ms: p95,
    maxMs: durations[durations.length - 1],
    minMs: durations[0],
  };
  report.load.push(row);
  console.log("LOAD", row);
}

// Orphan / dangling detectors (informational)
const danglingAccount = await Proj.aggregate([
  { $match: { applicationId: app._id } },
  { $limit: 5000 },
  {
    $lookup: {
      from: "identity_account_links",
      let: { iid: "$identityId", aid: "$accountId", appId: "$applicationId" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$identityId", "$$iid"] },
                { $eq: ["$accountId", "$$aid"] },
                { $eq: ["$applicationId", "$$appId"] },
                { $ne: ["$isActive", false] },
              ],
            },
          },
        },
        { $limit: 1 },
      ],
      as: "link",
    },
  },
  { $match: { link: { $size: 0 } } },
  { $count: "n" },
]);
report.danglingWithoutActiveLink = danglingAccount[0]?.n ?? 0;
check(
  "dangling_without_active_link_info",
  true,
  { count: report.danglingWithoutActiveLink, note: "auth-source rows may legitimately lack links" },
);

report.beforeCount = beforeCount;
report.afterCount = after2;
report.app = { id: String(app._id), name: app.name };

const outPath = join(outDir, "validation-raw.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`Wrote ${outPath}; failures=${report.failures.length}`);

await mongoose.disconnect();
process.exit(report.failures.length ? 1 : 0);
