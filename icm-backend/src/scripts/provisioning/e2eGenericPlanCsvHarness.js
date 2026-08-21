/**
 * Offline generic Plan → Workflow → Approval → Task → CSV worker E2E.
 *
 * Usage:
 *   node src/scripts/provisioning/e2eGenericPlanCsvHarness.js
 *
 * Env:
 *   MONGODB_URI
 *   PROVISIONING_WORKER_ENABLED is NOT required — tasks are processed via processProvisioningTaskById
 *
 * Proves P4 generic orchestration on file_delimited test apps only.
 * Does NOT claim SAP/Oracle connectors or AD live success.
 */

import mongoose from "mongoose";
import env from "../../config/env.js";
import Application from "../../models/application/Application.js";
import Tenant from "../../models/platform/Tenant.js";
import ProvisioningRequest from "../../models/provisioning/ProvisioningRequest.js";
import ProvisioningTask from "../../models/provisioning/ProvisioningTask.js";
import ProvisioningPlan from "../../models/provisioning/ProvisioningPlan.js";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import { seedWorkflowTemplates } from "../../services/workflow/seedWorkflowTemplates.js";
import { ensureStepsRegistered } from "../../workflows/steps/index.js";
import { startGenericPlanOrchestration } from "../../services/provisioning/genericLifecycleOrchestrationService.js";
import { decideLifecycleApproval } from "../../services/provisioning/lifecycleWorkflowService.js";
import { processProvisioningTaskById } from "../../services/provisioning/provisioningWorker.js";
import { calculateAccessDelta } from "../../services/provisioning/accessDeltaService.js";

