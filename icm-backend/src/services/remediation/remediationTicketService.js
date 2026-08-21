import Campaign from "../../models/certification/Campaign.js";
import RemediationTicket from "../../models/remediation/RemediationTicket.js";
import RemediationTicketItem from "../../models/remediation/RemediationTicketItem.js";
import RemediationTicketResponse from "../../models/remediation/RemediationTicketResponse.js";
import RemediationExecutionLog from "../../models/remediation/RemediationExecutionLog.js";
import RemediationAuditLog from "../../models/remediation/RemediationAuditLog.js";
import { AppError } from "../../middleware/errorHandler.js";
import { remediationTenantFilter, remediationWithTenant } from "../../utils/remediation/remediationTenant.js";
import { asObjectId, getTenantApplicationIds } from "../../controllers/access-certification/certificationControllerHelpers.js";
import { resolveCertificationAccessTenantId } from "../../utils/access-certification/resolveCertificationAccessTenantId.js";
import { aggregateRevokedEntitlements, buildItemKey } from "./remediationRevokedUsersService.js";
import {
  generateTicketReviewToken,
  buildTicketReviewUrl,
} from "./remediationTicketTokenService.js";
import { sendItsmTicketEmail } from "./remediationTicketEmailService.js";
import { countRevokedEntitlementsForCampaign } from "./remediationRevokedUsersService.js";
import { safeAsObjectId } from "../../utils/remediation/remediationObjectId.js";
import { upsertRemediationEventForTicket } from "./remediationEventSyncService.js";
import RemediationQueue from "../../models/remediation/RemediationQueue.js";
import RemediationQueueItem from "../../models/remediation/RemediationQueueItem.js";
import {
  getQueueById,
  markQueueTicketCreated,
} from "./remediationQueueService.js";
import {
  updateStage,
  markCertificationReviewerComplete,
} from "./remediationTrackingService.js";
import { createValidationForTicketItem } from "./remediationValidationService.js";

