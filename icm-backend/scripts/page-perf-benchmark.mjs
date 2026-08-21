/**
 * Performance Observatory harness (Framework v3).
 *
 * Layers: Database · API · Payload · Frontend · Action
 * Targets: Navigation · Feature · Action · Shared API
 *
 * Backward compatible: still writes `results[]` (v1 labels) + `pageBenchmarks[]` (v2).
 * Additive: `schemaVersion: 3`, `targetBenchmarks[]`, `sharedApiReports[]`.
 *
 * Usage: node scripts/page-perf-benchmark.mjs
 * Output: docs/page-performance/reports/<YYYY-MM-DD_HH-mm-ss-mmm>/benchmark-raw.json
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { runMongoSuite } from "./page-perf/drivers/mongo-driver.mjs";
import { runActionSuite } from "./page-perf/drivers/action-driver.mjs";
import { runApiProbes } from "./page-perf/api-probes.mjs";
import { enrichObservatoryRaw } from "./page-perf/enrich-targets.mjs";
import { loadRegistry } from "./page-perf/registry/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT_ID = process.env.PERF_TENANT_ID || "69fc1bda8ea4655d5c93b8eb";
const PAGE = 10;
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dbName = process.env.DB_NAME || "IGA-V3";
const reportsRoot = path.join(__dirname, "../docs/page-performance/reports");

if (!uri) {
  console.error("Missing MONGODB_URI");
  process.exit(1);
}

function createRunStamp(date = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`,
  ].join("_");
}

function resolveRunOutDir() {
  fs.mkdirSync(reportsRoot, { recursive: true });
  let stamp = createRunStamp();
  let outDir = path.join(reportsRoot, stamp);
  while (fs.existsSync(outDir)) {
    stamp = createRunStamp(new Date(Date.now() + 1));
    outDir = path.join(reportsRoot, stamp);
  }
  fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

const registry = loadRegistry();
console.log(
  `Registry v${registry.version}: ${registry.targets.length} targets ` +
    `(nav=${registry.targets.filter((t) => t.kind === "navigation").length}, ` +
    `feature=${registry.targets.filter((t) => t.kind === "feature").length}, ` +
    `action=${registry.targets.filter((t) => t.kind === "action").length}, ` +
    `api=${registry.targets.filter((t) => t.kind === "sharedApi").length})`,
);

await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 60000 });
const db = mongoose.connection.db;
const tid = new ObjectId(TENANT_ID);
const tenant = await db.collection("tenants").findOne({ _id: tid });
const apps = await db
  .collection("applications")
  .find({ tenantId: tid })
  .project({ name: 1, slug: 1, type: 1, connectorType: 1 })
  .toArray();
const adApp =
  apps.find((a) => /active.?directory/i.test(a.name)) ||
  apps.find((a) => /microsoft/i.test(a.name)) ||
  apps[0];

console.log("Running Mongo suite (navigation + feature labels)...");
const { results: mongoResults, meta: mongoMeta } = await runMongoSuite({
  db,
  tenantId: tid,
  apps,
  pageSize: PAGE,
});

console.log("Running Action suite (historical jobs)...");
const { results: actionResults, actionProbes } = await runActionSuite({
  db,
  tenantId: TENANT_ID,
  adAppId: adApp ? String(adApp._id) : mongoMeta.adAppId,
});

const results = [...mongoResults, ...actionResults];

console.log("Running Layer 2 API probes (controllers)...");
const apiProbes = await runApiProbes({ tenantId: TENANT_ID, db, pageSize: PAGE });
console.log(`API probes: ${Object.keys(apiProbes).filter((k) => apiProbes[k]?.ok).length} ok`);

const outDir = resolveRunOutDir();
const basePayload = {
  measuredAt: new Date().toISOString(),
  tenantId: TENANT_ID,
  tenant: tenant?.name || null,
  dbName,
  pageSize: PAGE,
  apps: mongoMeta.apps || apps.map((a) => ({ id: String(a._id), name: a.name })),
  results,
  apiProbes,
  actionProbes,
  reportRunDir: path.relative(path.join(__dirname, ".."), outDir),
};

const payload = enrichObservatoryRaw(basePayload, { apiProbes, actionProbes, pageSize: PAGE });
const rawPath = path.join(outDir, "benchmark-raw.json");
fs.writeFileSync(rawPath, JSON.stringify(payload, null, 2));
console.log(`Wrote ${rawPath} (schemaVersion=${payload.schemaVersion})`);
console.log(
  `Targets: ${payload.targetBenchmarks?.length || 0} · Shared APIs: ${payload.sharedApiReports?.length || 0}`,
);
console.log(`Run folder: ${outDir}`);
console.log(
  `Next: node scripts/generate-page-perf-reports.mjs ${path.basename(outDir)}`,
);
await mongoose.disconnect();
