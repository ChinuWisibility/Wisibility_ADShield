/**
 * P5 processor-driven generic Joiner CSV E2E.
 *
 * Path:
 *   JOINER LifecycleEvent → tickLifecycleEvents (flag ON)
 *   → startGenericPlanOrchestration → approve → tasks → CSV worker
 *
 * Usage:
 *   GENERIC_JML_ORCHESTRATION_ENABLED=true node src/scripts/provisioning/e2eGenericJoinerProcessorCsvHarness.js
 *
 * Env:
 *   MONGODB_URI
 *   GENERIC_JML_ORCHESTRATION_ENABLED (forced true by this harness if unset)
 *
 * Does NOT claim AD live success — file_delimited CSV test apps only.
 */

import mongoose from "mongoose";
import env from "../../config/env.js";
import Application from "../../models/application/Application.js";
import Tenant from "../../models/platform/Tenant.js";
import IdentityProvisioningRule from "../../models/provisioning/IdentityProvisioningRule.js";
import ProvisioningRequest from "../../models/provisioning/ProvisioningRequest.js";
import ProvisioningTask from "../../models/provisioning/ProvisioningTask.js";
import ProvisioningPlan from "../../models/provisioning/ProvisioningPlan.js";
import ProvisioningResult from "../../models/provisioning/ProvisioningResult.js";
import LifecycleEvent from "../../models/identity/LifecycleEvent.js";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import { seedWorkflowTemplates } from "../../services/workflow/seedWorkflowTemplates.js";
import { ensureStepsRegistered } from "../../workflows/steps/index.js";
import { enqueueLifecycleEventsFromIdentityChange } from "../../services/lifecycle/lifecycleEventService.js";
import { tickLifecycleEvents } from "../../services/lifecycle/lifecycleEventWorker.js";
import { processLifecycleEvent } from "../../services/lifecycle/lifecycleEventProcessor.js";
import { isGenericJmlOrchestrationEnabled } from "../../services/lifecycle/genericJmlOrchestrationFlag.js";
import { decideLifecycleApproval } from "../../services/provisioning/lifecycleWorkflowService.js";
import { processProvisioningTaskById } from "../../services/provisioning/provisioningWorker.js";
import { materializeProvisioningTasks } from "../../services/provisioning/taskMaterializationService.js";
import { evaluateDesiredAccess } from "../../services/provisioning/policyDecisionService.js";
import { loadActualAccessForIdentity } from "../../services/provisioning/actualAccessService.js";
import { computeAccessDelta } from "../../services/provisioning/accessDeltaService.js";
import {
  classifyProvisioningOperation,
  EXECUTION_CLASS,
} from "../../services/provisioning/provisioningCapabilityCatalog.js";

async function resolveTenant() {
  if (
    process.env.GENERIC_E2E_TENANT_ID &&
    mongoose.isValidObjectId(process.env.GENERIC_E2E_TENANT_ID)
  ) {
    return new mongoose.Types.ObjectId(process.env.GENERIC_E2E_TENANT_ID);
  }
  let tenant = await Tenant.findOne({ code: "generic-joiner-p5-e2e" });
  if (!tenant) {
    tenant = await Tenant.create({
      name: "Generic Joiner P5 E2E",
      code: "generic-joiner-p5-e2e",
      subscriptionTier: "core",
      isActive: true,
    });
  }
  return tenant._id;
}

