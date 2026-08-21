import mongoose from "mongoose";
import RemediationEvent from "../models/remediation/RemediationEvent.js";
import RemediationAuditLog from "../models/remediation/RemediationAuditLog.js";
import RemediationTicket from "../models/remediation/RemediationTicket.js";
import RemediationTicketItem from "../models/remediation/RemediationTicketItem.js";
import RemediationTicketResponse from "../models/remediation/RemediationTicketResponse.js";
import RemediationExecutionLog from "../models/remediation/RemediationExecutionLog.js";
import IdentityAccountLink from "../models/identity/IdentityAccountLink.js";
import Campaign from "../models/certification/Campaign.js";
import ReviewItem from "../models/certification/ReviewItem.js";
import Application from "../models/application/Application.js";
import { getDynamicIdentityModelForTenantId } from "../models/identity/Identity.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  remediationTenantFilter,
  remediationWithTenant,
} from "../utils/remediation/remediationTenant.js";
import { sendRemediationEmail } from "../services/remediationNotificationService.js";
import { resolveCertificationAccessTenantId } from "../utils/access-certification/resolveCertificationAccessTenantId.js";
import {
  asObjectId,
  getTenantApplicationIds,
} from "./access-certification/certificationControllerHelpers.js";
import { countRevokedEntitlementsForCampaign } from "../services/remediation/remediationRevokedUsersService.js";
import { resolveMappedUserModel } from "../utils/access-certification/mappedUserResolver.js";

const DEFAULT_TEMPLATES = {
  REVOKE_ACCESS: {
    email: "remediation-revoke-access",
    ticket: "ticket-revoke-access",
  },
  MISSING_MANAGER: {
    email: "remediation-missing-manager",
    ticket: "ticket-missing-manager",
  },
  DUPLICATE_ACCOUNT: {
    email: "remediation-duplicate-account",
    ticket: "ticket-duplicate-account",
  },
  ORPHAN_ACCOUNT: {
    email: "remediation-orphan-account",
    ticket: "ticket-orphan-account",
  },
  REVOKE_PRIVILEGED_ACCESS: {
    email: "remediation-revoke-privileged-access",
    ticket: "ticket-revoke-privileged-access",
  },
  INACTIVE_USER_ACCESS: {
    email: "remediation-inactive-user-access",
    ticket: "ticket-inactive-user-access",
  },
};

const REMEDIATION_ACTIONS = new Set(["GRANTED", "DENIED"]);

function deriveEventStateFromTicketStatus(ticketStatus) {
  switch (String(ticketStatus || "").toUpperCase()) {
    case "IN_PROGRESS":
      return { status: "IN_PROGRESS", workflowState: "TICKET_IN_PROGRESS" };
    case "CLOSED":
      return { status: "COMPLETED", workflowState: "TICKET_CLOSED" };
    case "EXECUTED":
      return { status: "COMPLETED", workflowState: "RECORD_UPDATED" };
    case "OPEN":
    default:
      return { status: "OPEN", workflowState: "TICKET_CREATED" };
  }
}

function deriveCampaignRemediationStatus(revokedUsers = []) {
  if (!revokedUsers.length) {
    return { status: "OPEN", ticketStatus: "OPEN" };
  }
  const pending = revokedUsers.some(
    (u) => !u.remediationAction || u.remediationAction === "PENDING",
  );
  if (pending) {
    return { status: "IN_PROGRESS", ticketStatus: "IN_PROGRESS" };
  }
  return { status: "COMPLETED", ticketStatus: "CLOSED" };
}

function mapReviewItemToRevokedUser(ri) {
  return {
    reviewItemId: String(ri._id),
    userId: ri.userId || "",
    itemId: ri.itemId || "",
    identityName: ri.itemName || "",
    identityEmail: ri.itemEmail || "",
    applicationId: ri.applicationId ? String(ri.applicationId) : "",
    applicationName: ri.itemApplicationName || "",
    accountId: ri.userPrimaryKey || ri.userId || ri.itemId || "",
    accessDetails: Array.isArray(ri.itemAccessDetails) ? ri.itemAccessDetails : [],
    remediationAction: "PENDING",
    actionAt: null,
    actionBy: null,
  };
}

