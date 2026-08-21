/**
 * Smoke test notification data for named campaigns (if present in DB).
 * Run: node scripts/qa/smokeCampaignNotifications.js
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Campaign from "../../src/models/certification/Campaign.js";
import {
  getCampaignNotificationSummary,
  getCampaignNotifications,
} from "../../src/services/email/campaignNotificationService.js";

dotenv.config();

const TARGET_NAMES = ["test - 2", "GIT HUB Owner Access"];

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("Set MONGODB_URI");
  await mongoose.connect(uri);

  let anyFound = false;
  let allOk = true;

  for (const name of TARGET_NAMES) {
    const campaign = await Campaign.findOne({
      name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    })
      .select("_id name tenantId")
      .lean();

    if (!campaign) {
      console.log(`[smoke] Campaign not found: "${name}" — skip`);
      continue;
    }

    anyFound = true;
    const id = campaign._id;
    const summary = await getCampaignNotificationSummary(id, campaign.tenantId);
    const payload = await getCampaignNotifications(id, {
      tenantId: campaign.tenantId,
      limit: 20,
    });

    const ok =
      summary.totalEvents >= 0 &&
      Array.isArray(payload.byReviewer) &&
      Array.isArray(payload.timeline);

    console.log(`[smoke] ${campaign.name}`, {
      summary,
      byReviewer: payload.byReviewer.length,
      jobs: payload.jobs.length,
      timeline: payload.timeline.length,
      ok,
    });

    if (!ok) allOk = false;
  }

  await mongoose.disconnect();

  if (!anyFound) {
    console.log("[smoke] No target campaigns in DB — QA scripts still validate merge logic");
    process.exit(0);
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