async function createCsvApp(tenantId, name) {
  return Application.create({
    tenantId,
    name,
    status: "active",
    // Application schema defaults integrationType to "manual", which the plan
    // compiler treats as MANUAL_FULFILLMENT. Connector-backed CSV test apps
    // must be non-manual so ADD_ACCOUNT stays EXECUTABLE.
    integrationType: "connector",
    connectorType: "CONNECTOR_DELIMITEDFILE",
    connectionConfig: { provisioningTestMode: "csv" },
    userMappings: [
      { csvColumn: "employee_id", standardField: "employee_id", isPrimaryKey: true },
      { csvColumn: "email", standardField: "email" },
      { csvColumn: "display_name", standardField: "display_name" },
      { csvColumn: "department", standardField: "department" },
      { csvColumn: "location", standardField: "location" },
    ],
  });
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(load, predicate, label, timeoutMs = 10_000) {
  const started = Date.now();
  let current;
  while (Date.now() - started < timeoutMs) {
    current = await load();
    if (predicate(current)) return current;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(current)}`);
}

async function createJoinerEvent({ Identity, tenantId, stamp, label }) {
  const identity = await Identity.create({
    tenantId,
    employeeId: `P5-${label}-${stamp}`,
    email: `p5.${label.toLowerCase()}.${stamp}@example.com`,
    firstName: "P5",
    lastName: label,
    displayName: `P5 ${label}`,
    department: "IT",
    location: "India",
    lifecycleState: "ACTIVE",
  });
  const syncJobId = `p5-e2e:${label}:${stamp}`;
  const enqueued = await enqueueLifecycleEventsFromIdentityChange({
    tenantId,
    identityId: identity._id,
    before: null,
    after: identity.toObject ? identity.toObject() : identity,
    syncJobId,
    triggeredBy: "SYSTEM",
  });
  const eventRef = (enqueued.enqueued || []).find(
    (row) => row.eventType === "JOINER",
  );
  invariant(eventRef, `${label}: expected JOINER LifecycleEvent`);
  return { identity, enqueued, eventRef };
}

async function loadOrchestration(eventId) {
  const event = await LifecycleEvent.findById(eventId).lean();
  const processResult = event?.metadata?.processResult || {};
  const request = processResult.provisioningRequestId
    ? await ProvisioningRequest.findById(processResult.provisioningRequestId).lean()
    : null;
  const plan = request
    ? await ProvisioningPlan.findOne({ requestId: request._id }).lean()
    : null;
  const workflows = request
    ? await RemediationWorkflowExecution.find({
        provisioningRequestId: String(request._id),
        eventOwner: "lifecycle",
      }).lean()
    : [];
  const tasks = request
    ? await ProvisioningTask.find({ requestId: request._id }).sort({ sequence: 1 }).lean()
    : [];
  return { event, processResult, request, plan, workflows, tasks };
}

async function targetRows({ UsersA, UsersB, employeeId }) {
  const [rowsA, rowsB] = await Promise.all([
    UsersA.find({ employee_id: employeeId }).lean(),
    UsersB.find({ employee_id: employeeId }).lean(),
  ]);
  return { rowsA, rowsB };
}

async function main() {
  // Server-only flags used by the same resolver/workers as the backend.
  process.env.GENERIC_JML_ORCHESTRATION_ENABLED = "true";
  process.env.PROVISIONING_WORKER_ENABLED = "true";

  ensureStepsRegistered();
  const uri = process.env.MONGODB_URI || env.mongodbUri || env.mongodb?.uri;
  if (!uri) {
    console.error("ENVIRONMENT BLOCKED: MONGODB_URI not configured");
    process.exit(1);
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    dbName: process.env.DB_NAME || undefined,
  });
  await mongoose.connection.db.admin().ping();
  await seedWorkflowTemplates();

  const tenantId = await resolveTenant();
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const stamp = Date.now();

  const appA = await createCsvApp(tenantId, `P5-SAP-CSV-TEST-${stamp}`);
  const appB = await createCsvApp(tenantId, `P5-ORACLE-CSV-TEST-${stamp}`);
  const UsersA = await getDynamicUserModelForTenantId(appA.name, tenantId);
  const UsersB = await getDynamicUserModelForTenantId(appB.name, tenantId);

  await IdentityProvisioningRule.deleteMany({
    tenantId,
    name: { $regex: /^P5 Generic Joiner/ },
  });
  await IdentityProvisioningRule.create({
    tenantId,
    name: `P5 Generic Joiner ${stamp}`,
    enabled: true,
    priority: 10,
    conditionLogic: "AND",
    conditions: [
      { field: "department", operator: "equals", value: "IT" },
      { field: "location", operator: "equals", value: "India" },
    ],
    actions: [
      { type: "ENSURE_ACCOUNT", applicationId: appA._id },
      { type: "ENSURE_ACCOUNT", applicationId: appB._id },
    ],
  });

  invariant(
    isGenericJmlOrchestrationEnabled(),
    "GENERIC_JML_ORCHESTRATION_ENABLED resolver did not return true",
  );

  console.log("ENVIRONMENT", {
    mongo: "PASS",
    backendInitialization: "PASS",
    tenantId: String(tenantId),
    csvApplications: [appA.name, appB.name],
    provisioningWorkerEnabled:
      process.env.PROVISIONING_WORKER_ENABLED === "true",
    genericJoinerEnabled: isGenericJmlOrchestrationEnabled(),
    ad: "OFFLINE — AD LIVE VALIDATION PENDING",
  });

  // SUCCESS PATH: real event engine → worker claim → actual processor.
  const {
    identity,
    enqueued: enq,
    eventRef: joinerEvent,
  } = await createJoinerEvent({
    Identity,
    tenantId,
    stamp,
    label: "SUCCESS",
  });

  const targetBeforeApproval = await targetRows({
    UsersA,
    UsersB,
    employeeId: identity.employeeId,
  });
  invariant(
    targetBeforeApproval.rowsA.length === 0 &&
      targetBeforeApproval.rowsB.length === 0,
    "SUCCESS: isolated target was not empty before processing",
  );

  const tick = await tickLifecycleEvents({ limit: 50, tenantId });
  invariant(tick.processed >= 1, "SUCCESS: lifecycle worker claimed no events");

  let state = await loadOrchestration(joinerEvent.eventId);
  const { event, processResult, request, plan, workflows } = state;
  invariant(event?.eventStatus === "COMPLETED", "SUCCESS: event not COMPLETED");
  invariant(event.lifecycleType === "JOINER", "SUCCESS: lifecycleType is not JOINER");
  invariant(processResult.route === "GENERIC", "SUCCESS: processor did not select GENERIC");
  invariant(request?.metadata?.genericPlan === true, "SUCCESS: generic request missing");
  invariant(
    request.sourceId === `lifecycle-plan:${String(event._id)}`,
    `SUCCESS: unexpected sourceId ${request.sourceId}`,
  );
  invariant(plan, "SUCCESS: ProvisioningPlan missing");
  invariant(String(plan.requestId) === String(request._id), "SUCCESS: plan/request mismatch");
  invariant(
    String(plan.lifecycleEventId) === String(event._id),
    "SUCCESS: plan lifecycleEventId mismatch",
  );
  invariant(
    String(plan.tenantId) === String(tenantId),
    "SUCCESS: plan tenant mismatch",
  );
  invariant(workflows.length === 1, `SUCCESS: workflow count ${workflows.length}, expected 1`);
  invariant(state.tasks.length === 0, "SUCCESS: tasks existed before approval");

  const requestCountBeforeApproval = await ProvisioningRequest.countDocuments({
    sourceType: "LIFECYCLE",
    sourceId: `lifecycle-plan:${String(event._id)}`,
  });
  const planCountBeforeApproval = await ProvisioningPlan.countDocuments({
    requestId: request._id,
  });
  invariant(requestCountBeforeApproval === 1, "SUCCESS: request count before approval != 1");
  invariant(planCountBeforeApproval === 1, "SUCCESS: plan count before approval != 1");

  const targetsStillEmpty = await targetRows({
    UsersA,
    UsersB,
    employeeId: identity.employeeId,
  });
  invariant(
    targetsStillEmpty.rowsA.length === 0 && targetsStillEmpty.rowsB.length === 0,
    "SUCCESS: target changed before approval",
  );

  // Evidence from the real P1.5/P2 services used internally by orchestration.
  const context = {
    tenantId,
    lifecycleType: "JOINER",
    lifecycleEventId: String(event._id),
    jmlCorrelationId: event.jmlCorrelationId,
  };
  const desired = await evaluateDesiredAccess(identity.toObject(), context);
  const actual = await loadActualAccessForIdentity({
    tenantId,
    identityId: identity._id,
  });
  const delta = await computeAccessDelta({
    identity: identity.toObject(),
    context,
    desiredAccess: desired,
    actualAccess: actual,
  });

  const desiredAppIds = desired.applications.map((row) => row.applicationId).sort();
  const expectedAppIds = [String(appA._id), String(appB._id)].sort();
  invariant(
    JSON.stringify(desiredAppIds) === JSON.stringify(expectedAppIds),
    `SUCCESS: desired apps mismatch ${JSON.stringify(desiredAppIds)}`,
  );
  invariant(
    desired.applications.every((row) => row.accountRequired),
    "SUCCESS: desired account requirement missing",
  );
  invariant(actual.metadata?.source === "IGA_AGGREGATION_AND_CORRELATION", "SUCCESS: wrong actual source");
  invariant(actual.metadata?.targetQueries === false, "SUCCESS: actual service queried target");
  invariant(actual.applications.length === 0, "SUCCESS: isolated identity unexpectedly has actual access");
  invariant(
    delta.applications.length === 2 &&
      delta.applications.every((row) => row.account?.operation === "ADD_ACCOUNT"),
    `SUCCESS: unexpected delta ${JSON.stringify(delta.applications)}`,
  );

  const executablePlanItems = (plan.operations || []).filter(
    (row) => row.executionClass === EXECUTION_CLASS.EXECUTABLE,
  );
  invariant(executablePlanItems.length === 2, "SUCCESS: expected 2 executable plan items");
  invariant(
    executablePlanItems.every((row) => row.operationType === "ADD_ACCOUNT"),
    "SUCCESS: plan contains unexpected executable operation",
  );

  const approved = await decideLifecycleApproval({
    provisioningRequestId: request._id,
    decision: "APPROVED",
    tenantId,
  });
  invariant(approved.ok, `SUCCESS: approve failed ${JSON.stringify(approved)}`);

  const tasks = await waitFor(
    () =>
      ProvisioningTask.find({ requestId: request._id })
        .sort({ sequence: 1 })
        .lean(),
    (rows) => rows.length === 2,
    "SUCCESS: workflow task materialization",
  );
  invariant(new Set(tasks.map((row) => row.planItemId)).size === 2, "SUCCESS: duplicate planItemId");
  for (const task of tasks) {
    invariant(String(task.requestId) === String(request._id), "SUCCESS: task requestId mismatch");
    invariant(String(task.planId) === String(plan._id), "SUCCESS: task planId mismatch");
    invariant(task.lifecycleEventId === String(event._id), "SUCCESS: task lifecycleEventId mismatch");
    invariant(String(task.jmlCorrelationId) === String(event.jmlCorrelationId), "SUCCESS: task correlation mismatch");
    invariant(String(task.targetAttributes?.tenantId) === String(tenantId), "SUCCESS: task tenant mismatch");
    invariant(task.operationType === "ADD_ACCOUNT", "SUCCESS: task operation mismatch");
  }

  for (const task of tasks) {
    const workerResult = await processProvisioningTaskById(task._id);
    invariant(
      workerResult?.ok === true,
      `SUCCESS: provisioning worker failed ${JSON.stringify(workerResult)}`,
    );
  }

  const targetAfter = await targetRows({
    UsersA,
    UsersB,
    employeeId: identity.employeeId,
  });
  invariant(
    targetAfter.rowsA.length === 1 && targetAfter.rowsB.length === 1,
    "SUCCESS: expected one target record per CSV app",
  );
  const results = await ProvisioningResult.find({
    taskId: { $in: tasks.map((row) => row._id) },
    isSuccess: true,
  }).lean();
  invariant(results.length === 2, `SUCCESS: expected 2 successful results, got ${results.length}`);

  // Duplicate event reprocessing through the actual lifecycleEventProcessor.
  const duplicateProcess = await processLifecycleEvent(event);
  invariant(duplicateProcess.ok, `DUPLICATE: processor failed ${JSON.stringify(duplicateProcess)}`);
  const duplicateState = await loadOrchestration(event._id);
  const duplicateTarget = await targetRows({
    UsersA,
    UsersB,
    employeeId: identity.employeeId,
  });
  invariant(
    (await ProvisioningRequest.countDocuments({
      sourceType: "LIFECYCLE",
      sourceId: request.sourceId,
    })) === 1,
    "DUPLICATE: request count changed",
  );
  invariant(
    (await ProvisioningPlan.countDocuments({ requestId: request._id })) === 1,
    "DUPLICATE: plan count changed",
  );
  invariant(duplicateState.workflows.length === 1, "DUPLICATE: workflow count changed");
  invariant(duplicateState.tasks.length === 2, "DUPLICATE: task count changed");
  invariant(
    duplicateTarget.rowsA.length === 1 && duplicateTarget.rowsB.length === 1,
    "DUPLICATE: target account duplicated",
  );

  // Explicit re-materialization must upsert, not duplicate.
  const beforeRematerialize = duplicateState.tasks.length;
  const rematerialized = await materializeProvisioningTasks({
    planId: plan._id,
    workflowExecutionId: workflows[0].executionId,
    tenantId,
  });
  invariant(rematerialized.success, `REMATERIALIZE: failed ${JSON.stringify(rematerialized)}`);
  const afterRematerialize = await ProvisioningTask.countDocuments({
    requestId: request._id,
  });
  invariant(
    beforeRematerialize === 2 && afterRematerialize === 2,
    `REMATERIALIZE: before=${beforeRematerialize} after=${afterRematerialize}`,
  );

  // Tenant safety: wrong tenant cannot materialize or write.
  const wrongTenant = new mongoose.Types.ObjectId();
  const tenantSafety = await materializeProvisioningTasks({
    planId: plan._id,
    workflowExecutionId: workflows[0].executionId,
    tenantId: wrongTenant,
  });
  invariant(tenantSafety.success === false && tenantSafety.status === 403, "TENANT: mismatch not rejected");
  invariant(
    (await ProvisioningTask.countDocuments({ requestId: request._id })) === 2,
    "TENANT: mismatch changed task count",
  );

  // Rejection path: second real JOINER event; no tasks or target writes.
  const rejectedCase = await createJoinerEvent({
    Identity,
    tenantId,
    stamp: stamp + 1,
    label: "REJECT",
  });
  await tickLifecycleEvents({ limit: 50, tenantId });
  const rejectedBefore = await loadOrchestration(rejectedCase.eventRef.eventId);
  invariant(rejectedBefore.processResult.route === "GENERIC", "REJECT: not generic");
  invariant(rejectedBefore.tasks.length === 0, "REJECT: task before decision");
  const rejectedTargetsBefore = await targetRows({
    UsersA,
    UsersB,
    employeeId: rejectedCase.identity.employeeId,
  });
  invariant(
    rejectedTargetsBefore.rowsA.length === 0 && rejectedTargetsBefore.rowsB.length === 0,
    "REJECT: target changed before rejection",
  );
  const rejectedDecision = await decideLifecycleApproval({
    provisioningRequestId: rejectedBefore.request._id,
    decision: "REJECTED",
    tenantId,
  });
  invariant(rejectedDecision.ok, `REJECT: decision failed ${JSON.stringify(rejectedDecision)}`);
  const rejectedAfter = await loadOrchestration(rejectedCase.eventRef.eventId);
  invariant(rejectedAfter.request.approvalStatus === "REJECTED", "REJECT: approval status mismatch");
  invariant(rejectedAfter.request.status === "CANCELLED", "REJECT: request not cancelled");
  invariant(rejectedAfter.tasks.length === 0, "REJECT: tasks created");
  const rejectedTargetsAfter = await targetRows({
    UsersA,
    UsersB,
    employeeId: rejectedCase.identity.employeeId,
  });
  invariant(
    rejectedTargetsAfter.rowsA.length === 0 && rejectedTargetsAfter.rowsB.length === 0,
    "REJECT: target changed",
  );

  // Flag-off rollback: new event goes exclusively to legacy evaluator.
  process.env.GENERIC_JML_ORCHESTRATION_ENABLED = "false";
  invariant(!isGenericJmlOrchestrationEnabled(), "ROLLBACK: flag resolver did not disable");
  const rollbackCase = await createJoinerEvent({
    Identity,
    tenantId,
    stamp: stamp + 2,
    label: "ROLLBACK",
  });
  await tickLifecycleEvents({ limit: 50, tenantId });
  const rollbackEvent = await LifecycleEvent.findById(
    rollbackCase.eventRef.eventId,
  ).lean();
  invariant(rollbackEvent?.metadata?.processResult?.route === "LEGACY", "ROLLBACK: legacy route not selected");
  invariant(
    (await ProvisioningRequest.countDocuments({
      sourceType: "LIFECYCLE",
      sourceId: `lifecycle-plan:${String(rollbackEvent._id)}`,
    })) === 0,
    "ROLLBACK: generic request created",
  );
  const legacyRequests = await ProvisioningRequest.find({
    tenantId,
    identityId: rollbackCase.identity._id,
    requestType: "JOINER",
    "metadata.genericPlan": { $ne: true },
  }).lean();
  invariant(legacyRequests.length === 2, `ROLLBACK: expected 2 legacy requests, got ${legacyRequests.length}`);
  process.env.GENERIC_JML_ORCHESTRATION_ENABLED = "true";

  // Controlled failure: generate a real event, remove only its isolated identity,
  // then let the processor's tenant-scoped identity load fail and retry.
  const failureCase = await createJoinerEvent({
    Identity,
    tenantId,
    stamp: stamp + 3,
    label: "FAILURE",
  });
  await Identity.deleteOne({ _id: failureCase.identity._id });
  await tickLifecycleEvents({ limit: 50, tenantId });
  const failedEvent = await LifecycleEvent.findById(
    failureCase.eventRef.eventId,
  ).lean();
  invariant(failedEvent.eventStatus === "PENDING", `FAILURE: status ${failedEvent.eventStatus}, expected PENDING`);
  invariant((failedEvent.retryCount || 0) >= 1, "FAILURE: retryCount not incremented");
  invariant(!failedEvent.completedAt, "FAILURE: event marked completed");
  invariant(
    (await ProvisioningRequest.countDocuments({
      sourceType: "LIFECYCLE",
      sourceId: `lifecycle-plan:${String(failedEvent._id)}`,
    })) === 0,
    "FAILURE: request created despite identity-load failure",
  );

  // CSV capability catalog explicitly does not execute entitlement writes.
  const entitlementCapability = classifyProvisioningOperation({
    application: appA.toObject(),
    tenantId,
    operationType: "ADD_ENTITLEMENT",
    entitlement: { name: "IT" },
    identity: identity.toObject(),
  });
  invariant(
    entitlementCapability.executionClass === EXECUTION_CLASS.UNSUPPORTED,
    "ENTITLEMENT: CSV capability unexpectedly executable",
  );

  // Correlation/lineage audit across every persisted layer.
  const expectedCorrelation = String(event.jmlCorrelationId);
  invariant(String(request.metadata?.jmlCorrelationId) === expectedCorrelation, "LINEAGE: request correlation mismatch");
  invariant(String(plan.jmlCorrelationId) === expectedCorrelation, "LINEAGE: plan correlation mismatch");
  invariant(String(workflows[0].triggerPayload?.jmlCorrelationId) === expectedCorrelation, "LINEAGE: workflow correlation mismatch");
  invariant(tasks.every((row) => String(row.jmlCorrelationId) === expectedCorrelation), "LINEAGE: task correlation mismatch");
  invariant(results.every((row) => String(row.jmlCorrelationId) === expectedCorrelation), "LINEAGE: result correlation mismatch");

  const finalRequest = await ProvisioningRequest.findById(request._id).lean();
  const finalPlan = await ProvisioningPlan.findById(plan._id).lean();
  invariant(finalRequest.status === "COMPLETED", `SUCCESS: final request status ${finalRequest.status}`);
  invariant(finalPlan.status === "COMPLETED", `SUCCESS: final plan status ${finalPlan.status}`);

  console.log("\nP5_FULL_GENERIC_JOINER_E2E_PASS", {
    environment: {
      mongo: "PASS",
      backend: "PASS",
      csvApplications: "PASS",
      ad: "OFFLINE",
    },
    lifecycle: {
      eventId: String(event._id),
      identityId: String(identity._id),
      tenantId: String(tenantId),
      jmlCorrelationId: expectedCorrelation,
      route: processResult.route,
    },
    policy: {
      matchedRules: desired.matchedRules.map((row) => row.ruleName),
      applications: desired.applications.map((row) => ({
        applicationId: row.applicationId,
        applicationName: row.applicationName,
        accountRequired: row.accountRequired,
        entitlements: row.entitlements,
      })),
    },
    actual: {
      source: actual.metadata.source,
      applications: actual.applications,
      targetQueries: actual.metadata.targetQueries,
    },
    delta: delta.applications.map((row) => ({
      applicationId: row.applicationId,
      applicationName: row.applicationName,
      accountOperation: row.account?.operation,
    })),
    plan: {
      planId: String(plan._id),
      status: finalPlan.status,
      items: plan.operations.map((row) => ({
        planItemId: row.itemKey,
        applicationId: row.applicationId,
        operationType: row.operationType,
        executionClass: row.executionClass,
      })),
    },
    approvalGate: {
      requests: requestCountBeforeApproval,
      plans: planCountBeforeApproval,
      workflows: workflows.length,
      tasks: 0,
      targetRows: 0,
    },
    execution: {
      taskCount: tasks.length,
      resultCount: results.length,
      targetRecords: [
        {
          application: appA.name,
          recordId: String(targetAfter.rowsA[0]._id),
          employeeId: targetAfter.rowsA[0].employee_id,
          email: targetAfter.rowsA[0].email,
        },
        {
          application: appB.name,
          recordId: String(targetAfter.rowsB[0]._id),
          employeeId: targetAfter.rowsB[0].employee_id,
          email: targetAfter.rowsB[0].email,
        },
      ],
    },
    idempotency: {
      requests: 1,
      plans: 1,
      workflows: duplicateState.workflows.length,
      tasksBeforeRematerialize: beforeRematerialize,
      tasksAfterRematerialize: afterRematerialize,
      targetRowsPerApplication: [duplicateTarget.rowsA.length, duplicateTarget.rowsB.length],
    },
    rejection: {
      requestStatus: rejectedAfter.request.status,
      approvalStatus: rejectedAfter.request.approvalStatus,
      tasks: rejectedAfter.tasks.length,
      targetRows: rejectedTargetsAfter.rowsA.length + rejectedTargetsAfter.rowsB.length,
    },
    rollback: {
      route: rollbackEvent.metadata.processResult.route,
      legacyRequestCount: legacyRequests.length,
      genericRequestCount: 0,
    },
    failure: {
      eventStatus: failedEvent.eventStatus,
      retryCount: failedEvent.retryCount,
      completed: Boolean(failedEvent.completedAt),
    },
    tenantSafety: {
      status: tenantSafety.status,
      rejected: tenantSafety.success === false,
    },
    correlation: {
      csvTargetCreation: "PASS",
      aggregationCorrelation: "NOT AVAILABLE IN THIS HARNESS",
      lineage: "PASS",
    },
    entitlements: {
      csvExecutionClass: entitlementCapability.executionClass,
      targetWrite: "NOT SUPPORTED BY TEST CONNECTOR",
    },
    note: "Dummy file-delimited SAP/Oracle-named test apps only; AD LIVE VALIDATION PENDING",
  });

  await mongoose.disconnect();
}

main().catch(async (err) => {
  const connected = mongoose.connection.readyState === 1;
  console.error(
    connected ? "P5_FULL_GENERIC_JOINER_E2E_FAIL:" : "ENVIRONMENT BLOCKED:",
    err.message,
  );
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