function mergeRevokedUsers(existing = [], fromCampaign = []) {
  const byReviewItem = new Map(
    (existing || []).map((u) => [String(u.reviewItemId), u]),
  );
  return fromCampaign.map((fresh) => {
    const prev = byReviewItem.get(String(fresh.reviewItemId));
    if (!prev) return fresh;
    return {
      ...fresh,
      remediationAction: prev.remediationAction || "PENDING",
      actionAt: prev.actionAt || null,
      actionBy: prev.actionBy || null,
    };
  });
}

async function assertTenantCampaignAccess(req, campaignId) {
  const cId = asObjectId(campaignId);
  if (!cId) throw new AppError("Invalid campaign id", 400);

  const userTenantId = await resolveCertificationAccessTenantId(req);
  if (!userTenantId) {
    throw new AppError("Tenant not found for the current user", 403);
  }

  const campaign = await Campaign.findById(cId).lean();
  if (!campaign) throw new AppError("Campaign not found", 404);

  const tenantApplicationIds = await getTenantApplicationIds(userTenantId);
  const appId = campaign.applicationId ? String(campaign.applicationId) : null;
  const campaignTenantId = campaign.tenantId ? String(campaign.tenantId) : null;

  const allowed =
    (appId && tenantApplicationIds.some((id) => String(id) === appId)) ||
    (campaignTenantId && String(campaignTenantId) === String(userTenantId));

  if (!allowed) throw new AppError("Campaign not found", 404);

  return { campaign, userTenantId };
}

async function applyGrantToApplication({ applicationId, userId, itemEmail, accountId }) {
  const appOid = asObjectId(applicationId);
  if (!appOid) return { linkUpdated: false, appUserUpdated: false };

  let linkUpdated = false;
  const orClauses = [];
  if (accountId) orClauses.push({ accountId: String(accountId) });
  if (userId) orClauses.push({ accountId: String(userId) });
  if (orClauses.length) {
    const link = await IdentityAccountLink.findOneAndUpdate(
      { applicationId: appOid, $or: orClauses },
      {
        $set: {
          accessState: "active",
          remediationStatus: "granted",
          isActive: true,
        },
      },
      { new: true },
    );
    linkUpdated = Boolean(link);
  }

  let appUserUpdated = false;
  try {
    const app = await Application.findById(appOid).select("name tenantId").lean();
    if (app?.name && app?.tenantId) {
      const UsersModel = await resolveMappedUserModel(app);
      const userFilter = {
        applicationId: appOid,
        $or: [
          ...(userId ? [{ user_id: String(userId) }] : []),
          ...(itemEmail ? [{ email: itemEmail }] : []),
          ...(accountId ? [{ user_id: String(accountId) }] : []),
        ],
      };
      if (userFilter.$or.length) {
        const result = await UsersModel.updateOne(userFilter, {
          $set: { is_active: "true" },
        });
        appUserUpdated = result.modifiedCount > 0;
      }
    }
  } catch {
    // best-effort application sync
  }

  return { linkUpdated, appUserUpdated };
}

async function applyDenyToApplication({ applicationId, userId, accountId }) {
  const appOid = asObjectId(applicationId);
  if (!appOid) return false;

  const orClauses = [];
  if (accountId) orClauses.push({ accountId: String(accountId) });
  if (userId) orClauses.push({ accountId: String(userId) });
  if (!orClauses.length) return false;

  const link = await IdentityAccountLink.findOneAndUpdate(
    { applicationId: appOid, $or: orClauses },
    { $set: { remediationStatus: "denied", accessState: "revoked" } },
    { new: true },
  );
  return Boolean(link);
}

function toEventType(value) {
  const v = String(value || "").trim().toUpperCase();
  return DEFAULT_TEMPLATES[v] ? v : null;
}

