/**
 * Optional backfill: ingest REVOKE_ACCESS queue records for recently completed campaigns.
 *
 * Usage: node scripts/backfillRemediationQueue.js [--days=30]
 */

import mongoose from "mongoose";
import "../src/config/env.js";
import env from "../src/config/env.js";
import Campaign from "../src/models/certification/Campaign.js";
import RemediationQueue from "../src/models/remediation/RemediationQueue.js";
import { ingestRevokeAccessFromCampaign } from "../src/services/remediation/remediationQueueIngestionService.js";

function parseDaysArg() {
  const arg = process.argv.find((a) => a.startsWith("--days="));
  if (!arg) return 30;
  return Math.max(1, Number(arg.split("=")[1]) || 30);
}

async function main() {
  const days = parseDaysArg();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  await mongoose.connect(env.mongodb.uri, { dbName: env.mongodb.dbName });
  console.log(`[backfillRemediationQueue] connected — campaigns completed since ${since.toISOString()}`);

  const campaigns = await Campaign.find({
    status: "Completed",
    endDate: { $gte: since },
  })
    .select("_id name endDate")
    .lean();

  let created = 0;
  let skipped = 0;

  for (const campaign of campaigns) {
    const existing = await RemediationQueue.findOne({
      eventType: "REVOKE_ACCESS",
      sourceId: String(campaign._id),
    }).lean();

    if (existing) {
      skipped += 1;
      continue;
    }

    const queue = await ingestRevokeAccessFromCampaign(campaign._id);
    if (queue) {
      created += 1;
      console.log(`  + ${campaign.name} (${campaign._id}) -> ${queue.eventId}`);
    }
  }

  console.log(`[backfillRemediationQueue] done — created: ${created}, skipped: ${skipped}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
