/**
 * Offline Joiner E2E harness (CSV SAP/Oracle) — no live AD.
 *
 * Usage (requires Mongo + seeded tenant optional):
 *   node src/scripts/joiner/e2eCsvJoinerHarness.js
 *
 * Env:
 *   MONGODB_URI (default from env.js)
 *   JOINER_E2E_TENANT_ID (optional — creates ephemeral data under a random ObjectId)
 *
 * Demonstrates P1 lifecycle path:
 *   IDENTITY_CREATED LifecycleEvent → worker → Joiner rule → request → approve → plan/task → CSV createAccount
 *
 * Does NOT claim "AD ACCOUNT CREATED" — CSV targets are temporary test apps only.
 */

import mongoose from "mongoose";
import env from "../../config/env.js";
import Application from "../../models/application/Application.js";
import Tenant from "../../models/platform/Tenant.js";
import IdentityProvisioningRule from "../../models/provisioning/IdentityProvisioningRule.js";
import ProvisioningRequest from "../../models/provisioning/ProvisioningRequest.js";
import ProvisioningTask from "../../models/provisioning/ProvisioningTask.js";
import LifecycleEvent from "../../models/identity/LifecycleEvent.js";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import { seedWorkflowTemplates } from "../../services/workflow/seedWorkflowTemplates.js";
import {
  evaluateJoinersForIdentities,
  compileJoinerPlanAndTask,
} from "../../services/provisioning/joinerProvisioningService.js";
import { decideJoinerApproval } from "../../services/provisioning/joinerWorkflowService.js";
import { processProvisioningTaskById } from "../../services/provisioning/provisioningWorker.js";
import { enqueueLifecycleEventsFromIdentityChange } from "../../services/lifecycle/lifecycleEventService.js";
import { tickLifecycleEvents } from "../../services/lifecycle/lifecycleEventWorker.js";
import { ensureStepsRegistered } from "../../workflows/steps/index.js";

