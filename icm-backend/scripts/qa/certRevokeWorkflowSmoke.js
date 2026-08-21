/**
 * Build + test the certification revoke remediation workflow end-to-end.
 *
 * Run from icm-backend:
 *   node scripts/qa/certRevokeWorkflowSmoke.js
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(
  __dirname,
  "../../src/workflows/templates/cert-revoke-flow.json",
);

function pass(label, detail = "") {
  console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label, detail = "") {
  console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n${"=".repeat(60)}\n${title}\n${"=".repeat(60)}`);
}

function buildQaTrigger(overrides = {}) {
  return {
    decision: "Revoke",
    identityId: "qa-identity",
    identityName: "QA User",
    identityEmail: "",
    managerEmail: "",
    managerName: "",
    applicationId: "qa-app",
    applicationName: "QA Application",
    entitlementId: "qa-entitlement",
    entitlementName: "QA Entitlement",
    campaignId: "qa-campaign",
    campaignName: "QA Campaign",
    reviewItemId: "qa-review-item",
    provisioningAction: "REMOVE_ENTITLEMENT",
    ...overrides,
  };
}

async function loadModules() {
  const [
    { validateWorkflow },
    { repairWorkflowDefinition },
    { executeWorkflow },
    { getTriggerTemplate },
    { createDemoAdapter },
    { createWorkflow, getWorkflowById, getEnabledWorkflows },
    { buildTriggerFromReviewItem, enqueueRevokeExecution },
  ] = await Promise.all([
    import("../../src/workflows/workflow/validator.js"),
    import("../../src/workflows/workflow/repairDefinition.js"),
    import("../../src/workflows/engine/executor.js"),
    import("../../src/workflows/engine/sampleTriggers.js"),
    import("../../src/workflows/adapters/demoAdapter.js"),
    import("../../src/workflows/persistence/workflowStore.js"),
    import("../../src/services/workflow/workflowDispatcher.js"),
  ]);
  return {
    validateWorkflow,
    repairWorkflowDefinition,
    executeWorkflow,
    getTriggerTemplate,
    createDemoAdapter,
    createWorkflow,
    getWorkflowById,
    getEnabledWorkflows,
    buildTriggerFromReviewItem,
    enqueueRevokeExecution,
  };
}

async function runEngineTests(mods, definition) {
  section("Phase 1 — Workflow engine (no database)");

  const validation = mods.validateWorkflow(definition);
  if (!validation.valid) {
    fail("Template validation", validation.errors?.join("; "));
    return false;
  }
  pass("Template validation", `${definition.nodes.length} nodes, ${definition.edges.length} edges`);

  const template = mods.getTriggerTemplate();
  if (template.decision === "Revoke" && template.identityId) {
    pass("Trigger template", "realistic sample with identity and entitlement");
  } else {
    fail("Trigger template", "expected populated certification trigger fields");
  }

  const revokeTrigger = buildQaTrigger();
  const demoAdapter = mods.createDemoAdapter({ trigger: revokeTrigger });

  // Run 1: access still present → queue provisioning + ITSM ticket, park as WAITING.
  const waitRun = await mods.executeWorkflow(definition, { trigger: revokeTrigger }, {
    adapter: demoAdapter,
    mode: "TEST",
    persist: false,
  });
  if (waitRun.status === "WAITING") {
    pass("Revoke path (still present)", "queued provisioning + ticket → WAITING");
  } else {
    fail("Revoke path (still present)", `expected WAITING, got ${waitRun.status}`);
    return false;
  }

  // Run 2: re-verify from the checkpoint. The demo adapter removed access in run 1,
  // so verification now passes and the run completes.
  const verifyRun = await mods.executeWorkflow(definition, { trigger: revokeTrigger }, {
    adapter: demoAdapter,
    mode: "TEST",
    persist: false,
    startNodeId: "verify",
  });
  if (verifyRun.status === "SUCCESS") {
    pass("Re-verify path (access removed)", verifyRun.steps?.map((s) => s.label).join(" → "));
  } else {
    fail("Re-verify path (access removed)", `expected SUCCESS, got ${verifyRun.status}`);
    return false;
  }

  const keepTrigger = buildQaTrigger({ decision: "Keep" });
  const keepRun = await mods.executeWorkflow(definition, { trigger: keepTrigger }, {
    adapter: mods.createDemoAdapter({ trigger: keepTrigger }),
    mode: "TEST",
    persist: false,
  });
  if (keepRun.status === "SKIPPED") {
    pass("Non-revoke filter", "SKIPPED as expected");
  } else {
    fail("Non-revoke filter", `expected SKIPPED, got ${keepRun.status}`);
    return false;
  }

  const emptyTrigger = {
    decision: "Revoke",
    identityId: "",
    entitlementId: "",
    entitlementName: "",
  };
  const emptyRun = await mods.executeWorkflow(definition, { trigger: emptyTrigger }, {
    adapter: mods.createDemoAdapter({ trigger: emptyTrigger }),
    mode: "TEST",
    persist: false,
  });
  const emptyVerify = emptyRun.steps?.find((s) => s.type === "VerifyAccessRemoved");
  const emptyNotifyUser = emptyRun.steps?.find(
    (s) => s.label === "Notify User" || s.stepId === "emailUser",
  );
  if (
    emptyRun.status === "FAILED" &&
    emptyVerify?.output?.verificationStatus === "VERIFICATION_FAILED" &&
    !emptyNotifyUser
  ) {
    pass("Empty trigger guard", "VERIFICATION_FAILED — did not route to Notify User");
  } else {
    fail(
      "Empty trigger guard",
      `expected FAILED/VERIFICATION_FAILED without Notify User, got status=${emptyRun.status}`,
    );
    return false;
  }

  return true;
}

async function runMongoTests(mods, definition) {
  section("Phase 2 — MongoDB (read-only checks, no seeding)");

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.log("  ⚠️  MONGODB_URI not set — skipping Phase 2");
    return true;
  }

  await mongoose.connect(uri, { dbName: process.env.DB_NAME || "IGA-V3" });
  pass("MongoDB connected");

  const RemediationWorkflowDefinition = (
    await import("../../src/models/workflow/RemediationWorkflowDefinition.js")
  ).default;

  const trigger = buildQaTrigger();
  const mockReviewItem = {
    _id: new mongoose.Types.ObjectId(),
    userId: trigger.identityId,
    itemName: trigger.identityName,
    itemEmail: trigger.identityEmail,
    itemManagerEmail: trigger.managerEmail,
    itemManager: trigger.managerName,
    applicationId: new mongoose.Types.ObjectId(),
    itemApplicationName: trigger.applicationName,
    campaignId: new mongoose.Types.ObjectId(),
    provisioningPayload: {
      identityId: trigger.identityId,
      applicationName: trigger.applicationName,
      entitlementId: trigger.entitlementId,
      entitlementName: trigger.entitlementName,
    },
    entitlementSnapshot: {
      entitlementId: trigger.entitlementId,
      entitlementName: trigger.entitlementName,
      applicationName: trigger.applicationName,
    },
    provisioningAction: "REMOVE_ENTITLEMENT",
  };

  const built = await mods.buildTriggerFromReviewItem(
    mockReviewItem,
    trigger.entitlementName,
    trigger.campaignName,
    process.env.TENANT_ID || null,
  );
  if (built.entitlementName === trigger.entitlementName) {
    pass("Trigger from ReviewItem", "fields mapped");
  } else {
    fail("Trigger from ReviewItem", JSON.stringify(built));
    await mongoose.disconnect();
    return false;
  }

  const existing = await RemediationWorkflowDefinition.countDocuments({});
  pass("Database check", `${existing} workflow(s) in DB (QA script does not seed)`);

  await mongoose.disconnect();
  return true;
}

async function main() {
  console.log("\nCertification Revoke Workflow — QA\n");
  const raw = JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8"));
  const mods = await loadModules();
  const definition = mods.repairWorkflowDefinition(raw);
  const phase1 = await runEngineTests(mods, definition);
  let phase2 = true;
  try {
    phase2 = await runMongoTests(mods, definition);
  } catch (err) {
    fail("Phase 2", err.message);
    phase2 = false;
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  }
  section("Summary");
  console.log(`Phase 1: ${phase1 ? "PASS" : "FAIL"}`);
  console.log(`Phase 2: ${phase2 ? "PASS" : "FAIL/SKIP"}`);
  process.exit(phase1 && phase2 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
