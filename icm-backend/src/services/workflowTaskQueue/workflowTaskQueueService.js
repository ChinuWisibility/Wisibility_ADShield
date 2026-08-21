import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import env from "../../config/env.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import Campaign from "../../models/certification/Campaign.js";
import UnifiedAuditEvent from "../../models/compliance/UnifiedAuditEvent.js";
import WorkflowTaskQueue from "../../models/workflowTaskQueue/WorkflowTaskQueue.js";
import {
  OPEN_TASK_STATUSES,
  WORKFLOW_TASK_ACTIONS,
  WORKFLOW_TASK_STATUS,
  buildRevokeAccessTaskName,
  buildIamOrphanReviewTaskName,
} from "../../constants/workflowTaskQueue.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import Application from "../../models/application/Application.js";
import SchedulerConfig from "../../models/scheduler/SchedulerConfig.js";
import RemediationWorkflowRun from "../../models/workflow/RemediationWorkflowRun.js";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import EmailJob from "../../models/email/EmailJob.js";
import { getRunById } from "../../workflows/persistence/runStore.js";
import { buildWorkflowTenantReadFilter } from "../../workflows/persistence/workflowTenantScope.js";
import { issueOrphanIamPortalUrl } from "../workflow/orphanIamPortalTokenService.js";
import { resolveIamCheckpointNodeId } from "../workflow/iamCheckpointNode.js";
import { deriveIamOrphanStatusBullets } from "../workflow/orphanIamProgressTrace.js";
import { healStuckIamOrphanDecision } from "../workflow/orphanIamWorkflowService.js";
import { failRemediationOnWorkflowEmailDelivery } from "../workflow/failRemediationOnWorkflowEmailDelivery.js";
import { recoverRemediationAfterEmailDelivered } from "../workflow/recoverRemediationAfterEmailDelivered.js";
import { resolveWorkflowForAction } from "./remediationWorkflowRuleService.js";
import { getWorkflowById } from "../../workflows/persistence/workflowStore.js";
import { repairWorkflowDefinition } from "../../workflows/workflow/repairDefinition.js";
import { executeWorkflow } from "../../workflows/engine/executor.js";
import { createIgaAdapter } from "../../workflows/adapters/igaAdapter.js";
import { buildTriggerFromReviewItem } from "../workflow/workflowRevokeService.js";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import { normalizeTenantId, tenantMatchFilter } from "../../utils/tenantScope.js";

function looksLikeObjectId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || "").trim());
}

function sanitizeUsername(value) {
  return String(value || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._@-]/g, "_")
    .replace(/^@+/, "")
    || "unknown";
}

function resolveUsername(reviewItem) {
  const pp = reviewItem?.provisioningPayload || {};
  if (pp.nativeIdentity) {
    const native = sanitizeUsername(pp.nativeIdentity);
    if (native !== "unknown") return native;
  }

  const email = String(reviewItem?.itemEmail || "").trim();
  if (email.includes("@")) {
    const local = email.split("@")[0];
    if (local && !looksLikeObjectId(local)) return sanitizeUsername(local);
  }

  const itemName = String(reviewItem?.itemName || "").trim();
  if (itemName && !looksLikeObjectId(itemName)) return sanitizeUsername(itemName);

  const userId = String(reviewItem?.userId || "").trim();
  if (userId && !looksLikeObjectId(userId)) return sanitizeUsername(userId);

  if (email) return sanitizeUsername(email.replace(/@/g, "_at_"));

  return "unknown";
}

function parseRevokeUsernameFromTaskName(taskName) {
  const match = String(taskName || "").trim().match(/^REVOKE_ACCESS_(.+)$/i);
  return match ? match[1] : "";
}

function needsDisplayRepair(task) {
  const fromTaskName = parseRevokeUsernameFromTaskName(task.taskName);
  return (
    looksLikeObjectId(task.username) ||
    looksLikeObjectId(task.identityName) ||
    looksLikeObjectId(fromTaskName)
  );
}

async function lookupIdentityDisplay(identityId, tenantId) {
  if (!identityId || !looksLikeObjectId(identityId) || !tenantId) return null;
  try {
    const Identity = await getDynamicIdentityModelForTenantId(tenantId);
    const doc = await Identity.findById(identityId)
      .select("displayName firstName lastName email employeeId")
      .lean();
    if (!doc) return null;

    const email = String(doc.email || "").trim();
    if (email.includes("@")) {
      const local = email.split("@")[0];
      if (local && !looksLikeObjectId(local)) {
        return {
          username: sanitizeUsername(local),
          identityName: String(doc.displayName || local).trim() || local,
          email,
        };
      }
    }

    const displayName = String(doc.displayName || "").trim();
    if (displayName && !looksLikeObjectId(displayName)) {
      const username = sanitizeUsername(
        displayName.includes(" ") ? displayName.replace(/\s+/g, ".") : displayName,
      );
      return { username, identityName: displayName, email: email || undefined };
    }

    const employeeId = String(doc.employeeId || "").trim();
    if (employeeId && !looksLikeObjectId(employeeId)) {
      return {
        username: sanitizeUsername(employeeId),
        identityName: displayName || employeeId,
        email: email || undefined,
      };
    }
  } catch {
    // best-effort display enrichment
  }
  return null;
}

async function resolveRevokeDisplayNames(reviewItem, tenantId) {
  if (!reviewItem) {
    return { username: "unknown", identityName: "Unknown", email: null };
  }

  let username = resolveUsername(reviewItem);
  let identityName = String(reviewItem.itemName || "").trim();
  const email = String(reviewItem.itemEmail || "").trim() || null;

  if (username !== "unknown" && !looksLikeObjectId(username)) {
    if (!identityName || looksLikeObjectId(identityName)) {
      identityName = username;
    }
    return { username, identityName, email };
  }

  const identityId =
    reviewItem.provisioningPayload?.identityId ||
    (looksLikeObjectId(reviewItem.userId) ? reviewItem.userId : null) ||
    (looksLikeObjectId(reviewItem.itemName) ? reviewItem.itemName : null);

  const fromIdentity = await lookupIdentityDisplay(identityId, tenantId);
  if (fromIdentity) return fromIdentity;

  if (email && email.includes("@")) {
    const local = email.split("@")[0];
    if (local && !looksLikeObjectId(local)) {
      return {
        username: sanitizeUsername(local),
        identityName: identityName && !looksLikeObjectId(identityName) ? identityName : local,
        email,
      };
    }
  }

  return { username: "unknown", identityName: identityName || "Unknown", email };
}

function applyRevokeDisplayFields(task, display) {
  const username =
    display.username && display.username !== "unknown" && !looksLikeObjectId(display.username)
      ? display.username
      : !looksLikeObjectId(task.username)
        ? task.username
        : "unknown";

  const identityName =
    display.identityName && !looksLikeObjectId(display.identityName)
      ? display.identityName
      : username !== "unknown"
        ? username
        : task.identityName;

  return {
    ...task,
    username,
    identityName,
    identityEmail: display.email || task.identityEmail || "",
    taskName: buildRevokeAccessTaskName(username),
    context: {
      ...(task.context || {}),
      displayUsername: username,
      displayIdentityName: identityName,
    },
  };
}

