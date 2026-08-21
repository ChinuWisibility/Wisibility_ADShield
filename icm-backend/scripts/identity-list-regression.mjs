/**
 * Live-data semantic regression for the All Identities compact list path.
 * It is read-only: no identities are created, changed, or deleted.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { getIdentities } from "../src/controllers/identity/identityController.js";
import { getIdentityValueByTargetKey } from "../../icm-frontend/src/utils/identityMappedValues.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tenantId = process.env.PERF_TENANT_ID || "69fc1bda8ea4655d5c93b8eb";
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dbName = process.env.DB_NAME || "IGA-V3";
if (!uri) throw new Error("MONGODB_URI or MONGO_URI is required");

function createResponse() {
  let statusCode = 200;
  let body;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
    result() {
      return { statusCode, body };
    },
  };
}

async function call(query, auth = {}) {
  const scopedTenantId = Object.prototype.hasOwnProperty.call(auth, "scopedTenantId")
    ? auth.scopedTenantId
    : tenantId;
  const req = {
    query: { tenantId, ...query },
    user: auth.user || { role: "admin", tenantId: scopedTenantId },
    scopedTenantId,
  };
  const res = createResponse();
  await getIdentities(req, res);
  return res.result();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 60_000 });

try {
  const tid = new mongoose.Types.ObjectId(tenantId);
  const profiles = await mongoose.connection.db
    .collection("identity_profiles")
    .find({ tenantId: tid })
    .project({ attributeMappings: 1 })
    .toArray();
  const fields = [
    ...new Set(
      profiles.flatMap((profile) =>
        (profile.attributeMappings || [])
          .map((mapping) => mapping.targetKey)
          .filter(Boolean),
      ),
    ),
  ];
  const fieldsParam = fields.join(",");

  const cases = [
    ["default", { page: 0, limit: 10, sortBy: "displayName", sortDir: "asc" }],
    ["page-1", { page: 1, limit: 10, sortBy: "displayName", sortDir: "asc" }],
    ["display-desc", { page: 0, limit: 25, sortBy: "displayName", sortDir: "desc" }],
    ["email", { page: 0, limit: 25, sortBy: "email", sortDir: "asc" }],
    ["employee-id", { page: 0, limit: 25, sortBy: "employeeId", sortDir: "desc" }],
    ["lifecycle", { page: 0, limit: 25, lifecycleState: "ACTIVE", sortBy: "displayName", sortDir: "asc" }],
    ["exact-search", { page: 0, limit: 10, search: "aarav.adams@wisibility.lcl", sortBy: "displayName", sortDir: "asc" }],
    ["multiword-search", { page: 0, limit: 10, search: "aarav adams", sortBy: "displayName", sortDir: "asc" }],
    ["escaped-search", { page: 0, limit: 10, search: "a+b", sortBy: "displayName", sortDir: "asc" }],
    ["no-result", { page: 0, limit: 10, search: "__NO_MATCH_7f54__", sortBy: "displayName", sortDir: "asc" }],
  ];

  const results = [];
  for (const [name, query] of cases) {
    const [full, compact] = await Promise.all([
      call(query),
      call({ ...query, fields: fieldsParam }),
    ]);
    assert(full.statusCode === 200, `${name}: full request failed`);
    assert(compact.statusCode === 200, `${name}: compact request failed`);
    assert(full.body.listTotal === compact.body.listTotal, `${name}: listTotal changed`);
    assert(full.body.count === compact.body.count, `${name}: count changed`);
    assert(JSON.stringify(full.body.stats) === JSON.stringify(compact.body.stats), `${name}: stats changed`);

    const fullIds = full.body.data.map((row) => String(row._id));
    const compactIds = compact.body.data.map((row) => String(row._id));
    assert(JSON.stringify(fullIds) === JSON.stringify(compactIds), `${name}: row order changed`);

    let mappedValueChecks = 0;
    for (let index = 0; index < full.body.data.length; index += 1) {
      for (const field of fields) {
        const expected = getIdentityValueByTargetKey(full.body.data[index], field);
        const actual = getIdentityValueByTargetKey(compact.body.data[index], field);
        assert(expected === actual, `${name}: ${field} changed at row ${index}`);
        mappedValueChecks += 1;
      }
    }

    results.push({
      name,
      rows: full.body.count,
      listTotal: full.body.listTotal,
      orderedIdsEqual: true,
      mappedValueChecks,
      fullBytes: Buffer.byteLength(JSON.stringify(full.body)),
      compactBytes: Buffer.byteLength(JSON.stringify(compact.body)),
    });
  }

  const page0 = await call({ page: 0, limit: 100, sortBy: "displayName", sortDir: "asc" });
  const page1 = await call({ page: 1, limit: 100, sortBy: "displayName", sortDir: "asc" });
  const firstIds = new Set(page0.body.data.map((row) => String(row._id)));
  const overlap = page1.body.data.filter((row) => firstIds.has(String(row._id)));
  assert(overlap.length === 0, "Adjacent pages contain duplicate identities");

  const qAlias = await call({
    page: 0,
    limit: 10,
    q: "aarav adams",
    sortBy: "displayName",
    sortDir: "asc",
  });
  const searchAlias = await call({
    page: 0,
    limit: 10,
    search: "aarav adams",
    sortBy: "displayName",
    sortDir: "asc",
  });
  assert(
    JSON.stringify(qAlias.body.data.map((row) => String(row._id))) ===
      JSON.stringify(searchAlias.body.data.map((row) => String(row._id))),
    "q and search aliases differ",
  );

  const otherTenant = await mongoose.connection.db
    .collection("tenants")
    .findOne({ _id: { $ne: tid } }, { projection: { _id: 1 } });
  const tenantOverride = await call(
    {
      tenantId: String(otherTenant?._id || tid),
      page: 0,
      limit: 10,
      sortBy: "displayName",
      sortDir: "asc",
    },
    {
      scopedTenantId: tenantId,
      user: { role: "admin", tenantId },
    },
  );
  assert(
    tenantOverride.body.data.every((row) => String(row.tenantId) === tenantId),
    "Tenant-bound request escaped its scoped tenant",
  );

  const platformRead = await call(
    {
      page: 0,
      limit: 10,
      sortBy: "displayName",
      sortDir: "asc",
    },
    {
      scopedTenantId: null,
      user: { role: "superAdmin", tenantId: null },
    },
  );
  assert(platformRead.statusCode === 200, "Platform read failed");
  assert(
    JSON.stringify(platformRead.body.data.map((row) => String(row._id))) ===
      JSON.stringify(page0.body.data.slice(0, 10).map((row) => String(row._id))),
    "Platform tenant-targeted read changed row order",
  );

  const output = {
    measuredAt: new Date().toISOString(),
    tenantId,
    dbName,
    mappedFields: fields,
    cases: results,
    adjacentPageOverlap: overlap.length,
    searchAliasesEqual: true,
    tenantOverrideBlocked: true,
    platformReadEqual: true,
    passed: true,
  };
  const outputDir = path.join(__dirname, "../docs/identities-performance-v2");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "regression-results.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
} finally {
  await mongoose.disconnect();
}