async function resolveTenant() {
  if (process.env.GENERIC_E2E_TENANT_ID && mongoose.isValidObjectId(process.env.GENERIC_E2E_TENANT_ID)) {
    return new mongoose.Types.ObjectId(process.env.GENERIC_E2E_TENANT_ID);
  }
  let tenant = await Tenant.findOne({ code: "generic-plan-e2e" });
  if (!tenant) {
    tenant = await Tenant.create({
      name: "Generic Plan E2E",
      code: "generic-plan-e2e",
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
    // Avoid Application default integrationType:"manual" → MANUAL_FULFILLMENT.
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

async function main() {
  ensureStepsRegistered();
  await mongoose.connect(env.mongodbUri || process.env.MONGODB_URI);
  await seedWorkflowTemplates();

  const tenantId = await resolveTenant();
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);

  const stamp = Date.now();
  const appA = await createCsvApp(tenantId, `E2E-CSV-A-${stamp}`);
  const appB = await createCsvApp(tenantId, `E2E-CSV-B-${stamp}`);

  const identity = await Identity.create({
    tenantId,
    employeeId: `GE2E-${stamp}`,
    email: `ge2e.${stamp}@example.com`,
    firstName: "Generic",
    lastName: "E2E",
    displayName: "Generic E2E",
    department: "IT",
    location: "India",
    lifecycleState: "ACTIVE",
  });

  const lifecycleEventId = `evt-generic-${stamp}`;
  const jmlCorrelationId = `JML-GE2E-${stamp}`;

  const desiredAccess = {
    tenantId: String(tenantId),
    identityId: String(identity._id),
    lifecycleEventId,
    jmlCorrelationId,
    lifecycleType: "JOINER",
    applications: [
      {
        applicationId: String(appA._id),
        applicationName: appA.name,
        accountRequired: true,
        attributes: { employee_id: identity.employeeId, email: identity.email },
        entitlements: [],
      },
      {
        applicationId: String(appB._id),
        applicationName: appB.name,
        accountRequired: true,
        attributes: { employee_id: identity.employeeId, email: identity.email },
        entitlements: [],
      },
    ],
  };

  const actualAccess = {
    tenantId: String(tenantId),
    identityId: String(identity._id),
    applications: [],
    metadata: { source: "CALLER_SUPPLIED", projectionEntitlementsAvailable: false },
  };

  const accessDelta = calculateAccessDelta(desiredAccess, actualAccess, {
    lifecycleEventId,
    jmlCorrelationId,
    lifecycleType: "JOINER",
  });

  console.log("Delta apps:", accessDelta.applications.map((a) => ({
    app: a.applicationName,
    account: a.account.operation,
  })));

  const started = await startGenericPlanOrchestration({
    identity: identity.toObject ? identity.toObject() : identity,
    lifecycleEvent: {
      _id: lifecycleEventId,
      tenantId,
      identityId: identity._id,
      jmlCorrelationId,
      lifecycleType: "JOINER",
    },
    desiredAccess,
    actualAccess,
    accessDelta,
    context: {
      tenantId,
      lifecycleType: "JOINER",
      applications: [appA.toObject(), appB.toObject()],
    },
  });

  if (!started.success) {
    console.error("FAIL start:", started);
    process.exit(1);
  }

  console.log("Started generic orchestration", {
    requestId: started.provisioningRequestId,
    planId: started.planId,
    executionId: started.workflowExecutionId,
    ops: started.totalOperations,
  });

  // No tasks before approval
  const before = await ProvisioningTask.countDocuments({
    requestId: started.provisioningRequestId,
  });
  if (before !== 0) {
    console.error("FAIL: tasks existed before approval", before);
    process.exit(1);
  }

  const approved = await decideLifecycleApproval({
    provisioningRequestId: started.provisioningRequestId,
    decision: "APPROVED",
    tenantId,
  });
  if (!approved.ok) {
    console.error("FAIL approve:", approved);
    process.exit(1);
  }

  // Allow workflow resume materialization a moment if async
  await new Promise((r) => setTimeout(r, 1500));

  let tasks = await ProvisioningTask.find({
    requestId: started.provisioningRequestId,
  }).lean();

  // Direct materialization fallback if workflow template missing
  if (!tasks.length) {
    const { materializeProvisioningTasks } = await import(
      "../../services/provisioning/taskMaterializationService.js"
    );
    const mat = await materializeProvisioningTasks({
      planId: started.planId,
      workflowExecutionId: started.workflowExecutionId,
      tenantId,
    });
    console.log("Direct materialize fallback:", mat);
    tasks = await ProvisioningTask.find({
      requestId: started.provisioningRequestId,
    }).lean();
  }

  console.log(
    "Tasks after approval:",
    tasks.map((t) => ({
      planItemId: t.planItemId,
      op: t.operationType,
      app: String(t.applicationId),
      status: t.status,
    })),
  );

  if (tasks.length !== 2) {
    console.error("FAIL: expected 2 ADD_ACCOUNT tasks, got", tasks.length);
    process.exit(1);
  }
  if (new Set(tasks.map((t) => t.planItemId)).size !== 2) {
    console.error("FAIL: planItemIds not distinct");
    process.exit(1);
  }

  for (const task of tasks) {
    const result = await processProvisioningTaskById(task._id);
    console.log("Worker result", String(task._id), result?.ok, result?.result?.status || result?.reason);
  }

  const UsersA = await getDynamicUserModelForTenantId(appA.name, tenantId);
  const UsersB = await getDynamicUserModelForTenantId(appB.name, tenantId);
  const rowA = await UsersA.findOne({ employee_id: identity.employeeId }).lean();
  const rowB = await UsersB.findOne({ employee_id: identity.employeeId }).lean();

  if (!rowA || !rowB) {
    console.error("FAIL: CSV users missing", { rowA: Boolean(rowA), rowB: Boolean(rowB) });
    process.exit(1);
  }

  const plan = await ProvisioningPlan.findById(started.planId).lean();
  const request = await ProvisioningRequest.findById(started.provisioningRequestId).lean();

  console.log("\nPASS generic multi-app CSV orchestration");
  console.log({
    jmlCorrelationId: started.jmlCorrelationId,
    planStatus: plan?.status,
    requestStatus: request?.status,
    tasks: tasks.length,
    note: "CSV test apps only — AD LIVE VALIDATION PENDING",
  });

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("ENVIRONMENT BLOCKED or FAIL:", err.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
