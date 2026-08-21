/**
 * B25 — Verify reviewer routing produces expected reviewerEmail on review items.
 * Usage: node scripts/qa/certReviewerRouting.js <campaignId>
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Campaign from "../../src/models/certification/Campaign.js";
import ReviewItem from "../../src/models/certification/ReviewItem.js";

dotenv.config();

const campaignId = process.argv[2];
if (!campaignId) {
  console.error("Usage: node scripts/qa/certReviewerRouting.js <campaignId>");
  process.exit(1);
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(uri);

  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign) {
    console.error("Campaign not found");
    process.exit(1);
  }

  const routing = String(campaign.reviewerRoutingMode || "DEFAULT").toUpperCase();
  const items = await ReviewItem.find({ campaignId }).lean();
  const withReviewer = items.filter((i) => i.reviewerEmail);
  const distinctReviewers = [...new Set(withReviewer.map((i) => i.reviewerEmail.toLowerCase()))];

  console.log("[B25] Campaign:", campaign.name);
  console.log("[B25] Routing mode:", routing);
  console.log("[B25] Total items:", items.length);
  console.log("[B25] Items with reviewerEmail:", withReviewer.length);
  console.log("[B25] Distinct reviewers:", distinctReviewers.length);
  if (campaign.backupManagerReviewerEmail) {
    console.log("[B25] Backup reviewer:", campaign.backupManagerReviewerEmail);
  }

  await mongoose.disconnect();
  process.exit(withReviewer.length > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
