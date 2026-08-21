import mongoose from "mongoose";
import dotenv from "dotenv";

import migrateAccessCertification from "./001_accessCertification.mjs";
import migrateAccessIntelligence from "./002_accessIntelligence.mjs";
import migrateEntitlementAccount from "./003_entitlementAccount.mjs";
import migrateIdentity from "./004_identity.mjs";
import ensureIndexes from "./010_indexes.mjs";
import migrateEscalationIds from "./011_escalationIdFix.mjs";
import validateData from "./020_validateData.mjs";
import backfillTenantIds from "./021_backfillTenantIds.mjs";
import backfillSodPolicyIds from "./022_backfillSodPolicyIds.mjs";
import migrateReconciliationIndexes from "./023_reconciliation_indexes.mjs";
import migrateIdentityListIndexes from "./024_identity_list_indexes.mjs";
import migrateOrphanAccountIdentity from "./025_orphan_account_identity.mjs";

dotenv.config();

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    // eslint-disable-next-line no-console
    console.error("MONGO_URI / MONGODB_URI not set; cannot run migrations.");
    process.exit(1);
  }

  await mongoose.connect(mongoUri, {
    maxPoolSize: 5,
  });

  try {
    // Domain migrations in dependency order
    await migrateEntitlementAccount();
    await migrateIdentity();
    await migrateAccessIntelligence();
    await migrateAccessCertification();
    await backfillTenantIds();
    await backfillSodPolicyIds();
    await migrateReconciliationIndexes();
    await migrateIdentityListIndexes();
    // Must run before OrphanAccount.syncIndexes() so the unique corr-key index is dropped first.
    await migrateOrphanAccountIdentity();

    // Indexes and validation
    await ensureIndexes();
    await migrateEscalationIds();
    await validateData();
  } finally {
    await mongoose.disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // eslint-disable-next-line no-console
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Migration failed", err);
    process.exit(1);
  });
}
