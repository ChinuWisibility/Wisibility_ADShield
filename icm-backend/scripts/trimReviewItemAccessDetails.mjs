/**
 * One-off maintenance: trim ReviewItem.itemAccessDetails for ACCESS_ITEMS / ROLE_COMPOSITION
 * campaigns so stored details align with campaign.selectedIds (normalized labels).
 *
 * Usage:
 *   node scripts/trimReviewItemAccessDetails.mjs           # dry-run, logs counts
 *   node scripts/trimReviewItemAccessDetails.mjs --apply # writes updates
 *
 * Requires MONGO_URI (or DATABASE_URL) in .env at repo root or icm-backend.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "..", ".env") });
dotenv.config({ path: join(__dirname, "..", "..", ".env") });

const uri = process.env.MONGO_URI || process.env.DATABASE_URL || process.env.MONGODB_URI;
if (!uri) {
  console.error("Missing MONGO_URI / DATABASE_URL / MONGODB_URI");
  process.exit(1);
}

const { normalizeAccessDisplayLabel } = await import(
  "../src/utils/accessMemberOfTokens.js"
);

function normLabel(s) {
  return normalizeAccessDisplayLabel(String(s || "").trim()).toLowerCase();
}

async function main() {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(uri);

  const Campaign = mongoose.connection.collection("access_certification_campaigns");
  const ReviewItem = mongoose.connection.collection("review_items");

  const cursor = Campaign.find(
    { category: { $in: ["ACCESS_ITEMS", "ROLE_COMPOSITION"] } },
    { projection: { _id: 1, selectedIds: 1 } },
  );

  let campaigns = 0;
  let reviewItemsScanned = 0;
  let reviewItemsWouldChange = 0;
  let reviewItemsUpdated = 0;

  for await (const c of cursor) {
    campaigns += 1;
    const selectedSet = new Set();
    for (const sid of c.selectedIds || []) {
      const n = normLabel(sid);
      if (n) selectedSet.add(n);
    }
    if (selectedSet.size === 0) continue;

    const items = await ReviewItem.find(
      { campaignId: c._id },
      { projection: { itemAccessDetails: 1 } },
    ).toArray();

    for (const ri of items) {
      reviewItemsScanned += 1;
      const raw = Array.isArray(ri.itemAccessDetails) ? ri.itemAccessDetails : [];
      const filtered = raw.filter((d) => {
        const n = normLabel(d);
        if (!n) return false;
        if (selectedSet.has(n)) return true;
        for (const s of selectedSet) {
          if (n === s || n.includes(s) || s.includes(n)) return true;
        }
        return false;
      });
      if (filtered.length === raw.length) continue;
      reviewItemsWouldChange += 1;
      if (apply) {
        await ReviewItem.updateOne(
          { _id: ri._id },
          { $set: { itemAccessDetails: filtered } },
        );
        reviewItemsUpdated += 1;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        campaignsScanned: campaigns,
        reviewItemsScanned,
        reviewItemsWouldChange,
        reviewItemsUpdated: apply ? reviewItemsUpdated : 0,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
