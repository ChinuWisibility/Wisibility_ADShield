/**
 * Backfill tenantId on identity_account_links from identities.tenantId.
 *
 * Usage:
 *   node scripts/backfillLinkTenantId.mjs
 *   node scripts/backfillLinkTenantId.mjs --dryRun
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
const dbName = process.env.DB_NAME || "IGA-V3";
const dryRun = process.argv.includes("--dryRun");

if (!uri) {
  console.error("Missing MONGODB_URI");
  process.exit(1);
}

await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 120000 });
const links = mongoose.connection.db.collection("identity_account_links");

const missing = await links.countDocuments({
  isActive: true,
  identityId: { $ne: null },
  $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
});
console.log(`[backfillLinkTenantId] missing tenantId on active links: ${missing} dryRun=${dryRun}`);

if (dryRun) {
  await mongoose.disconnect();
  process.exit(0);
}

if (missing > 0) {
  const batchSize = 2000;
  let updated = 0;
  let processed = 0;

  const cursor = links.aggregate(
    [
      {
        $match: {
          isActive: true,
          identityId: { $ne: null },
          $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
        },
      },
      {
        $lookup: {
          from: "identities",
          localField: "identityId",
          foreignField: "_id",
          as: "idArr",
        },
      },
      { $unwind: { path: "$idArr", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "applications",
          localField: "applicationId",
          foreignField: "_id",
          as: "appArr",
        },
      },
      { $unwind: { path: "$appArr", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          tenantId: { $ifNull: ["$idArr.tenantId", "$appArr.tenantId"] },
        },
      },
      { $match: { tenantId: { $ne: null } } },
    ],
    { allowDiskUse: true, batchSize },
  );

  let ops = [];
  for await (const row of cursor) {
    processed += 1;
    if (!row.tenantId) continue;
    ops.push({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: { tenantId: row.tenantId } },
      },
    });
    if (ops.length >= batchSize) {
      const r = await links.bulkWrite(ops, { ordered: false });
      updated += r.modifiedCount || 0;
      ops = [];
      console.log(`[backfillLinkTenantId] processed=${processed} updated=${updated}`);
    }
  }
  if (ops.length) {
    const r = await links.bulkWrite(ops, { ordered: false });
    updated += r.modifiedCount || 0;
  }
  console.log(`[backfillLinkTenantId] done processed=${processed} updated=${updated}`);
}

await links.createIndex({ tenantId: 1, isActive: 1, updatedAt: -1 });
await links.createIndex({ tenantId: 1, isActive: 1, applicationId: 1, updatedAt: -1 });
console.log("[backfillLinkTenantId] indexes ensured");

const afterMissing = await links.countDocuments({
  isActive: true,
  identityId: { $ne: null },
  $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
});
console.log(`[backfillLinkTenantId] remaining missing: ${afterMissing}`);

await mongoose.disconnect();
process.exit(0);