async function persistDisplayRepair(taskId, display) {
  if (!display?.username || display.username === "unknown" || looksLikeObjectId(display.username)) {
    return;
  }
  await WorkflowTaskQueue.updateOne(
    { taskId },
    {
      $set: {
        username: display.username,
        identityName: display.identityName,
        identityEmail: display.email || undefined,
        taskName: buildRevokeAccessTaskName(display.username),
        "context.displayUsername": display.username,
        "context.displayIdentityName": display.identityName,
      },
    },
  ).catch(() => {});
}

async function enrichRevokeAccessTask(task, reviewItemsById, tenantId) {
  if (task.action !== WORKFLOW_TASK_ACTIONS.ACCESS_REVOKE) return task;

  const cachedDisplay =
    task.context?.displayUsername && !looksLikeObjectId(task.context.displayUsername);
  if (cachedDisplay && !needsDisplayRepair(task)) {
    return applyRevokeDisplayFields(task, {
      username: task.context.displayUsername,
      identityName: task.context.displayIdentityName || task.identityName,
      email: task.identityEmail,
    });
  }

  let reviewItem = null;
  if (task.reviewEventId) {
    reviewItem = reviewItemsById.get(String(task.reviewEventId));
    if (!reviewItem) {
      reviewItem = await ReviewItem.findById(task.reviewEventId).lean();
      if (reviewItem) reviewItemsById.set(String(task.reviewEventId), reviewItem);
    }
  }

  const display = await resolveRevokeDisplayNames(reviewItem, tenantId);
  const enriched = applyRevokeDisplayFields(task, display);

  if (needsDisplayRepair(task) && display.username !== "unknown") {
    await persistDisplayRepair(task.taskId, display);
  }

  return enriched;
}

async function enrichRevokeAccessTasks(tasks, tenantId) {
  if (!Array.isArray(tasks) || tasks.length === 0) return tasks;
  const reviewItemsById = new Map();
  const reviewIds = [
    ...new Set(
      tasks
        .filter((t) => t.action === WORKFLOW_TASK_ACTIONS.ACCESS_REVOKE && t.reviewEventId)
        .map((t) => String(t.reviewEventId)),
    ),
  ];
  if (reviewIds.length > 0) {
    const reviewItems = await ReviewItem.find({ _id: { $in: reviewIds } }).lean();
    for (const item of reviewItems) {
      reviewItemsById.set(String(item._id), item);
    }
  }
  return Promise.all(
    tasks.map((task) =>
      task.action === WORKFLOW_TASK_ACTIONS.ACCESS_REVOKE
        ? enrichRevokeAccessTask(task, reviewItemsById, tenantId)
        : task,
    ),
  );
}

function resolveReviewerContext(reviewItem, entitlementName) {
  if (!reviewItem) {
    return {
      reviewerName: null,
      reviewerEmail: null,
      reviewedAt: null,
    };
  }

  if (entitlementName && Array.isArray(reviewItem.entitlementDecisions)) {
    const match = reviewItem.entitlementDecisions.find(
      (ed) =>
        String(ed.entitlementName || "").toLowerCase() ===
        String(entitlementName).toLowerCase(),
    );
    if (match) {
      return {
        reviewerName: reviewItem.reviewerName || reviewItem.reviewerSnapshot?.name || null,
        reviewerEmail: reviewItem.reviewerEmail || reviewItem.reviewerSnapshot?.email || null,
        reviewedAt: match.reviewedAt || reviewItem.reviewedAt || null,
        decision: match.decision || "Revoke",
      };
    }
  }

  return {
    reviewerName: reviewItem.reviewerName || reviewItem.reviewerSnapshot?.name || null,
    reviewerEmail: reviewItem.reviewerEmail || reviewItem.reviewerSnapshot?.email || null,
    reviewedAt: reviewItem.reviewedAt || null,
    decision: reviewItem.decision || "Revoke",
  };
}

async function appendStepLog(taskId, label, status, detail) {
  await WorkflowTaskQueue.updateOne(
    { taskId },
    {
      $push: {
        stepLog: { label, status, at: new Date(), detail: detail || undefined },
      },
    },
  );
}

export async function findOpenTaskForReview({
  tenantId,
  reviewEventId,
  entitlementName,
  action = WORKFLOW_TASK_ACTIONS.ACCESS_REVOKE,
}) {
  const filter = {
    tenantId: normalizeTenantId(tenantId) || String(tenantId),
    action,
    reviewEventId: String(reviewEventId),
    status: { $in: OPEN_TASK_STATUSES },
  };
  if (entitlementName) {
    filter.entitlementName = entitlementName;
  }
  return WorkflowTaskQueue.findOne(filter).lean();
}

export async function findOpenTaskForOrphan({
  tenantId,
  orphanId,
  action = WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW,
}) {
  return WorkflowTaskQueue.findOne({
    tenantId: normalizeTenantId(tenantId) || String(tenantId),
    action,
    orphanId: String(orphanId),
    status: { $in: OPEN_TASK_STATUSES },
  }).lean();
}

export async function getQueuedOrphanTargetsMap(tenantId, orphanIds = []) {
  const ids = [...new Set(orphanIds.map(String).filter(Boolean))];
  if (!ids.length) return { queuedTargets: {}, alreadyQueued: [], availableIds: ids };

  const tasks = await WorkflowTaskQueue.find({
    tenantId: normalizeTenantId(tenantId) || String(tenantId),
    action: WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW,
    orphanId: { $in: ids },
    status: { $in: OPEN_TASK_STATUSES },
  })
    .select("taskId taskName status orphanId dateOfEntry")
    .lean();

  const queuedTargets = {};
  for (const task of tasks) {
    queuedTargets[String(task.orphanId)] = {
      taskId: task.taskId,
      taskName: task.taskName,
      status: task.status,
      queueSlug: "iam-orphan-review",
    };
  }

  const alreadyQueued = tasks.map((t) => ({
    targetId: String(t.orphanId),
    identityName: t.taskName,
    eventId: t.taskId,
  }));
  const queuedSet = new Set(Object.keys(queuedTargets));
  const availableIds = ids.filter((id) => !queuedSet.has(String(id)));

  return { queuedTargets, alreadyQueued, availableIds };
}

async function resolveEnqueueWorkflowMapping(tenantId, action, workflowIdOverride) {
  if (workflowIdOverride) {
    const wf = await getWorkflowById(String(workflowIdOverride), String(tenantId));
    if (!wf || wf.enabled === false) return null;
    return {
      workflowId: wf.id,
      workflowName: wf.name,
      source: "user_selected",
    };
  }
  const mapping = await resolveWorkflowForAction(tenantId, action);
  if (!mapping) return null;
  return { ...mapping, source: "global_rule_set" };
}

