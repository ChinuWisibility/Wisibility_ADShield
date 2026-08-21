/**
 * Backfill identity entitlement projection rows for all tenants/applications.
 *
 * Usage:
 *   node scripts/backfillIdentityEntitlements.mjs
 *   node scripts/backfillIdentityEntitlements.mjs --tenantId=<mongoId>
 *   node scripts/backfillIdentityEntitlements.mjs --applicationId=<mongoId>
 *
 * Requires MONGODB_URI (or MONGO_URI / DATABASE_URL) and DB_NAME in .env (default IGA-V3).
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "..", ".env") });
dotenv.config({ path: join(__dirname, "..", "..", ".env") });

const uri =
  process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
const dbName = process.env.DB_NAME || "IGA-V3";

if (!uri) {
  console.error("Missing MONGODB_URI / MONGO_URI / DATABASE_URL");
  process.exit(1);
}

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}

const filterTenantId = argValue("tenantId");
const filterApplicationId = argValue("applicationId");

const { default: Tenant } = await import("../src/models/platform/Tenant.js");
const { default: Application } = await import("../src/models/application/Application.js");
const { syncAllForApplication } = await import(
  "../src/services/identityEntitlementSyncService.js"
);

await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 120000 });
console.log(`[backfillIdentityEntitlements] Connected to MongoDB (${dbName})`);

let tenants = await Tenant.find({}).select("_id name code").lean();
if (filterTenantId) {
  tenants = tenants.filter((t) => String(t._id) === String(filterTenantId));
}

let totalApps = 0;
let okApps = 0;
let failedApps = 0;

for (const tenant of tenants) {
  const appQuery = { tenantId: tenant._id };
  if (filterApplicationId) appQuery._id = filterApplicationId;

  const apps = await Application.find(appQuery).select("_id name tenantId").lean();
  console.log(
    `[backfillIdentityEntitlements] Tenant ${tenant.name || tenant.code} (${tenant._id}): ${apps.length} application(s)`,
  );

  for (const app of apps) {
    totalApps += 1;
    try {
      const result = await syncAllForApplication(app._id);
      okApps += 1;
      const line = `  OK ${app.name} (${app._id}) upserted=${result.upserted} links=${result.linksProcessed ?? 0} identities=${result.authIdentitiesProcessed ?? 0} ms=${result.durationMs}`;
      if (result.upserted === 0 && (result.authIdentitiesProcessed ?? 0) > 0) {
        console.log(
          `${line} — auth-source identities matched; if upserted=0, run account↔entitlement correlation for this app`,
        );
      } else if (result.linksProcessed === 0 && (result.authIdentitiesProcessed ?? 0) === 0) {
        console.log(
          `${line} — no linked accounts; for auth-source apps ensure identity refresh ran from this application`,
        );
      } else {
        console.log(line);
      }
    } catch (err) {
      failedApps += 1;
      console.error(
        `  FAIL ${app.name} (${app._id}): ${err?.message || err}`,
      );
    }
  }
}

console.log(
  `[backfillIdentityEntitlements] Done. apps=${totalApps} ok=${okApps} failed=${failedApps}`,
);

await mongoose.disconnect();
process.exit(failedApps > 0 ? 1 : 0);
