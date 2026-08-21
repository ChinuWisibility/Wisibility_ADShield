import { createHash } from "crypto";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import SodViolation from "../../models/sod/SodViolation.js";
import Application from "../../models/application/Application.js";
import { AppError } from "../../middleware/errorHandler.js";
import {
  WORKFLOW_REMEDIATION_EVENT_SOURCES,
  WORKFLOW_REMEDIATION_EVENT_TYPES,
  WORKFLOW_REMEDIATION_QUEUE_SOURCES,
} from "../../constants/workflowRemediation.js";
import { getWorkflowById, getEnabledWorkflows } from "../../workflows/persistence/workflowStore.js";
import { triggerWorkflowForEvent } from "./workflowRemediationTriggerService.js";
import {
  createWorkflowRemediationEvent,
  findOpenWorkflowEventByTarget,
  resolveQueuedTargets,
} from "./workflowRemediationEventService.js";

const TRIGGER_TYPE_BY_EVENT = {
  [WORKFLOW_REMEDIATION_EVENT_TYPES.REVOKE_ACCESS]: "CertificationSignedOff",
  [WORKFLOW_REMEDIATION_EVENT_TYPES.UNCORRELATED_ACCOUNT]: "UncorrelatedAccountIAMDecision",
  [WORKFLOW_REMEDIATION_EVENT_TYPES.MISSING_MANAGER]: "MissingManagerDetected",
  [WORKFLOW_REMEDIATION_EVENT_TYPES.DORMANT_ACCOUNT]: "DormantAccountDetected",
  [WORKFLOW_REMEDIATION_EVENT_TYPES.SOD_VIOLATION]: "SodViolationDetected",
};

const SOURCE_TYPE_BY_EVENT = {
  [WORKFLOW_REMEDIATION_EVENT_TYPES.MISSING_MANAGER]:
    WORKFLOW_REMEDIATION_EVENT_SOURCES.MISSING_MANAGER,
  [WORKFLOW_REMEDIATION_EVENT_TYPES.DORMANT_ACCOUNT]:
    WORKFLOW_REMEDIATION_EVENT_SOURCES.DORMANT_ACCOUNT,
  [WORKFLOW_REMEDIATION_EVENT_TYPES.SOD_VIOLATION]: WORKFLOW_REMEDIATION_EVENT_SOURCES.SOD,
  [WORKFLOW_REMEDIATION_EVENT_TYPES.UNCORRELATED_ACCOUNT]:
    WORKFLOW_REMEDIATION_EVENT_SOURCES.UNCORRELATED_ACCOUNT,
};

function duplicateMessage() {
  return "An open Workflow Remediation Queue event already exists.";
}

function normalizeTargetIds(targetId, targetIds = []) {
  return [...new Set([...(targetId ? [String(targetId)] : []), ...targetIds.map(String)])].filter(
    Boolean,
  );
}

function buildManualBatchKey(eventType, targetIds) {
  const sorted = [...new Set(targetIds.map(String))].sort();
  if (sorted.length === 1) return sorted[0];
  const joined = sorted.join("-");
  if (joined.length <= 200) {
    return `batch-${eventType}-${joined}`.slice(0, 240);
  }
  const hash = createHash("sha256").update(joined).digest("hex").slice(0, 16);
  return `batch-${eventType}-${hash}`;
}

function contextMapFromPayload(contexts = [], itemsContext = []) {
  const map = new Map();
  for (const row of [...contexts, ...itemsContext]) {
    const id = row?.targetId || row?.id;
    if (id) map.set(String(id), row);
  }
  return map;
}

async function resolveWorkflow(tenantId, eventType, workflowId) {
  const workflow = await getWorkflowById(workflowId, tenantId);
  if (!workflow) {
    throw new AppError("Selected workflow not found or not accessible", 404);
  }

  const triggerType = TRIGGER_TYPE_BY_EVENT[eventType];
  if (triggerType && workflow.trigger?.type !== triggerType) {
    throw new AppError(
      `Workflow trigger ${workflow.trigger?.type || "unknown"} does not match event type`,
      422,
    );
  }

  return workflow;
}

function buildDuplicateResponse(existing, extra = {}) {
  return {
    event: existing,
    created: false,
    duplicate: true,
    message: duplicateMessage(),
    ...extra,
  };
}

export async function listWorkflowsForRemediation(tenantId, triggerType) {
  if (triggerType) {
    return getEnabledWorkflows(tenantId, triggerType);
  }
  const types = [...new Set(Object.values(TRIGGER_TYPE_BY_EVENT))];
  const merged = [];
  const seen = new Set();
  for (const type of types) {
    const rows = await getEnabledWorkflows(tenantId, type);
    for (const wf of rows) {
      if (!wf?.id || seen.has(wf.id)) continue;
      seen.add(wf.id);
      merged.push(wf);
    }
  }
  return merged;
}

