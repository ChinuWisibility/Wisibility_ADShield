/**
 * Reproducible All Identities benchmark.
 *
 * Measures the real controller path separately from Mongo explain plans so
 * explain overhead never contaminates latency samples.
 *
 * Usage:
 *   node scripts/identity-list-api-benchmark.mjs before
 *   node scripts/identity-list-api-benchmark.mjs after
 */
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import {
  buildIdentityListSort,
  buildIdentityTextSearchFilter,
  getIdentities,
} from "../src/controllers/identity/identityController.js";
import { getDynamicIdentityModelForTenantId } from "../src/models/identity/Identity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const phase = process.argv[2] || "adhoc";
const tenantId = process.env.PERF_TENANT_ID || "69fc1bda8ea4655d5c93b8eb";
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dbName = process.env.DB_NAME || "IGA-V3";
const sampleCount = Math.max(3, Number(process.env.PERF_SAMPLES || 15));
const warmupCount = Math.max(1, Number(process.env.PERF_WARMUPS || 3));

if (!uri) throw new Error("MONGODB_URI or MONGO_URI is required");
if (!mongoose.Types.ObjectId.isValid(tenantId)) throw new Error("PERF_TENANT_ID must be valid");

const tid = new mongoose.Types.ObjectId(tenantId);

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, n) => sum + n, 0) / sorted.length;
  return {
    samples: sorted.length,
    minMs: Number(sorted[0].toFixed(2)),
    p50Ms: Number(percentile(sorted, 50).toFixed(2)),
    p95Ms: Number(percentile(sorted, 95).toFixed(2)),
    maxMs: Number(sorted.at(-1).toFixed(2)),
    meanMs: Number(mean.toFixed(2)),
  };
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function createMockResponse() {
  let statusCode = 200;
  let payload;
  let serialized;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      // Include the same JSON serialization work Express performs.
      serialized = JSON.stringify(value);
      return this;
    },
    result() {
      return { statusCode, payload, serialized };
    },
  };
}

async function invokeController(query) {
  const req = {
    query: { tenantId, ...query },
    user: { role: "admin", tenantId },
    scopedTenantId: tenantId,
  };
  const res = createMockResponse();
  await getIdentities(req, res);
  const result = res.result();
  if (result.statusCode !== 200 || !result.payload?.success) {
    throw new Error(`Controller failed (${result.statusCode}): ${result.serialized}`);
  }
  return result;
}

