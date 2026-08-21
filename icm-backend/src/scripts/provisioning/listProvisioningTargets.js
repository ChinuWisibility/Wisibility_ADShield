/**
 * List which of a tenant's applications can actually be provisioned into.
 *
 * Usage:
 *   node src/scripts/provisioning/listProvisioningTargets.js "Test Tenant"
 *
 * Read-only.
 */

import "dotenv/config";
import mongoose from "mongoose";
import Tenant from "../../models/platform/Tenant.js";
import Application from "../../models/application/Application.js";
import { resolveConnectorFamily } from "../../services/provisioning/provisioningCapabilityCatalog.js";

async function main() {
  const tenantName = process.argv[2] || "Test Tenant";
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.DB_NAME || undefined,
  });

  const tenant = await Tenant.findOne({
    $or: [{ name: tenantName }, { code: tenantName }],
  }).lean();
  if (!tenant) throw new Error(`No tenant named "${tenantName}"`);

  const apps = await Application.find({ tenantId: tenant._id })
    .select("name status connectorType connectionConfig userMappings")
    .lean();

  console.log(`\nApplications in "${tenantName}" (${apps.length})\n`);
  for (const app of apps) {
    const family = resolveConnectorFamily(app);
    const csv =
      family === "file_delimited" || app.connectionConfig?.provisioningTestMode === "csv";
    const ad = family === "ldap_ad" || Boolean(app.connectionConfig?.ad);
    const verdict = csv ? "CSV connector" : ad ? "AD connector" : "NOT PROVISIONABLE";
    console.log(
      `  ${verdict.padEnd(18)} ${String(app.name).padEnd(28)} `
      + `status=${app.status || "?"} connectorType=${app.connectorType || "none"} `
      + `family=${family} mappings=${app.userMappings?.length || 0}`,
    );
    console.log(`  ${" ".repeat(18)} id=${app._id}`);
  }
  console.log("");

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
