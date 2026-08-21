/**
 * Reusable lifecycle provisioning — CREATE / UPDATE / DISABLE.
 * Not Joiner/Mover/Leaver-specific engines: same Request → Plan → Task → Worker path.
 */

import mongoose from "mongoose";
import ProvisioningRequest from "../../models/provisioning/ProvisioningRequest.js";
import ProvisioningPlan from "../../models/provisioning/ProvisioningPlan.js";
import ProvisioningTask from "../../models/provisioning/ProvisioningTask.js";
import DeprovisioningRecord from "../../models/provisioning/DeprovisioningRecord.js";
import Application from "../../models/application/Application.js";
import IdentityAccountLink from "../../models/identity/IdentityAccountLink.js";
import AccountAggregation from "../../models/access/AccountAggregation.js";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import {
  loadEnabledIdentityProvisioningRules,
  collectEnsureAccountActions,
} from "./identityProvisioningRuleService.js";
import { accountExistsForIdentity } from "./joinerProvisioningService.js";
import { startLifecycleProvisionWorkflow } from "./lifecycleWorkflowService.js";
import { createJmlCorrelationId } from "../lifecycle/jmlCorrelation.js";

function toOid(value) {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null;
}

function buildSourceId({ kind, identityId, applicationId, fingerprint }) {
  return `lifecycle:${kind}:${identityId}:${applicationId}:${fingerprint || "na"}`;
}

/**
 * Map identity change fields → generic account attribute patch (connector translates).
 */
export function buildAccountAttributePatchFromIdentity(identity = {}, changeSet = {}) {
  const changes = Array.isArray(changeSet?.changes) ? changeSet.changes : [];
  const changed = new Set(changes.map((c) => c.field));
  const attrs = {};

  const put = (ldapKey, value) => {
    if (value == null || value === "") return;
    attrs[ldapKey] = value;
  };

  if (changed.has("displayName") || changed.size === 0) put("displayName", identity.displayName);
  if (changed.has("firstName") || changed.size === 0) put("givenName", identity.firstName);
  if (changed.has("lastName") || changed.size === 0) put("sn", identity.lastName);
  if (changed.has("department") || changed.size === 0) put("department", identity.department);
  if (changed.has("title") || changed.size === 0) put("title", identity.title);
  if (changed.has("email") || changed.size === 0) put("mail", identity.email);
  if (changed.has("phoneNumber")) put("telephoneNumber", identity.phoneNumber);
  if (identity.employeeId) put("employeeID", identity.employeeId);

  // Always include identity-derived snapshot for UPDATE when mover signals present
  if (changed.has("department")) put("department", identity.department);
  if (changed.has("title")) put("title", identity.title);
  if (changed.has("displayName")) put("displayName", identity.displayName);
  if (changed.has("firstName")) put("givenName", identity.firstName);
  if (changed.has("lastName")) put("sn", identity.lastName);
  if (changed.has("email")) put("mail", identity.email);

  return attrs;
}

async function listLinkedApplicationsForIdentity({ tenantId, identityId }) {
  const identityOid = toOid(identityId);
  const tenantOid = toOid(tenantId);
  const links = await IdentityAccountLink.find({
    identityId: identityOid,
    ...(tenantOid ? { tenantId: tenantOid } : {}),
  })
    .select("applicationId accountId")
    .lean();

  const fromLinks = links
    .filter((l) => l.applicationId)
    .map((l) => ({
      applicationId: String(l.applicationId),
      nativeIdentifier: l.accountId || undefined,
      source: "IDENTITY_ACCOUNT_LINK",
    }));

  const aggs = await AccountAggregation.find({
    correlatedIdentityId: identityOid,
    ...(tenantOid ? { tenantId: tenantOid } : {}),
  })
    .select("applicationId nativeAccountId accountName")
    .lean();

  const fromAgg = aggs
    .filter((a) => a.applicationId)
    .map((a) => ({
      applicationId: String(a.applicationId),
      nativeIdentifier: a.nativeAccountId || a.accountName || undefined,
      source: "ACCOUNT_AGGREGATION",
    }));

  const byApp = new Map();
  for (const row of [...fromLinks, ...fromAgg]) {
    if (!byApp.has(row.applicationId)) byApp.set(row.applicationId, row);
  }
  return [...byApp.values()];
}

