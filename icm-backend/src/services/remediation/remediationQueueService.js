import RemediationQueue from "../../models/remediation/RemediationQueue.js";
import RemediationQueueItem from "../../models/remediation/RemediationQueueItem.js";
import RemediationTicket from "../../models/remediation/RemediationTicket.js";
import { initTracking } from "./remediationTrackingService.js";

const EVENT_TYPE_PREFIX = {
  REVOKE_ACCESS: "RA",
  MISSING_MANAGER: "MM",
  ORPHAN_ACCOUNT: "OA",
  DUPLICATE_ACCOUNT: "DA",
  INACTIVE_USER_ACCESS: "IU",
  SOD_VIOLATION: "SV",
};

const EVENT_TO_QUEUE_TYPE = {
  REVOKE_ACCESS: "ACCESS_CERTIFICATION",
  MISSING_MANAGER: "IDENTITY_QUALITY",
  ORPHAN_ACCOUNT: "CORRELATION_ENGINE",
  DUPLICATE_ACCOUNT: "IDENTITY_QUALITY",
  INACTIVE_USER_ACCESS: "ACCESS_ANALYTICS",
  SOD_VIOLATION: "SOD_ENGINE",
};

export function generateEventId(eventType) {
  const prefix = EVENT_TYPE_PREFIX[eventType] || "RQ";
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RQ-${prefix}-${stamp}-${rand}`;
}

export function resolveQueueType(eventType) {
  return EVENT_TO_QUEUE_TYPE[eventType] || "IDENTITY_QUALITY";
}

export async function preventDuplicateEvents(tenantId, eventType, sourceId) {
  const existing = await RemediationQueue.findOne({
    tenantId: String(tenantId),
    eventType,
    sourceId: String(sourceId),
    status: { $nin: ["CLOSED", "VALIDATED"] },
  }).lean();
  return existing;
}

export async function createQueueEvent({
  tenantId,
  eventType,
  eventQueueType,
  sourceCollection,
  sourceId,
  certificationId,
  certificationName,
  applicationId,
  applicationName,
  totalUsersReviewed = 0,
  revokedUsersCount = 0,
  approvedUsersCount = 0,
  pendingUsersCount = 0,
  subjectCount = 0,
  severity = "MEDIUM",
  queuedBy = "system",
  detectionSnapshot,
  metadata,
}) {
  const duplicate = await preventDuplicateEvents(tenantId, eventType, sourceId);
  if (duplicate) return { queue: duplicate, created: false };

  const eventId = generateEventId(eventType);
  const queue = await RemediationQueue.create({
    tenantId: String(tenantId),
    eventId,
    eventType,
    eventQueueType: eventQueueType || resolveQueueType(eventType),
    sourceCollection,
    sourceId: String(sourceId),
    certificationId,
    certificationName,
    applicationId,
    applicationName,
    totalUsersReviewed,
    revokedUsersCount,
    approvedUsersCount,
    pendingUsersCount,
    subjectCount,
    severity,
    status: "PENDING",
    ticketCreated: false,
    queuedAt: new Date(),
    queuedBy,
    detectionSnapshot,
    metadata,
  });

  await initTracking({ tenantId, queueId: queue._id, eventId });

  return { queue, created: true };
}

export async function createQueueItems(queueId, tenantId, subjects = []) {
  if (!subjects.length) return [];

  const docs = subjects.map((s) => ({
    tenantId: String(tenantId),
    queueId,
    identityId: s.identityId ? String(s.identityId) : undefined,
    identityName: s.identityName || s.itemName || s.displayName || "",
    identityEmail: s.identityEmail || s.itemEmail || s.email || "",
    accountId: s.accountId ? String(s.accountId) : undefined,
    entitlementName: s.entitlementName || "",
    applicationId: s.applicationId || undefined,
    applicationName: s.applicationName || "",
    managerEmail: s.managerEmail || s.manager || "",
    reviewItemId: s.reviewItemId || undefined,
    campaignId: s.campaignId || undefined,
    itemKey: s.itemKey || undefined,
    accessDetails: s.accessDetails || [],
    currentStatus: "PENDING",
    metadata: s.metadata || undefined,
  }));

  return RemediationQueueItem.insertMany(docs, { ordered: false });
}

export async function listQueueRecords({
  tenantId,
  page = 1,
  limit = 20,
  eventType,
  status,
  certificationId,
  applicationId,
  search,
}) {
  const filter = { tenantId: String(tenantId) };
  if (eventType) filter.eventType = String(eventType).toUpperCase();
  if (status) filter.status = String(status).toUpperCase();
  if (certificationId) filter.certificationId = certificationId;
  if (applicationId) filter.applicationId = applicationId;
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { eventId: rx },
      { certificationName: rx },
      { applicationName: rx },
    ];
  }

  const pg = Math.max(1, Number(page) || 1);
  const cap = Math.min(100, Math.max(1, Number(limit) || 20));

  const [items, total] = await Promise.all([
    RemediationQueue.find(filter)
      .sort({ queuedAt: -1 })
      .skip((pg - 1) * cap)
      .limit(cap)
      .lean(),
    RemediationQueue.countDocuments(filter),
  ]);

  return {
    items,
    pagination: { page: pg, limit: cap, total, pages: Math.ceil(total / cap) || 0 },
  };
}

export async function getQueueById(tenantId, queueId) {
  return RemediationQueue.findOne({ tenantId: String(tenantId), _id: queueId }).lean();
}

export async function listQueueItems(tenantId, queueId, { page = 1, limit = 50, search = "" } = {}) {
  const filter = { tenantId: String(tenantId), queueId };
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { identityName: rx },
      { identityEmail: rx },
      { entitlementName: rx },
      { applicationName: rx },
    ];
  }

  const pg = Math.max(1, Number(page) || 1);
  const cap = Math.min(200, Math.max(1, Number(limit) || 50));

  const [items, total] = await Promise.all([
    RemediationQueueItem.find(filter)
      .sort({ identityName: 1 })
      .skip((pg - 1) * cap)
      .limit(cap)
      .lean(),
    RemediationQueueItem.countDocuments(filter),
  ]);

  return {
    items,
    pagination: { page: pg, limit: cap, total, pages: Math.ceil(total / cap) || 0 },
  };
}

export async function markQueueTicketCreated(queueId, ticketId) {
  return RemediationQueue.findByIdAndUpdate(
    queueId,
    {
      $set: {
        status: "TICKET_CREATED",
        ticketCreated: true,
        ticketId,
      },
    },
    { new: true },
  );
}

export async function updateQueueStatus(queueId, status) {
  return RemediationQueue.findByIdAndUpdate(queueId, { $set: { status } }, { new: true });
}

export async function refreshQueueSubjects(queueId, tenantId, subjects = [], counts = {}) {
  await RemediationQueueItem.deleteMany({ queueId, tenantId: String(tenantId) });
  if (subjects.length) {
    await createQueueItems(queueId, tenantId, subjects);
  }
  return RemediationQueue.findByIdAndUpdate(
    queueId,
    {
      $set: {
        subjectCount: counts.subjectCount ?? subjects.length,
        revokedUsersCount: counts.revokedUsersCount ?? subjects.length,
        ...counts,
      },
    },
    { new: true },
  );
}

export async function reconcileQueueTicketFlags(tenantId) {
  const tid = String(tenantId);
  const tickets = await RemediationTicket.find({
    tenantId: tid,
    queueId: { $exists: true, $ne: null },
  })
    .select("queueId status")
    .lean();

  let updated = 0;
  for (const ticket of tickets) {
    const queue = await RemediationQueue.findById(ticket.queueId).select("ticketCreated status").lean();
    if (!queue || queue.ticketCreated) continue;

    const nextStatus =
      queue.status === "PENDING" ? "TICKET_CREATED" : queue.status;
    await RemediationQueue.updateOne(
      { _id: ticket.queueId },
      {
        $set: {
          ticketCreated: true,
          ticketId: ticket._id,
          status: nextStatus,
        },
      },
    );
    updated += 1;
  }
  return { updated };
}

export async function getQueueSummary(tenantId) {
  const tid = String(tenantId);
  const statusAgg = await RemediationQueue.aggregate([
    { $match: { tenantId: tid } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const byStatus = {};
  let total = 0;
  for (const row of statusAgg) {
    const key = row._id || "UNKNOWN";
    byStatus[key] = row.count;
    total += row.count;
  }
  const withTicket = await RemediationQueue.countDocuments({
    tenantId: tid,
    $or: [{ ticketCreated: true }, { ticketId: { $exists: true, $ne: null } }],
  });
  return { total, byStatus, withTicket };
}

export {
  EVENT_TYPE_PREFIX,
  EVENT_TO_QUEUE_TYPE,
};
