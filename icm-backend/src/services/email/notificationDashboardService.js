import EmailJob from "../../models/email/EmailJob.js";
import Campaign from "../../models/certification/Campaign.js";
import CampaignReminderLog from "../../models/certification/CampaignReminderLog.js";

function formatJobDisplayStatus(job) {
  const status = String(job?.status || "").toUpperCase();
  const attempts = Number(job?.attempts) || 0;
  if (status === "PENDING" && attempts > 0) return "RETRYING";
  return status || "UNKNOWN";
}

function applyStatusFilter(jobs, statusFilter) {
  if (!statusFilter || statusFilter === "ALL") return jobs;
  if (statusFilter === "RETRYING") {
    return jobs.filter(
      (j) =>
        String(j.status || "").toUpperCase() === "PENDING" &&
        (j.attempts || 0) > 0,
    );
  }
  return jobs.filter(
    (j) =>
      String(j.status || "").toUpperCase() === statusFilter ||
      formatJobDisplayStatus(j) === statusFilter,
  );
}

async function loadTenantCampaigns(tenantId) {
  const campaignQuery = tenantId ? { tenantId } : {};
  const campaigns = await Campaign.find(campaignQuery)
    .select("_id name tenantId")
    .lean();
  const nameById = new Map(
    campaigns.map((c) => [String(c._id), c.name || "Campaign"]),
  );
  return { campaignIds: campaigns.map((c) => c._id), nameById };
}

/**
 * Cross-campaign notification dashboard for admin reporting.
 */
export async function getNotificationDashboard(tenantId, options = {}) {
  const typeFilter = String(options.type || "")
    .trim()
    .toUpperCase();
  const statusFilter = String(options.status || "")
    .trim()
    .toUpperCase();
  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(500, Math.max(Number(options.limit) || 25, 1));

  const { campaignIds, nameById } = await loadTenantCampaigns(tenantId);

  const empty = {
    summary: {
      sent: 0,
      failed: 0,
      pending: 0,
      processing: 0,
      retrying: 0,
      totalJobs: 0,
    },
    jobs: [],
    reviewers: [],
    pagination: { page, limit, total: 0, totalPages: 1 },
  };

  if (campaignIds.length === 0) return empty;

  const baseJobFilter = { campaignId: { $in: campaignIds } };
  if (typeFilter && typeFilter !== "ALL") {
    baseJobFilter.type = typeFilter;
  }

  const [sent, failed, pending, processing, retrying] = await Promise.all([
    EmailJob.countDocuments({ ...baseJobFilter, status: "SENT" }),
    EmailJob.countDocuments({ ...baseJobFilter, status: "FAILED" }),
    EmailJob.countDocuments({
      ...baseJobFilter,
      status: "PENDING",
      attempts: 0,
    }),
    EmailJob.countDocuments({ ...baseJobFilter, status: "PROCESSING" }),
    EmailJob.countDocuments({
      ...baseJobFilter,
      status: "PENDING",
      attempts: { $gt: 0 },
    }),
  ]);

  const allJobs = await EmailJob.find(baseJobFilter)
    .select("-html")
    .sort({ updatedAt: -1 })
    .lean();

  const filteredJobs = applyStatusFilter(allJobs, statusFilter);
  const total = filteredJobs.length;
  const skip = (page - 1) * limit;
  const paged = filteredJobs.slice(skip, skip + limit);

  const jobs = paged.map((job) => ({
    id: job._id,
    campaignId: job.campaignId,
    campaignName: nameById.get(String(job.campaignId)) || "Campaign",
    type: job.type,
    recipientEmail: job.recipientEmail,
    status: formatJobDisplayStatus(job),
    rawStatus: job.status,
    attempts: job.attempts || 0,
    maxAttempts: job.maxAttempts || 4,
    nextRunAt: job.nextRunAt,
    sentAt: job.sentAt,
    lastError: job.lastError,
    source: "email_job",
    legacy: false,
  }));

  const reminderRows = await CampaignReminderLog.aggregate([
    {
      $match: {
        campaignId: { $in: campaignIds },
        deliveryStatus: "SENT",
        reminderType: { $in: ["STANDARD", "ESCALATION", "EXPIRY"] },
      },
    },
    {
      $group: {
        _id: {
          email: { $toLower: "$recipientEmail" },
          campaignId: "$campaignId",
        },
        reminderCount: { $sum: 1 },
        lastReminder: { $max: "$sentAt" },
      },
    },
    { $sort: { lastReminder: -1 } },
    { $limit: 500 },
  ]);

  const reviewers = reminderRows.map((row) => ({
    recipientEmail: row._id.email,
    recipientName: row._id.email,
    campaignId: row._id.campaignId,
    campaignName: nameById.get(String(row._id.campaignId)) || "Campaign",
    reminderCount: row.reminderCount,
    lastReminder: row.lastReminder,
    status: "SENT",
  }));

  return {
    summary: {
      sent,
      failed,
      pending,
      processing,
      retrying,
      totalJobs: sent + failed + pending + processing,
    },
    jobs,
    reviewers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}