export async function createIamOrphanReviewTask({
  tenantId,
  orphan,
  createdBy = "Uncorrelated Accounts",
  workflowId: workflowIdOverride = null,
}) {
  if (!tenantId || !orphan?._id) return { created: false, reason: "missing_context" };

  const mapping = await resolveEnqueueWorkflowMapping(
    tenantId,
    WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW,
    workflowIdOverride,
  );
  if (!mapping) {
    return {
      created: false,
      reason: workflowIdOverride ? "invalid_workflow" : "no_workflow_mapping",
    };
  }

  const orphanId = String(orphan._id);
  const existing = await findOpenTaskForOrphan({ tenantId, orphanId });
  if (existing) return { created: false, task: existing, reason: "duplicate" };

  const accountName = String(orphan.accountName || orphan.accountId || "unknown").trim();
  const taskId = uuidv4();
  const taskName = buildIamOrphanReviewTaskName(accountName);
  const queuedAt = new Date();

  let applicationName = "";
  if (orphan.applicationId) {
    const app = await Application.findById(orphan.applicationId).select("name").lean();
    applicationName = app?.name || "";
  }

  const task = await WorkflowTaskQueue.create({
    taskId,
    taskName,
    action: WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW,
    tenantId: normalizeTenantId(tenantId) || String(tenantId),
    username: sanitizeUsername(accountName),
    identityName: accountName,
    applicationId: orphan.applicationId ? String(orphan.applicationId) : undefined,
    applicationName,
    orphanId,
    workflowId: mapping.workflowId,
    workflowName: mapping.workflowName,
    status: WORKFLOW_TASK_STATUS.NEW,
    dateOfEntry: queuedAt,
    createdBy,
    retryCount: 0,
    stepLog: [
      {
        label: "Orphan flagged for remediation",
        status: "COMPLETED",
        at: queuedAt,
        detail: "Uncorrelated account queued for IAM orphan review",
      },
      {
        label: "Queue created",
        status: "COMPLETED",
        at: queuedAt,
        detail:
          mapping.source === "user_selected"
            ? `Workflow "${mapping.workflowName}" selected at remediate. Awaiting remediation scheduler — workflow is not started on remediate click.`
            : "Mapped via Global Rule Set. Awaiting remediation scheduler — workflow is not started on remediate click.",
      },
    ],
    context: {
      orphanId,
      accountName,
      riskLevel: orphan.riskLevel || null,
      triggerMode: "scheduler",
      eventFamily: "ACCESS_REVOKE_FRAMEWORK",
    },
  });

  await OrphanAccount.updateOne(
    { _id: orphan._id },
    {
      $set: {
        workflowStatus: "PENDING",
        currentStepLabel: "Queued for IAM review",
      },
    },
  );

  await UnifiedAuditEvent.create({
    tenantId: normalizeTenantId(tenantId) || String(tenantId),
    eventType: "WORKFLOW_TASK_QUEUE",
    action: "TASK_CREATED",
    resourceType: "WorkflowTaskQueue",
    resourceId: taskId,
    actor: createdBy,
    details: {
      taskName,
      workflowName: mapping.workflowName,
      action: WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW,
      orphanId,
    },
  }).catch(() => {});

  return { created: true, task: task.toObject() };
}

export async function enqueueIamOrphanReviewTasks({
  tenantId,
  orphanIds = [],
  createdBy = "Uncorrelated Accounts",
  workflowId = null,
}) {
  const results = [];
  const uniqueIds = [...new Set(orphanIds.map(String).filter(Boolean))];
  const tid = String(tenantId);

  for (const orphanId of uniqueIds) {
    if (!mongoose.isValidObjectId(orphanId)) {
      results.push({ orphanId, created: false, reason: "invalid_id" });
      continue;
    }
    const orphan = await OrphanAccount.findById(orphanId).lean();
    if (!orphan || String(orphan.tenantId) !== tid) {
      results.push({ orphanId, created: false, reason: "not_found" });
      continue;
    }
    results.push({
      orphanId,
      ...(await createIamOrphanReviewTask({
        tenantId,
        orphan,
        createdBy,
        workflowId,
      })),
    });
  }

  const created = results.filter((r) => r.created);
  const duplicates = results.filter((r) => r.reason === "duplicate");
  return {
    results,
    createdCount: created.length,
    duplicateCount: duplicates.length,
    tasks: created.map((r) => r.task).filter(Boolean),
  };
}

export async function createRevokeAccessTask({
  tenantId,
  reviewItem,
  entitlementName = null,
  campaignId,
  campaignName,
  createdBy = "Certification Engine",
  workflowId: workflowIdOverride = null,
}) {
  if (!tenantId || !reviewItem) return { created: false, reason: "missing_context" };

  const mapping = await resolveEnqueueWorkflowMapping(
    tenantId,
    WORKFLOW_TASK_ACTIONS.ACCESS_REVOKE,
    workflowIdOverride,
  );
  if (!mapping) {
    await UnifiedAuditEvent.create({
      tenantId: normalizeTenantId(tenantId) || String(tenantId),
      eventType: "WORKFLOW_TASK_QUEUE",
      action: "QUEUE_SKIPPED_NO_RULE",
      resourceType: "ReviewItem",
      resourceId: String(reviewItem._id),
      actor: createdBy,
      details: {
        action: WORKFLOW_TASK_ACTIONS.ACCESS_REVOKE,
        message: "No workflow mapped in Global Rule Set for ACCESS_REVOKE",
      },
    }).catch(() => {});
    return { created: false, reason: "no_workflow_mapping" };
  }

  const reviewEventId = String(reviewItem._id);
  const existing = await findOpenTaskForReview({
    tenantId,
    reviewEventId,
    entitlementName,
  });
  if (existing) return { created: false, task: existing, reason: "duplicate" };

  const username = resolveUsername(reviewItem);
  const display = await resolveRevokeDisplayNames(reviewItem, tenantId);
  const resolvedUsername =
    display.username !== "unknown" ? display.username : username;
  const taskId = uuidv4();
  const taskName = buildRevokeAccessTaskName(resolvedUsername);
  const reviewer = resolveReviewerContext(reviewItem, entitlementName);
  const queuedAt = new Date();

  const task = await WorkflowTaskQueue.create({
    taskId,
    taskName,
    action: WORKFLOW_TASK_ACTIONS.ACCESS_REVOKE,
    tenantId: normalizeTenantId(tenantId) || String(tenantId),
    username: resolvedUsername,
    identityName: display.identityName || resolvedUsername,
    identityEmail: display.email || reviewItem.itemEmail || "",
    applicationId: reviewItem.applicationId ? String(reviewItem.applicationId) : undefined,
    applicationName: reviewItem.itemApplicationName || reviewItem.applicationName || "",
    entitlementName: entitlementName || undefined,
    workflowId: mapping.workflowId,
    workflowName: mapping.workflowName,
    status: WORKFLOW_TASK_STATUS.NEW,
    dateOfEntry: queuedAt,
    createdBy,
    reviewEventId,
    campaignId: campaignId ? String(campaignId) : undefined,
    campaignName: campaignName || undefined,
    retryCount: 0,
    stepLog: [
      {
        label: "Revoke decision recorded",
        status: "COMPLETED",
        at: queuedAt,
        detail: "Certification entitlement set to REVOKE_IN_PROGRESS",
      },
      {
        label: "Queue created",
        status: "COMPLETED",
        at: queuedAt,
        detail:
          mapping.source === "user_selected"
            ? `Workflow "${mapping.workflowName}" selected at revoke. Awaiting remediation scheduler — workflow is not started on the revoke click.`
            : "Mapped via Global Rule Set. Awaiting remediation scheduler — workflow is not started on revoke click.",
      },
    ],
    context: {
      reviewItemId: reviewEventId,
      entitlementName: entitlementName || null,
      reviewerName: reviewer.reviewerName,
      reviewerEmail: reviewer.reviewerEmail,
      reviewedAt: reviewer.reviewedAt,
      certificationStatus: "REVOKE_IN_PROGRESS",
      triggerMode: "scheduler",
      displayUsername: resolvedUsername,
      displayIdentityName: display.identityName || resolvedUsername,
    },
  });

  await UnifiedAuditEvent.create({
    tenantId: normalizeTenantId(tenantId) || String(tenantId),
    eventType: "WORKFLOW_TASK_QUEUE",
    action: "TASK_CREATED",
    resourceType: "WorkflowTaskQueue",
    resourceId: taskId,
    actor: createdBy,
    details: {
      taskName,
      workflowName: mapping.workflowName,
      action: WORKFLOW_TASK_ACTIONS.ACCESS_REVOKE,
      status: WORKFLOW_TASK_STATUS.NEW,
    },
  }).catch(() => {});

  return { created: true, task: task.toObject() };
}

