/**
 * Backfill status-mismatch hygiene sidecars for non-authoritative apps in a tenant.
 *
 * Usage:
 *   BACKFILL_TENANT_ID=... node --env-file=.env scripts/datahygine/backfill-status-mismatch-sidecar.mjs
 */
import "dotenv/config";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { rebuildStatusMismatchSidecarsForTenant } from "../../src/services/datahygine/applicationStatusMismatchSidecar.js";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dbName = process.env.DB_NAME || "IGA-V3";
const tenantFilter =
  process.env.BACKFILL_TENANT_ID || process.env.PERF_TENANT_ID || "6a1017e7a0e37190d40d8c2b";

if (!uri) {
  console.error("Missing MONGODB_URI");
  process.exit(1);
}

await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 60000 });
console.log(`Backfilling status-mismatch sidecar for tenant=${tenantFilter}`);
const result = await rebuildStatusMismatchSidecarsForTenant(new ObjectId(tenantFilter));
console.log(JSON.stringify(result, null, 2));
await mongoose.disconnect();
console.log("Done.");
