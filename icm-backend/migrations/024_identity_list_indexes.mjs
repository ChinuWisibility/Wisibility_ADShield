/**
 * Adds the measured All Identities list indexes to every existing identity
 * shard. Uses targeted createIndex calls so unrelated indexes are never
 * dropped (unlike syncIndexes).
 */
import mongoose from "mongoose";

export const IDENTITY_LIST_INDEXES = [
  {
    key: { tenantId: 1, displayName: 1, _id: 1 },
    name: "tenantId_1_displayName_1__id_1",
  },
  {
    key: { tenantId: 1, displayName: -1, _id: 1 },
    name: "tenantId_1_displayName_-1__id_1",
  },
  {
    key: { tenantId: 1, lifecycleState: 1, displayName: 1, _id: 1 },
    name: "tenantId_1_lifecycleState_1_displayName_1__id_1",
  },
  {
    key: { tenantId: 1, updatedAt: -1, _id: 1 },
    name: "tenantId_1_updatedAt_-1__id_1",
  },
];

export default async function migrateIdentityListIndexes() {
  const db = mongoose.connection.db;
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const identityCollections = collections
    .map(({ name }) => name)
    .filter((name) => name === "identities" || /^app_.+_identities$/.test(name));

  const failures = [];
  let created = 0;
  for (const collectionName of identityCollections) {
    const collection = db.collection(collectionName);
    for (const { key, name } of IDENTITY_LIST_INDEXES) {
      try {
        await collection.createIndex(key, { name, background: true });
        created += 1;
      } catch (error) {
        failures.push({
          collection: collectionName,
          index: name,
          message: error?.message || String(error),
        });
      }
    }
  }

  if (failures.length > 0) {
    const detail = failures
      .map((failure) => `${failure.collection}/${failure.index}: ${failure.message}`)
      .join("\n");
    throw new Error(`Identity list index migration failed:\n${detail}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[024_identity_list_indexes] ensured ${created} index(es) across ${identityCollections.length} collection(s)`,
  );
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
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
    await migrateIdentityListIndexes();
  } finally {
    await mongoose.disconnect();
  }
}