/**
 * Resolve target applications for MOVER/LEAVER:
 * 1) linked accounts
 * 2) else ENSURE_ACCOUNT rule applications (desired apps)
 */
async function resolveTargetApplications({ tenantId, identity }) {
  const linked = await listLinkedApplicationsForIdentity({
    tenantId,
    identityId: identity._id,
  });
  if (linked.length) return linked;

  const rules = await loadEnabledIdentityProvisioningRules(tenantId);
  const { ensureAccounts } = collectEnsureAccountActions(identity, rules);
  return ensureAccounts.map((a) => ({
    applicationId: String(a.applicationId),
    ruleId: a.ruleId,
    ruleName: a.ruleName,
    source: "PROVISIONING_RULE",
  }));
}

async function createLifecycleProvisioningRequest({
  requestType,
  tenantId,
  identityId,
  applicationId,
  operationType,
  attributes,
  nativeIdentifier,
  jmlCorrelationId,
  lifecycleEventId,
  syncJobId,
  fingerprint,
  justification,
  ruleId,
  ruleName,
}) {
  const tenantOid = toOid(tenantId);
  const identityOid = toOid(identityId);
  const applicationOid = toOid(applicationId);
  if (!tenantOid || !identityOid || !applicationOid) {
    return { success: false, error: "Invalid ids" };
  }

  const app = await Application.findOne({ _id: applicationOid, tenantId: tenantOid })
    .select("name")
    .lean();
  if (!app) return { success: false, error: "Application not found for tenant" };

  const sourceId = buildSourceId({
    kind: requestType.toLowerCase(),
    identityId: String(identityOid),
    applicationId: String(applicationOid),
    fingerprint: fingerprint || operationType,
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
      workflowExecutionId: existing.metadata?.workflowExecutionId || null,
    };
  }

  const openDup = await ProvisioningRequest.findOne({
    requestType,
    tenantId: tenantOid,
    identityId: identityOid,
    "metadata.applicationId": String(applicationOid),
    "metadata.operationType": operationType,
    status: { $in: ["PENDING", "APPROVED", "IN_PROGRESS"] },
  }).lean();
  if (openDup) {
    return {
      success: true,
      reused: true,
      provisioningRequestId: String(openDup._id),
      approvalStatus: openDup.approvalStatus,
      status: openDup.status,
      workflowExecutionId: openDup.metadata?.workflowExecutionId || null,
    };
  }

  const correlationId = jmlCorrelationId || createJmlCorrelationId();
  let request;
  try {
    request = await ProvisioningRequest.create({
      requestType,
      tenantId: tenantOid,
      identityId: identityOid,
      justification:
        justification ||
        `${requestType} ${operationType} → ${app.name}`,
      status: "PENDING",
      priority: requestType === "LEAVER" ? "HIGH" : "NORMAL",
      sourceType: "LIFECYCLE",
      sourceId,
      approvalStatus: "PENDING",
      metadata: {
        applicationId: String(applicationOid),
        applicationName: app.name,
        operationType,
        attributes: attributes || {},
        nativeIdentifier: nativeIdentifier || undefined,
        jmlCorrelationId: correlationId,
        lifecycleEventId: lifecycleEventId ? String(lifecycleEventId) : undefined,
        syncJobId: syncJobId || undefined,
        ruleId: ruleId ? String(ruleId) : undefined,
        ruleName,
      },
    });
  } catch (err) {
    if (err?.code === 11000) {
      const raced = await ProvisioningRequest.findOne({
        sourceType: "LIFECYCLE",
        sourceId,
        status: { $in: ["PENDING", "APPROVED", "IN_PROGRESS", "COMPLETED"] },
      }).lean();
      if (raced) {
        return {
          success: true,
          reused: true,
          provisioningRequestId: String(raced._id),
          approvalStatus: raced.approvalStatus,
          status: raced.status,
          workflowExecutionId: raced.metadata?.workflowExecutionId || null,
        };
      }
    }
    throw err;
  }

  const wf = await startLifecycleProvisionWorkflow({
    tenantId: tenantOid,
    identityId: identityOid,
    applicationId: applicationOid,
    applicationName: app.name,
    provisioningRequestId: request._id,
    requestType,
    operationType,
    jmlCorrelationId: correlationId,
  });

  if (wf?.executionId) {
    await ProvisioningRequest.updateOne(
      { _id: request._id },
      { $set: { "metadata.workflowExecutionId": wf.executionId } },
    );
  }

  console.log(
    "[lifecycle] REQUEST_CREATED",
    JSON.stringify({
      requestType,
      operationType,
      provisioningRequestId: String(request._id),
      workflowExecutionId: wf?.executionId || null,
      jmlCorrelationId: correlationId,
    }),
  );

  return {
    success: true,
    reused: false,
    provisioningRequestId: String(request._id),
    workflowExecutionId: wf?.executionId || null,
    approvalStatus: "PENDING",
    jmlCorrelationId: correlationId,
  };
}