export async function getOpenEventByTarget(tenantId, eventType, targetId) {
  if (!eventType || !targetId) return null;
  return findOpenWorkflowEventByTarget(tenantId, eventType, targetId, {
    queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.MANUAL,
  });
}

export async function checkQueuedTargets(
  tenantId,
  eventType,
  targetIds = [],
  { includeNonManual = false } = {},
) {
  return resolveQueuedTargets(tenantId, eventType, normalizeTargetIds(null, targetIds), {
    queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.MANUAL,
    includeNonManual,
  });
}

async function buildHygieneItems(eventType, tenantId, targetIds, sharedContext = {}, ctxMap) {
  return targetIds.map((targetId) => {
    const row = ctxMap.get(targetId) || {};
    const applicationId = row.applicationId || sharedContext.applicationId;
    return {
      userId: row.userId || targetId,
      identityName:
        row.identityName || row.displayName || sharedContext.identityName || targetId,
      identityEmail: row.identityEmail || row.email || sharedContext.identityEmail || "",
      applicationId: applicationId ? String(applicationId) : undefined,
      applicationName: row.applicationName || sharedContext.applicationName || "",
      sourceRef: targetId,
      metadata: {
        targetId,
        eventType,
        ...(row.metadata || {}),
      },
    };
  });
}

async function buildSodItems(tenantId, targetIds) {
  const violations = await SodViolation.find({
    _id: { $in: targetIds },
    tenantId: String(tenantId),
  }).lean();

  if (!violations.length) {
    throw new AppError("No SoD violations found for selection", 404);
  }

  const found = new Set(violations.map((v) => String(v._id)));
  const missing = targetIds.filter((id) => !found.has(id));
  if (missing.length) {
    throw new AppError(`SoD violation(s) not found: ${missing.slice(0, 3).join(", ")}`, 404);
  }

  return violations.map((v) => ({
    userId: v.identity ? String(v.identity) : "",
    identityName: v.identityName || "",
    identityEmail: v.identityEmail || "",
    sourceRef: String(v._id),
    metadata: {
      targetId: String(v._id),
      policyName: v.policyName,
      ruleName: v.ruleName,
      severity: v.severity,
      leftEntitlements: v.leftEntitlements,
      rightEntitlements: v.rightEntitlements,
    },
  }));
}

async function buildOrphanItems(tenantId, targetIds) {
  const orphans = await OrphanAccount.find({ _id: { $in: targetIds } }).lean();
  if (!orphans.length) {
    throw new AppError("No orphan accounts found for selection", 404);
  }

  const tenantOrphans = orphans.filter((o) => String(o.tenantId) === String(tenantId));
  if (!tenantOrphans.length) {
    throw new AppError("Orphan account not found", 404);
  }

  const appIds = [
    ...new Set(tenantOrphans.map((o) => o.applicationId).filter(Boolean).map(String)),
  ];
  const apps = appIds.length
    ? await Application.find({ _id: { $in: appIds } })
        .select("name")
        .lean()
    : [];
  const appNameById = new Map(apps.map((a) => [String(a._id), a.name]));

  return tenantOrphans.map((orphan) => {
    const id = String(orphan._id);
    const appName = appNameById.get(String(orphan.applicationId)) || "";
    return {
      accountId: orphan.accountId,
      identityName: orphan.accountName || orphan.accountId,
      applicationId: orphan.applicationId,
      applicationName: appName,
      sourceRef: id,
      metadata: {
        targetId: id,
        orphanId: id,
        correlationKey: orphan.correlationKey,
        riskLevel: orphan.riskLevel,
      },
    };
  });
}

async function buildItemsForEventType(eventType, tenantId, targetIds, context, ctxMap) {
  switch (eventType) {
    case WORKFLOW_REMEDIATION_EVENT_TYPES.MISSING_MANAGER:
    case WORKFLOW_REMEDIATION_EVENT_TYPES.DORMANT_ACCOUNT:
      return buildHygieneItems(eventType, tenantId, targetIds, context, ctxMap);
    case WORKFLOW_REMEDIATION_EVENT_TYPES.SOD_VIOLATION:
      return buildSodItems(tenantId, targetIds);
    case WORKFLOW_REMEDIATION_EVENT_TYPES.UNCORRELATED_ACCOUNT:
      return buildOrphanItems(tenantId, targetIds);
    default:
      throw new AppError(`Manual enqueue is not supported for event type ${eventType}`, 400);
  }
}

/**
 * Unified batch manual enqueue — always creates ONE event with N items.
 */