export async function enqueueAccessRevokeTasks({
  tenantId,
  items = [],
  createdBy = "Certification Review",
  workflowId = null,
}) {
  const results = [];
  const tid = normalizeTenantId(tenantId) || String(tenantId);

  for (const row of items) {
    const reviewItemId = String(row.reviewItemId || row.id || "").trim();
    if (!mongoose.isValidObjectId(reviewItemId)) {
      results.push({ reviewItemId, created: false, reason: "invalid_id" });
      continue;
    }
    const reviewItem = await ReviewItem.findById(reviewItemId).lean();
    if (!reviewItem) {
      results.push({ reviewItemId, created: false, reason: "not_found" });
      continue;
    }
    const campaign = reviewItem.campaignId
      ? await Campaign.findById(reviewItem.campaignId).select("name tenantId").lean()
      : null;
    if (campaign && String(campaign.tenantId) !== tid) {
      results.push({ reviewItemId, created: false, reason: "not_found" });
      continue;
    }
    results.push({
      reviewItemId,
      ...(await createRevokeAccessTask({
        tenantId: tid,
        reviewItem,
        entitlementName: row.entitlementName || null,
        campaignId: reviewItem.campaignId,
        campaignName: row.campaignName || campaign?.name || "",
        createdBy,
        workflowId,
      })),
    });
  }

  const created = results.filter((r) => r.created);
  const duplicates = results.filter((r) => r.reason === "duplicate");
  return {
    results,
    createdCount: created.length,
    duplicateCount: duplicates.length,
    tasks: created.map((r) => r.task).filter(Boolean),
  };
}

export async function listWorkflowTasks(tenantId, filters = {}) {
  const query = { ...tenantMatchFilter(tenantId, "tenantId") };
  if (filters.status) query.status = filters.status;
  if (filters.action) query.action = filters.action;
  if (filters.campaignId) query.campaignId = String(filters.campaignId);
  const limit = Math.min(parseInt(filters.limit, 10) || 100, 500);
  const data = await WorkflowTaskQueue.find(query)
    .sort({ dateOfEntry: -1 })
    .limit(limit)
    .lean();
  return enrichRevokeAccessTasks(data, tenantId);
}

async function buildWorkflowContextForTask(task, tenantId) {
  const tid = String(tenantId);
  const tenantFilter = buildWorkflowTenantReadFilter(tid);

  let run = null;
  if (task?.executionId) {
    run = await RemediationWorkflowRun.findOne({
      executionId: task.executionId,
      ...tenantFilter,
    })
      .sort({ startedAt: -1 })
      .lean();
  }
  if (!run && task?.runId) {
    run = await getRunById(task.runId, tid);
  }

  let execution = null;
  if (task?.executionId) {
    execution = await RemediationWorkflowExecution.findOne({
      executionId: task.executionId,
      ...tenantFilter,
    }).lean();
  }

  let actionEmail = null;
  if (task?.executionId) {
    const execId = String(task.executionId);
    let emailJob = await EmailJob.findOne({
      type: "WORKFLOW",
      "metadata.executionId": execId,
      $or: [
        { "metadata.stepId": "sendEmail" },
        { "metadata.stepLabel": /send action email/i },
      ],
    })
      .sort({ createdAt: -1 })
      .select("status recipientEmail subject attempts maxAttempts lastError sentAt nextRunAt createdAt")
      .lean();
    if (!emailJob) {
      emailJob = await EmailJob.findOne({
        type: "WORKFLOW",
        "metadata.executionId": execId,
      })
        .sort({ createdAt: -1 })
        .select("status recipientEmail subject attempts maxAttempts lastError sentAt nextRunAt createdAt")
        .lean();
    }
    if (emailJob) {
      actionEmail = {
        status: emailJob.status,
        to: emailJob.recipientEmail || null,
        subject: emailJob.subject || null,
        attempts: emailJob.attempts || 0,
        maxAttempts: emailJob.maxAttempts || null,
        lastError: emailJob.lastError || null,
        sentAt: emailJob.sentAt || null,
        nextRunAt: emailJob.nextRunAt || null,
        createdAt: emailJob.createdAt || null,
      };
    }
  }

  return {
    runSteps: run?.steps || [],
    runStartedAt: run?.startedAt || null,
    runCompletedAt: run?.completedAt || null,
    executionStatus: execution?.status || null,
    waitReason: execution?.waitReason || null,
    nextPollAt: execution?.nextPollAt || null,
    reminderPhaseIndex: execution?.reminderPhaseIndex ?? null,
    reminderPhases: execution?.reminderPhases || [],
    executionStartedAt:
      task?.executionStartedAt || run?.startedAt || execution?.startedAt || null,
    completedAt: task?.completedAt || run?.completedAt || execution?.completedAt || null,
    actionEmail,
  };
}

