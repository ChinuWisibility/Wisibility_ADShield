import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import IdentityAccountLink from "../../models/identity/IdentityAccountLink.js";
import RemediationTicket from "../../models/remediation/RemediationTicket.js";
import RemediationTicketItem from "../../models/remediation/RemediationTicketItem.js";
import RemediationExecutionLog from "../../models/remediation/RemediationExecutionLog.js";
import RemediationAuditLog from "../../models/remediation/RemediationAuditLog.js";
import { resolveMappedUserModel } from "../../utils/access-certification/mappedUserResolver.js";
import { asObjectId } from "../../controllers/access-certification/certificationControllerHelpers.js";
import { remediationWithTenant } from "../../utils/remediation/remediationTenant.js";
import { upsertRemediationEventForTicket } from "./remediationEventSyncService.js";
import { runValidationsForExecutedItem } from "./remediationValidationService.js";

async function captureBeforeState({ applicationId, userId, itemEmail, accountId }) {
  const appOid = asObjectId(applicationId);
  if (!appOid) return null;

  const linkOr = [];
  if (userId) linkOr.push({ accountId: String(userId) });
  if (itemEmail) {
    const IdentityAccountLinkModel = IdentityAccountLink;
    // link by accountId primarily
  }

  let link = null;
  if (linkOr.length) {
    link = await IdentityAccountLink.findOne({
      applicationId: appOid,
      $or: linkOr,
    }).lean();
  }

  let appUser = null;
  try {
    const app = await Application.findById(appOid).select("name tenantId").lean();
    if (app?.name && app?.tenantId) {
      const UsersModel = await resolveMappedUserModel(app);
      const filter = {
        applicationId: appOid,
        $or: [
          ...(userId ? [{ user_id: String(userId) }] : []),
          ...(itemEmail ? [{ email: itemEmail }] : []),
        ],
      };
      if (filter.$or.length) {
        appUser = await UsersModel.findOne(filter).lean();
      }
    }
  } catch {
    // best effort
  }

  return {
    accessState: link?.accessState || null,
    remediationStatus: link?.remediationStatus || null,
    isActive: link?.isActive ?? null,
    appUserActive: appUser?.is_active ?? appUser?.isActive ?? null,
  };
}

async function applyGrant({ applicationId, userId, itemEmail, accountId }) {
  const appOid = asObjectId(applicationId);
  if (!appOid) return { linkUpdated: false, appUserUpdated: false };

  const orClauses = [];
  if (accountId) orClauses.push({ accountId: String(accountId) });
  if (userId) orClauses.push({ accountId: String(userId) });

  let linkUpdated = false;
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
    // best effort
  }

  return { linkUpdated, appUserUpdated };
}

async function applyDeny({ applicationId, userId, accountId }) {
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

function deriveTicketExecutionStatus(items) {
  const actionable = items.filter((i) =>
    ["APPROVED", "DENIED", "EXECUTED"].includes(i.status),
  );
  if (!actionable.length) return null;
  return actionable.every((i) => i.status === "EXECUTED") ? "EXECUTED" : null;
}

export async function executeTicketRemediation(ticketId, ctx) {
  const ticket = await RemediationTicket.findById(ticketId);
  if (!ticket) throw new Error("Ticket not found");

  const items = await RemediationTicketItem.find({
    ticketId: ticket._id,
    status: { $in: ["APPROVED"] },
    decision: { $ne: "PENDING" },
    executionStatus: { $ne: "EXECUTED" },
  });

  const executedBy = ctx.user?.email || "system";
  const now = new Date();

  for (const item of items) {
    const beforeState = await captureBeforeState({
      applicationId: item.applicationId,
      userId: item.userId,
      itemEmail: item.itemEmail,
      accountId: item.userId,
    });

    let execStatus = "EXECUTED";
    let execError = null;
    let afterState = beforeState;

    try {
      if (item.decision === "GRANT_ACCESS" || item.status === "APPROVED") {
        const result = await applyGrant({
          applicationId: item.applicationId,
          userId: item.userId,
          itemEmail: item.itemEmail,
          accountId: item.userId,
        });
        afterState = {
          ...beforeState,
          accessState: "active",
          remediationStatus: "granted",
          connectorResult: result,
        };
      } else {
        await applyDeny({
          applicationId: item.applicationId,
          userId: item.userId,
          accountId: item.userId,
        });
        afterState = {
          ...beforeState,
          accessState: "revoked",
          remediationStatus: "denied",
        };
        item.executionStatus = "SKIPPED";
      }
    } catch (err) {
      execStatus = "FAILED";
      execError = err?.message || "Execution failed";
    }

    item.executionStatus = execStatus;
    item.executionError = execError || undefined;
    item.executedAt = now;
    item.beforeState = beforeState;
    item.afterState = afterState;
    if (execStatus === "EXECUTED") {
      item.status = "EXECUTED";
      try {
        await runValidationsForExecutedItem(item._id);
      } catch (valErr) {
        console.error("[executeTicketRemediation] validation failed:", valErr.message);
      }
    }
    await item.save();

    await RemediationExecutionLog.create(
      remediationWithTenant(ctx.scopedTenantId, {
        ticketId: ticket._id,
        ticketItemId: item._id,
        ticketNumber: ticket.ticketNumber,
        campaignId: item.campaignId,
        campaignName: item.campaignName,
        userId: item.userId,
        itemEmail: item.itemEmail,
        applicationId: item.applicationId,
        applicationName: item.applicationName,
        entitlementName: item.entitlementName,
        decision: item.decision,
        status: execStatus,
        beforeState,
        afterState,
        executedBy,
        executedAt: now,
        error: execError || undefined,
        connectorRef: "remediation_execution_service",
      }),
    );
  }

  const allItems = await RemediationTicketItem.find({ ticketId: ticket._id }).lean();
  const counts = {
    total: allItems.length,
    pending: allItems.filter((i) =>
      ["PENDING", "TICKET_CREATED", "IN_PROGRESS"].includes(i.status),
    ).length,
    approved: allItems.filter((i) => i.status === "APPROVED" || i.decision === "GRANT_ACCESS").length,
    denied: allItems.filter((i) => i.status === "DENIED" || i.decision === "PENDING").length,
    executed: allItems.filter((i) => i.status === "EXECUTED").length,
  };

  ticket.itemCounts = counts;
  const execStatus = deriveTicketExecutionStatus(allItems);
  if (execStatus === "EXECUTED") {
    ticket.status = "EXECUTED";
    ticket.executedAt = now;
  }
  ticket.lastStatusAt = now;
  await ticket.save();

  await upsertRemediationEventForTicket(ctx, ticket, allItems);

  try {
    await RemediationAuditLog.create(
      remediationWithTenant(ctx.scopedTenantId, {
        action: "RECORD_UPDATE",
        performedBy: executedBy,
        performedAt: now,
        note: `Executed remediation ticket ${ticket.ticketNumber}`,
        newValue: { ticketId: ticket._id, executedCount: items.length },
      }),
    );
  } catch {
    // non-blocking
  }

  return { ticket, executedCount: items.length };
}
