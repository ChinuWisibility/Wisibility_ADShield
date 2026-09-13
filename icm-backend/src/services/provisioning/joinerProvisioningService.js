/**
 * Joiner provisioning orchestration.
 *
 * Flow:
 *   ENSURE_ACCOUNT rule match
 *     → ProvisioningRequest (JOINER, approval PENDING) — no task yet
 *     → Joiner workflow (approval wait)
 *     → on approve → Plan + ADD_ACCOUNT Task
 *     → worker → connector.createAccount()
 *
 * No LDAP / CSV / app-name branching here.
 */

import mongoose from "mongoose";
import { randomUUID } from "crypto";
import ProvisioningRequest from "../../models/provisioning/ProvisioningRequest.js";
import ProvisioningPlan from "../../models/provisioning/ProvisioningPlan.js";
import ProvisioningTask from "../../models/provisioning/ProvisioningTask.js";
import Application from "../../models/application/Application.js";
import IdentityAccountLink from "../../models/identity/IdentityAccountLink.js";
import AccountAggregation from "../../models/access/AccountAggregation.js";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import { applicationIdInClause } from "../application/applicationUserIngestService.js";
import { startJoinerWorkflow } from "./joinerWorkflowService.js";
import {
  evaluateDesiredAccess,
  desiredAccessToEnsureAccountActions,
} from "./policyDecisionService.js";

function toOid(value) {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null;
}

export function buildJoinerSourceId({ syncJobId, identityId, applicationId }) {
  const sync = syncJobId || "nosync";
  return `joiner:${sync}:${identityId}:${applicationId}`;
}

/**
 * ENSURE_ACCOUNT: does identity already have an account on this application?
 * Prefers IdentityAccountLink; falls back to aggregation / CSV user match.
 */