export async function getWorkflowTask(taskId, tenantId) {
  const tid = normalizeTenantId(tenantId);
  let task = await WorkflowTaskQueue.findOne({
    taskId: String(taskId),
    ...tenantMatchFilter(tid, "tenantId"),
  }).lean();
  if (!task) return null;

  // Auto-heal: portal decision saved but queue-first wait never resumed.
  if (
    task.action === WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW &&
    task.orphanId &&
    task.status === WORKFLOW_TASK_STATUS.WAITING
  ) {
    try {
      const heal = await healStuckIamOrphanDecision({
        orphanId: task.orphanId,
        tenantId: tid,
        executionId: task.executionId,
      });
      if (heal.healed) {
        task = await WorkflowTaskQueue.findOne({
          taskId: String(taskId),
          ...tenantMatchFilter(tid, "tenantId"),
        }).lean();
      }
    } catch (err) {
      console.warn("[getWorkflowTask] IAM orphan decision heal failed:", err.message);
    }
  }

  // Auto-heal: action email SMTP failed but task still WAITING for IAM decision.
  if (
    task &&
    task.action === WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW &&
    task.status === WORKFLOW_TASK_STATUS.WAITING &&
    task.executionId
  ) {
    try {
      const badEmail = await EmailJob.findOne({
        type: "WORKFLOW",
        "metadata.executionId": String(task.executionId),
        $or: [
          { status: "FAILED" },
          { status: "PENDING", attempts: { $gt: 0 }, lastError: { $nin: [null, ""] } },
        ],
      })
        .sort({ updatedAt: -1 })
        .select("recipientEmail lastError metadata status")
        .lean();
      if (badEmail) {
        if (badEmail.status !== "FAILED") {
          await EmailJob.updateOne(
            { _id: badEmail._id },
            {
              $set: {
                status: "FAILED",
                lastError: badEmail.lastError || "SMTP delivery failed",
              },
              $unset: { processingStartedAt: 1 },
            },
          );
        }
        await failRemediationOnWorkflowEmailDelivery({
          executionId: task.executionId,
          recipientEmail: badEmail.recipientEmail,
          errorMessage: badEmail.lastError,
          orphanId: badEmail.metadata?.orphanId || task.orphanId,
        });
        task = await WorkflowTaskQueue.findOne({
          taskId: String(taskId),
          ...tenantMatchFilter(tid, "tenantId"),
        }).lean();
      }
    } catch (err) {
      console.warn("[getWorkflowTask] email-failure heal failed:", err.message);
    }
  }

  // Auto-heal: email later delivered after fail-fast — resume Waiting for IAM decision.
  if (
    task &&
    task.action === WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW &&
    task.status === WORKFLOW_TASK_STATUS.FAILED &&
    task.executionId
  ) {
    try {
      const recover = await recoverRemediationAfterEmailDelivered({
        task,
        tenantId: tid,
      });
      if (recover.recovered) {
        task = await WorkflowTaskQueue.findOne({
          taskId: String(taskId),
          ...tenantMatchFilter(tid, "tenantId"),
        }).lean();
      }
    } catch (err) {
      console.warn("[getWorkflowTask] email-delivered recover failed:", err.message);
    }
  }

  const [enriched] = await enrichRevokeAccessTasks([task], tid);
  const [schedulerConfig, workflowContext] = await Promise.all([
    SchedulerConfig.findOne({ $or: [{ orgId: tid }, ...(mongoose.Types.ObjectId.isValid(tid || "") ? [{ orgId: new mongoose.Types.ObjectId(tid) }] : [])] }).lean(),
    buildWorkflowContextForTask(enriched, tid),
  ]);
  const schedulerContext = schedulerConfig
    ? {
        enabled: schedulerConfig.enabled !== false,
        scheduleType: schedulerConfig.scheduleType,
        interval: schedulerConfig.interval,
        lastRunAt: schedulerConfig.lastRunAt,
        nextRunAt: schedulerConfig.nextRunAt,
        pendingPickup:
          enriched?.status === WORKFLOW_TASK_STATUS.NEW &&
          schedulerConfig.lastRunAt &&
          enriched.dateOfEntry &&
          new Date(schedulerConfig.lastRunAt) > new Date(enriched.dateOfEntry),
      }
    : null;
  return { ...enriched, schedulerContext, workflowContext };
}

