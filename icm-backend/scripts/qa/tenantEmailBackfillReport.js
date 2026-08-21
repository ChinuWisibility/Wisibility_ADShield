/**
 * Report missing tenantId on certification email collections.
 * Run: node scripts/qa/tenantEmailBackfillReport.js [--fix]
 *
 * With --fix, runs backfillCertificationEmailTenantIds().
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import CampaignReminderLog from "../../src/models/certification/CampaignReminderLog.js";
import EmailJob from "../../src/models/email/EmailJob.js";
import EmailDeliveryLog from "../../src/models/email/EmailDeliveryLog.js";
import CampaignAuditLog from "../../src/models/certification/CampaignAuditLog.js";
import {
  backfillCertificationEmailTenantIds,
} from "../../src/services/email/campaignReminderLogService.js";

dotenv.config();

const FIX = process.argv.includes("--fix");

async function countMissing(Model, label) {
  const missing = await Model.countDocuments({
    campaignId: { $exists: true, $ne: null },
    $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
  });
  const total = await Model.countDocuments({});
  console.log(`[tenant-report] ${label}: ${missing} missing tenantId / ${total} total`);
  return { label, missing, total };
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("Set MONGODB_URI");
  await mongoose.connect(uri);

  const rows = await Promise.all([
    countMissing(CampaignReminderLog, "CampaignReminderLog"),
    countMissing(EmailJob, "EmailJob"),
    countMissing(EmailDeliveryLog, "EmailDeliveryLog"),
    countMissing(CampaignAuditLog, "CampaignAuditLog"),
  ]);

  const totalMissing = rows.reduce((n, r) => n + r.missing, 0);
  console.log(`[tenant-report] Total missing tenantId: ${totalMissing}`);
  console.log(
    `[tenant-report] TENANT_STRICT_EMAIL_QUERIES=${process.env.TENANT_STRICT_EMAIL_QUERIES || "false"}`,
  );

  if (FIX && totalMissing > 0) {
    const result = await backfillCertificationEmailTenantIds();
    console.log("[tenant-report] Backfill result:", result);
    const after = await Promise.all([
      countMissing(CampaignReminderLog, "CampaignReminderLog"),
      countMissing(EmailJob, "EmailJob"),
      countMissing(EmailDeliveryLog, "EmailDeliveryLog"),
      countMissing(CampaignAuditLog, "CampaignAuditLog"),
    ]);
    const remaining = after.reduce((n, r) => n + r.missing, 0);
    console.log(`[tenant-report] Remaining missing after fix: ${remaining}`);
  } else if (totalMissing > 0) {
    console.log("[tenant-report] Run with --fix to backfill from campaign.tenantId");
  }

  await mongoose.disconnect();
  process.exit(totalMissing > 0 && !FIX ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