export async function manualEnqueueBatch({
  tenantId,
  eventType,
  targetId,
  targetIds = [],
  workflowId,
  queuedBy,
  context = {},
  contexts = [],
  itemsContext = [],
  proceedWithAvailable = true,
  launchImmediately = false,
}) {
  const normalized = String(eventType || "").toUpperCase();
  const ids = normalizeTargetIds(targetId, targetIds);
  if (!ids.length) throw new AppError("targetIds is required", 400);
  if (!workflowId) throw new AppError("workflowId is required", 400);

  const { alreadyQueued, availableIds } = await checkQueuedTargets(tenantId, normalized, ids);

  if (!availableIds.length) {
    return {
      created: false,
      duplicate: true,
      alreadyQueued,
      message: "These records are already in Workflow Remediation Queue.",
    };
  }

  if (alreadyQueued.length && !proceedWithAvailable) {
    return {
      created: false,
      partialConflict: true,
      alreadyQueued,
      availableIds,
      message: "Some selected records are already in Workflow Remediation Queue.",
    };
  }

  const workflow = await resolveWorkflow(tenantId, normalized, workflowId);
  const ctxMap = contextMapFromPayload(contexts, itemsContext);
  const items = await buildItemsForEventType(
    normalized,
    tenantId,
    availableIds,
    context,
    ctxMap,
  );

  const batchKey = buildManualBatchKey(normalized, availableIds);
  const existingBatch = await findOpenWorkflowEventByTarget(tenantId, normalized, batchKey, {
    queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.MANUAL,
  });
  if (existingBatch) {
    return buildDuplicateResponse(existingBatch, { alreadyQueued });
  }

  const applicationId = context.applicationId ? String(context.applicationId) : items[0]?.applicationId;
  const applicationName = context.applicationName || items[0]?.applicationName || "";

  const result = await createWorkflowRemediationEvent({
    tenantId,
    eventType: normalized,
    sourceType: SOURCE_TYPE_BY_EVENT[normalized],
    sourceRef: batchKey,
    targetId: batchKey,
    applicationId,
    applicationName,
    subjectCount: items.length,
    createdBy: queuedBy || "manual",
    queuedBy: queuedBy || "manual",
    queuedAt: new Date(),
    selectedWorkflowId: workflow.id,
    selectedWorkflowName: workflow.name,
    metadata: {
      targetIds: availableIds,
      intakeMode: "manual",
      skippedTargetIds: alreadyQueued.map((r) => r.targetId),
      ...context.metadata,
    },
    items,
    skipDedupe: true,
    queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.MANUAL,
  });

  const response = {
    ...result,
    alreadyQueued: alreadyQueued.length ? alreadyQueued : undefined,
    skippedCount: alreadyQueued.length,
    enqueuedCount: items.length,
  };

  // Enterprise: immediately trigger workflow after creating the event
  if (launchImmediately && result.created && result.event?.eventId) {
    try {
      const triggerResult = await triggerWorkflowForEvent(
        tenantId,
        result.event.eventId,
        workflowId,
        queuedBy || "system",
      );
      response.launched = true;
      response.launchMode = "immediate";
      response.triggerResult = triggerResult;
    } catch (err) {
      // Event was created successfully but launch failed — report it but don't fail the enqueue
      console.error(
        "[manualEnqueueBatch] immediate launch failed:",
        err.message,
      );
      response.launched = false;
      response.launchError = err.message;
    }
  }

  return response;
}

/** @deprecated Use manualEnqueueBatch with targetIds */
export async function manualEnqueueHygieneEvent(params) {
  return manualEnqueueBatch({
    ...params,
    targetIds: params.targetId ? [params.targetId] : params.targetIds,
    contexts: params.context ? [{ targetId: params.targetId, ...params.context }] : [],
  });
}

/** @deprecated Use manualEnqueueBatch with targetIds */
export async function manualEnqueueSodViolation(params) {
  return manualEnqueueBatch({
    tenantId: params.tenantId,
    eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.SOD_VIOLATION,
    targetId: params.targetId,
    targetIds: params.targetIds,
    workflowId: params.workflowId,
    queuedBy: params.queuedBy,
  });
}

/** @deprecated Use manualEnqueueBatch with targetIds */
export async function manualEnqueueOrphanAccount(params) {
  return manualEnqueueBatch({
    tenantId: params.tenantId,
    eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.UNCORRELATED_ACCOUNT,
    targetIds: params.targetId ? [params.targetId] : params.targetIds,
    workflowId: params.workflowId,
    queuedBy: params.queuedBy,
  });
}

export async function manualEnqueueToWorkflowQueue({
  tenantId,
  eventType,
  targetId,
  targetIds,
  workflowId,
  queuedBy,
  context,
  contexts,
  itemsContext,
  proceedWithAvailable,
  launchImmediately,
}) {
  const normalized = String(eventType || "").toUpperCase();
  if (!SOURCE_TYPE_BY_EVENT[normalized]) {
    throw new AppError(`Manual enqueue is not supported for event type ${normalized}`, 400);
  }

  return manualEnqueueBatch({
    tenantId,
    eventType: normalized,
    targetId,
    targetIds,
    workflowId,
    queuedBy,
    context: context || {},
    contexts: contexts || [],
    itemsContext: itemsContext || [],
    proceedWithAvailable: proceedWithAvailable !== false,
    launchImmediately: launchImmediately === true,
  });
}

export { TRIGGER_TYPE_BY_EVENT, duplicateMessage };
