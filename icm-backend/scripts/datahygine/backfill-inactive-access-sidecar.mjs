/**
 * One-shot backfill: rebuild inactive-with-access hygiene sidecars for all apps in a tenant
 * (or all tenants when PERF_TENANT_ID / BACKFILL_TENANT_ID is unset and BACKFILL_ALL=1).
 *
 * Usage:
 *   node --env-file=.env scripts/datahygine/backfill-inactive-access-sidecar.mjs
 *   BACKFILL_TENANT_ID=... node --env-file=.env scripts/datahygine/backfill-inactive-access-sidecar.mjs
 */
import "dotenv/config";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import Application from "../../src/models/application/Application.js";
import { getAppUsersCollectionName, resolveTenantSlugFromTenantId } from "../../src/utils/applicationDynamicCollections.js";
import { rebuildInactiveAccessSidecar } from "../../src/services/datahygine/applicationUserInactiveAccessSidecar.js";
import { isInactiveAppUserWithAccess } from "../../src/utils/datahygine/appUserInactiveWithAccess.js";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dbName = process.env.DB_NAME || "IGA-V3";
const tenantFilter = process.env.BACKFILL_TENANT_ID || process.env.PERF_TENANT_ID || "6a1017e7a0e37190d40d8c2b";

if (!uri) {
  console.error("Missing MONGODB_URI");
  process.exit(1);
}

await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 60000 });
const db = mongoose.connection.db;

const apps = await Application.find({ tenantId: new ObjectId(tenantFilter) })
  .select("_id name tenantId")
  .lean();

console.log(`Backfilling inactive-access sidecar for ${apps.length} apps (tenant=${tenantFilter})`);

const INACTIVE_PROJ = {
  status: 1,
  user_status: 1,
  account_status: 1,
  profile_status: 1,
  lifecycleState: 1,
  lifecycle: 1,
  state: 1,
  isActive: 1,
  active: 1,
  enabled: 1,
  accountDisabled: 1,
  locked: 1,
  user_id: 1,
  username: 1,
  email: 1,
  display_name: 1,
  member_of_entitlements: 1,
  entitlements: 1,
  roles: 1,
  groups: 1,
  rawData: 1,
};

for (const app of apps) {
  const slug = await resolveTenantSlugFromTenantId(app.tenantId);
  if (!slug) {
    console.warn(`skip ${app.name}: no tenant slug`);
    continue;
  }
  let usersColl;
  try {
    usersColl = getAppUsersCollectionName(app.name, slug);
  } catch (e) {
    console.warn(`skip ${app.name}: ${e.message}`);
    continue;
  }
  const users = [];
  let hits = 0;
  const cursor = db
    .collection(usersColl)
    .find({ applicationId: app._id })
    .project(INACTIVE_PROJ)
    .batchSize(500);
  for await (const user of cursor) {
    users.push(user);
    if (isInactiveAppUserWithAccess(user)) hits += 1;
  }
  const result = await rebuildInactiveAccessSidecar({
    applicationId: app._id,
    tenantId: app.tenantId,
    users,
  });
  console.log(`${app.name}: users=${users.length} hits=${hits} sidecar=${result.hitCount}`);
}

await mongoose.disconnect();
console.log("Done.");
