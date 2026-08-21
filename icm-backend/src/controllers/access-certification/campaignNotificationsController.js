import {
  getCampaignNotificationSummary,
  getCampaignNotifications,
  getNotificationJobLog,
  retryEmailJob,
} from "../../services/email/campaignNotificationService.js";
import { getEmailQueueStats, getEmailQueueHealth } from "../../services/email/emailQueueOpsService.js";
import { getNotificationDashboard } from "../../services/email/notificationDashboardService.js";
import { assertTenantForCampaign, resolveUserTenantId } from "../../utils/access-certification/certificationTenantScope.js";

function getUserId(req) {
  return req.user?.id || req.user?._id || null;
}

export async function getCampaignNotificationSummaryHandler(req, res) {
  try {
    const campaignId = req.params.id;
    const campaign = await assertTenantForCampaign(req, campaignId, {
      notFound: true,
    });

    const summary = await getCampaignNotificationSummary(
      campaignId,
      campaign.tenantId,
    );

    return res.json({
      success: true,
      data: summary,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message,
    });
  }
}

export async function getCampaignNotificationsHandler(req, res) {
  try {
    const campaignId = req.params.id;
    const campaign = await assertTenantForCampaign(req, campaignId, {
      notFound: true,
    });

    const data = await getCampaignNotifications(campaignId, {
      tenantId: campaign.tenantId,
      type: req.query.type,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message,
    });
  }
}

export async function getNotificationJobLogHandler(req, res) {
  try {
    const campaignId = req.params.id;
    const jobId = req.params.jobId;
    const campaign = await assertTenantForCampaign(req, campaignId, {
      notFound: true,
    });

    const data = await getNotificationJobLog(
      campaignId,
      jobId,
      campaign.tenantId,
    );

    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message,
    });
  }
}

export async function getEmailQueueStatsHandler(req, res) {
  try {
    const tenantId = await resolveUserTenantId(req);
    const stats = await getEmailQueueStats(tenantId);
    return res.json({ success: true, data: stats });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message,
    });
  }
}

export async function getEmailQueueHealthHandler(req, res) {
  try {
    const tenantId = await resolveUserTenantId(req);
    const health = await getEmailQueueHealth(tenantId);
    const status = health.healthy ? 200 : 503;
    return res.status(status).json({ success: health.healthy, data: health });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message,
    });
  }
}

export async function getNotificationDashboardHandler(req, res) {
  try {
    const tenantId = await resolveUserTenantId(req);
    const data = await getNotificationDashboard(tenantId, {
      type: req.query.type,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message,
    });
  }
}

export async function retryNotificationJobHandler(req, res) {
  try {
    const jobId = req.params.jobId;
    const campaignId = req.body?.campaignId || req.query?.campaignId;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        message: "campaignId is required",
      });
    }

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const job = await retryEmailJob(jobId, {
      actorId: getUserId(req),
      campaignId,
    });

    return res.json({
      success: true,
      data: { job },
      message: "Retry scheduled",
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message,
    });
  }
}
