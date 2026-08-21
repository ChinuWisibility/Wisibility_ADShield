/**
 * One-time backfill: set tenantId on legacy CampaignReminderLog rows.
 * Usage: node scripts/migrations/backfillReminderLogTenantId.js
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { backfillCertificationEmailTenantIds } from "../../src/services/email/campaignReminderLogService.js";

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("Set MONGODB_URI");
  await mongoose.connect(uri);
  const result = await backfillCertificationEmailTenantIds();
  console.log(`Done. Updated ${result.total} record(s).`, result);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