/**
 * After workflow approval: compile Plan + Task for CREATE/UPDATE/DISABLE.
 */
export async function compileLifecyclePlanAndTask({
  provisioningRequestId,
  approvedBy,
}) {
  const request = await ProvisioningRequest.findById(provisioningRequestId);
  if (!request) return { success: false, error: "Request not found" };
  if (!["JOINER", "MOVER", "LEAVER", "MODIFY", "DEPROVISION"].includes(request.requestType)) {
    return { success: false, error: `Unsupported requestType ${request.requestType}` };
  }
  if (request.approvalStatus === "REJECTED" || request.status === "CANCELLED") {
    return { success: false, error: "Request was rejected/cancelled" };
  }

  const applicationId = toOid(request.metadata?.applicationId);
  const operationType =
    request.metadata?.operationType ||
    (request.requestType === "JOINER"
      ? "ADD_ACCOUNT"
      : request.requestType === "MOVER"
        ? "UPDATE_ACCOUNT"
        : request.requestType === "LEAVER"
          ? "DISABLE"
          : null);
  if (!applicationId || !operationType) {
    return { success: false, error: "metadata.applicationId/operationType required" };
  }

  // CREATE idempotency: ENSURE satisfied
  if (operationType === "ADD_ACCOUNT") {
    const ensure = await accountExistsForIdentity({
      tenantId: request.tenantId,
      identityId: request.identityId,
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
      identityId: request.identityId,
      tenantId: request.tenantId,
      jmlCorrelationId: request.metadata?.jmlCorrelationId,
      operations: [
        {
          operationType,
          applicationId: String(applicationId),
          applicationName: request.metadata?.applicationName,
          attributes: request.metadata?.attributes || {},
        },
      ],
      totalOperations: 1,
      completedOperations: 0,
      failedOperations: 0,
      status: "COMPILED",
      compiledAt: new Date(),
    });
  }

  let task = await ProvisioningTask.findOne({
    requestId: request._id,
    applicationId,
    operationType,
    status: { $in: ["PENDING", "RUNNING", "RETRYING", "COMPLETED"] },
  });
  if (!task) {
    try {
      task = await ProvisioningTask.create({
        planId: plan._id,
        requestId: request._id,
        applicationId,
        operationType,
        planItemId: `legacy:${operationType}:${String(applicationId)}`,
        lifecycleEventId: request.metadata?.lifecycleEventId || undefined,
        jmlCorrelationId: request.metadata?.jmlCorrelationId,
        targetAttributes: {
          identityId: String(request.identityId),
          tenantId: request.tenantId ? String(request.tenantId) : undefined,
          applicationName: request.metadata?.applicationName,
          lifecycleRequestId: String(request._id),
          joinerRequestId:
            request.requestType === "JOINER" ? String(request._id) : undefined,
          executionId: request.metadata?.workflowExecutionId || undefined,
          jmlCorrelationId: request.metadata?.jmlCorrelationId,
          nativeIdentifier: request.metadata?.nativeIdentifier,
          attributes: request.metadata?.attributes || {},
          planItemId: `legacy:${operationType}:${String(applicationId)}`,
        },
        status: "PENDING",
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      task = await ProvisioningTask.findOne({
        requestId: request._id,
        applicationId,
        operationType,
        status: { $in: ["PENDING", "RUNNING", "RETRYING", "COMPLETED"] },
      });
      if (!task) throw err;
    }
  }

  console.log(
    "[lifecycle] PLAN_CREATED",
    JSON.stringify({
      planId: String(plan._id),
      taskId: String(task._id),
      operationType,
      jmlCorrelationId: request.metadata?.jmlCorrelationId,
    }),
  );

  return {
    success: true,
    provisioningRequestId: String(request._id),
    provisioningPlanId: String(plan._id),
    provisioningTaskId: String(task._id),
  };
}

export async function rejectLifecycleRequest({ provisioningRequestId, rejectedBy }) {
  const claimSet = {
    approvalStatus: "REJECTED",
    status: "CANCELLED",
    completedAt: new Date(),
  };
  if (rejectedBy) claimSet.updatedBy = toOid(rejectedBy) || undefined;

  const request = await ProvisioningRequest.findOneAndUpdate(
    {
      _id: provisioningRequestId,
      approvalStatus: { $in: ["PENDING", "NOT_REQUIRED"] },
      status: { $in: ["PENDING", "APPROVED", "IN_PROGRESS"] },
    },
    { $set: claimSet },
    { new: true },
  );
  if (!request) {
    const existing = await ProvisioningRequest.findById(provisioningRequestId).lean();
    if (!existing) return { success: false, error: "Request not found" };
    if (existing.approvalStatus === "REJECTED" || existing.status === "CANCELLED") {
      return { success: true, reused: true, provisioningRequestId: String(existing._id) };
    }
    return {
      success: false,
      error: `Request approvalStatus is ${existing.approvalStatus}`,
    };
  }
  return { success: true, provisioningRequestId: String(request._id) };
}

async function ensureDeprovisioningRecord({ event, identity, provisioningRequestId }) {
  const identityOid = toOid(identity._id);
  const tenantOid = toOid(event.tenantId);
  const open = await DeprovisioningRecord.findOne({
    identityId: identityOid,
    ...(tenantOid ? { tenantId: tenantOid } : {}),
    status: { $in: ["INITIATED", "IN_PROGRESS"] },
  });
  if (open) {
    const patch = {};
    if (event.jmlCorrelationId && !open.jmlCorrelationId) {
      patch.jmlCorrelationId = event.jmlCorrelationId;
    }
    if (event._id && !open.lifecycleEventId) patch.lifecycleEventId = event._id;
    if (provisioningRequestId && !open.provisioningRequestId) {
      patch.provisioningRequestId = toOid(provisioningRequestId);
    }
    if (Object.keys(patch).length) {
      await DeprovisioningRecord.updateOne({ _id: open._id }, { $set: patch });
    }
    return open;
  }

  return DeprovisioningRecord.create({
    tenantId: tenantOid || undefined,
    identityId: identityOid,
    terminationDate: event.effectiveDate || identity.endDate || new Date(),
    status: "INITIATED",
    lifecycleEventId: event._id || undefined,
    provisioningRequestId: toOid(provisioningRequestId) || undefined,
    jmlCorrelationId: event.jmlCorrelationId || undefined,
  });
}

export async function startMoverProvisioningFromEvent(event) {
  const tenantId = event.tenantId;
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const identity = await Identity.findOne({ _id: event.identityId, tenantId }).lean();
  if (!identity) return { success: false, error: "Identity not found" };

  const targets = await resolveTargetApplications({ tenantId, identity });
  if (!targets.length) {
    return { success: true, skipped: "NO_TARGET_APPLICATIONS" };
  }

  const attributes = buildAccountAttributePatchFromIdentity(identity, event.changeSet || {});
  if (!Object.keys(attributes).length) {
    return { success: true, skipped: "NO_ATTRIBUTE_PATCH" };
  }

  const fingerprint =
    (event.metadata && event.metadata.fingerprint) ||
    String(event._id);
  const requests = [];
  for (const target of targets) {
    const created = await createLifecycleProvisioningRequest({
      requestType: "MOVER",
      tenantId,
      identityId: identity._id,
      applicationId: target.applicationId,
      operationType: "UPDATE_ACCOUNT",
      attributes,
      nativeIdentifier: target.nativeIdentifier,
      jmlCorrelationId: event.jmlCorrelationId,
      lifecycleEventId: event._id,
      syncJobId: event.syncJobId,
      fingerprint,
      ruleId: target.ruleId,
      ruleName: target.ruleName,
      justification: `Mover UPDATE_ACCOUNT → identity attribute sync`,
    });
    requests.push(created);
  }

  return {
    success: true,
    requests,
    provisioningRequestId: requests.find((r) => r.success)?.provisioningRequestId,
    workflowExecutionId: requests.find((r) => r.workflowExecutionId)?.workflowExecutionId,
  };
}

export async function startLeaverProvisioningFromEvent(event) {
  const tenantId = event.tenantId;
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const identity = await Identity.findOne({ _id: event.identityId, tenantId }).lean();
  if (!identity) return { success: false, error: "Identity not found" };

  // Keep identity flags aligned even if HRMS mapping omitted isActive/endDate
  await Identity.updateOne(
    { _id: identity._id, tenantId },
    {
      $set: {
        isActive: false,
        lifecycleState: identity.lifecycleState || "TERMINATED",
        ...(identity.endDate ? {} : { endDate: event.effectiveDate || new Date() }),
      },
    },
  );

  const targets = await resolveTargetApplications({ tenantId, identity });
  if (!targets.length) {
    await ensureDeprovisioningRecord({ event, identity });
    return { success: true, skipped: "NO_TARGET_APPLICATIONS" };
  }

  const fingerprint =
    (event.metadata && event.metadata.fingerprint) ||
    String(event._id);
  const requests = [];
  for (const target of targets) {
    const created = await createLifecycleProvisioningRequest({
      requestType: "LEAVER",
      tenantId,
      identityId: identity._id,
      applicationId: target.applicationId,
      operationType: "DISABLE",
      attributes: {},
      nativeIdentifier: target.nativeIdentifier,
      jmlCorrelationId: event.jmlCorrelationId,
      lifecycleEventId: event._id,
      syncJobId: event.syncJobId,
      fingerprint,
      ruleId: target.ruleId,
      ruleName: target.ruleName,
      justification: `Leaver DISABLE_ACCOUNT`,
    });
    requests.push(created);
  }

  const primaryRequestId = requests.find((r) => r.success)?.provisioningRequestId;
  await ensureDeprovisioningRecord({
    event,
    identity,
    provisioningRequestId: primaryRequestId,
  });

  return {
    success: true,
    requests,
    provisioningRequestId: primaryRequestId,
    workflowExecutionId: requests.find((r) => r.workflowExecutionId)?.workflowExecutionId,
  };
}
