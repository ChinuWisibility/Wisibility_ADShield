/**
 * Rollback for 025_orphan_account_identity.
 *
 * Restores orphan_accounts from orphan_accounts_backup_025 and reinstates the
 * pre-fix UNIQUE sparse (applicationId, correlationKey) index ONLY when the
 * restored data has no duplicate correlation keys (otherwise restore would fail).
 *
 * WARNING: Rolling back AFTER a successful correlation replay that created
 * multiple orphans sharing a correlationKey will fail index recreation until
 * those duplicates are collapsed. Prefer restoring from the backup collection
 * (which predates the split) rather than rolling indexes alone.
 *
 * Usage:
 *   node migrations/025_orphan_account_identity.rollback.mjs --dry-run
 *   node migrations/025_orphan_account_identity.rollback.mjs --confirm
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import {
  MIGRATION_ID,
  SOURCE_COLLECTION,
  BACKUP_COLLECTION,
  MARKER_COLLECTION,
} from "./025_orphan_account_identity.mjs";

dotenv.config();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const confirm = process.argv.includes("--confirm");
  if (!dryRun && !confirm) {
    console.error("Refusing to run without --dry-run or --confirm");
    process.exit(1);
  }

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("MONGO_URI / MONGODB_URI not set");
    process.exit(1);
  }

  await mongoose.connect(mongoUri, {
    dbName: process.env.DB_NAME || "IGA-V3",
    maxPoolSize: 5,
  });

  try {
    const db = mongoose.connection.db;
    const hasBackup = await db.listCollections({ name: BACKUP_COLLECTION }).hasNext();
    if (!hasBackup) {
      throw new Error(`Backup collection ${BACKUP_COLLECTION} not found — cannot rollback safely`);
    }

    const backup = db.collection(BACKUP_COLLECTION);
    const backupCount = await backup.estimatedDocumentCount();

    // Detect whether backup can accept unique correlationKey again.
    const dupKeys = await backup
      .aggregate([
        {
          $group: {
            _id: { applicationId: "$applicationId", correlationKey: "$correlationKey" },
            n: { $sum: 1 },
          },
        },
        { $match: { n: { $gt: 1 }, "_id.correlationKey": { $ne: null } } },
        { $limit: 5 },
      ])
      .toArray();

    const summary = {
      dryRun,
      backupCollection: BACKUP_COLLECTION,
      backupCount,
      duplicateCorrelationKeysInBackup: dupKeys.length,
      canRestoreUniqueCorrKeyIndex: dupKeys.length === 0,
    };

    if (dryRun) {
      console.log(`[${MIGRATION_ID} rollback] dry-run`, JSON.stringify(summary, null, 2));
      return;
    }

    // Replace live collection from backup via $out to a temp name, then rename.
    const tempName = `${SOURCE_COLLECTION}_rollback_tmp`;
    const existingTemp = await db.listCollections({ name: tempName }).hasNext();
    if (existingTemp) {
      await db.collection(tempName).drop();
    }
    await backup.aggregate([{ $match: {} }, { $out: tempName }]).toArray();

    const liveExists = await db.listCollections({ name: SOURCE_COLLECTION }).hasNext();
    if (liveExists) {
      await db.collection(SOURCE_COLLECTION).drop();
    }
    await db.renameCollection(tempName, SOURCE_COLLECTION);

    const col = db.collection(SOURCE_COLLECTION);
    // Ensure account uniqueness (correct identity — keep even on rollback of corr-key constraint).
    try {
      await col.createIndex(
        { applicationId: 1, accountId: 1 },
        { name: "applicationId_1_accountId_1", unique: true, background: true },
      );
    } catch (e) {
      console.warn("[rollback] account unique index:", e.message);
    }

    // Drop any non-unique corr-key index, then restore unique sparse if backup allows.
    const indexes = await col.indexes();
    const corr = indexes.find((i) => i.name === "applicationId_1_correlationKey_1");
    if (corr) {
      await col.dropIndex("applicationId_1_correlationKey_1");
    }

    if (dupKeys.length === 0) {
      await col.createIndex(
        { applicationId: 1, correlationKey: 1 },
        {
          name: "applicationId_1_correlationKey_1",
          unique: true,
          sparse: true,
          background: true,
        },
      );
      summary.corrKeyIndex = "restored_unique_sparse";
    } else {
      await col.createIndex(
        { applicationId: 1, correlationKey: 1 },
        { name: "applicationId_1_correlationKey_1", background: true },
      );
      summary.corrKeyIndex = "kept_non_unique_due_to_duplicates_in_backup";
    }

    await db.collection(MARKER_COLLECTION).updateOne(
      { _id: MIGRATION_ID },
      {
        $set: {
          status: "rolled_back",
          rolledBackAt: new Date(),
          updatedAt: new Date(),
          rollbackSummary: summary,
        },
        $unset: { completedAt: "" },
      },
      { upsert: true },
    );

    console.log(`[${MIGRATION_ID} rollback] completed`, JSON.stringify(summary, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(`[${MIGRATION_ID} rollback] failed`, err);
  process.exit(1);
});