async function benchmarkControllerCase(name, query) {
  for (let i = 0; i < warmupCount; i += 1) await invokeController(query);

  if (global.gc) global.gc();
  const memoryBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const times = [];
  let last;
  for (let i = 0; i < sampleCount; i += 1) {
    const start = process.hrtime.bigint();
    last = await invokeController(query);
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  const cpu = process.cpuUsage(cpuBefore);
  const memoryAfter = process.memoryUsage();
  const rows = last.payload.data || [];
  return {
    name,
    query,
    latency: summarize(times),
    cpuMsPerRequest: {
      user: Number((cpu.user / 1000 / sampleCount).toFixed(2)),
      system: Number((cpu.system / 1000 / sampleCount).toFixed(2)),
    },
    memoryDeltaBytes: {
      rss: memoryAfter.rss - memoryBefore.rss,
      heapUsed: memoryAfter.heapUsed - memoryBefore.heapUsed,
      external: memoryAfter.external - memoryBefore.external,
    },
    status: last.statusCode,
    rows: rows.length,
    listTotal: last.payload.listTotal,
    payloadBytes: Buffer.byteLength(last.serialized),
    orderedIds: rows.map((row) => String(row._id || row.id)),
    payloadHash: stableHash(last.payload),
  };
}

async function explainCase(Identity, name, query) {
  const filter = { tenantId: tid };
  if (query.lifecycleState && query.lifecycleState !== "ALL") {
    filter.lifecycleState = query.lifecycleState;
  }
  const textSearch = buildIdentityTextSearchFilter(query.search || query.q || "");
  if (textSearch) Object.assign(filter, textSearch);
  const sort = buildIdentityListSort(query.sortBy, query.sortDir);
  const page = Math.max(0, Number(query.page) || 0);
  const limit = Math.min(2000, Math.max(1, Number(query.limit) || 10));

  const [listPlan, countPlan] = await Promise.all([
    Identity.find(filter)
      .sort(sort)
      .skip(page * limit)
      .limit(limit)
      .select("_id displayName email employeeId managerId attributes lifecycleState")
      .lean()
      .explain("executionStats"),
    Identity.collection.countDocuments(filter, { explain: true }).catch(() => null),
  ]);

  const stats = listPlan.executionStats || {};
  const planText = JSON.stringify(listPlan.queryPlanner?.winningPlan || {});
  const indexNames = [...planText.matchAll(/"indexName":"([^"]+)"/g)].map((match) => match[1]);
  return {
    name,
    filter: JSON.parse(JSON.stringify(filter)),
    sort,
    page,
    limit,
    list: {
      executionTimeMillis: stats.executionTimeMillis,
      totalKeysExamined: stats.totalKeysExamined,
      totalDocsExamined: stats.totalDocsExamined,
      nReturned: stats.nReturned,
      indexNames: [...new Set(indexNames)],
      hasBlockingSort: planText.includes('"stage":"SORT"'),
      winningPlan: listPlan.queryPlanner?.winningPlan,
      rejectedPlans: listPlan.queryPlanner?.rejectedPlans?.length || 0,
    },
    count: countPlan
      ? {
          executionTimeMillis: countPlan.executionStats?.executionTimeMillis,
          totalKeysExamined: countPlan.executionStats?.totalKeysExamined,
          totalDocsExamined: countPlan.executionStats?.totalDocsExamined,
          nReturned: countPlan.executionStats?.nReturned,
        }
      : null,
  };
}

await mongoose.connect(uri, {
  dbName,
  serverSelectionTimeoutMS: 60_000,
  maxPoolSize: 10,
});

try {
  const Identity = await getDynamicIdentityModelForTenantId(tid);
  const sample = await Identity.findOne({ tenantId: tid })
    .select("displayName firstName lastName email employeeId attributes lifecycleState")
    .lean();
  const firstAttribute = Object.entries(sample?.attributes || {}).find(
    ([, value]) => ["string", "number", "boolean"].includes(typeof value) && String(value).trim(),
  );
  const profiles = await mongoose.connection.db
    .collection("identity_profiles")
    .find({ tenantId: tid })
    .project({ attributeMappings: 1 })
    .toArray();
  const mappedFieldsParam = [
    ...new Set(
      profiles.flatMap((profile) =>
        (profile.attributeMappings || [])
          .map((mapping) => mapping.targetKey)
          .filter(Boolean),
      ),
    ),
  ].join(",");
  const firstName = String(sample?.firstName || sample?.displayName || "").trim().split(/\s+/)[0];
  const secondWord = String(sample?.lastName || sample?.displayName || "").trim().split(/\s+/).at(-1);

  const cases = [
    ["default-page-10", { page: 0, limit: 10, sortBy: "displayName", sortDir: "asc" }],
    ["default-page-25", { page: 0, limit: 25, sortBy: "displayName", sortDir: "asc" }],
    ["default-page-100", { page: 0, limit: 100, sortBy: "displayName", sortDir: "asc" }],
    ["page-1", { page: 1, limit: 10, sortBy: "displayName", sortDir: "asc" }],
    ["deep-page", { page: 400, limit: 10, sortBy: "displayName", sortDir: "asc" }],
    ["display-name-desc", { page: 0, limit: 10, sortBy: "displayName", sortDir: "desc" }],
    ["email-sort", { page: 0, limit: 10, sortBy: "email", sortDir: "asc" }],
    ["employee-id-sort", { page: 0, limit: 10, sortBy: "employeeId", sortDir: "asc" }],
    ["updated-sort", { page: 0, limit: 10, sortBy: "updatedAt", sortDir: "desc" }],
    ["lifecycle-active", { page: 0, limit: 10, lifecycleState: "ACTIVE", sortBy: "displayName", sortDir: "asc" }],
    ["exact-search", { page: 0, limit: 10, search: String(sample?.email || firstName), sortBy: "displayName", sortDir: "asc" }],
    ["broad-search", { page: 0, limit: 10, search: "a", sortBy: "displayName", sortDir: "asc" }],
    ["no-result-search", { page: 0, limit: 10, search: "__PERF_NO_MATCH_7f54__", sortBy: "displayName", sortDir: "asc" }],
  ];
  if (mappedFieldsParam) {
    cases.splice(1, 0, [
      "compact-default-page-10",
      {
        page: 0,
        limit: 10,
        sortBy: "displayName",
        sortDir: "asc",
        fields: mappedFieldsParam,
      },
    ]);
  }
  if (firstName && secondWord && firstName !== secondWord) {
    cases.push(["multiword-search", { page: 0, limit: 10, search: `${firstName} ${secondWord}`, sortBy: "displayName", sortDir: "asc" }]);
  }
  if (firstAttribute) {
    cases.push(["attribute-search", { page: 0, limit: 10, search: String(firstAttribute[1]), sortBy: "displayName", sortDir: "asc" }]);
    cases.push(["attribute-sort", { page: 0, limit: 10, sortBy: firstAttribute[0], sortDir: "asc" }]);
  }

  const controller = [];
  for (const [name, query] of cases) {
    console.log(`Benchmarking ${name}...`);
    controller.push(await benchmarkControllerCase(name, query));
  }

  const explain = [];
  for (const [name, query] of cases) {
    console.log(`Explaining ${name}...`);
    explain.push(await explainCase(Identity, name, query));
  }

  const indexes = await Identity.collection.indexes();
  const output = {
    phase,
    measuredAt: new Date().toISOString(),
    dbName,
    tenantId,
    collection: Identity.collection.name,
    identityCount: await Identity.countDocuments({ tenantId: tid }),
    samplesPerCase: sampleCount,
    warmupsPerCase: warmupCount,
    node: process.version,
    indexes,
    controller,
    explain,
  };

  const outputDir = path.join(__dirname, "../docs/identities-performance-v2");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${phase}-benchmark.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
  const primary = controller.find((item) => item.name === "default-page-10");
  const primaryPlan = explain.find((item) => item.name === "default-page-10");
  console.log(JSON.stringify({ primary, primaryPlan: primaryPlan?.list }, null, 2));
} finally {
  await mongoose.disconnect();
}
