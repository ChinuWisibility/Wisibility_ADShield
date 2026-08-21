import mongoose from "mongoose";
import ProvisioningRequest from "../../models/provisioning/ProvisioningRequest.js";
import ProvisioningPlan from "../../models/provisioning/ProvisioningPlan.js";
import ProvisioningTask from "../../models/provisioning/ProvisioningTask.js";
import ProvisioningResult from "../../models/provisioning/ProvisioningResult.js";
import Application from "../../models/application/Application.js";
import LifecycleEvent from "../../models/identity/LifecycleEvent.js";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import { resolveConnectorFamily } from "../../services/provisioning/provisioningCapabilityCatalog.js";

const LIFECYCLE_REQUEST_TYPES = ["JOINER", "MOVER", "LEAVER"];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function tenantIdFromReq(req) {
  return req.user?.tenantId || req.headers["x-tenant-id"] || req.query.tenantId;
}

/**
 * One read for the whole JML chain: request -> approval -> plan -> tasks -> connector result.
 * The pieces live in five collections with no shared tenantId, so joining them client-side
 * would mean a request waterfall on every poll.
 */
export async function listLifecycleRequests(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ message: "tenantId required" });
    if (!mongoose.isValidObjectId(tenantId)) {
      return res.status(400).json({ message: "Invalid tenantId" });
    }

    const tenantOid = new mongoose.Types.ObjectId(String(tenantId));
    const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);

    const filter = { tenantId: tenantOid, requestType: { $in: LIFECYCLE_REQUEST_TYPES } };
    if (req.query.requestType && LIFECYCLE_REQUEST_TYPES.includes(req.query.requestType)) {
      filter.requestType = req.query.requestType;
    }
    if (req.query.status) filter.status = req.query.status;
    if (req.query.approvalStatus) filter.approvalStatus = req.query.approvalStatus;

    const requests = await ProvisioningRequest.find(filter)
      .sort({ submittedAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const [identityMap, applicationMap, planMap, taskMap] = await Promise.all([
      loadIdentities(tenantOid, requests),
      loadApplications(tenantOid, requests),
      loadPlans(requests),
      loadTasks(requests),
    ]);
    const resultMap = await loadLatestResults(taskMap);

    const items = requests.map((request) =>
      shapeRequest({ request, identityMap, applicationMap, planMap, taskMap, resultMap }),
    );

    return res.json({
      data: items,
      summary: summarize(items),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/** Recent lifecycle events, so the demo can show detection even before a request exists. */
export async function listRecentLifecycleEvents(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ message: "tenantId required" });
    if (!mongoose.isValidObjectId(tenantId)) {
      return res.status(400).json({ message: "Invalid tenantId" });
    }

    const limit = Math.min(Number(req.query.limit) || 25, MAX_LIMIT);
    const events = await LifecycleEvent.find({
      tenantId: new mongoose.Types.ObjectId(String(tenantId)),
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("eventType eventStatus identityId triggeredBy error jmlCorrelationId createdAt processedAt")
      .lean();

    return res.json({ data: events });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

async function loadIdentities(tenantOid, requests) {
  const ids = uniqueIds(requests.map((r) => r.identityId));
  if (!ids.length) return new Map();
  try {
    const Identity = await getDynamicIdentityModelForTenantId(tenantOid);
    const identities = await Identity.find({ _id: { $in: ids } })
      .select("displayName firstName lastName email employeeId department title lifecycleState")
      .lean();
    return new Map(identities.map((i) => [String(i._id), i]));
  } catch {
    return new Map();
  }
}

async function loadApplications(tenantOid, requests) {
  const ids = uniqueIds(requests.map((r) => r.metadata?.applicationId));
  if (!ids.length) return new Map();
  const apps = await Application.find({ _id: { $in: ids }, tenantId: tenantOid })
    .select("name connectorType status connectionConfig.provisioningTestMode connectionConfig.ad")
    .lean();
  return new Map(
    apps.map((a) => [
      String(a._id),
      {
        _id: a._id,
        name: a.name,
        status: a.status,
        connectorType: a.connectorType || null,
        family: resolveConnectorFamily(a),
        // connectionConfig can hold credentials; only the provisioning-relevant flags escape.
        isCsvTestTarget:
          resolveConnectorFamily(a) === "file_delimited"
          || a.connectionConfig?.provisioningTestMode === "csv",
        isAdTarget: Boolean(a.connectionConfig?.ad) || resolveConnectorFamily(a) === "ldap_ad",
      },
    ]),
  );
}

async function loadPlans(requests) {
  const ids = uniqueIds(requests.map((r) => r._id));
  if (!ids.length) return new Map();
  const plans = await ProvisioningPlan.find({ requestId: { $in: ids } })
    .select("requestId status totalOperations completedOperations failedOperations operations compiledAt executedAt")
    .lean();
  return new Map(plans.map((p) => [String(p.requestId), p]));
}

async function loadTasks(requests) {
  const ids = uniqueIds(requests.map((r) => r._id));
  if (!ids.length) return new Map();
  const tasks = await ProvisioningTask.find({ requestId: { $in: ids } })
    .sort({ sequence: 1, createdAt: 1 })
    .lean();
  const map = new Map();
  for (const task of tasks) {
    const key = String(task.requestId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(task);
  }
  return map;
}

async function loadLatestResults(taskMap) {
  const taskIds = [];
  for (const tasks of taskMap.values()) {
    for (const task of tasks) taskIds.push(task._id);
  }
  if (!taskIds.length) return new Map();
  const results = await ProvisioningResult.find({ taskId: { $in: taskIds } })
    .sort({ executedAt: 1 })
    .select("taskId statusCode isSuccess responseBody executedAt durationMs")
    .lean();
  const map = new Map();
  for (const result of results) map.set(String(result.taskId), result);
  return map;
}

function shapeRequest({ request, identityMap, applicationMap, planMap, taskMap, resultMap }) {
  const requestId = String(request._id);
  const identity = identityMap.get(String(request.identityId)) || null;
  const applicationId = request.metadata?.applicationId
    ? String(request.metadata.applicationId)
    : null;
  const application = applicationId ? applicationMap.get(applicationId) : null;
  const plan = planMap.get(requestId) || null;
  const tasks = taskMap.get(requestId) || [];

  return {
    id: requestId,
    requestType: request.requestType,
    status: request.status,
    approvalStatus: request.approvalStatus,
    priority: request.priority,
    justification: request.justification,
    sourceType: request.sourceType,
    sourceId: request.sourceId,
    submittedAt: request.submittedAt,
    approvedAt: request.approvedAt,
    completedAt: request.completedAt,
    identity: identity
      ? {
        id: String(identity._id),
        displayName: identity.displayName,
        email: identity.email,
        employeeId: identity.employeeId,
        department: identity.department,
        title: identity.title,
        lifecycleState: identity.lifecycleState,
      }
      : { id: request.identityId ? String(request.identityId) : null },
    application: {
      id: applicationId,
      name: application?.name || request.metadata?.applicationName || null,
      connectorType: application?.connectorType || null,
      family: application?.family || null,
      isCsvTestTarget: Boolean(application?.isCsvTestTarget),
      isAdTarget: Boolean(application?.isAdTarget),
    },
    rule: request.metadata?.ruleName
      ? { id: request.metadata.ruleId || null, name: request.metadata.ruleName }
      : null,
    workflowExecutionId: request.metadata?.workflowExecutionId || null,
    ensureAccount: request.metadata?.ensureAccount || null,
    nativeIdentifier: request.metadata?.nativeIdentifier || null,
    plan: plan
      ? {
        id: String(plan._id),
        status: plan.status,
        totalOperations: plan.totalOperations ?? (plan.operations?.length || 0),
        completedOperations: plan.completedOperations || 0,
        failedOperations: plan.failedOperations || 0,
        compiledAt: plan.compiledAt,
        executedAt: plan.executedAt,
      }
      : null,
    tasks: tasks.map((task) => shapeTask(task, resultMap)),
    stage: deriveStage(request, tasks),
  };
}

function shapeTask(task, resultMap) {
  const result = resultMap.get(String(task._id)) || null;
  return {
    id: String(task._id),
    operationType: task.operationType,
    status: task.status,
    sequence: task.sequence,
    retryCount: task.retryCount || 0,
    maxRetries: task.maxRetries ?? 3,
    errorMessage: task.errorMessage || null,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    nextAttemptAt: task.nextAttemptAt,
    nativeIdentifier:
      result?.responseBody?.nativeIdentifier || task.targetAttributes?.nativeIdentifier || null,
    result: result
      ? {
        isSuccess: result.isSuccess,
        statusCode: result.statusCode,
        message: result.responseBody?.message || null,
        executedAt: result.executedAt,
        durationMs: result.durationMs,
      }
      : null,
    canRun: ["PENDING", "RETRYING"].includes(task.status),
    canRetry: task.status === "FAILED",
  };
}

/** Single label describing where the request sits, so the UI does not re-derive it. */
function deriveStage(request, tasks) {
  if (request.status === "CANCELLED" || request.approvalStatus === "REJECTED") return "REJECTED";
  if (request.approvalStatus === "PENDING") return "AWAITING_APPROVAL";
  if (request.metadata?.ensureAccount === "SATISFIED") return "ALREADY_SATISFIED";
  if (!tasks.length) {
    return request.status === "COMPLETED" ? "COMPLETED" : "COMPILING";
  }
  if (tasks.some((t) => t.status === "FAILED")) return "FAILED";
  if (tasks.some((t) => t.status === "RUNNING")) return "PROVISIONING";
  if (tasks.every((t) => ["COMPLETED", "SKIPPED"].includes(t.status))) return "COMPLETED";
  return "READY_TO_PROVISION";
}

function summarize(items) {
  const summary = {
    total: items.length,
    awaitingApproval: 0,
    readyToProvision: 0,
    provisioned: 0,
    failed: 0,
    rejected: 0,
  };
  for (const item of items) {
    if (item.stage === "AWAITING_APPROVAL") summary.awaitingApproval += 1;
    else if (item.stage === "READY_TO_PROVISION" || item.stage === "PROVISIONING") {
      summary.readyToProvision += 1;
    } else if (item.stage === "COMPLETED" || item.stage === "ALREADY_SATISFIED") {
      summary.provisioned += 1;
    } else if (item.stage === "FAILED") summary.failed += 1;
    else if (item.stage === "REJECTED") summary.rejected += 1;
  }
  return summary;
}

function uniqueIds(values) {
  const seen = new Set();
  const ids = [];
  for (const value of values) {
    if (!value) continue;
    const key = String(value);
    if (seen.has(key) || !mongoose.isValidObjectId(key)) continue;
    seen.add(key);
    ids.push(new mongoose.Types.ObjectId(key));
  }
  return ids;
}
