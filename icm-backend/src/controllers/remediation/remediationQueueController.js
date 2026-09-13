import { AppError } from "../../middleware/errorHandler.js";
import {
  listQueueRecords,
  getQueueById,
  listQueueItems,
  getQueueSummary,
  reconcileQueueTicketFlags,
} from "../../services/remediation/remediationQueueService.js";
import {
  manualEnqueueFromDetection,
  ingestCompletedRevokeAccessCampaigns,
  runTenantQueueIngestion,
} from "../../services/remediation/remediationQueueIngestionService.js";
import { createRemediationTicketFromQueue } from "../../services/remediation/remediationTicketService.js";

export async function getQueueSummaryHandler(req, res, next) {
  try {
    const summary = await getQueueSummary(req.scopedTenantId);
    res.json({ success: true, data: summary });
  } catch (e) {
    next(e);
  }
}

export async function listQueue(req, res, next) {
  try {
    const data = await listQueueRecords({
      tenantId: req.scopedTenantId,
      page: req.query.page,
      limit: req.query.limit,
      eventType: req.query.eventType,
      status: req.query.status,
      certificationId: req.query.certificationId,
      applicationId: req.query.applicationId,
      search: req.query.search,
    });
    res.json({ success: true, data: data.items, pagination: data.pagination });
  } catch (e) {
    next(e);
  }
}

export async function getQueue(req, res, next) {
  try {
    const queue = await getQueueById(req.scopedTenantId, req.params.id);
    if (!queue) throw new AppError("Queue record not found", 404);
    res.json({ success: true, data: queue });
  } catch (e) {
    next(e);
  }
}

export async function getQueueItems(req, res, next) {
  try {
    const queue = await getQueueById(req.scopedTenantId, req.params.id);
    if (!queue) throw new AppError("Queue record not found", 404);
    const data = await listQueueItems(req.scopedTenantId, req.params.id, {
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
    });
    res.json({ success: true, data: data.items, pagination: data.pagination });
  } catch (e) {
    next(e);
  }
}

export async function createTicketFromQueue(req, res, next) {
  try {
    const result = await createRemediationTicketFromQueue(req, req.params.id);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
}

export async function syncRevokeAccessQueues(req, res, next) {
  try {
    const result = await ingestCompletedRevokeAccessCampaigns(req.scopedTenantId);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
}

export async function syncAllQueues(req, res, next) {
  try {
    const result = await runTenantQueueIngestion(req.scopedTenantId);
    const ticketReconcile = await reconcileQueueTicketFlags(req.scopedTenantId);
    res.json({ success: true, data: { ...result, ticketReconcile } });
  } catch (e) {
    next(e);
  }
}

export async function enqueueManual(req, res, next) {
  try {
    const { eventType, subjects = [], sourceMeta = {} } = req.body || {};
    if (!eventType) throw new AppError("eventType is required", 400);
    if (!subjects.length) throw new AppError("At least one subject is required", 400);

    const result = await manualEnqueueFromDetection(
      req.scopedTenantId,
      eventType,
      subjects,
      { ...sourceMeta, queuedBy: req.user?.email || "manual" },
    );
    res.status(result.created ? 201 : 200).json({ success: true, data: result });
  } catch (e) {
    if (e.message?.includes("required")) {
      return next(new AppError(e.message, 400));
    }
    next(e);
  }
}