function createPseudoTicketId() {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RM-${stamp}-${rand}`;
}

function cloneJson(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function buildDuplicateMetadata(event) {
  const metadata = cloneJson(event?.metadata, {});

  if (Array.isArray(metadata?.revokedUsers)) {
    metadata.revokedUsers = metadata.revokedUsers.map((user) => ({
      ...user,
      remediationAction: "PENDING",
      actionAt: null,
      actionBy: null,
    }));
  }

  if (metadata?.itemCounts && typeof metadata.itemCounts === "object") {
    const total =
      Number(metadata.itemCounts.total) ||
      Number(metadata.selectedUsersCount) ||
      0;
    metadata.itemCounts = {
      total,
      pending: total,
      approved: 0,
      denied: 0,
      executed: 0,
    };
  }

  return metadata;
}

async function deleteLinkedTicketArtifacts(ticketRecordId) {
  const ticketOid = asObjectId(ticketRecordId);
  if (!ticketOid) return;

  await Promise.all([
    RemediationTicketItem.deleteMany({ ticketId: ticketOid }),
    RemediationTicketResponse.deleteMany({ ticketId: ticketOid }),
    RemediationExecutionLog.deleteMany({ ticketId: ticketOid }),
    RemediationTicket.deleteOne({ _id: ticketOid }),
  ]);
}

function buildNotificationData(event, req) {
  return {
    eventType: event.eventType,
    title: event.title || "Remediation Action Required",
    description: event.description || "",
    identityName: event.subject?.identityName || "",
    identityEmail: event.subject?.identityEmail || "",
    accountId: event.subject?.accountId || "",
    applicationName: event.subject?.applicationName || "",
    itsmEmail: event.itsmEmail || "",
    ticketId: event.ticket?.ticketId || "",
    ticketStatus: event.ticket?.ticketStatus || "",
    remediationUrl: `${process.env.FRONTEND_URL || "http://localhost:3000"}/remediation/remediation`,
    triggeredBy: req?.user?.email || "system",
  };
}

async function logRemediationAudit(ctx, entry) {
  try {
    await RemediationAuditLog.create(
      remediationWithTenant(ctx.scopedTenantId, {
        ...entry,
        performedBy:
          entry.performedBy || ctx.user?.email || ctx.user?.id || "system",
        performedAt: entry.performedAt || new Date(),
      }),
    );
  } catch {
    // non-blocking
  }
}

async function updateAccountLinkRecords(event) {
  const updates = {};
  const statusValue = String(event.status || "").toLowerCase();
  if (statusValue) updates.remediationStatus = statusValue;

  if (
    event.eventType === "REVOKE_ACCESS" ||
    event.eventType === "DUPLICATE_ACCOUNT" ||
    event.eventType === "REVOKE_PRIVILEGED_ACCESS"
  ) {
    updates.accessState = "revoked";
  }
  if (event.eventType === "ORPHAN_ACCOUNT") {
    updates.orphanStatus = "resolved";
  }

  if (!Object.keys(updates).length) return null;

  const linkId = event.subject?.accountLinkId;
  if (linkId && mongoose.isValidObjectId(linkId)) {
    return IdentityAccountLink.findByIdAndUpdate(
      linkId,
      { $set: updates },
      { new: true },
    );
  }

  const filters = [];
  if (event.subject?.identityId && mongoose.isValidObjectId(event.subject.identityId)) {
    filters.push({ identityId: event.subject.identityId });
  }
  if (event.subject?.accountId) {
    filters.push({ accountId: event.subject.accountId });
  }
  if (event.subject?.applicationId && mongoose.isValidObjectId(event.subject.applicationId)) {
    filters.push({ applicationId: event.subject.applicationId });
  }

  if (!filters.length) return null;

  return IdentityAccountLink.findOneAndUpdate(
    { $and: filters },
    { $set: updates },
    { new: true },
  );
}

async function updateIdentityRecords(event, scopedTenantId) {
  const identityId = event.subject?.identityId;
  const identityEmail = event.subject?.identityEmail;
  if (!identityId && !identityEmail) return null;

  const IdentityModel = await getDynamicIdentityModelForTenantId(scopedTenantId);
  const filter = identityId && mongoose.isValidObjectId(identityId)
    ? { _id: identityId }
    : { email: identityEmail };

  const updates = {};
  if (event.eventType === "MISSING_MANAGER") {
    updates.managerCorrelationStatus = "resolved";
  }
  updates.governanceStatus = "remediated";

  if (!Object.keys(updates).length) return null;

  return IdentityModel.findOneAndUpdate(filter, { $set: updates }, { new: true });
}

export async function listRemediationEvents(req, res, next) {
  try {
    const base = remediationTenantFilter(req.scopedTenantId);
    const {
      eventType,
      status,
      ticketStatus,
      itsmEmail,
      page = 1,
      limit = 50,
    } = req.query;

    const filter = { ...base };
    if (eventType) filter.eventType = String(eventType).toUpperCase();
    if (status) filter.status = String(status).toUpperCase();
    if (ticketStatus) filter["ticket.ticketStatus"] = String(ticketStatus);
    if (itsmEmail) filter.itsmEmail = itsmEmail;

    const skip =
      (Math.max(1, parseInt(page, 10)) - 1) *
      Math.min(500, Math.max(1, parseInt(limit, 10)));
    const cap = Math.min(500, Math.max(1, parseInt(limit, 10)));

    const [rows, total] = await Promise.all([
      RemediationEvent.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(cap)
        .lean(),
      RemediationEvent.countDocuments(filter),
    ]);

    const linkedTicketIds = rows
      .map((row) => row?.ticket?.ticketRecordId)
      .filter((value) => mongoose.isValidObjectId(value));

    let ticketMap = new Map();
    if (linkedTicketIds.length) {
      const tickets = await RemediationTicket.find({
        _id: { $in: linkedTicketIds },
      })
        .select("_id status itemCounts closedAt executedAt lastStatusAt")
        .lean();
      ticketMap = new Map(tickets.map((ticket) => [String(ticket._id), ticket]));
    }

    const enrichedRows = rows.map((row) => {
      const linkedTicketId = row?.ticket?.ticketRecordId;
      const linkedTicket = linkedTicketId ? ticketMap.get(String(linkedTicketId)) : null;
      if (!linkedTicket) return row;

      const { status: eventStatus, workflowState } = deriveEventStateFromTicketStatus(
        linkedTicket.status,
      );

      return {
        ...row,
        status: eventStatus,
        workflowState,
        metadata: {
          ...(row.metadata || {}),
          itemCounts: linkedTicket.itemCounts || row.metadata?.itemCounts || {},
        },
        ticket: {
          ...(row.ticket || {}),
          ticketStatus: linkedTicket.status || row.ticket?.ticketStatus,
          closedAt:
            linkedTicket.closedAt ||
            linkedTicket.executedAt ||
            row.ticket?.closedAt,
        },
        completedAt:
          linkedTicket.status === "CLOSED" || linkedTicket.status === "EXECUTED"
            ? linkedTicket.executedAt || linkedTicket.closedAt || row.completedAt
            : row.completedAt,
        lastStatusAt: linkedTicket.lastStatusAt || row.lastStatusAt,
      };
    });

    res.json({
      success: true,
      data: enrichedRows,
      pagination: {
        page: parseInt(page, 10),
        limit: cap,
        total,
        pages: Math.ceil(total / cap),
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function getRemediationEvent(req, res, next) {
  try {
    const event = await RemediationEvent.findOne({
      ...remediationTenantFilter(req.scopedTenantId),
      _id: req.params.id,
    }).lean();
    if (!event) throw new AppError("Remediation event not found", 404);
    res.json({ success: true, data: event });
  } catch (e) {
    next(e);
  }
}

export async function createRemediationEvent(req, res, next) {
  try {
    const {
      eventType,
      itsmEmail,
      title,
      description,
      subject,
      source,
      metadata,
      notificationTemplateKey,
      ticketTemplateKey,
    } = req.body || {};

    const resolvedType = toEventType(eventType);
    if (!resolvedType) {
      throw new AppError("Invalid remediation event type", 400);
    }

    const defaults = DEFAULT_TEMPLATES[resolvedType] || {};
    const resolvedItsmEmail = itsmEmail || req.user?.email || "";

    const event = await RemediationEvent.create(
      remediationWithTenant(req.scopedTenantId, {
        eventType: resolvedType,
        status: "OPEN",
        workflowState: "DETECTED",
        title,
        description,
        itsmEmail: resolvedItsmEmail,
        subject: subject || {},
        source: source || {},
        metadata: metadata || {},
        notification: {
          templateKey: notificationTemplateKey || defaults.email,
          status: resolvedItsmEmail ? "PENDING" : "SKIPPED",
          to: resolvedItsmEmail || undefined,
        },
        ticket: {
          templateKey: ticketTemplateKey || defaults.ticket,
          ticketId: createPseudoTicketId(),
          ticketStatus: "OPEN",
          openedAt: new Date(),
          assignedEmail: resolvedItsmEmail,
        },
        lastStatusAt: new Date(),
      }),
    );

    await logRemediationAudit(req, {
      remediationEventId: event._id,
      action: "CREATE",
      newValue: event,
    });

    if (resolvedItsmEmail && event.notification?.templateKey) {
      try {
        const notify = await sendRemediationEmail({
          templateKey: event.notification.templateKey,
          to: resolvedItsmEmail,
          data: buildNotificationData(event, req),
        });

        await RemediationEvent.updateOne(
          { _id: event._id },
          {
            $set: {
              "notification.status": notify.status,
              "notification.sentAt": notify.status === "SENT" ? new Date() : undefined,
              "notification.error": notify.error || undefined,
              workflowState:
                notify.status === "SENT" ? "NOTIFIED" : "NOTIFICATION_FAILED",
            },
          },
        );

        await logRemediationAudit(req, {
          remediationEventId: event._id,
          action: "NOTIFY",
          newValue: { status: notify.status },
          note: notify.error,
        });
      } catch (err) {
        await RemediationEvent.updateOne(
          { _id: event._id },
          {
            $set: {
              "notification.status": "FAILED",
              "notification.error": err?.message || "Failed to send",
              workflowState: "NOTIFICATION_FAILED",
            },
          },
        );
      }
    }

    const refreshed = await RemediationEvent.findById(event._id).lean();
    res.status(201).json({ success: true, data: refreshed || event });
  } catch (e) {
    next(e);
  }
}

export async function patchRemediationEvent(req, res, next) {
  try {
    const event = await RemediationEvent.findOne({
      ...remediationTenantFilter(req.scopedTenantId),
      _id: req.params.id,
    });
    if (!event) throw new AppError("Remediation event not found", 404);

    const allowed = [
      "status",
      "workflowState",
      "itsmEmail",
      "title",
      "description",
      "subject",
      "metadata",
      "ticketStatus",
      "ticketId",
      "ticketUrl",
      "ticketTemplateKey",
      "assignedEmail",
    ];

    const updates = {};
    for (const key of allowed) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) {
        updates[key] = req.body[key];
      }
    }

    const setOps = {};
    if (updates.status) setOps.status = String(updates.status).toUpperCase();
    if (updates.workflowState) {
      setOps.workflowState = String(updates.workflowState).toUpperCase();
    }
    if (updates.itsmEmail !== undefined) setOps.itsmEmail = updates.itsmEmail;
    if (updates.title !== undefined) setOps.title = updates.title;
    if (updates.description !== undefined) setOps.description = updates.description;
    if (updates.subject) setOps.subject = updates.subject;
    if (updates.metadata) setOps.metadata = updates.metadata;

    if (updates.ticketStatus !== undefined) {
      setOps["ticket.ticketStatus"] = updates.ticketStatus;
      const ts = String(updates.ticketStatus).toUpperCase();
      if (!setOps.status) {
        if (ts === "OPEN") setOps.status = "OPEN";
        else if (ts === "IN_PROGRESS") setOps.status = "IN_PROGRESS";
        else if (ts === "CLOSED" || ts === "EXECUTED") setOps.status = "COMPLETED";
      }
      if (!setOps.workflowState) {
        if (ts === "CLOSED") setOps.workflowState = "TICKET_CLOSED";
        else if (ts === "EXECUTED") setOps.workflowState = "RECORD_UPDATED";
        else if (ts === "IN_PROGRESS") setOps.workflowState = "TICKET_IN_PROGRESS";
        else if (ts === "OPEN") setOps.workflowState = "TICKET_CREATED";
      }
    }
    if (updates.ticketId !== undefined) {
      setOps["ticket.ticketId"] = updates.ticketId;
    }
    if (updates.ticketUrl !== undefined) {
      setOps["ticket.ticketUrl"] = updates.ticketUrl;
    }
    if (updates.ticketTemplateKey !== undefined) {
      setOps["ticket.templateKey"] = updates.ticketTemplateKey;
    }
    if (updates.assignedEmail !== undefined) {
      setOps["ticket.assignedEmail"] = updates.assignedEmail;
    }
    if (updates.itsmEmail !== undefined && updates.assignedEmail === undefined) {
      setOps["ticket.assignedEmail"] = updates.itsmEmail;
    }

    if (Object.keys(setOps).length === 0) {
      throw new AppError("No valid updates provided", 400);
    }

    const prev = event.toObject();
    const updated = await RemediationEvent.findByIdAndUpdate(
      event._id,
      {
        $set: {
          ...setOps,
          lastStatusAt: new Date(),
        },
      },
      { new: true },
    );

    const linkedTicketId = event.ticket?.ticketRecordId;
    if (linkedTicketId) {
      const ticketOid = asObjectId(linkedTicketId);
      if (ticketOid) {
        const ticketSetOps = {};
        if (updates.title !== undefined) ticketSetOps.title = updates.title;
        if (updates.description !== undefined) {
          ticketSetOps.description = updates.description;
        }
        if (updates.itsmEmail !== undefined) {
          ticketSetOps.itsmEmail = String(updates.itsmEmail || "")
            .trim()
            .toLowerCase();
        }
        if (updates.ticketStatus !== undefined) {
          ticketSetOps.status = String(updates.ticketStatus).toUpperCase();
        }
        if (Object.keys(ticketSetOps).length) {
          ticketSetOps.lastStatusAt = new Date();
          if (ticketSetOps.status === "CLOSED" || ticketSetOps.status === "EXECUTED") {
            ticketSetOps.closedAt = event.completedAt || new Date();
          }
          await RemediationTicket.updateOne({ _id: ticketOid }, { $set: ticketSetOps });
        }
      }
    }

    if (updated) {
      await logRemediationAudit(req, {
        remediationEventId: updated._id,
        action: "UPDATE",
        oldValue: prev,
        newValue: updated,
      });
    }

    if (updated && updated.status === "COMPLETED") {
      await updateAccountLinkRecords(updated);
      await updateIdentityRecords(updated, req.scopedTenantId);
      await RemediationEvent.updateOne(
        { _id: updated._id },
        {
          $set: {
            completedAt: updated.completedAt || new Date(),
            workflowState: "RECORD_UPDATED",
          },
        },
      );

      await logRemediationAudit(req, {
        remediationEventId: updated._id,
        action: "RECORD_UPDATE",
        note: "Updated identity/account records on completion",
      });
    }

    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
}

export async function duplicateRemediationEvent(req, res, next) {
  try {
    const existing = await RemediationEvent.findOne({
      ...remediationTenantFilter(req.scopedTenantId),
      _id: req.params.id,
    }).lean();
    if (!existing) throw new AppError("Remediation event not found", 404);

    const now = new Date();
    const duplicate = await RemediationEvent.create(
      remediationWithTenant(req.scopedTenantId, {
        eventType: existing.eventType,
        status: "OPEN",
        workflowState: existing.ticket?.ticketRecordId ? "TICKET_CREATED" : "DETECTED",
        title: existing.title ? `${existing.title} (Copy)` : undefined,
        description: existing.description,
        itsmEmail: existing.itsmEmail,
        subject: cloneJson(existing.subject, {}),
        source: cloneJson(existing.source, {}),
        metadata: buildDuplicateMetadata(existing),
        notification: {
          templateKey: existing.notification?.templateKey,
          status: "SKIPPED",
          to: existing.itsmEmail || undefined,
        },
        ticket: {
          templateKey: existing.ticket?.templateKey,
          ticketId: createPseudoTicketId(),
          ticketStatus: "OPEN",
          openedAt: now,
          assignedEmail: existing.ticket?.assignedEmail || existing.itsmEmail || "",
        },
        lastStatusAt: now,
      }),
    );

    await logRemediationAudit(req, {
      remediationEventId: duplicate._id,
      action: "CREATE",
      newValue: duplicate,
      note: `Duplicated from remediation event ${existing._id}`,
    });

    res.status(201).json({ success: true, data: duplicate });
  } catch (e) {
    next(e);
  }
}

export async function deleteRemediationEvent(req, res, next) {
  try {
    const event = await RemediationEvent.findOne({
      ...remediationTenantFilter(req.scopedTenantId),
      _id: req.params.id,
    });
    if (!event) throw new AppError("Remediation event not found", 404);

    const snapshot = event.toObject();
    if (event.ticket?.ticketRecordId) {
      await deleteLinkedTicketArtifacts(event.ticket.ticketRecordId);
    }

    await RemediationEvent.deleteOne({ _id: event._id });

    await logRemediationAudit(req, {
      remediationEventId: snapshot._id,
      action: "DELETE",
      oldValue: snapshot,
    });

    res.json({ success: true, data: { _id: String(snapshot._id) } });
  } catch (e) {
    next(e);
  }
}

export async function listApplicationCampaigns(req, res, next) {
  try {
    const userTenantId = await resolveCertificationAccessTenantId(req);
    if (!userTenantId) {
      throw new AppError("Tenant not found for the current user", 403);
    }

    const tenantApplicationIds = await getTenantApplicationIds(userTenantId);
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(100, Math.max(Number(req.query.limit || 50), 1));

    const query = {
      applicationId: { $in: tenantApplicationIds },
    };
    if (req.query.status) query.status = req.query.status;

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
      items.map(async (c) => {
        const revokedCount = await countRevokedEntitlementsForCampaign(c._id);
        return {
          _id: c._id,
          name: c.name,
          description: c.description,
          status: c.status,
          applicationId: c.applicationId?._id || c.applicationId,
          applicationName:
            c.applicationName || c.applicationId?.name || "Unknown Application",
          category: c.category,
          certificationScope: c.certificationScope,
          revokedCount,
          createdAt: c.createdAt,
          endDate: c.endDate,
        };
      }),
    );

    res.json({
      success: true,
      data: enriched,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function getCampaignRevokedUsers(req, res, next) {
  try {
    const { campaign } = await assertTenantCampaignAccess(req, req.params.campaignId);

    const reviewItems = await ReviewItem.find({
      campaignId: campaign._id,
      status: "REVOKED",
    })
      .sort({ itemName: 1, itemEmail: 1 })
      .lean();

    const revokedUsers = reviewItems.map(mapReviewItemToRevokedUser);

    let event = await RemediationEvent.findOne({
      ...remediationTenantFilter(req.scopedTenantId),
      eventType: "REVOKE_ACCESS",
      "source.sourceId": String(campaign._id),
    }).lean();

    if (event) {
      const merged = mergeRevokedUsers(
        event.metadata?.revokedUsers || [],
        revokedUsers,
      );
      event = { ...event, metadata: { ...(event.metadata || {}), revokedUsers: merged } };
    }

    const derived = deriveCampaignRemediationStatus(
      event?.metadata?.revokedUsers || revokedUsers,
    );

    res.json({
      success: true,
      data: {
        campaign: {
          _id: campaign._id,
          name: campaign.name,
          applicationId: campaign.applicationId,
          applicationName: campaign.applicationName,
          status: campaign.status,
        },
        revokedUsers: event?.metadata?.revokedUsers || revokedUsers,
        remediationEvent: event || null,
        derivedStatus: derived,
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function importCampaignRevokeEvent(req, res, next) {
  try {
    const { campaign } = await assertTenantCampaignAccess(req, req.params.campaignId);

    const reviewItems = await ReviewItem.find({
      campaignId: campaign._id,
      status: "REVOKED",
    }).lean();

    const revokedUsers = reviewItems.map(mapReviewItemToRevokedUser);
    const derived = deriveCampaignRemediationStatus(revokedUsers);

    let event = await RemediationEvent.findOne({
      ...remediationTenantFilter(req.scopedTenantId),
      eventType: "REVOKE_ACCESS",
      "source.sourceId": String(campaign._id),
    });

    const appId = campaign.applicationId ? String(campaign.applicationId) : "";
    const appName = campaign.applicationName || "";

    if (event) {
      const merged = mergeRevokedUsers(
        event.metadata?.revokedUsers || [],
        revokedUsers,
      );
      event.metadata = { ...(event.metadata || {}), revokedUsers: merged };
      const nextDerived = deriveCampaignRemediationStatus(merged);
      event.status = nextDerived.status;
      event.ticket = event.ticket || {};
      event.ticket.ticketStatus = nextDerived.ticketStatus;
      event.lastStatusAt = new Date();
      await event.save();
    } else {
      event = await RemediationEvent.create(
        remediationWithTenant(req.scopedTenantId, {
          eventType: "REVOKE_ACCESS",
          status: derived.status,
          workflowState: "DETECTED",
          title: `Revoke remediation — ${campaign.name}`,
          description: `Remediation for revoked users from campaign "${campaign.name}"`,
          itsmEmail: req.user?.email || "",
          subject: {
            applicationId: appId,
            applicationName: appName,
          },
          source: {
            sourceType: "ACCESS_CERTIFICATION_CAMPAIGN",
            sourceId: String(campaign._id),
            sourceRef: campaign.name,
          },
          metadata: {
            campaignId: String(campaign._id),
            campaignName: campaign.name,
            applicationId: appId,
            applicationName: appName,
            revokedUsers,
          },
          ticket: {
            templateKey: DEFAULT_TEMPLATES.REVOKE_ACCESS.ticket,
            ticketId: createPseudoTicketId(),
            ticketStatus: derived.ticketStatus,
            openedAt: new Date(),
            assignedEmail: req.user?.email || "",
          },
          lastStatusAt: new Date(),
        }),
      );

      await logRemediationAudit(req, {
        remediationEventId: event._id,
        action: "CREATE",
        newValue: event,
        note: "Imported from access certification campaign",
      });
    }

    const refreshed = await RemediationEvent.findById(event._id).lean();
    res.status(event ? 200 : 201).json({ success: true, data: refreshed });
  } catch (e) {
    next(e);
  }
}

export async function submitCampaignRevokeActions(req, res, next) {
  try {
    const { campaign } = await assertTenantCampaignAccess(req, req.params.campaignId);
    const { reviewItemIds = [], action } = req.body || {};

    const normalizedAction = String(action || "").toUpperCase();
    if (!REMEDIATION_ACTIONS.has(normalizedAction)) {
      throw new AppError("Action must be GRANTED or DENIED", 400);
    }
    if (!Array.isArray(reviewItemIds) || !reviewItemIds.length) {
      throw new AppError("At least one review item must be selected", 400);
    }

    let event = await RemediationEvent.findOne({
      ...remediationTenantFilter(req.scopedTenantId),
      eventType: "REVOKE_ACCESS",
      "source.sourceId": String(campaign._id),
    });

    if (!event) {
      throw new AppError(
        "Remediation event not found. Import the campaign first.",
        404,
      );
    }

    const selectedSet = new Set(reviewItemIds.map(String));
    const revokedUsers = Array.isArray(event.metadata?.revokedUsers)
      ? [...event.metadata.revokedUsers]
      : [];
    const now = new Date();
    const actor = req.user?.email || "system";

    for (const user of revokedUsers) {
      if (!selectedSet.has(String(user.reviewItemId))) continue;
      if (user.remediationAction && user.remediationAction !== "PENDING") {
        continue;
      }

      user.remediationAction = normalizedAction;
      user.actionAt = now;
      user.actionBy = actor;

      if (normalizedAction === "GRANTED") {
        await applyGrantToApplication({
          applicationId: user.applicationId || event.subject?.applicationId,
          userId: user.userId,
          itemEmail: user.identityEmail,
          accountId: user.accountId,
        });
      } else {
        await applyDenyToApplication({
          applicationId: user.applicationId || event.subject?.applicationId,
          userId: user.userId,
          accountId: user.accountId,
        });
      }
    }

    const derived = deriveCampaignRemediationStatus(revokedUsers);
    event.metadata = { ...(event.metadata || {}), revokedUsers };
    event.status = derived.status;
    event.ticket = event.ticket || {};
    event.ticket.ticketStatus = derived.ticketStatus;
    if (derived.status === "COMPLETED") {
      event.completedAt = now;
      event.workflowState = "RECORD_UPDATED";
    } else {
      event.workflowState = "TICKET_IN_PROGRESS";
    }
    event.lastStatusAt = now;
    await event.save();

    await logRemediationAudit(req, {
      remediationEventId: event._id,
      action: "UPDATE",
      newValue: {
        action: normalizedAction,
        reviewItemIds,
        status: derived.status,
      },
      note: `Campaign revoke remediation: ${normalizedAction}`,
    });

    const refreshed = await RemediationEvent.findById(event._id).lean();
    res.json({
      success: true,
      data: refreshed,
      derivedStatus: derived,
    });
  } catch (e) {
    next(e);
  }
}
