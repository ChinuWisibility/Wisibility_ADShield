import Campaign from "../../models/certification/Campaign.js";
import RemediationTicket from "../../models/remediation/RemediationTicket.js";
import RemediationTicketItem from "../../models/remediation/RemediationTicketItem.js";
import WorkflowRemediationEvent from "../../models/workflowRemediation/WorkflowRemediationEvent.js";
import WorkflowRemediationEventItem from "../../models/workflowRemediation/WorkflowRemediationEventItem.js";
import { AppError } from "../../middleware/errorHandler.js";
import {
  WORKFLOW_REMEDIATION_QUEUE_STATUS,
  WORKFLOW_REMEDIATION_COLUMN_CONFIG,
  WORKFLOW_REMEDIATION_QUEUE_SOURCES,
  QUEUE_SLUG_BY_EVENT_TYPE,
  generateWorkflowRemediationEventId,
} from "../../constants/workflowRemediation.js";
import { remediationWithTenant } from "../../utils/remediation/remediationTenant.js";
import { buildItemKey } from "../remediation/remediationRevokedUsersService.js";
import { safeAsObjectId } from "../../utils/remediation/remediationObjectId.js";
import {
  generateTicketReviewToken,
  buildTicketReviewUrl,
} from "../remediation/remediationTicketTokenService.js";
import { sendItsmTicketEmail } from "../remediation/remediationTicketEmailService.js";

const OPEN_STATUSES = [
  WORKFLOW_REMEDIATION_QUEUE_STATUS.PENDING,
  WORKFLOW_REMEDIATION_QUEUE_STATUS.WITH_TICKET,
  WORKFLOW_REMEDIATION_QUEUE_STATUS.AWAITING_ITSM,
  WORKFLOW_REMEDIATION_QUEUE_STATUS.VALIDATION_PENDING,
];