function createTicketNumber() {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RT-${stamp}-${rand}`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function deriveTicketStatusFromItems(items = []) {
  if (!items.length) return "OPEN";
  if (items.some((i) => i.status === "PENDING_DECISION")) return "IN_PROGRESS";
  const pending = items.filter(
    (i) => !["APPROVED", "DENIED", "EXECUTED", "PENDING_DECISION"].includes(i.status),
  );
  if (pending.length === 0) return "CLOSED";
  const anyDecision = items.some((i) =>
    ["APPROVED", "DENIED", "EXECUTED", "PENDING_DECISION"].includes(i.status),
  );
  return anyDecision ? "IN_PROGRESS" : "OPEN";
}

function computeItemCounts(items = []) {
  return {
    total: items.length,
    pending: items.filter((i) =>
      ["PENDING", "TICKET_CREATED", "IN_PROGRESS", "PENDING_DECISION"].includes(i.status),
    ).length,
    approved: items.filter((i) => i.status === "APPROVED").length,
    denied: items.filter((i) => i.status === "DENIED").length,
    executed: items.filter((i) => i.status === "EXECUTED").length,
  };
}

async function logTicketAudit(ctx, entry) {
  try {
    await RemediationAuditLog.create(
      remediationWithTenant(ctx.scopedTenantId, {
        ...entry,
        performedBy: entry.performedBy || ctx.user?.email || "system",
        performedAt: entry.performedAt || new Date(),
      }),
    );
  } catch {
    // non-blocking
  }
}

export async function assertTenantTicketAccess(req, ticketId) {
  const tId = asObjectId(ticketId);
  if (!tId) throw new AppError("Invalid ticket id", 400);

  const ticket = await RemediationTicket.findOne({
    ...remediationTenantFilter(req.scopedTenantId),
    _id: tId,
  }).lean();
  if (!ticket) throw new AppError("Ticket not found", 404);
  return ticket;
}

export async function listApplicationCampaignsPaginated(req) {
  const userTenantId = await resolveCertificationAccessTenantId(req);
  if (!userTenantId) {
    throw new AppError("Tenant not found for the current user", 403);
  }

  const tenantApplicationIds = await getTenantApplicationIds(userTenantId);
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(100, Math.max(Number(req.query.limit || 20), 1));
  const search = String(req.query.search || "").trim();

  const query = { applicationId: { $in: tenantApplicationIds } };
  if (req.query.status) query.status = req.query.status;
  if (search) {
    query.$or = [
      { name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
      { applicationName: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
    ];
  }

  const [items, total] = await Promise.all([
    Campaign.find(query)
      .populate("applicationId", "name tenantId")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Campaign.countDocuments(query),
  ]);

  const enriched = await Promise.all(
    items.map(async (c) => ({
      _id: c._id,
      name: c.name,
      description: c.description,
      status: c.status,
      applicationId: c.applicationId?._id || c.applicationId,
      applicationName:
        c.applicationName || c.applicationId?.name || "Unknown Application",
      category: c.category,
      certificationScope: c.certificationScope,
      revokedCount: await countRevokedEntitlementsForCampaign(c._id),
      createdAt: c.createdAt,
      endDate: c.endDate,
    })),
  );

  return {
    items: enriched,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 0,
    },
  };
}

export async function getRevokedUsersForCampaigns(req) {
  const campaignIds = Array.isArray(req.body?.campaignIds)
    ? req.body.campaignIds
    : req.query.campaignIds
      ? String(req.query.campaignIds).split(",")
      : [];

  if (!campaignIds.length) {
    throw new AppError("At least one campaignId is required", 400);
  }

  const userTenantId = await resolveCertificationAccessTenantId(req);
  const tenantApplicationIds = await getTenantApplicationIds(userTenantId);
  for (const cid of campaignIds) {
    const campaign = await Campaign.findById(cid).lean();
    if (!campaign) throw new AppError("Campaign not found", 404);
    const appId = campaign.applicationId ? String(campaign.applicationId) : null;
    if (!appId || !tenantApplicationIds.some((id) => String(id) === appId)) {
      throw new AppError("Campaign not found", 404);
    }
  }

  const result = await aggregateRevokedEntitlements({
    campaignIds,
    page: req.body?.page || req.query.page || 1,
    limit: req.body?.limit || req.query.limit || 25,
    search: req.body?.search || req.query.search || "",
    applicationName: req.body?.applicationName || req.query.applicationName || "",
    campaignName: req.body?.campaignName || req.query.campaignName || "",
    entitlementName: req.body?.entitlementName || req.query.entitlementName || "",
    sortBy: req.body?.sortBy || req.query.sortBy || "itemName",
    sortDir: req.body?.sortDir || req.query.sortDir || "asc",
  });

  return result;
}

export async function createRemediationTicket(req) {
  const {
    itsmEmail,
    title,
    description,
    priority = "MEDIUM",
    dueDate,
    additionalNotes,
    campaignIds = [],
    selectedItems = [],
  } = req.body || {};

  if (!isValidEmail(itsmEmail)) {
    throw new AppError("Valid ITSM admin email is required", 400);
  }
  if (!Array.isArray(selectedItems) || !selectedItems.length) {
    throw new AppError("At least one revoked user must be selected", 400);
  }
  if (!Array.isArray(campaignIds) || !campaignIds.length) {
    throw new AppError("At least one campaign must be selected", 400);
  }

  const campaigns = await Campaign.find({
    _id: { $in: campaignIds.map(asObjectId).filter(Boolean) },
  }).lean();
  if (!campaigns.length) throw new AppError("Campaigns not found", 404);

  const campaignNameMap = new Map(
    campaigns.map((c) => [String(c._id), c.name]),
  );

  const ticket = await RemediationTicket.create(
    remediationWithTenant(req.scopedTenantId, {
      ticketNumber: createTicketNumber(),
      status: "OPEN",
      itsmEmail: itsmEmail.trim().toLowerCase(),
      title: title || "Revoke Access Remediation Ticket",
      description,
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
      itemCounts: { total: selectedItems.length, pending: selectedItems.length },
      lastStatusAt: new Date(),
    }),
  );

  const itemDocs = selectedItems
    .map((item) => {
      const reviewItemOid = safeAsObjectId(item.reviewItemId);
      if (!reviewItemOid) return null;
      return {
        tenantId: String(req.scopedTenantId),
        ticketId: ticket._id,
        reviewItemId: reviewItemOid,
        campaignId: safeAsObjectId(item.campaignId),
        campaignName: item.campaignName || campaignNameMap.get(String(item.campaignId)) || "",
        userId: item.userId || "",
        itemName: item.itemName || "",
        itemEmail: item.itemEmail || "",
        applicationId: safeAsObjectId(item.applicationId),
        applicationName: item.applicationName || "",
        entitlementName: item.entitlementName || "",
        accessDetails: item.accessDetails || [],
        manager: item.manager || "",
        reviewerEmail: item.reviewerEmail || "",
        reviewerName: item.reviewerName || "",
        reviewedAt: item.reviewedAt ? new Date(item.reviewedAt) : undefined,
        remediationRequired: Boolean(item.remediationRequired),
        itemKey: item.itemKey || buildItemKey(item.reviewItemId, item.entitlementName),
        status: "TICKET_CREATED",
      };
    })
    .filter(Boolean);

  if (!itemDocs.length) {
    throw new AppError("No valid revoked users selected for ticket creation", 400);
  }

  const createdItems = await RemediationTicketItem.insertMany(itemDocs, {
    ordered: false,
  });

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
  } catch (err) {
    ticket.notification = {
      status: "FAILED",
      error: err?.message || "Failed to send email",
    };
  }
  await ticket.save();

  const event = await upsertRemediationEventForTicket(req, ticket, createdItems, {
    reviewUrl,
  });

  await logTicketAudit(req, {
    action: "CREATE",
    note: `Created remediation ticket ${ticket.ticketNumber}`,
    newValue: { ticketId: ticket._id, itemCount: createdItems.length },
  });

  return {
    ticket,
    items: createdItems,
    reviewUrl,
    event,
  };
}

export async function createRemediationTicketFromQueue(req, queueId) {
  const {
    itsmEmail,
    title,
    description,
    priority = "MEDIUM",
    dueDate,
    additionalNotes,
    selectedQueueItemIds = [],
  } = req.body || {};

  if (!isValidEmail(itsmEmail)) {
    throw new AppError("Valid ITSM admin email is required", 400);
  }
  if (!Array.isArray(selectedQueueItemIds) || !selectedQueueItemIds.length) {
    throw new AppError("At least one queue item must be selected", 400);
  }

  const queue = await getQueueById(req.scopedTenantId, queueId);
  if (!queue) throw new AppError("Queue record not found", 404);
  if (queue.ticketCreated) {
    throw new AppError("A ticket has already been created for this queue record", 400);
  }

  const itemObjectIds = selectedQueueItemIds.map(safeAsObjectId).filter(Boolean);
  const queueItems = await RemediationQueueItem.find({
    tenantId: String(req.scopedTenantId),
    queueId: queue._id,
    _id: { $in: itemObjectIds },
  }).lean();

  if (!queueItems.length) {
    throw new AppError("No valid queue items selected", 400);
  }

  const campaignIds = [
    ...new Set(queueItems.map((i) => i.campaignId).filter(Boolean).map(String)),
  ];
  const campaigns = campaignIds.length
    ? await Campaign.find({ _id: { $in: campaignIds.map(asObjectId).filter(Boolean) } }).lean()
    : [];
  const campaignNameMap = new Map(campaigns.map((c) => [String(c._id), c.name]));

  const ticket = await RemediationTicket.create(
    remediationWithTenant(req.scopedTenantId, {
      ticketNumber: createTicketNumber(),
      status: "OPEN",
      itsmEmail: itsmEmail.trim().toLowerCase(),
      title: title || `${queue.eventType.replace(/_/g, " ")} Remediation Ticket`,
      description,
      priority: String(priority).toUpperCase(),
      dueDate: dueDate ? new Date(dueDate) : undefined,
      additionalNotes,
      campaignIds: campaigns.map((c) => c._id),
      campaignNames: campaigns.map((c) => c.name),
      queueId: queue._id,
      eventId: queue.eventId,
      requesterEmail: req.user?.email || "",
      requesterId: req.user?.id || req.user?._id || "",
      requesterName:
        [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") ||
        req.user?.email ||
        "",
      notification: { status: "PENDING" },
      itemCounts: { total: queueItems.length, pending: queueItems.length },
      lastStatusAt: new Date(),
    }),
  );

  const itemDocs = queueItems.map((qi) => {
    const reviewItemOid = safeAsObjectId(qi.reviewItemId);
    const itemKey =
      qi.itemKey ||
      (reviewItemOid
        ? buildItemKey(qi.reviewItemId, qi.entitlementName)
        : `${String(qi._id)}::${qi.entitlementName || qi.accountId || "item"}`);

    return {
      tenantId: String(req.scopedTenantId),
      ticketId: ticket._id,
      queueItemId: qi._id,
      reviewItemId: reviewItemOid || undefined,
      campaignId: safeAsObjectId(qi.campaignId),
      campaignName: campaignNameMap.get(String(qi.campaignId)) || queue.certificationName || "",
      userId: qi.identityId || qi.accountId || "",
      itemName: qi.identityName || "",
      itemEmail: qi.identityEmail || "",
      applicationId: safeAsObjectId(qi.applicationId || queue.applicationId),
      applicationName: qi.applicationName || queue.applicationName || "",
      entitlementName: qi.entitlementName || "",
      accessDetails: qi.accessDetails || [],
      manager: qi.managerEmail || "",
      itemKey,
      status: "TICKET_CREATED",
    };
  });

  const createdItems = await RemediationTicketItem.insertMany(itemDocs, { ordered: false });

  await RemediationQueueItem.updateMany(
    { _id: { $in: queueItems.map((i) => i._id) } },
    { $set: { currentStatus: "TICKET_CREATED" } },
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
      campaignNames: ticket.campaignNames?.length
        ? ticket.campaignNames
        : [queue.certificationName || queue.applicationName].filter(Boolean),
      items: createdItems,
      reviewUrl,
      requesterName: ticket.requesterName,
      requesterEmail: ticket.requesterEmail,
      itsmEmail: ticket.itsmEmail,
    });
    ticket.notification = { status: "SENT", sentAt: new Date() };
    await updateStage(queue.eventId, "email", "SENT", new Date());
  } catch (err) {
    ticket.notification = {
      status: "FAILED",
      error: err?.message || "Failed to send email",
    };
  }
  await ticket.save();

  await markQueueTicketCreated(queue._id, ticket._id);

  if (queue.eventType === "REVOKE_ACCESS") {
    const latestReviewMs = queueItems.reduce((max, qi) => {
      const t = qi.metadata?.reviewedAt ? new Date(qi.metadata.reviewedAt).getTime() : 0;
      return Math.max(max, t);
    }, 0);
    await markCertificationReviewerComplete(queue.eventId, {
      completedAt: latestReviewMs > 0 ? new Date(latestReviewMs) : new Date(),
    }).catch(() => {});
  }

  const event = await upsertRemediationEventForTicket(req, ticket, createdItems, {
    reviewUrl,
  });

  await logTicketAudit(req, {
    action: "CREATE",
    note: `Created remediation ticket ${ticket.ticketNumber} from queue ${queue.eventId}`,
    newValue: { ticketId: ticket._id, queueId: queue._id, itemCount: createdItems.length },
  });

  return {
    ticket,
    items: createdItems,
    reviewUrl,
    event,
    queue,
  };
}

export async function listRemediationTickets(req) {
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(100, Math.max(Number(req.query.limit || 20), 1));
  const filter = remediationTenantFilter(req.scopedTenantId);
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();

  const [items, total] = await Promise.all([
    RemediationTicket.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    RemediationTicket.countDocuments(filter),
  ]);

  return {
    items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 0 },
  };
}

export async function getRemediationTicketDetail(req, ticketId) {
  const ticket = await assertTenantTicketAccess(req, ticketId);
  const [items, responses, executionLogs] = await Promise.all([
    RemediationTicketItem.find({ ticketId: ticket._id }).sort({ itemName: 1 }).lean(),
    RemediationTicketResponse.find({ ticketId: ticket._id })
      .sort({ respondedAt: -1 })
      .lean(),
    RemediationExecutionLog.find({ ticketId: ticket._id })
      .sort({ executedAt: -1 })
      .lean(),
  ]);

  return { ticket, items, responses, executionLogs };
}

export async function getTicketForItsmReview(ticketId, tokenPayload) {
  const ticketOid = safeAsObjectId(ticketId);
  if (!ticketOid) throw new AppError("Invalid ticket id", 400);

  const ticket = await RemediationTicket.findById(ticketOid).lean();
  if (!ticket) throw new AppError("Ticket not found", 404);

  if (tokenPayload.tenantId && String(ticket.tenantId) !== String(tokenPayload.tenantId)) {
    throw new AppError("Ticket not found", 404);
  }
  if (
    tokenPayload.itsmEmail &&
    String(ticket.itsmEmail).toLowerCase() !== String(tokenPayload.itsmEmail).toLowerCase()
  ) {
    throw new AppError("Unauthorized review access", 403);
  }

  const items = await RemediationTicketItem.find({ ticketId: ticket._id })
    .sort({ itemName: 1, entitlementName: 1 })
    .lean();

  return { ticket, items };
}

export async function submitItsmTicketResponses(req, ticketId, tokenPayload) {
  const { itemIds = [], decision, comment = "", tentativeDate } = req.body || {};
  const normalizedDecision = String(decision || "").toUpperCase();
  if (!["GRANT_ACCESS", "PENDING"].includes(normalizedDecision)) {
    throw new AppError("Decision must be GRANT_ACCESS or PENDING", 400);
  }
  if (!Array.isArray(itemIds) || !itemIds.length) {
    throw new AppError("At least one ticket item must be selected", 400);
  }
  if (normalizedDecision === "PENDING" && !tentativeDate) {
    throw new AppError("tentativeDate is required for PENDING decisions", 400);
  }

  const ticketOid = safeAsObjectId(ticketId);
  if (!ticketOid) {
    throw new AppError("Invalid ticket id", 400);
  }

  const ticket = await RemediationTicket.findById(ticketOid);
  if (!ticket) throw new AppError("Ticket not found", 404);

  if (tokenPayload?.tenantId && String(ticket.tenantId) !== String(tokenPayload.tenantId)) {
    throw new AppError("Ticket not found", 404);
  }

  const itemObjectIds = itemIds.map(safeAsObjectId).filter(Boolean);
  if (!itemObjectIds.length) {
    throw new AppError("Invalid ticket item IDs", 400);
  }

  const now = new Date();
  const responderEmail =
    tokenPayload?.itsmEmail || req.user?.email || "itsm@unknown";

  const itemStatus =
    normalizedDecision === "GRANT_ACCESS" ? "APPROVED" : "PENDING_DECISION";

  const updateFields = {
    status: itemStatus,
    decision: normalizedDecision,
    comment: comment || "",
    respondedAt: now,
    respondedBy: responderEmail,
  };
  if (normalizedDecision === "PENDING") {
    updateFields.tentativeDate = new Date(tentativeDate);
  }

  const updateResult = await RemediationTicketItem.updateMany(
    {
      ticketId: ticket._id,
      _id: { $in: itemObjectIds },
      status: { $nin: ["APPROVED", "EXECUTED"] },
    },
    { $set: updateFields },
  );

  if (!updateResult.matchedCount) {
    throw new AppError(
      "No eligible ticket items found. They may have already been processed.",
      400,
    );
  }

  const updatedItems = await RemediationTicketItem.find({
    ticketId: ticket._id,
    _id: { $in: itemObjectIds },
  }).lean();

  await RemediationTicketResponse.create({
    tenantId: String(ticket.tenantId),
    ticketId: ticket._id,
    respondedBy: responderEmail,
    respondedByEmail: responderEmail,
    decision: normalizedDecision,
    comment,
    tentativeDate: normalizedDecision === "PENDING" ? new Date(tentativeDate) : undefined,
    itemIds: updatedItems.map((i) => i._id),
    itemCount: updateResult.modifiedCount || updatedItems.length,
    respondedAt: now,
    source: tokenPayload ? "ITSM_PORTAL" : "CONSOLE",
  });

  if (normalizedDecision === "GRANT_ACCESS" && ticket.queueId) {
    const queue = await RemediationQueue.findById(ticket.queueId).lean();
    if (queue?.eventId) {
      await updateStage(queue.eventId, "itsm", "GRANTED", now);
    }
    for (const item of updatedItems) {
      if (queue) {
        await createValidationForTicketItem(item, queue, {
          validationOwnerEmail: ticket.itsmEmail,
        });
      }
    }
  }

  const allItems = await RemediationTicketItem.find({ ticketId: ticket._id }).lean();
  ticket.itemCounts = computeItemCounts(allItems);
  ticket.status = deriveTicketStatusFromItems(allItems);
  if (ticket.status === "CLOSED") ticket.closedAt = now;
  ticket.lastStatusAt = now;
  await ticket.save();

  await upsertRemediationEventForTicket(
    { scopedTenantId: req.scopedTenantId || ticket.tenantId },
    ticket,
    allItems,
  );

  return { ticket, items: allItems, updatedCount: updateResult.modifiedCount };
}
