/**
 * 025 — Orphan account identity index migration
 *
 * Problem:
 *   Live MongoDB enforces UNIQUE (applicationId, correlationKey), which collapses
 *   multiple unmatched accounts that share a correlation attribute value into one
 *   orphan document (overwrite on upsert).
 *
 * Fix:
 *   1. Backup orphan_accounts (idempotent).
 *   2. Ensure UNIQUE (applicationId, accountId) — document identity.
 *   3. Drop unique (applicationId, correlationKey) and recreate as NON-UNIQUE.
 *
 * Idempotent: safe to re-run. Does not rewrite orphan documents (replay script does).
 * Rollback: see 025_orphan_account_identity.rollback.mjs
 *
 * Usage:
 *   node migrations/025_orphan_account_identity.mjs
 *   node migrations/025_orphan_account_identity.mjs --dry-run
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { pathToFileURL } from "url";

dotenv.config();

export const MIGRATION_ID = "025_orphan_account_identity";
export const SOURCE_COLLECTION = "orphan_accounts";
export const BACKUP_COLLECTION = "orphan_accounts_backup_025";
export const MARKER_COLLECTION = "_schema_migrations";

const ACCOUNT_UNIQUE_INDEX = {
  key: { applicationId: 1, accountId: 1 },
  name: "applicationId_1_accountId_1",
  unique: true,
};

const CORRELATION_KEY_INDEX = {
  key: { applicationId: 1, correlationKey: 1 },
  name: "applicationId_1_correlationKey_1",
  unique: false,
};

function isDryRun(argv = process.argv) {
  return argv.includes("--dry-run");
}

async function ensureMigrationMarker(db, { dryRun }) {
  const markers = db.collection(MARKER_COLLECTION);
  const existing = await markers.findOne({ _id: MIGRATION_ID });
  if (existing?.completedAt) {
    return { alreadyComplete: true, marker: existing };
  }
  if (!dryRun) {
    await markers.updateOne(
      { _id: MIGRATION_ID },
      {
        $setOnInsert: { startedAt: new Date() },
        $set: { status: "in_progress", updatedAt: new Date() },
      },
      { upsert: true },
    );
  }
  return { alreadyComplete: false, marker: existing };
}

async function markComplete(db, summary) {
  await db.collection(MARKER_COLLECTION).updateOne(
    { _id: MIGRATION_ID },
    {
      $set: {
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
        summary,
      },
    },
    { upsert: true },
  );
}

async function backupOrphanAccounts(db, { dryRun }) {
  const source = db.collection(SOURCE_COLLECTION);
  const existingBackup = await db.listCollections({ name: BACKUP_COLLECTION }).hasNext();

  if (existingBackup) {
    const backupCount = await db.collection(BACKUP_COLLECTION).estimatedDocumentCount();
    return {
      action: "skipped_existing_backup",
      backupCollection: BACKUP_COLLECTION,
      backupCount,
    };
  }

  const sourceCount = await source.estimatedDocumentCount();
  if (dryRun) {
    return {
      action: "would_backup",
      backupCollection: BACKUP_COLLECTION,
      sourceCount,
    };
  }

  // Aggregate $out creates the backup collection atomically from a snapshot read.
  await source.aggregate([{ $match: {} }, { $out: BACKUP_COLLECTION }]).toArray();
  const backupCount = await db.collection(BACKUP_COLLECTION).estimatedDocumentCount();
  return {
    action: "backed_up",
    backupCollection: BACKUP_COLLECTION,
    sourceCount,
    backupCount,
  };
}

async function ensureAccountUniqueIndex(col, { dryRun }) {
  const indexes = await col.indexes();
  const existing = indexes.find((i) => i.name === ACCOUNT_UNIQUE_INDEX.name);
  if (existing?.unique === true) {
    return { action: "exists", name: ACCOUNT_UNIQUE_INDEX.name, unique: true };
  }
  if (dryRun) {
    return { action: "would_create", ...ACCOUNT_UNIQUE_INDEX };
  }
  if (existing) {
    await col.dropIndex(ACCOUNT_UNIQUE_INDEX.name);
  }
  await col.createIndex(ACCOUNT_UNIQUE_INDEX.key, {
    name: ACCOUNT_UNIQUE_INDEX.name,
    unique: true,
    background: true,
  });
  return { action: existing ? "recreated_unique" : "created", ...ACCOUNT_UNIQUE_INDEX };
}

async function fixCorrelationKeyIndex(col, { dryRun }) {
  const indexes = await col.indexes();
  const existing = indexes.find((i) => i.name === CORRELATION_KEY_INDEX.name);

  if (existing && existing.unique !== true) {
    return {
      action: "exists_non_unique",
      name: CORRELATION_KEY_INDEX.name,
      unique: false,
      sparse: Boolean(existing.sparse),
    };
  }

  if (dryRun) {
    return {
      action: existing ? "would_drop_unique_and_recreate" : "would_create_non_unique",
      name: CORRELATION_KEY_INDEX.name,
      previousUnique: existing?.unique === true,
    };
  }

  if (existing) {
    await col.dropIndex(CORRELATION_KEY_INDEX.name);
  }
  await col.createIndex(CORRELATION_KEY_INDEX.key, {
    name: CORRELATION_KEY_INDEX.name,
    background: true,
  });
  return {
    action: existing ? "dropped_unique_recreated_non_unique" : "created_non_unique",
    name: CORRELATION_KEY_INDEX.name,
    unique: false,
  };
}

export default async function migrateOrphanAccountIdentity(options = {}) {
  const dryRun = options.dryRun ?? isDryRun();
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }

  const marker = await ensureMigrationMarker(db, { dryRun });
  if (marker.alreadyComplete && !options.force) {
    // eslint-disable-next-line no-console
    console.log(`[${MIGRATION_ID}] already completed at ${marker.marker.completedAt}`);
    return { skipped: true, reason: "already_completed", marker: marker.marker };
  }

  const collections = await db.listCollections({ name: SOURCE_COLLECTION }).toArray();
  if (collections.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[${MIGRATION_ID}] ${SOURCE_COLLECTION} missing — nothing to migrate`);
    if (!dryRun) {
      await markComplete(db, { note: "source_collection_missing" });
    }
    return { skipped: true, reason: "source_missing" };
  }

  const col = db.collection(SOURCE_COLLECTION);
  const backup = await backupOrphanAccounts(db, { dryRun });
  const accountIndex = await ensureAccountUniqueIndex(col, { dryRun });
  const corrKeyIndex = await fixCorrelationKeyIndex(col, { dryRun });

  const summary = {
    dryRun,
    backup,
    accountIndex,
    corrKeyIndex,
    indexesAfter: dryRun ? null : await col.indexes(),
  };

  if (!dryRun) {
    await markComplete(db, summary);
  }

  // eslint-disable-next-line no-console
  console.log(`[${MIGRATION_ID}] ${dryRun ? "dry-run" : "completed"}`, JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
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
    await migrateOrphanAccountIdentity({ force: process.argv.includes("--force") });
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[${MIGRATION_ID}] failed`, err);
    process.exit(1);
  });
}
