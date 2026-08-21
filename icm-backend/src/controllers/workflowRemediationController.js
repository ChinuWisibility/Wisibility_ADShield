import { AppError } from "../middleware/errorHandler.js";
import { ROLES } from "../middleware/auth.js";
import {
  createWorkflowRemediationEvent,
  createTicketForEvent,
  getColumnConfig,
  getEventDetail,
  listEventItems,
  listEvents,
  listEventSummary,
} from "../services/workflowRemediation/workflowRemediationEventService.js";
import { triggerWorkflowForEvent, immediatelyLaunchEvent } from "../services/workflowRemediation/workflowRemediationTriggerService.js";
import {
  getOpenEventByTarget,
  listWorkflowsForRemediation,
  manualEnqueueToWorkflowQueue,
  checkQueuedTargets,
  TRIGGER_TYPE_BY_EVENT,
} from "../services/workflowRemediation/workflowRemediationManualEnqueueService.js";
import {
  WORKFLOW_REMEDIATION_EVENT_TYPES,
  WORKFLOW_REMEDIATION_EVENT_SOURCES,
  WORKFLOW_REMEDIATION_QUEUE_SOURCES,
  defaultQueueSourceForEventType,
} from "../constants/workflowRemediation.js";

export async function getSummary(req, res, next) {
  try {
    const summary = await listEventSummary(req.scopedTenantId, {
      queueSource: req.query.queueSource || undefined,
    });
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
}

export async function listEventsHandler(req, res, next) {
  try {
    const eventType = req.query.eventType;
    const queueSource =
      req.query.queueSource
      || (eventType ? defaultQueueSourceForEventType(eventType) : undefined);

    const result = await listEvents(req.scopedTenantId, {
      eventType,
      queueStatus: req.query.queueStatus,
      queueSource,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getEventHandler(req, res, next) {
  try {
    const data = await getEventDetail(req.params.eventId, req.scopedTenantId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function listEventItemsHandler(req, res, next) {
  try {
    const result = await listEventItems(req.params.eventId, req.scopedTenantId, {
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function createEventHandler(req, res, next) {
  try {
    const body = req.body || {};
    const result = await createWorkflowRemediationEvent({
      tenantId: req.scopedTenantId,
      ...body,
      createdBy: req.user?.email || "admin",
      queueSource: body.queueSource || WORKFLOW_REMEDIATION_QUEUE_SOURCES.API,
    });
    res.status(result.created ? 201 : 200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function createTicketHandler(req, res, next) {
  try {
    const data = await createTicketForEvent(req, req.params.eventId, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function triggerWorkflowHandler(req, res, next) {
  try {
    const { workflowId } = req.body || {};
    const data = await triggerWorkflowForEvent(
      req.scopedTenantId,
      req.params.eventId,
      workflowId,
      req.user?.email || "system",
    );
    res.status(202).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getColumnConfigHandler(req, res, next) {
  try {
    const columns = getColumnConfig(req.params.eventType);
    if (!columns) {
      return next(new AppError("Unknown event type", 404));
    }
    res.json({ success: true, data: columns });
  } catch (err) {
    next(err);
  }
}

export async function getWorkflowsHandler(req, res, next) {
  try {
    const trigger = req.query.trigger || null;
    const eventType = req.query.eventType || null;
    const triggerType =
      trigger || (eventType ? TRIGGER_TYPE_BY_EVENT[eventType] : null) || undefined;
    const workflows = await listWorkflowsForRemediation(req.scopedTenantId, triggerType);
    res.json({ success: true, data: workflows });
  } catch (err) {
    next(err);
  }
}

export async function getOpenEventHandler(req, res, next) {
  try {
    const { eventType, targetId } = req.query || {};
    if (!eventType || !targetId) {
      return next(new AppError("eventType and targetId are required", 400));
    }
    const event = await getOpenEventByTarget(req.scopedTenantId, eventType, targetId);
    res.json({ success: true, data: { event, exists: Boolean(event) } });
  } catch (err) {
    next(err);
  }
}

export async function checkQueuedHandler(req, res, next) {
  try {
    const body = req.body || {};
    const { eventType, targetId, targetIds, includeNonManual } = body;
    if (!eventType) return next(new AppError("eventType is required", 400));

    const ids = [
      ...(targetId ? [String(targetId)] : []),
      ...(Array.isArray(targetIds) ? targetIds.map(String) : []),
    ];
    if (!ids.length) return next(new AppError("targetId or targetIds is required", 400));

    const allowAllSources = Boolean(includeNonManual);
    if (allowAllSources && req.user?.role !== ROLES.SUPER_ADMIN) {
      return next(new AppError("includeNonManual requires super admin access", 403));
    }

    const data = await checkQueuedTargets(
      req.scopedTenantId,
      String(eventType).toUpperCase(),
      ids,
      { includeNonManual: allowAllSources },
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function manualEnqueueHandler(req, res, next) {
  try {
    const body = req.body || {};
    const {
      eventType,
      targetId,
      targetIds,
      workflowId,
      context,
      contexts,
      itemsContext,
      proceedWithAvailable,
      launchImmediately,
    } = body;

    if (!eventType) return next(new AppError("eventType is required", 400));
    if (!workflowId) return next(new AppError("workflowId is required", 400));

    const normalized = String(eventType).toUpperCase();
    if (normalized === WORKFLOW_REMEDIATION_EVENT_TYPES.REVOKE_ACCESS) {
      return next(
        new AppError("Revoke Access events are created from certification revoke decisions", 400),
      );
    }

    const ids = [
      ...(targetId ? [String(targetId)] : []),
      ...(Array.isArray(targetIds) ? targetIds.map(String) : []),
    ];
    if (!ids.length) {
      return next(new AppError("targetId or targetIds is required", 400));
    }

    const result = await manualEnqueueToWorkflowQueue({
      tenantId: req.scopedTenantId,
      eventType: normalized,
      targetIds: ids,
      workflowId: String(workflowId),
      queuedBy: req.user?.email || "manual",
      context: context || {},
      contexts: Array.isArray(contexts) ? contexts : [],
      itemsContext: Array.isArray(itemsContext) ? itemsContext : [],
      proceedWithAvailable: proceedWithAvailable !== false,
      launchImmediately: launchImmediately === true,
    });

    res.status(result.created ? 201 : 200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function enqueueManualHandler(req, res, next) {
  return manualEnqueueHandler(req, res, next);
}

export async function immediatelyLaunchHandler(req, res, next) {
  try {
    const { workflowId } = req.body || {};
    const data = await immediatelyLaunchEvent(
      req.scopedTenantId,
      req.params.eventId,
      {
        workflowId,
        actor: req.user?.email || "system",
      },
    );
    res.status(202).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
