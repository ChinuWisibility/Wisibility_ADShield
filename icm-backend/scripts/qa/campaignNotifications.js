/**
 * QA for tenant-scoped campaign notifications (merged read model).
 *
 * Run: node scripts/qa/campaignNotifications.js
 *
 * Requires MONGODB_URI (or MONGO_URI).
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import Campaign from "../../src/models/certification/Campaign.js";
import EmailJob from "../../src/models/email/EmailJob.js";
import EmailDeliveryLog from "../../src/models/email/EmailDeliveryLog.js";
import CampaignReminderLog from "../../src/models/certification/CampaignReminderLog.js";
import CampaignAuditLog from "../../src/models/certification/CampaignAuditLog.js";
import {
  getCampaignNotificationSummary,
  getCampaignNotifications,
  getNotificationJobLog,
} from "../../src/services/email/campaignNotificationService.js";
import { buildTenantScopedCampaignFilter } from "../../src/services/email/tenantCampaignFilter.js";

dotenv.config();

const REVIEWER = "qa.notifications@example.com";

async function connectDb() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("Set MONGODB_URI to run QA scripts");
  await mongoose.connect(uri);
}

async function seedFixture() {
  const tenantA = new mongoose.Types.ObjectId();
  const tenantB = new mongoose.Types.ObjectId();
  const campaignId = new mongoose.Types.ObjectId();

  await Campaign.create({
    _id: campaignId,
    tenantId: tenantA,
    name: "[QA] Notifications merge test",
    status: "Active",
    category: "MANAGER",
    reviewersAssigned: [{ email: REVIEWER, name: "QA Reviewer" }],
  });

  const job = await EmailJob.create({
    type: "LAUNCH",
    status: "SENT",
    campaignId,
    tenantId: tenantA,
    recipientEmail: REVIEWER,
    subject: "[QA] Launch",
    html: "<p>launch</p>",
    sentAt: new Date(),
  });

  await CampaignReminderLog.create({
    campaignId,
    tenantId: tenantA,
    recipientEmail: REVIEWER,
    reminderType: "STANDARD",
    deliveryStatus: "SENT",
    sentAt: new Date(),
  });

  await EmailDeliveryLog.create({
    emailJobId: job._id,
    campaignId,
    tenantId: tenantA,
    recipientEmail: REVIEWER,
    emailType: "LAUNCH",
    deliveryStatus: "DELIVERED",
    deliveredAt: new Date(),
  });

  await CampaignAuditLog.create({
    campaignId,
    tenantId: tenantA,
    eventType: "EMAIL_SENT",
    recipientEmail: REVIEWER,
    emailJobId: job._id,
    emailType: "LAUNCH",
  });

  return { tenantA, tenantB, campaignId, jobId: job._id };
}

async function cleanup(ids) {
  const { campaignId, jobId } = ids;
  await Promise.all([
    Campaign.deleteOne({ _id: campaignId }),
    EmailJob.deleteMany({ campaignId }),
    CampaignReminderLog.deleteMany({ campaignId }),
    EmailDeliveryLog.deleteMany({ campaignId }),
    CampaignAuditLog.deleteMany({ campaignId }),
  ]);
  if (jobId) await EmailJob.deleteOne({ _id: jobId }).catch(() => {});
}

async function testMergedSummaryAndNotifications(fixture) {
  const { tenantA, campaignId } = fixture;

  const summary = await getCampaignNotificationSummary(campaignId, tenantA);
  const payload = await getCampaignNotifications(campaignId, {
    tenantId: tenantA,
    limit: 50,
  });

  const reviewerRow = payload.byReviewer.find(
    (r) => r.recipientEmail === REVIEWER.toLowerCase(),
  );

  const checks = {
    summarySentNonZero: summary.sent >= 1,
    legacySentNonZero: summary.legacySent >= 1,
    totalEventsNonZero: summary.totalEvents >= 1,
    reviewerHasReminder: reviewerRow?.reminder?.sent === true,
    timelineNonEmpty: payload.timeline.length > 0,
    jobsIncludeLegacyOrQueue: payload.jobs.length >= 1,
  };

  console.log("[notifications] summary:", summary);
  console.log("[notifications] byReviewer count:", payload.byReviewer.length);
  console.log("[notifications] timeline length:", payload.timeline.length);
  console.log("[notifications] checks:", checks);

  return Object.values(checks).every(Boolean);
}

async function testJobLog(fixture) {
  const { tenantA, campaignId, jobId } = fixture;
  const log = await getNotificationJobLog(campaignId, jobId, tenantA);
  const ok =
    Boolean(log.job) &&
    Array.isArray(log.deliveryLogs) &&
    Array.isArray(log.auditEvents);
  console.log("[notifications] job log:", {
    hasJob: Boolean(log.job),
    deliveryCount: log.deliveryLogs?.length,
    auditCount: log.auditEvents?.length,
  });
  return ok;
}

async function testTenantIsolation(fixture) {
  const { tenantA, tenantB, campaignId } = fixture;
  const prevStrict = process.env.TENANT_STRICT_EMAIL_QUERIES;
  process.env.TENANT_STRICT_EMAIL_QUERIES = "true";

  try {
    const wrongTenantSummary = await getCampaignNotificationSummary(
      campaignId,
      tenantB,
    );
    const filterA = buildTenantScopedCampaignFilter(campaignId, tenantA);
    const filterB = buildTenantScopedCampaignFilter(campaignId, tenantB);
    const reminderCountA = await CampaignReminderLog.countDocuments(filterA);
    const reminderCountB = await CampaignReminderLog.countDocuments(filterB);

    const isolated =
      wrongTenantSummary.legacySent === 0 &&
      reminderCountA >= 1 &&
      reminderCountB === 0;

    console.log("[notifications] tenant isolation:", {
      legacySentWrongTenant: wrongTenantSummary.legacySent,
      reminderCountA,
      reminderCountB,
    });

    let logRejected = false;
    try {
      await getNotificationJobLog(campaignId, fixture.jobId, tenantB);
    } catch (err) {
      logRejected = err.statusCode === 404;
    }

    console.log("[notifications] wrong-tenant job log 404:", logRejected);
    return isolated && logRejected;
  } finally {
    if (prevStrict === undefined) {
      delete process.env.TENANT_STRICT_EMAIL_QUERIES;
    } else {
      process.env.TENANT_STRICT_EMAIL_QUERIES = prevStrict;
    }
  }
}

async function main() {
  await connectDb();
  const fixture = await seedFixture();
  let ok = false;

  try {
    const mergeOk = await testMergedSummaryAndNotifications(fixture);
    const logOk = await testJobLog(fixture);
    const tenantOk = await testTenantIsolation(fixture);
    ok = mergeOk && logOk && tenantOk;
    console.log(
      ok
        ? "[notifications] ALL CHECKS PASSED"
        : "[notifications] SOME CHECKS FAILED",
    );
  } finally {
    await cleanup(fixture);
    await mongoose.disconnect();
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