export async function accountExistsForIdentity({
  tenantId,
  identityId,
  applicationId,
  identity,
}) {
  const identityOid = toOid(identityId);
  const applicationOid = toOid(applicationId);
  if (!identityOid || !applicationOid) return { exists: false };

  const link = await IdentityAccountLink.findOne({
    identityId: identityOid,
    applicationId: applicationOid,
    ...(tenantId ? { tenantId: toOid(tenantId) || tenantId } : {}),
  })
    .select("_id accountId")
    .lean();
  if (link) {
    return { exists: true, reason: "IDENTITY_ACCOUNT_LINK", nativeIdentifier: link.accountId };
  }

  const idDoc =
    identity ||
    (await (await getDynamicIdentityModelForTenantId(tenantId))
      .findOne({ _id: identityOid, tenantId })
      .lean());

  const correlated = await AccountAggregation.findOne({
    applicationId: applicationOid,
    correlatedIdentityId: identityOid,
    ...(tenantId ? { tenantId: toOid(tenantId) || tenantId } : {}),
  })
    .select("_id nativeAccountId accountName")
    .lean();
  if (correlated) {
    return {
      exists: true,
      reason: "ACCOUNT_AGGREGATION",
      nativeIdentifier:
        correlated.nativeAccountId || correlated.accountName || String(correlated._id),
    };
  }

  if (idDoc?.email || idDoc?.employeeId) {
    const aggOr = [];
    if (idDoc.email) {
      const emailRe = new RegExp(`^${escapeRegex(String(idDoc.email).trim())}$`, "i");
      aggOr.push({ accountName: emailRe });
      aggOr.push({ "rawAttributes.mail": emailRe });
      aggOr.push({ "rawAttributes.email": emailRe });
    }
    if (idDoc.employeeId) {
      const eid = String(idDoc.employeeId).trim();
      aggOr.push({ "rawAttributes.employeeId": eid });
      aggOr.push({ "rawAttributes.employeeID": eid });
      aggOr.push({ nativeAccountId: eid });
    }
    if (aggOr.length) {
      const agg = await AccountAggregation.findOne({
        applicationId: applicationOid,
        ...(tenantId ? { tenantId: toOid(tenantId) || tenantId } : {}),
        $or: aggOr,
      })
        .select("_id nativeAccountId accountName")
        .lean();
      if (agg) {
        return {
          exists: true,
          reason: "ACCOUNT_AGGREGATION_UNCORRELATED",
          nativeIdentifier: agg.nativeAccountId || agg.accountName || String(agg._id),
        };
      }
    }
  }

  // CSV / dynamic users (test path)
  const app = await Application.findOne({
    _id: applicationOid,
    ...(tenantId ? { tenantId: toOid(tenantId) || tenantId } : {}),
  })
    .select("name userMappings tenantId")
    .lean();
  if (app?.name && idDoc) {
    try {
      const Users = await getDynamicUserModelForTenantId(app.name, tenantId);
      const appIdClause = applicationIdInClause(applicationOid);
      const or = [];
      if (idDoc.email) or.push({ email: new RegExp(`^${escapeRegex(String(idDoc.email).trim())}$`, "i") });
      if (idDoc.employeeId) {
        or.push({ employee_id: String(idDoc.employeeId).trim() });
        or.push({ employeeId: String(idDoc.employeeId).trim() });
        or.push({ user_id: String(idDoc.employeeId).trim() });
      }
      if (or.length) {
        const row = await Users.findOne({ applicationId: appIdClause, $or: or })
          .select("_id")
          .lean();
        if (row) {
          return { exists: true, reason: "CSV_USER", nativeIdentifier: String(row._id) };
        }
      }
    } catch {
      /* collection may not exist yet */
    }
  }

  return { exists: false };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create JOINER ProvisioningRequest (no plan/task until approval).
 */
export async function createJoinerProvisioningRequest({
  tenantId,
  identityId,
  applicationId,
  ruleId,
  ruleName,
  syncJobId,
  justification,
  jmlCorrelationId,
  lifecycleEventId,
}) {
  const identityOid = toOid(identityId);
  const applicationOid = toOid(applicationId);
  const tenantOid = toOid(tenantId);
  if (!identityOid || !applicationOid || !tenantOid) {
    return { success: false, error: "Invalid tenantId/identityId/applicationId" };
  }

  const app = await Application.findOne({ _id: applicationOid, tenantId: tenantOid })
    .select("name")
    .lean();
  if (!app) {
    return { success: false, error: "Application not found for tenant" };
  }

  const sourceId = buildJoinerSourceId({
    syncJobId,
    identityId: String(identityOid),
    applicationId: String(applicationOid),
  });

  const existing = await ProvisioningRequest.findOne({
    sourceType: "LIFECYCLE",
    sourceId,
    status: { $in: ["PENDING", "APPROVED", "IN_PROGRESS", "COMPLETED"] },
  }).lean();
  if (existing) {
    return {
      success: true,
      reused: true,
      provisioningRequestId: String(existing._id),
      approvalStatus: existing.approvalStatus,
      status: existing.status,
    };
  }

  // Also block duplicate open JOINER for same identity+app across sync ids
  const openDup = await ProvisioningRequest.findOne({
    requestType: "JOINER",
    tenantId: tenantOid,
    identityId: identityOid,
    "metadata.applicationId": String(applicationOid),
    status: { $in: ["PENDING", "APPROVED", "IN_PROGRESS"] },
  }).lean();
  if (openDup) {
    return {
      success: true,
      reused: true,
      provisioningRequestId: String(openDup._id),
      approvalStatus: openDup.approvalStatus,
      status: openDup.status,
    };
  }

  const ensure = await accountExistsForIdentity({
    tenantId: tenantOid,
    identityId: identityOid,
    applicationId: applicationOid,
  });
  if (ensure.exists) {
    const satisfied = await ProvisioningRequest.create({
      requestType: "JOINER",
      tenantId: tenantOid,
      identityId: identityOid,
      justification:
        justification ||
        `ENSURE_ACCOUNT already satisfied (${ensure.reason}) for ${app.name}`,
      status: "COMPLETED",
      priority: "NORMAL",
      sourceType: "LIFECYCLE",
      sourceId,
      approvalStatus: "NOT_REQUIRED",
      completedAt: new Date(),
      metadata: {
        applicationId: String(applicationOid),
        applicationName: app.name,
        ruleId: ruleId ? String(ruleId) : undefined,
        ruleName,
        syncJobId: syncJobId || undefined,
        ensureAccount: "SATISFIED",
        nativeIdentifier: ensure.nativeIdentifier,
        jmlCorrelationId: jmlCorrelationId || undefined,
        lifecycleEventId: lifecycleEventId ? String(lifecycleEventId) : undefined,
      },
    });
    return {
      success: true,
      satisfied: true,
      provisioningRequestId: String(satisfied._id),
      reason: ensure.reason,
    };
  }

  const request = await ProvisioningRequest.create({
    requestType: "JOINER",
    tenantId: tenantOid,
    identityId: identityOid,
    justification:
      justification ||
      `Joiner ENSURE_ACCOUNT → ${app.name}` +
        (ruleName ? ` (rule: ${ruleName})` : ""),
    status: "PENDING",
    priority: "NORMAL",
    sourceType: "LIFECYCLE",
    sourceId,
    approvalStatus: "PENDING",
    metadata: {
      applicationId: String(applicationOid),
      applicationName: app.name,
      ruleId: ruleId ? String(ruleId) : undefined,
      ruleName,
      syncJobId: syncJobId || undefined,
      ensureAccount: "PENDING_CREATE",
      operationType: "ADD_ACCOUNT",
      jmlCorrelationId: jmlCorrelationId || undefined,
      lifecycleEventId: lifecycleEventId ? String(lifecycleEventId) : undefined,
    },
  });

  const wf = await startJoinerWorkflow({
    tenantId: tenantOid,
    identityId: identityOid,
    applicationId: applicationOid,
    applicationName: app.name,
    provisioningRequestId: request._id,
    ruleId,
    ruleName,
    jmlCorrelationId: jmlCorrelationId || undefined,
  });

  if (wf?.executionId) {
    await ProvisioningRequest.updateOne(
      { _id: request._id },
      { $set: { "metadata.workflowExecutionId": wf.executionId } },
    );
  }

  return {
    success: true,
    reused: false,
    provisioningRequestId: String(request._id),
    workflowExecutionId: wf?.executionId || null,
    approvalStatus: "PENDING",
  };
}

/**
 * After workflow approval: compile Plan + ADD_ACCOUNT Task (idempotent).
 */
export async function compileJoinerPlanAndTask({
  provisioningRequestId,
  approvedBy,
}) {
  const request = await ProvisioningRequest.findById(provisioningRequestId);
  if (!request) return { success: false, error: "Request not found" };
  if (request.requestType !== "JOINER") {
    return { success: false, error: "Not a JOINER request" };
  }
  if (request.approvalStatus === "REJECTED" || request.status === "CANCELLED") {
    return { success: false, error: "Request was rejected/cancelled" };
  }

  const applicationId = toOid(request.metadata?.applicationId);
  const tenantId = request.tenantId;
  const identityId = request.identityId;
  if (!applicationId) {
    return { success: false, error: "Request metadata.applicationId missing" };
  }

  // Re-check ENSURE before creating task
  const ensure = await accountExistsForIdentity({
    tenantId,
    identityId,
    applicationId,
  });
  if (ensure.exists) {
    request.status = "COMPLETED";
    request.approvalStatus = "APPROVED";
    request.approvedAt = request.approvedAt || new Date();
    request.completedAt = new Date();
    request.metadata = {
      ...(request.metadata || {}),
      ensureAccount: "SATISFIED",
      nativeIdentifier: ensure.nativeIdentifier,
    };
    await request.save();
    return {
      success: true,
      satisfied: true,
      reason: ensure.reason,
      provisioningRequestId: String(request._id),
    };
  }

  request.approvalStatus = "APPROVED";
  request.status = "IN_PROGRESS";
  request.approvedAt = new Date();
  if (approvedBy) request.approvedBy = toOid(approvedBy) || undefined;
  await request.save();

  let plan = await ProvisioningPlan.findOne({ requestId: request._id });
  if (!plan) {
    plan = await ProvisioningPlan.create({
      requestId: request._id,
      identityId,
      tenantId: request.tenantId,
      jmlCorrelationId: request.metadata?.jmlCorrelationId,
      operations: [
        {
          operationType: "ADD_ACCOUNT",
          applicationId: String(applicationId),
          applicationName: request.metadata?.applicationName,
        },
      ],
      totalOperations: 1,
      completedOperations: 0,
      failedOperations: 0,
      status: "COMPILED",
      compiledAt: new Date(),
    });
  } else if (request.metadata?.jmlCorrelationId && !plan.jmlCorrelationId) {
    await ProvisioningPlan.updateOne(
      { _id: plan._id },
      { $set: { jmlCorrelationId: request.metadata.jmlCorrelationId } },
    );
  }

  let task = await ProvisioningTask.findOne({
    requestId: request._id,
    applicationId,
    operationType: "ADD_ACCOUNT",
    status: { $in: ["PENDING", "RUNNING", "COMPLETED"] },
  });
  if (!task) {
    task = await ProvisioningTask.create({
      planId: plan._id,
      requestId: request._id,
      applicationId,
      operationType: "ADD_ACCOUNT",
      planItemId: `legacy:ADD_ACCOUNT:${String(applicationId)}`,
      jmlCorrelationId: request.metadata?.jmlCorrelationId,
      targetAttributes: {
        identityId: String(identityId),
        tenantId: tenantId ? String(tenantId) : undefined,
        applicationName: request.metadata?.applicationName,
        joinerRequestId: String(request._id),
        lifecycleRequestId: String(request._id),
        executionId: request.metadata?.workflowExecutionId || undefined,
        jmlCorrelationId: request.metadata?.jmlCorrelationId,
        ruleId: request.metadata?.ruleId,
        attributes: {},
        planItemId: `legacy:ADD_ACCOUNT:${String(applicationId)}`,
      },
      status: "PENDING",
    });
  }

  return {
    success: true,
    provisioningRequestId: String(request._id),
    provisioningPlanId: String(plan._id),
    provisioningTaskId: String(task._id),
  };
}

export async function rejectJoinerRequest({ provisioningRequestId, rejectedBy }) {
  const request = await ProvisioningRequest.findById(provisioningRequestId);
  if (!request) return { success: false, error: "Request not found" };
  request.approvalStatus = "REJECTED";
  request.status = "CANCELLED";
  request.completedAt = new Date();
  if (rejectedBy) request.updatedBy = toOid(rejectedBy) || undefined;
  await request.save();
  return { success: true, provisioningRequestId: String(request._id) };
}

/**
 * Evaluate Joiner rules for newly inserted identities (async, post-sync).
 */
export async function evaluateJoinersForIdentities({
  tenantId,
  identityIds,
  syncJobId,
  jmlCorrelationId,
  lifecycleEventId,
}) {
  const tenantOid = toOid(tenantId);
  if (!tenantOid || !identityIds?.length) {
    return { processed: 0, requests: [], errors: [] };
  }

  const Identity = await getDynamicIdentityModelForTenantId(tenantOid);
  const ids = identityIds.map(toOid).filter(Boolean);
  const identities = await Identity.find({ _id: { $in: ids }, tenantId: tenantOid }).lean();

  const requests = [];
  const errors = [];

  for (const identity of identities) {
    try {
      // Compatibility boundary: policy remains a pure desired-state calculation.
      // This adapter translates only desired account requirements into the
      // existing JOINER request flow until Access Delta exists.
      const desiredAccess = await evaluateDesiredAccess(identity, {
        tenantId: tenantOid,
        lifecycleType: "JOINER",
        lifecycleEventId,
        jmlCorrelationId,
      });
      const ensureAccounts = desiredAccessToEnsureAccountActions(desiredAccess);
      if (!ensureAccounts.length) continue;

      console.log(
        "[joiner] POLICY_DECISION",
        JSON.stringify({
          tenantId: String(tenantOid),
          identityId: String(identity._id),
          rules: desiredAccess.matchedRules.map((m) => m.ruleName),
          policies: desiredAccess.matchedPolicies.map((m) => m.policyName),
          applications: ensureAccounts.map((a) => String(a.applicationId)),
          syncJobId,
          jmlCorrelationId: desiredAccess.jmlCorrelationId,
        }),
      );

      for (const action of ensureAccounts) {
        const created = await createJoinerProvisioningRequest({
          tenantId: tenantOid,
          identityId: identity._id,
          applicationId: action.applicationId,
          ruleId: action.ruleId,
          ruleName: action.ruleName,
          syncJobId,
          jmlCorrelationId: desiredAccess.jmlCorrelationId || jmlCorrelationId,
          lifecycleEventId,
        });
        requests.push({
          identityId: String(identity._id),
          ...created,
        });
        if (created.success && !created.reused && !created.satisfied) {
          console.log(
            "[joiner] PROVISIONING_REQUEST_CREATED",
            JSON.stringify({
              provisioningRequestId: created.provisioningRequestId,
              workflowExecutionId: created.workflowExecutionId,
            }),
          );
        }
      }
    } catch (err) {
      errors.push({ identityId: String(identity._id), error: err.message });
    }
  }

  return { processed: identities.length, requests, errors };
}

/**
 * @deprecated Prefer identity-refresh lifecycle enqueue. Kept for explicit API/compat.
 * Does not use setImmediate as a durable Joiner trigger when snapshots are provided.
 */
export function scheduleJoinerEvaluation(payload) {
  if (String(process.env.JOINER_EVALUATION_ENABLED || "true").toLowerCase() === "false") {
    return;
  }
  if (payload?.useLifecycleQueue !== false && payload?.identitySnapshots) {
    import("../lifecycle/lifecycleEventService.js")
      .then(({ enqueueLifecycleEventsBatch }) =>
        enqueueLifecycleEventsBatch(
          (payload.identitySnapshots || []).map((snap) => ({
            tenantId: payload.tenantId,
            identityId: snap.identityId,
            before: snap.before || null,
            after: snap.after,
            syncJobId: payload.syncJobId,
            triggeredBy: "HRMS",
            jmlCorrelationId: payload.jmlCorrelationId,
          })),
        ),
      )
      .catch((err) => console.warn("[joiner] lifecycle enqueue failed:", err.message));
    return;
  }

  console.warn(
    "[joiner] scheduleJoinerEvaluation falling back to in-process evaluate — prefer durable lifecycle events",
  );
  const syncJobId = payload.syncJobId || randomUUID();
  evaluateJoinersForIdentities({ ...payload, syncJobId })
    .then((r) => {
      console.log(
        "[joiner] JOINER_EVALUATION_DONE",
        JSON.stringify({
          syncJobId,
          processed: r.processed,
          requestCount: r.requests?.length || 0,
          errorCount: r.errors?.length || 0,
        }),
      );
    })
    .catch((err) => console.warn("[joiner] evaluation failed:", err.message));
}

/**
 * Find identities inserted at/after syncStartedAt (Joiner candidates).
 */
export async function findInsertedIdentityIds(tenantId, { since, limit = 5000 } = {}) {
  const tenantOid = toOid(tenantId);
  if (!tenantOid || !since) return [];
  const Identity = await getDynamicIdentityModelForTenantId(tenantOid);
  const rows = await Identity.find({
    tenantId: tenantOid,
    createdAt: { $gte: since },
  })
    .select("_id")
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();
  return rows.map((r) => String(r._id));
}