export async function getWorkflowTaskSummary(tenantId) {
  const tid = String(tenantId);
  const statuses = Object.values(WORKFLOW_TASK_STATUS);
  const counts = await WorkflowTaskQueue.aggregate([
    { $match: { tenantId: tid } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const byStatus = Object.fromEntries(statuses.map((s) => [s, 0]));
  for (const row of counts) {
    byStatus[row._id] = row.count;
  }
  const byAction = await WorkflowTaskQueue.aggregate([
    { $match: { tenantId: tid } },
    { $group: { _id: "$action", count: { $sum: 1 } } },
  ]);
  return {
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    byStatus,
    byAction: Object.fromEntries(byAction.map((r) => [r._id, r.count])),
  };
}

export async function pickUpNewTasks(tenantId) {
  const tid = normalizeTenantId(tenantId);
  if (!tid) {
    return { recordsFound: 0, recordsUpdated: 0 };
  }
  const filter = { status: WORKFLOW_TASK_STATUS.NEW, ...tenantMatchFilter(tid, "tenantId") };

  const now = new Date();
  const res = await WorkflowTaskQueue.updateMany(filter, {
    $set: {
      status: WORKFLOW_TASK_STATUS.IN_PROGRESS,
      updatedAt: now,
      "context.triggerMode": "scheduler",
      "context.pickedUpAt": now,
    },
    $push: {
      stepLog: {
        label: "Scheduler picked task",
        status: "COMPLETED",
        at: now,
        detail: "Picked up by remediation scheduler",
      },
    },
  });

  return {
    recordsFound: res.matchedCount ?? res.n ?? 0,
    recordsUpdated: res.modifiedCount ?? res.nModified ?? 0,
  };
}

export async function completeTaskAndUpdateCertification(task, { runResult } = {}) {
  const now = new Date();
  await WorkflowTaskQueue.updateOne(
    { taskId: task.taskId },
    {
      $set: {
        status: WORKFLOW_TASK_STATUS.COMPLETED,
        completedAt: now,
        runId: runResult?.runId || task.runId,
      },
      $push: {
        stepLog: {
          label: "Queue completed",
          status: "COMPLETED",
          at: now,
        },
      },
    },
  );

  if (task.action === WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW && task.orphanId) {
    await OrphanAccount.updateOne(
      { _id: task.orphanId },
      {
        $set: {
          workflowStatus: "COMPLETED",
          currentStepLabel: "IAM review workflow completed",
        },
      },
    );
  } else if (task.reviewEventId) {
    const item = await ReviewItem.findById(task.reviewEventId);
    if (item) {
      if (task.entitlementName && Array.isArray(item.entitlementDecisions)) {
        const idx = item.entitlementDecisions.findIndex(
          (ed) =>
            String(ed.entitlementName || "").toLowerCase() ===
            String(task.entitlementName).toLowerCase(),
        );
        if (idx >= 0) {
          item.entitlementDecisions[idx].status = "REVOKED";
          item.entitlementDecisions[idx].remediationStatus = "COMPLETED";
          item.entitlementDecisions[idx].provisioningStatus = "EXECUTED";
        }
      } else if (item.status === "REVOKE_IN_PROGRESS") {
        item.status = "REVOKED";
      }
      await item.save();
    }
  }

  await UnifiedAuditEvent.create({
    tenantId: task.tenantId,
    eventType: "WORKFLOW_TASK_QUEUE",
    action: "TASK_COMPLETED",
    resourceType: "WorkflowTaskQueue",
    resourceId: task.taskId,
    actor: "workflow-engine",
    details: { taskName: task.taskName, workflowName: task.workflowName },
  }).catch(() => {});
}

export async function executeWorkflowTask(task) {
  if (!task || task.executionStartedAt) return { skipped: true };

  const workflow = await getWorkflowById(task.workflowId, task.tenantId);
  if (!workflow) {
    await WorkflowTaskQueue.updateOne(
      { taskId: task.taskId },
      {
        $set: {
          status: WORKFLOW_TASK_STATUS.FAILED,
          failureReason: "Workflow definition not found",
        },
      },
    );
    return { status: "FAILED", error: "Workflow not found" };
  }

  const reviewItem = task.reviewEventId
    ? await ReviewItem.findById(task.reviewEventId).lean()
    : null;

  let trigger = task.context?.trigger;
  if (!trigger && task.action === WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW) {
    const orphanId = task.orphanId || task.context?.orphanId;
    const orphan = orphanId ? await OrphanAccount.findById(orphanId).lean() : null;
    if (orphan) {
      const app = orphan.applicationId
        ? await Application.findById(orphan.applicationId).select("name").lean()
        : null;
      trigger = {
        orphanId: String(orphan._id),
        accountName: orphan.accountName,
        applicationId: orphan.applicationId ? String(orphan.applicationId) : null,
        applicationName: app?.name || task.applicationName || null,
        riskLevel: orphan.riskLevel || "HIGH",
        detectedAt: orphan.detectedAt,
        status: orphan.status,
      };
    }
  }
  if (!trigger && reviewItem) {
    trigger = await buildTriggerFromReviewItem(
      reviewItem,
      task.entitlementName,
      task.campaignName,
      task.tenantId,
    );
  }
  if (!trigger) {
    trigger = {
      identityName: task.identityName,
      identityEmail: task.identityEmail,
      applicationName: task.applicationName,
      entitlementName: task.entitlementName,
      campaignId: task.campaignId,
      campaignName: task.campaignName,
      decision: "Revoke",
    };
  }

  const executionId = uuidv4();
  const executionStartedAt = new Date();
  await WorkflowTaskQueue.updateOne(
    { taskId: task.taskId },
    {
      $set: {
        executionId,
        executionStartedAt,
      },
    },
  );
  await appendStepLog(task.taskId, "Workflow started", "RUNNING");

  if (task.action === WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW && task.orphanId) {
    // Persist a remediation execution row so OrphanReminderSchedule / portal resume
    // can find WAITING state (queue-first path previously skipped this).
    await RemediationWorkflowExecution.create({
      tenantId: task.tenantId ? String(task.tenantId) : null,
      executionId,
      eventType: "IAM_ORPHAN_REVIEW",
      eventName: trigger?.accountName || task.taskName,
      orphanId: String(task.orphanId),
      workflowId: task.workflowId,
      workflowName: task.workflowName || workflow.name,
      applicationId: trigger?.applicationId || null,
      applicationName: trigger?.applicationName || task.applicationName || null,
      eventOwner: task.createdBy || "scheduler",
      status: "RUNNING",
      stepStatuses: ["Running"],
      triggerPayload: trigger,
      startedAt: executionStartedAt,
    });
    await OrphanAccount.updateOne(
      { _id: task.orphanId },
      {
        $set: {
          workflowExecutionId: executionId,
          workflowStatus: "IN_PROGRESS",
          currentStepLabel: "IAM review workflow running",
        },
      },
    );
  }

  const adapter = createIgaAdapter({
    tenantId: task.tenantId,
    executedBy: task.createdBy || "scheduler",
    executionId,
  });

  const result = await executeWorkflow(
    repairWorkflowDefinition(workflow),
    { trigger },
    {
      adapter,
      tenantId: task.tenantId,
      executionId,
      mode: "LIVE",
      persist: true,
      portalBaseUrl: env.frontendUrl,
      workflowFromEmail: env.workflow?.fromEmail,
      orphanIamPortalUrl:
        task.action === WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW
          ? issueOrphanIamPortalUrl({
              orphanId: task.orphanId || task.context?.orphanId,
              executionId,
              tenantId: task.tenantId,
            })
          : undefined,
    },
  );

  await WorkflowTaskQueue.updateOne(
    { taskId: task.taskId },
    { $set: { runId: result.runId } },
  );

  if (result.status === "SUCCESS") {
    if (task.action === WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW) {
      await RemediationWorkflowExecution.updateOne(
        { executionId },
        {
          $set: {
            status: "COMPLETED",
            runId: result.runId,
            waitReason: null,
            checkpointNodeId: null,
            nextPollAt: null,
            completedAt: new Date(),
            currentStepLabel: "Workflow finished",
            stepStatuses: deriveIamOrphanStatusBullets(result, { status: "COMPLETED" }),
          },
        },
      );
    }
    await appendStepLog(task.taskId, "Workflow finished", "COMPLETED");
    await completeTaskAndUpdateCertification(task, { runResult: result });
    return { status: "COMPLETED", result };
  }

  if (result.status === "WAITING") {
    await WorkflowTaskQueue.updateOne(
      { taskId: task.taskId },
      { $set: { status: WORKFLOW_TASK_STATUS.WAITING } },
    );
    if (task.action === WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW && task.orphanId) {
      const checkpointNodeId = resolveIamCheckpointNodeId(workflow) || "checkDecision";
      await RemediationWorkflowExecution.updateOne(
        { executionId },
        {
          $set: {
            status: "WAITING",
            waitReason: "IAM_DECISION",
            checkpointNodeId,
            runId: result.runId,
            currentStepLabel: "Awaiting IAM Decision",
            stepStatuses: deriveIamOrphanStatusBullets(result, {
              status: "WAITING",
              waitReason: "IAM_DECISION",
            }),
          },
        },
      );
      await OrphanAccount.updateOne(
        { _id: task.orphanId },
        {
          $set: {
            workflowStatus: "WAITING_IAM",
            currentStepLabel: "Awaiting IAM decision",
          },
        },
      );
    }
    await appendStepLog(task.taskId, "Workflow waiting", "WAITING", result.error);
    return { status: "WAITING", result };
  }

  if (task.action === WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW) {
    await RemediationWorkflowExecution.updateOne(
      { executionId },
      {
        $set: {
          status: "FAILED",
          runId: result.runId,
          error: result.error || "Workflow failed",
          waitReason: null,
          checkpointNodeId: null,
          nextPollAt: null,
          currentStepLabel: result.error?.includes("Send email")
            ? "Email delivery failed"
            : "Workflow Failed",
          stepStatuses: deriveIamOrphanStatusBullets(result, { status: "FAILED" }),
        },
      },
    );
    if (task.orphanId) {
      await OrphanAccount.updateOne(
        { _id: task.orphanId },
        {
          $set: {
            workflowStatus: "FAILED",
            currentStepLabel: result.error?.includes("Send email")
              ? "Email delivery failed"
              : "Workflow Failed",
            nextCheckAt: null,
          },
        },
      );
    }
  }

  await WorkflowTaskQueue.updateOne(
    { taskId: task.taskId },
    {
      $set: {
        status: WORKFLOW_TASK_STATUS.FAILED,
        failureReason: result.error || "Workflow failed",
      },
    },
  );
  await appendStepLog(task.taskId, "Workflow failed", "FAILED", result.error);
  return { status: "FAILED", result };
}

export async function processInProgressTasks(tenantId) {
  const tid = normalizeTenantId(tenantId);
  if (!tid) return [];

  const filter = {
    status: WORKFLOW_TASK_STATUS.IN_PROGRESS,
    executionStartedAt: { $exists: false },
    ...tenantMatchFilter(tid, "tenantId"),
  };

  const tasks = await WorkflowTaskQueue.find(filter).limit(50).lean();
  const results = [];
  for (const task of tasks) {
    try {
      results.push({ taskId: task.taskId, ...(await executeWorkflowTask(task)) });
    } catch (err) {
      await WorkflowTaskQueue.updateOne(
        { taskId: task.taskId },
        {
          $set: {
            status: WORKFLOW_TASK_STATUS.FAILED,
            failureReason: err.message,
          },
        },
      );
      results.push({ taskId: task.taskId, status: "FAILED", error: err.message });
    }
  }
  return results;
}

export async function immediatelyLaunchTask(taskId, tenantId, actor = "system") {
  const task = await WorkflowTaskQueue.findOne({
    taskId: String(taskId),
    tenantId: normalizeTenantId(tenantId) || String(tenantId),
  }).lean();

  if (!task) throw new Error("Task not found");
  if (task.status !== WORKFLOW_TASK_STATUS.NEW) {
    throw new Error(`Cannot launch: task is in status ${task.status}`);
  }

  const now = new Date();
  await WorkflowTaskQueue.updateOne(
    { taskId: task.taskId },
    {
      $set: {
        status: WORKFLOW_TASK_STATUS.IN_PROGRESS,
        updatedAt: now,
        "context.triggerMode": "manual",
        "context.launchedAt": now,
        "context.launchedBy": actor,
      },
      $push: {
        stepLog: {
          label: `Manual trigger picked task (${actor})`,
          status: "COMPLETED",
          at: now,
          detail: "Launched immediately — not waiting for remediation scheduler",
        },
      },
    },
  );

  const updatedTask = await WorkflowTaskQueue.findOne({ taskId: task.taskId }).lean();
  const result = await executeWorkflowTask(updatedTask);

  return { ...updatedTask, launchMode: "immediate", executeResult: result };
}

/**
 * Retry notification emails for a FAILED remediation task (SMTP recovered),
 * then resume the workflow from the first failed SendEmail step.
 */
export async function retryFailedNotifications(taskId, tenantId, actor = "system") {
  const tid = normalizeTenantId(tenantId) || String(tenantId);
  const task = await WorkflowTaskQueue.findOne({
    taskId: String(taskId),
    ...tenantMatchFilter(tid, "tenantId"),
  }).lean();

  if (!task) throw new Error("Task not found");
  if (task.status !== WORKFLOW_TASK_STATUS.FAILED) {
    throw new Error(`Cannot retry notifications: task is ${task.status}`);
  }
  if (!task.executionId || !task.workflowId) {
    throw new Error("Task has no workflow execution to resume");
  }

  const failure = String(task.failureReason || "").toLowerCase();
  const emailFailure =
    failure.includes("smtp") ||
    failure.includes("email") ||
    failure.includes("badcredentials") ||
    failure.includes("invalid login") ||
    failure.includes("send email") ||
    (task.stepLog || []).some((s) =>
      /email|notify|smtp|badcredentials|invalid login/i.test(
        `${s?.label || ""} ${s?.detail || ""}`,
      ),
    );
  if (!emailFailure && task.failureReason) {
    // Still allow if there are FAILED workflow emails for this execution.
    const failedCount = await EmailJob.countDocuments({
      type: "WORKFLOW",
      "metadata.executionId": String(task.executionId),
      status: "FAILED",
    });
    if (!failedCount) {
      throw new Error("Task failure is not notification-related");
    }
  }

  const { deliverEmailJobNow } = await import("../email/deliverEmailJobNow.js");
  const failedJobs = await EmailJob.find({
    type: "WORKFLOW",
    "metadata.executionId": String(task.executionId),
    status: "FAILED",
  })
    .select("_id recipientEmail subject lastError")
    .lean();

  const deliveryResults = [];
  for (const job of failedJobs) {
    const delivery = await deliverEmailJobNow(job._id);
    deliveryResults.push({
      emailJobId: String(job._id),
      to: job.recipientEmail,
      ok: delivery.ok,
      error: delivery.error || null,
      status: delivery.status || null,
    });
    if (!delivery.ok) {
      throw new Error(
        delivery.error ||
          `Email delivery still failing for ${job.recipientEmail || "recipient"}`,
      );
    }
  }

  const tenantFilter = buildWorkflowTenantReadFilter(tid);
  const run = await RemediationWorkflowRun.findOne({
    executionId: String(task.executionId),
    ...tenantFilter,
  })
    .sort({ startedAt: -1 })
    .lean();

  const failedEmailStep = (run?.steps || []).find(
    (s) => s.type === "SendEmail" && s.status === "FAILED",
  );
  const startNodeId = failedEmailStep?.stepId;
  if (!startNodeId) {
    throw new Error("No failed SendEmail step found to resume");
  }

  const seedOutputs = {};
  for (const step of run?.steps || []) {
    if (step.status === "SUCCESS" && step.stepId && step.output) {
      seedOutputs[step.stepId] = step.output;
    }
  }

  const workflow = await getWorkflowById(task.workflowId, tid);
  if (!workflow) throw new Error("Workflow definition not found");

  const reviewItem = task.reviewEventId
    ? await ReviewItem.findById(task.reviewEventId).lean()
    : null;
  let trigger = task.context?.trigger;
  if (!trigger && reviewItem) {
    trigger = await buildTriggerFromReviewItem(
      reviewItem,
      task.entitlementName,
      task.campaignName,
      tid,
    );
  }
  if (!trigger && run?.steps?.[0]?.output) {
    trigger = run.steps[0].output;
  }
  if (!trigger) {
    trigger = {
      identityName: task.identityName,
      identityEmail: task.identityEmail,
      applicationName: task.applicationName,
      entitlementName: task.entitlementName,
      campaignId: task.campaignId,
      campaignName: task.campaignName,
      decision: "Revoke",
    };
  }

  const now = new Date();
  await WorkflowTaskQueue.updateOne(
    { taskId: task.taskId },
    {
      $set: {
        status: WORKFLOW_TASK_STATUS.IN_PROGRESS,
        failureReason: null,
        updatedAt: now,
      },
      $push: {
        stepLog: {
          label: `Retry notifications (${actor})`,
          status: "RUNNING",
          at: now,
          detail: `Resuming from ${startNodeId}`,
        },
      },
      $inc: { retryCount: 1 },
    },
  );

  const adapter = createIgaAdapter({
    tenantId: tid,
    executedBy: actor,
    executionId: task.executionId,
  });

  const result = await executeWorkflow(
    repairWorkflowDefinition(workflow),
    { trigger },
    {
      adapter,
      tenantId: tid,
      executionId: task.executionId,
      mode: "LIVE",
      persist: true,
      startNodeId,
      seedOutputs,
      portalBaseUrl: env.frontendUrl,
      workflowFromEmail: env.workflow?.fromEmail,
    },
  );

  await WorkflowTaskQueue.updateOne(
    { taskId: task.taskId },
    { $set: { runId: result.runId } },
  );

  if (result.status === "SUCCESS") {
    await appendStepLog(task.taskId, "Notification retry succeeded", "COMPLETED");
    const fresh = await WorkflowTaskQueue.findOne({ taskId: task.taskId }).lean();
    await completeTaskAndUpdateCertification(fresh || task, { runResult: result });
    return {
      ok: true,
      status: "COMPLETED",
      deliveryResults,
      resultStatus: result.status,
      resumedFrom: startNodeId,
    };
  }

  if (result.status === "WAITING") {
    await WorkflowTaskQueue.updateOne(
      { taskId: task.taskId },
      { $set: { status: WORKFLOW_TASK_STATUS.WAITING, failureReason: null } },
    );
    await appendStepLog(task.taskId, "Workflow waiting after notification retry", "WAITING");
    return {
      ok: true,
      status: "WAITING",
      deliveryResults,
      resultStatus: result.status,
      resumedFrom: startNodeId,
    };
  }

  const errMsg = result.error || "Workflow retry failed";
  await WorkflowTaskQueue.updateOne(
    { taskId: task.taskId },
    {
      $set: {
        status: WORKFLOW_TASK_STATUS.FAILED,
        failureReason: errMsg,
      },
    },
  );
  await appendStepLog(task.taskId, "Notification retry failed", "FAILED", errMsg);
  throw new Error(errMsg);
}

/**
 * Manually mark a remediation queue task complete (e.g. ITSM ticket closed offline).
 * Allowed for WAITING / IN_PROGRESS open tasks that are not already terminal.
 */
export async function markTaskComplete(taskId, tenantId, actor = "system") {
  const tid = normalizeTenantId(tenantId) || String(tenantId || "");
  const task = await WorkflowTaskQueue.findOne({
    taskId: String(taskId),
    ...tenantMatchFilter(tid, "tenantId"),
  }).lean();

  if (!task) throw new Error("Task not found");

  if (
    task.status === WORKFLOW_TASK_STATUS.COMPLETED ||
    task.status === WORKFLOW_TASK_STATUS.CANCELLED
  ) {
    throw new Error(`Task is already ${task.status}`);
  }
  if (task.status === WORKFLOW_TASK_STATUS.NEW) {
    throw new Error(
      "Cannot mark complete while still queued. Launch the task first, or cancel it.",
    );
  }
  if (
    task.status !== WORKFLOW_TASK_STATUS.WAITING &&
    task.status !== WORKFLOW_TASK_STATUS.IN_PROGRESS &&
    task.status !== WORKFLOW_TASK_STATUS.FAILED
  ) {
    throw new Error(`Cannot mark complete: task is in status ${task.status}`);
  }

  const now = new Date();
  await appendStepLog(
    task.taskId,
    "Marked complete (manual)",
    "COMPLETED",
    `Completed by ${actor}`,
  );

  await completeTaskAndUpdateCertification(
    { ...task, runId: task.runId },
    { runResult: { runId: task.runId } },
  );

  await UnifiedAuditEvent.create({
    tenantId: task.tenantId,
    eventType: "WORKFLOW_TASK_QUEUE",
    action: "TASK_MARKED_COMPLETE",
    resourceType: "WorkflowTaskQueue",
    resourceId: task.taskId,
    actor,
    details: {
      taskName: task.taskName,
      previousStatus: task.status,
      at: now,
    },
  }).catch(() => {});

  return getWorkflowTask(task.taskId, tid);
}

/**
 * Cancel a pending remediation queue task before access is revoked / review finishes.
 * Allowed for NEW (and WAITING so operators can abandon a stuck ITSM wait).
 */
export async function cancelWorkflowTask(taskId, tenantId, actor = "system", { reason } = {}) {
  const tid = normalizeTenantId(tenantId) || String(tenantId || "");
  const task = await WorkflowTaskQueue.findOne({
    taskId: String(taskId),
    ...tenantMatchFilter(tid, "tenantId"),
  }).lean();

  if (!task) throw new Error("Task not found");

  if (
    task.status === WORKFLOW_TASK_STATUS.COMPLETED ||
    task.status === WORKFLOW_TASK_STATUS.CANCELLED
  ) {
    throw new Error(`Task is already ${task.status}`);
  }
  if (task.status === WORKFLOW_TASK_STATUS.IN_PROGRESS) {
    throw new Error(
      "Cannot cancel a running task. Wait for it to finish or fail, then retry.",
    );
  }
  if (
    task.status !== WORKFLOW_TASK_STATUS.NEW &&
    task.status !== WORKFLOW_TASK_STATUS.WAITING &&
    task.status !== WORKFLOW_TASK_STATUS.FAILED
  ) {
    throw new Error(`Cannot cancel: task is in status ${task.status}`);
  }

  const now = new Date();
  const cancelReason = String(reason || "").trim() || `Cancelled by ${actor}`;

  await WorkflowTaskQueue.updateOne(
    { taskId: task.taskId },
    {
      $set: {
        status: WORKFLOW_TASK_STATUS.CANCELLED,
        failureReason: cancelReason,
        updatedAt: now,
      },
      $push: {
        stepLog: {
          label: "Cancelled",
          status: "CANCELLED",
          at: now,
          detail: cancelReason,
        },
      },
    },
  );

  if (task.action === WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW && task.orphanId) {
    await OrphanAccount.updateOne(
      { _id: task.orphanId },
      {
        $set: {
          workflowStatus: "CANCELLED",
          currentStepLabel: "IAM review cancelled — access not changed",
        },
      },
    ).catch(() => {});
  }

  await UnifiedAuditEvent.create({
    tenantId: task.tenantId,
    eventType: "WORKFLOW_TASK_QUEUE",
    action: "TASK_CANCELLED",
    resourceType: "WorkflowTaskQueue",
    resourceId: task.taskId,
    actor,
    details: {
      taskName: task.taskName,
      previousStatus: task.status,
      reason: cancelReason,
      note: "Access was not revoked",
      at: now,
    },
  }).catch(() => {});

  return getWorkflowTask(task.taskId, tid);
}

export async function runTenantWorkflowTaskQueue(tenantId) {
  const pickup = await pickUpNewTasks(tenantId);
  const executions = await processInProgressTasks(tenantId);
  return { pickup, executions };
}