function createTicketNumber() {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RT-${stamp}-${rand}`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export async function preventDuplicateWorkflowEvent(
  tenantId,
  eventType,
  sourceRef,
  queueSource,
) {
  if (!sourceRef) return null;
  return findOpenWorkflowEventByTarget(tenantId, eventType, sourceRef, { queueSource });
}

export async function findOpenWorkflowEventByTarget(
  tenantId,
  eventType,
  targetId,
  { queueSource = WORKFLOW_REMEDIATION_QUEUE_SOURCES.MANUAL } = {},
) {
  if (!targetId) return null;
  const ref = String(targetId);
  const query = {
    tenantId: String(tenantId),
    eventType,
    queueStatus: { $in: OPEN_STATUSES },
    $or: [{ targetId: ref }, { sourceRef: ref }],
  };
  if (queueSource) {
    query.queueSource = queueSource;
  }
  return WorkflowRemediationEvent.findOne(query).lean();
}

/**
 * Item-level lookup: which targetIds are in open WRQ event items.
 * Default: MANUAL queue events only (manual intake membership).
 */
export async function resolveQueuedTargets(
  tenantId,
  eventType,
  targetIds = [],
  { queueSource = WORKFLOW_REMEDIATION_QUEUE_SOURCES.MANUAL, includeNonManual = false } = {},
) {
  const ids = [...new Set(targetIds.map(String).filter(Boolean))];
  if (!ids.length) {
    return { queuedTargets: {}, alreadyQueued: [], availableIds: [], targetIds: [] };
  }

  const eventQuery = {
    tenantId: String(tenantId),
    eventType,
    queueStatus: { $in: OPEN_STATUSES },
  };
  if (!includeNonManual && queueSource) {
    eventQuery.queueSource = queueSource;
  }

  const openEvents = await WorkflowRemediationEvent.find(eventQuery).lean();

  if (!openEvents.length) {
    return { queuedTargets: {}, alreadyQueued: [], availableIds: ids, targetIds: ids };
  }

  const eventById = new Map(openEvents.map((ev) => [ev.eventId, ev]));
  const idSet = new Set(ids);
  const matches = new Map();

  for (const ev of openEvents) {
    for (const key of [ev.targetId, ev.sourceRef]) {
      if (key && idSet.has(String(key)) && !matches.has(String(key))) {
        matches.set(String(key), {
          targetId: String(key),
          eventId: ev.eventId,
        });
      }
    }
  }

  const openEventIds = openEvents.map((e) => e.eventId);
  const items = await WorkflowRemediationEventItem.find({
    eventId: { $in: openEventIds },
    $or: [{ sourceRef: { $in: ids } }, { "metadata.targetId": { $in: ids } }],
  })
    .select("eventId sourceRef identityName metadata")
    .lean();

  for (const item of items) {
    const tid = String(item.sourceRef || item.metadata?.targetId || "");
    if (tid && idSet.has(tid)) {
      matches.set(tid, {
        targetId: tid,
        eventId: item.eventId,
        identityName: item.identityName || tid,
      });
    }
  }

  const queuedTargets = {};
  const alreadyQueued = [];

  for (const [targetId, match] of matches) {
    const ev = eventById.get(match.eventId);
    const resolvedEventType = ev?.eventType || eventType;
    const entry = {
      targetId,
      eventId: match.eventId,
      eventType: resolvedEventType,
      queueSlug: QUEUE_SLUG_BY_EVENT_TYPE[resolvedEventType] || null,
      workflowName: ev?.selectedWorkflowName || ev?.workflowName || null,
      status: ev?.queueStatus || WORKFLOW_REMEDIATION_QUEUE_STATUS.PENDING,
      identityName: match.identityName || targetId,
      queueSource: ev?.queueSource || null,
    };
    queuedTargets[targetId] = entry;
    alreadyQueued.push(entry);
  }

  const availableIds = ids.filter((id) => !matches.has(id));
  return { queuedTargets, alreadyQueued, availableIds, targetIds: ids };
}

/**
 * @deprecated Use resolveQueuedTargets
 */
export async function findAlreadyQueuedTargets(
  tenantId,
  eventType,
  targetIds = [],
  options = {},
) {
  const { alreadyQueued } = await resolveQueuedTargets(tenantId, eventType, targetIds, options);
  return alreadyQueued;
}

export async function appendAudit(eventId, action, actor = "system", detail = null) {
  await WorkflowRemediationEvent.updateOne(
    { eventId },
    {
      $push: {
        auditHistory: {
          action,
          actor,
          detail,
          performedAt: new Date(),
        },
      },
    },
  );
}

export async function updateQueueStatus(eventId, status, meta = {}) {
  const update = {
    queueStatus: status,
    ...meta,
  };
  await WorkflowRemediationEvent.updateOne({ eventId }, { $set: update });
}

export async function createWorkflowRemediationEvent({
  tenantId,
  eventType,
  sourceType,
  sourceRef,
  targetId,
  applicationId,
  applicationName,
  campaignId,
  campaignName,
  subjectCount,
  createdBy = "system",
  selectedWorkflowId,
  selectedWorkflowName,
  queuedBy,
  queuedAt,
  metadata = {},
  items = [],
  skipDedupe = false,
  queueSource = WORKFLOW_REMEDIATION_QUEUE_SOURCES.API,
}) {
  if (!tenantId || !eventType || !sourceType) {
    throw new AppError("tenantId, eventType, and sourceType are required", 400);
  }

  const dedupeKey = targetId || sourceRef;
  if (!skipDedupe && dedupeKey) {
    const duplicate = await findOpenWorkflowEventByTarget(tenantId, eventType, dedupeKey, {
      queueSource,
    });
    if (duplicate) {
      return {
        event: duplicate,
        created: false,
        duplicate: true,
        message: "An open Workflow Remediation Queue event already exists.",
      };
    }
  }

  const eventId = generateWorkflowRemediationEventId(eventType);
  const count = subjectCount ?? items.length;
  const now = queuedAt || new Date();

  const event = await WorkflowRemediationEvent.create({
    tenantId: String(tenantId),
    eventId,
    eventType,
    sourceType,
    sourceRef: sourceRef ? String(sourceRef) : undefined,
    targetId: targetId ? String(targetId) : sourceRef ? String(sourceRef) : undefined,
    applicationId: applicationId ? String(applicationId) : undefined,
    applicationName,
    campaignId: campaignId ? String(campaignId) : undefined,
    campaignName,
    subjectCount: count,
    queueStatus: WORKFLOW_REMEDIATION_QUEUE_STATUS.PENDING,
    selectedWorkflowId: selectedWorkflowId || undefined,
    selectedWorkflowName: selectedWorkflowName || undefined,
    queuedBy: queuedBy || createdBy,
    queuedAt: now,
    createdBy,
    queueSource,
    metadata,
    auditHistory: [
      {
        action: "EVENT_CREATED",
        actor: createdBy,
        detail: {
          subjectCount: count,
          selectedWorkflowId: selectedWorkflowId || null,
        },
        performedAt: now,
      },
    ],
  });

  if (items.length) {
    await WorkflowRemediationEventItem.insertMany(
      items.map((item) => ({
        tenantId: String(tenantId),
        eventId,
        userId: item.userId || item.identityId || "",
        accountId: item.accountId || "",
        entitlementId: item.entitlementId || "",
        entitlementName: item.entitlementName || "",
        applicationId: item.applicationId ? String(item.applicationId) : undefined,
        applicationName: item.applicationName || "",
        identityName: item.identityName || item.itemName || "",
        identityEmail: item.identityEmail || item.itemEmail || "",
        status: item.status || "PENDING",
        remarks: item.remarks || "",
        sourceRef: item.sourceRef || item.reviewItemId || item.orphanId || "",
        metadata: item.metadata || {},
      })),
    );
  }

  return { event: event.toObject(), created: true };
}

export async function listEventSummary(tenantId, { queueSource } = {}) {
  const match = { tenantId: String(tenantId) };
  if (queueSource) match.queueSource = queueSource;

  const rows = await WorkflowRemediationEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          eventType: "$eventType",
          queueStatus: "$queueStatus",
          queueSource: "$queueSource",
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const summary = {};
  for (const row of rows) {
    const { eventType, queueStatus, queueSource: src } = row._id;
    if (!summary[eventType]) summary[eventType] = {};
    const sourceKey = src || WORKFLOW_REMEDIATION_QUEUE_SOURCES.API;
    if (!summary[eventType][sourceKey]) summary[eventType][sourceKey] = {};
    summary[eventType][sourceKey][queueStatus] = row.count;
  }
  return summary;
}

export async function listEvents(
  tenantId,
  { eventType, queueStatus, queueSource, page = 1, limit = 25 } = {},
) {
  const query = { tenantId: String(tenantId) };
  if (eventType) query.eventType = eventType;
  if (queueStatus) query.queueStatus = queueStatus;
  if (queueSource) query.queueSource = queueSource;

  const pg = Math.max(Number(page) || 1, 1);
  const lim = Math.min(100, Math.max(Number(limit) || 25, 1));

  const [items, total] = await Promise.all([
    WorkflowRemediationEvent.find(query)
      .sort({ createdAt: -1 })
      .skip((pg - 1) * lim)
      .limit(lim)
      .lean(),
    WorkflowRemediationEvent.countDocuments(query),
  ]);

  return {
    items,
    pagination: { page: pg, limit: lim, total, pages: Math.ceil(total / lim) || 0 },
  };
}

export async function getEventDetail(eventId, tenantId) {
  const query = { eventId };
  if (tenantId) query.tenantId = String(tenantId);

  const event = await WorkflowRemediationEvent.findOne(query).lean();
  if (!event) throw new AppError("Workflow remediation event not found", 404);

  const items = await WorkflowRemediationEventItem.find({ eventId }).lean();
  return { event, items };
}

export async function listEventItems(eventId, tenantId, { page = 1, limit = 50 } = {}) {
  const event = await WorkflowRemediationEvent.findOne({
    eventId,
    tenantId: String(tenantId),
  }).lean();
  if (!event) throw new AppError("Workflow remediation event not found", 404);

  const pg = Math.max(Number(page) || 1, 1);
  const lim = Math.min(200, Math.max(Number(limit) || 50, 1));

  const [items, total] = await Promise.all([
    WorkflowRemediationEventItem.find({ eventId })
      .sort({ createdAt: 1 })
      .skip((pg - 1) * lim)
      .limit(lim)
      .lean(),
    WorkflowRemediationEventItem.countDocuments({ eventId }),
  ]);

  return {
    items,
    pagination: { page: pg, limit: lim, total, pages: Math.ceil(total / lim) || 0 },
  };
}

export function getColumnConfig(eventType) {
  return WORKFLOW_REMEDIATION_COLUMN_CONFIG[eventType] || WORKFLOW_REMEDIATION_COLUMN_CONFIG.REVOKE_ACCESS;
}

export async function createTicketForEvent(req, eventId, body = {}) {
  const { itsmEmail, title, description, priority = "MEDIUM", dueDate, additionalNotes } = body;

  if (!isValidEmail(itsmEmail)) {
    throw new AppError("Valid ITSM admin email is required", 400);
  }

  const { event, items } = await getEventDetail(eventId, req.scopedTenantId);
  if (!items.length) {
    throw new AppError("No subjects found for this event", 400);
  }

  const campaignIds = event.campaignId ? [event.campaignId] : [];
  const campaigns = campaignIds.length
    ? await Campaign.find({ _id: { $in: campaignIds.map(safeAsObjectId).filter(Boolean) } }).lean()
    : [];
  const campaignNameMap = new Map(campaigns.map((c) => [String(c._id), c.name]));

  const ticket = await RemediationTicket.create(
    remediationWithTenant(req.scopedTenantId, {
      ticketNumber: createTicketNumber(),
      status: "OPEN",
      itsmEmail: itsmEmail.trim().toLowerCase(),
      title: title || `${event.eventType} Remediation Ticket`,
      description: description || `Workflow remediation queue event ${event.eventId}`,
      priority: String(priority).toUpperCase(),
      dueDate: dueDate ? new Date(dueDate) : undefined,
      additionalNotes,
      campaignIds: campaigns.map((c) => c._id),
      campaignNames: campaigns.map((c) => c.name),
      requesterEmail: req.user?.email || "",
      requesterId: req.user?.id || req.user?._id || "",
      requesterName:
        [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") ||
        req.user?.email ||
        "",
      notification: { status: "PENDING" },
      itemCounts: { total: items.length, pending: items.length },
      lastStatusAt: new Date(),
      metadata: { workflowRemediationEventId: event.eventId },
    }),
  );

  const itemDocs = items
    .map((item) => {
      const reviewItemOid = safeAsObjectId(item.sourceRef || item.metadata?.reviewItemId);
      return {
        tenantId: String(req.scopedTenantId),
        ticketId: ticket._id,
        reviewItemId: reviewItemOid,
        campaignId: safeAsObjectId(event.campaignId),
        campaignName: event.campaignName || campaignNameMap.get(String(event.campaignId)) || "",
        userId: item.userId || "",
        itemName: item.identityName || "",
        itemEmail: item.identityEmail || "",
        applicationId: safeAsObjectId(item.applicationId),
        applicationName: item.applicationName || "",
        entitlementName: item.entitlementName || "",
        accessDetails: item.metadata?.accessDetails || [],
        manager: item.metadata?.manager || "",
        reviewerEmail: item.metadata?.reviewerEmail || "",
        reviewerName: item.metadata?.reviewerName || "",
        reviewedAt: item.metadata?.reviewedAt ? new Date(item.metadata.reviewedAt) : undefined,
        remediationRequired: true,
        itemKey: item.metadata?.itemKey || buildItemKey(item.sourceRef, item.entitlementName),
        status: "TICKET_CREATED",
        metadata: { workflowRemediationEventItemId: String(item._id) },
      };
    })
    .filter(Boolean);

  const createdItems = await RemediationTicketItem.insertMany(itemDocs, { ordered: false });

  await WorkflowRemediationEvent.updateOne(
    { eventId },
    {
      $set: {
        ticketId: String(ticket._id),
        ticketNumber: ticket.ticketNumber,
        queueStatus: WORKFLOW_REMEDIATION_QUEUE_STATUS.WITH_TICKET,
      },
    },
  );

  const reviewToken = generateTicketReviewToken(ticket._id, ticket.itsmEmail, {
    tenantId: req.scopedTenantId,
    dueDate: ticket.dueDate,
  });
  const reviewUrl = buildTicketReviewUrl(ticket._id, reviewToken);

  try {
    await sendItsmTicketEmail({
      ticketNumber: ticket.ticketNumber,
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      dueDate: ticket.dueDate,
      campaignNames: ticket.campaignNames,
      items: createdItems,
      reviewUrl,
      requesterName: ticket.requesterName,
      requesterEmail: ticket.requesterEmail,
      itsmEmail: ticket.itsmEmail,
    });
    ticket.notification = { status: "SENT", sentAt: new Date() };
    await ticket.save();
    await WorkflowRemediationEvent.updateOne(
      { eventId },
      { $set: { queueStatus: WORKFLOW_REMEDIATION_QUEUE_STATUS.AWAITING_ITSM } },
    );
  } catch (err) {
    ticket.notification = { status: "FAILED", error: err.message };
    await ticket.save();
  }

  await appendAudit(eventId, "TICKET_CREATED", req.user?.email || "system", {
    ticketId: String(ticket._id),
    ticketNumber: ticket.ticketNumber,
  });

  return { ticket, event: await WorkflowRemediationEvent.findOne({ eventId }).lean() };
}
