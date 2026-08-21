/**
 * Backfill manager-mismatch hygiene sidecars for all apps in a tenant.
 *
 * Usage:
 *   BACKFILL_TENANT_ID=... node --env-file=.env scripts/datahygine/backfill-manager-mismatch-sidecar.mjs
 */
import "dotenv/config";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { rebuildManagerMismatchSidecarsForTenant } from "../../src/services/datahygine/applicationManagerMismatchSidecar.js";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dbName = process.env.DB_NAME || "IGA-V3";
const tenantFilter =
  process.env.BACKFILL_TENANT_ID || process.env.PERF_TENANT_ID || "6a1017e7a0e37190d40d8c2b";

if (!uri) {
  console.error("Missing MONGODB_URI");
  process.exit(1);
}

await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 60000 });
console.log(`Backfilling manager-mismatch sidecar for tenant=${tenantFilter}`);
const result = await rebuildManagerMismatchSidecarsForTenant(new ObjectId(tenantFilter));
console.log(JSON.stringify(result, null, 2));
await mongoose.disconnect();
console.log("Done.");