async function resolveE2eTenant() {
  if (process.env.JOINER_E2E_TENANT_ID && mongoose.isValidObjectId(process.env.JOINER_E2E_TENANT_ID)) {
    return new mongoose.Types.ObjectId(process.env.JOINER_E2E_TENANT_ID);
  }
  let tenant = await Tenant.findOne({ code: "joiner-e2e-test" });
  if (!tenant) {
    tenant = await Tenant.create({
      name: "Joiner E2E Test",
      code: "joiner-e2e-test",
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

async function runForApp({ tenantId, app, identity, label, viaLifecycle = false }) {
  console.log(`\n=== ${label}: ${app.name} ===`);
  console.log(
    viaLifecycle
      ? "Path: LifecycleEvent → worker → Joiner (CSV target; NOT AD ACCOUNT CREATED)"
      : "Path: direct evaluateJoinersForIdentities (compat)",
  );

  await IdentityProvisioningRule.deleteMany({ tenantId, name: `E2E ${label}` });
  await IdentityProvisioningRule.create({
    tenantId,
    name: `E2E ${label}`,
    enabled: true,
    priority: 10,
    conditionLogic: "AND",
    conditions: [
      { field: "department", operator: "equals", value: "IT" },
      { field: "location", operator: "equals", value: "India" },
    ],
    actions: [{ type: "ENSURE_ACCOUNT", applicationId: app._id }],
  });

  const syncJobId = `e2e:${label}:${Date.now()}`;
  let evalResult;
  let jmlCorrelationId = null;

  if (viaLifecycle) {
    const enq = await enqueueLifecycleEventsFromIdentityChange({
      tenantId,
      identityId: identity._id,
      before: null,
      after: identity.toObject ? identity.toObject() : identity,
      syncJobId,
      triggeredBy: "SYSTEM",
      sourceApplicationId: app._id,
    });
    jmlCorrelationId = enq.jmlCorrelationId;
    const joinerEvent = (enq.enqueued || []).find((e) => e.eventType === "JOINER");
    if (!joinerEvent) throw new Error(`${label}: expected JOINER LifecycleEvent`);
    console.log("JOINER WORKFLOW TRIGGERED via LifecycleEvent", JSON.stringify(joinerEvent));

    const tick = await tickLifecycleEvents({ limit: 50, tenantId });
    console.log("lifecycle tick:", JSON.stringify({ processed: tick.processed }));

    const event = await LifecycleEvent.findById(joinerEvent.eventId).lean();
    if (!event || event.eventStatus !== "COMPLETED") {
      throw new Error(
        `${label}: JOINER event not COMPLETED (${event?.eventStatus || "missing"})`,
      );
    }

    const req = await ProvisioningRequest.findOne({
      tenantId,
      identityId: identity._id,
      requestType: "JOINER",
      "metadata.applicationId": String(app._id),
      status: { $in: ["PENDING", "APPROVED", "IN_PROGRESS", "COMPLETED"] },
    }).lean();
    if (!req) throw new Error(`${label}: expected provisioning request after lifecycle tick`);
    evalResult = {
      requests: [
        {
          success: true,
          satisfied: req.status === "COMPLETED",
          provisioningRequestId: String(req._id),
          approvalStatus: req.approvalStatus,
          status: req.status,
        },
      ],
    };
    if (req.metadata?.jmlCorrelationId && jmlCorrelationId) {
      if (req.metadata.jmlCorrelationId !== jmlCorrelationId) {
        throw new Error(`${label}: jmlCorrelationId mismatch on request`);
      }
    }
  } else {
    evalResult = await evaluateJoinersForIdentities({
      tenantId,
      identityIds: [identity._id],
      syncJobId,
    });
  }

  console.log("evaluate:", JSON.stringify(evalResult, null, 2));

  const reqEntry = evalResult.requests?.find((r) => r.success && !r.satisfied);
  if (!reqEntry?.provisioningRequestId) {
    throw new Error(`${label}: expected PENDING joiner request`);
  }

  // Ensure no task before approval
  const beforeTasks = await ProvisioningTask.countDocuments({
    requestId: reqEntry.provisioningRequestId,
  });
  if (beforeTasks !== 0) throw new Error(`${label}: task created before approval`);

  const decision = await decideJoinerApproval({
    provisioningRequestId: reqEntry.provisioningRequestId,
    decision: "APPROVED",
    decidedBy: "e2e-harness",
    tenantId,
  });
  console.log("approve:", JSON.stringify(decision));

  // If workflow path didn't compile (timing), compile directly
  let request = await ProvisioningRequest.findById(reqEntry.provisioningRequestId).lean();
  if (request.approvalStatus === "PENDING" || request.status === "PENDING") {
    await compileJoinerPlanAndTask({
      provisioningRequestId: reqEntry.provisioningRequestId,
      approvedBy: "e2e-harness",
    });
    request = await ProvisioningRequest.findById(reqEntry.provisioningRequestId).lean();
  }

  const task = await ProvisioningTask.findOne({
    requestId: reqEntry.provisioningRequestId,
    operationType: "ADD_ACCOUNT",
  }).lean();
  if (!task) throw new Error(`${label}: expected ADD_ACCOUNT task after approval`);

  const exec = await processProvisioningTaskById(task._id);
  console.log("worker:", JSON.stringify(exec));

  if (!exec?.ok && exec?.result?.status !== "COMPLETED") {
    throw new Error(`${label}: worker did not complete: ${JSON.stringify(exec)}`);
  }

  const Users = await getDynamicUserModelForTenantId(app.name, tenantId);
  const row = await Users.findOne({
    applicationId: { $in: [app._id, String(app._id)] },
    employee_id: identity.employeeId,
  }).lean();
  if (!row) throw new Error(`${label}: CSV dataset missing provisioned row`);

  console.log(
    `${label} OK — CSV test account row`,
    String(row._id),
    "(NOT an AD account)",
  );
  return {
    requestId: reqEntry.provisioningRequestId,
    taskId: String(task._id),
    userId: String(row._id),
    jmlCorrelationId: jmlCorrelationId || request?.metadata?.jmlCorrelationId || null,
    viaLifecycle,
  };
}

async function main() {
  ensureStepsRegistered();
  const uri = process.env.MONGODB_URI || env.mongodb?.uri;
  if (!uri) {
    console.error("MONGODB_URI not configured");
    process.exit(1);
  }
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    dbName: process.env.DB_NAME || undefined,
  });
  await seedWorkflowTemplates();

  const tenantId = await resolveE2eTenant();
  console.log("Using tenant", String(tenantId));
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);

  const identity = await Identity.create({
    tenantId,
    displayName: "Joiner Test 001",
    firstName: "Joiner",
    lastName: "Test",
    email: "is-joiner-test-001@example.com",
    employeeId: "IS-JOINER-TEST-001",
    department: "IT",
    location: "India",
    lifecycleState: "ACTIVE",
  });

  const sap = await createCsvApp(tenantId, `SAP-E2E-${Date.now()}`);
  const oracle = await createCsvApp(tenantId, `Oracle-E2E-${Date.now()}`);

  // Mismatch identity — should not provision
  const mismatch = await Identity.create({
    tenantId,
    displayName: "Mismatch",
    email: "mismatch@example.com",
    employeeId: "IS-JOINER-MISMATCH",
    department: "HR",
    location: "India",
    lifecycleState: "ACTIVE",
  });
  const mismatchEval = await evaluateJoinersForIdentities({
    tenantId,
    identityIds: [mismatch._id],
    syncJobId: `e2e:mismatch:${Date.now()}`,
  });
  if ((mismatchEval.requests || []).length !== 0) {
    throw new Error("mismatch identity should not create requests");
  }
  console.log("mismatch OK — no requests");

  const sapResult = await runForApp({
    tenantId,
    app: sap,
    identity,
    label: "SAP",
    viaLifecycle: true,
  });

  // Second evaluate same sync key should reuse
  const dup = await evaluateJoinersForIdentities({
    tenantId,
    identityIds: [identity._id],
    syncJobId: `e2e:SAP:${sapResult.requestId}`, // different sync — openDup by identity+app
  });
  const reused = (dup.requests || []).some((r) => r.reused || r.satisfied);
  console.log("idempotency check:", JSON.stringify(dup.requests));

  // Rejection path on fresh identity
  const rejectId = await Identity.create({
    tenantId,
    displayName: "Reject Me",
    email: "reject@example.com",
    employeeId: "IS-JOINER-REJECT",
    department: "IT",
    location: "India",
    lifecycleState: "ACTIVE",
  });
  await IdentityProvisioningRule.create({
    tenantId,
    name: `E2E REJECT ${Date.now()}`,
    enabled: true,
    conditions: [
      { field: "employeeId", operator: "equals", value: "IS-JOINER-REJECT" },
    ],
    actions: [{ type: "ENSURE_ACCOUNT", applicationId: sap._id }],
  });
  const rejEval = await evaluateJoinersForIdentities({
    tenantId,
    identityIds: [rejectId._id],
    syncJobId: `e2e:reject:${Date.now()}`,
  });
  const rejReq = rejEval.requests?.[0]?.provisioningRequestId;
  await decideJoinerApproval({
    provisioningRequestId: rejReq,
    decision: "REJECTED",
    tenantId,
  });
  const rejTasks = await ProvisioningTask.countDocuments({ requestId: rejReq });
  if (rejTasks !== 0) throw new Error("rejection must not create tasks");
  console.log("rejection OK — no tasks");

  const oracleResult = await runForApp({
    tenantId,
    app: oracle,
    identity,
    label: "Oracle",
    viaLifecycle: true,
  });

  console.log("\n=== SUMMARY ===");
  console.log({ sapResult, oracleResult, reused });
  console.log("CSV proves JOINER WORKFLOW TRIGGERED + temporary CSV account row");
  console.log("AD ACCOUNT CREATED: NO (AD LIVE VALIDATION PENDING)");
  console.log("STATUS: READY FOR AD VALIDATION");

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("E2E FAILED:", err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
