/**
 * Ensures reconciliation collection indexes for all applications.
 * Collections are created lazily on first reconciliation run; this migration
 * pre-creates indexes when collections already exist.
 */
import mongoose from "mongoose";
import Application from "../src/models/application/Application.js";
import {
  resolveTenantSlugFromTenantId,
  ensureReconciliationIndexes,
} from "../src/utils/applicationDynamicCollections.js";

export default async function migrateReconciliationIndexes() {
  const apps = await Application.find({}).select("name tenantId").lean();
  let ensured = 0;
  for (const app of apps) {
    const tenantSlug = await resolveTenantSlugFromTenantId(app.tenantId);
    if (!tenantSlug) continue;
    try {
      await ensureReconciliationIndexes(app.name, tenantSlug);
      ensured += 1;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `[023_reconciliation_indexes] ${app.name}: ${e?.message || e}`,
      );
    }
  }
  // eslint-disable-next-line no-console
  console.log(`Reconciliation indexes ensured for ${ensured} application(s).`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("MONGO_URI not set");
    process.exit(1);
  }
  await mongoose.connect(mongoUri);
  try {
    await migrateReconciliationIndexes();
  } finally {
    await mongoose.disconnect();
  }
}
