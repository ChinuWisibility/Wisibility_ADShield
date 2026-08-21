/**
 * Configure certification revoke workflow for a tenant and run one live revoke test.
 *
 * Usage:
 *   node scripts/qa/setupCertRevokeLiveTest.js
 *   node scripts/qa/setupCertRevokeLiveTest.js --tenant-id <id>
 *   node scripts/qa/setupCertRevokeLiveTest.js --campaign-id <id> --dry-run
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

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const dryRun = process.argv.includes("--dry-run");
const tenantArg = arg("--tenant-id");
const campaignArg = arg("--campaign-id");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI required");

  await mongoose.connect(uri, { dbName: process.env.DB_NAME || "IGA-V3" });

  const Tenant = (await import("../../src/models/platform/Tenant.js")).default;
  const Campaign = (await import("../../src/models/certification/Campaign.js")).default;
  const ReviewItem = (await import("../../src/models/certification/ReviewItem.js")).default;
  const Definition = (await import("../../src/models/workflow/RemediationWorkflowDefinition.js"))
    .default;
  const Execution = (await import("../../src/models/workflow/RemediationWorkflowExecution.js"))
    .default;

  const { createWorkflow, getEnabledWorkflows } = await import(
    "../../src/workflows/persistence/workflowStore.js"
  );
  const { repairWorkflowDefinition } = await import(
    "../../src/workflows/workflow/repairDefinition.js"
  );
  const { enqueueRevokeExecution } = await import(
    "../../src/services/workflow/workflowDispatcher.js"
  );

  console.log("\n=== Certification Revoke — Live Setup & Test ===\n");

  // ── 1. Resolve tenant ─────────────────────────────────────────────────────
  let tenantId = tenantArg;
  if (!tenantId) {
    const tenants = await Tenant.find({}).select("_id name code").limit(20).lean();
    console.log("Tenants:");
    for (const t of tenants) {
      console.log(`  ${t._id}  ${t.code || ""}  ${t.name || ""}`);
    }
    tenantId = tenants[0]?._id ? String(tenants[0]._id) : null;
  }
  if (!tenantId) {
    throw new Error("No tenant found. Pass --tenant-id");
  }
  console.log(`\nUsing tenantId: ${tenantId}`);

  // ── 2. Create or reuse workflow for this tenant ─────────────────────────
  const template = repairWorkflowDefinition(
    JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8")),
  );
  template.name = "Certification Revoke - Enterprise";
  template.enabled = true;

  let workflow = await Definition.findOne({
    tenantId: String(tenantId),
    name: template.name,
  }).lean();

  if (!workflow) {
    if (dryRun) {
      console.log("[dry-run] Would create workflow for tenant");
    } else {
      const created = await createWorkflow(template, tenantId, "setup-script@iga");
      workflow = { _id: created.id, ...created };
      console.log(`Created workflow: ${created.id} — "${created.name}" (enabled)`);
    }
  } else {
    console.log(`Workflow exists: ${workflow._id} — "${workflow.name}"`);
  }

  const workflowId = workflow?._id ? String(workflow._id) : null;
  if (!workflowId && !dryRun) throw new Error("Workflow creation failed");

  const enabled = await getEnabledWorkflows(tenantId, "CertificationSignedOff");
  console.log(`Enabled cert-revoke workflows for tenant: ${enabled.length}`);

  // ── 3. Find an active campaign with pending review items ────────────────
  const campaignFilter = campaignArg
    ? { _id: campaignArg }
    : {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        status: { $in: ["ACTIVE", "IN_PROGRESS", "OPEN", "RUNNING"] },
      };

  let campaign = await Campaign.findOne(campaignFilter)
    .sort({ updatedAt: -1 })
    .select("_id name status tenantId")
    .lean();

  if (!campaign && !campaignArg) {
    campaign = await Campaign.findOne({ tenantId: new mongoose.Types.ObjectId(tenantId) })
      .sort({ updatedAt: -1 })
      .select("_id name status tenantId")
      .lean();
  }

  if (!campaign) {
    console.log("\nNo certification campaign found for this tenant.");
    console.log("Create a campaign in UI: Governance → Campaigns → activate one.");
    console.log(`Then re-run: node scripts/qa/setupCertRevokeLiveTest.js --tenant-id ${tenantId}`);
    await mongoose.disconnect();
    return;
  }

  console.log(`\nCampaign: ${campaign.name} (${campaign._id}) status=${campaign.status}`);

  const reviewItem = await ReviewItem.findOne({
    campaignId: campaign._id,
    $or: [
      { decision: { $in: [null, "", "PENDING", "Pending", "NOT_STARTED"] } },
      { "entitlementDecisions.decision": { $in: [null, "", "PENDING", "Pending"] } },
    ],
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (!reviewItem) {
    const anyItem = await ReviewItem.findOne({ campaignId: campaign._id }).lean();
    if (!anyItem) {
      console.log("\nNo review items in this campaign. Generate/populate the campaign first.");
      await mongoose.disconnect();
      return;
    }
    console.log("\nNo pending review items — all decided. Using most recent item for dry info:");
    printReviewItem(anyItem);
    printUiSteps(tenantId, workflowId, campaign, anyItem);
    await mongoose.disconnect();
    return;
  }

  printReviewItem(reviewItem);

  const entitlementName =
    reviewItem.entitlementSnapshot?.entitlementName ||
    reviewItem.provisioningPayload?.entitlementName ||
    reviewItem.itemName ||
    null;

  if (!entitlementName && !reviewItem.entitlementDecisions?.length) {
    console.log("\nReview item has no entitlement granularity — item-level revoke will be used.");
  }

  if (dryRun) {
    printUiSteps(tenantId, workflowId, campaign, reviewItem, entitlementName);
    await mongoose.disconnect();
    return;
  }

  // ── 4. Live workflow enqueue (cert revoke decision is submitted in UI by assigned reviewer) ──
  console.log("\n--- Live workflow enqueue ---");
  console.log(
    "Note: Submit Revoked in the certification UI to link decision + workflow. This run exercises the live engine only.",
  );

  const freshItem = await ReviewItem.findById(reviewItem._id).lean();
  const execution = await enqueueRevokeExecution({
    tenantId,
    workflowId,
    reviewItem: freshItem,
    entitlementName: entitlementName || undefined,
    campaignName: campaign.name || "",
    eventOwner: freshItem.reviewerEmail || "certification-reviewer",
  });

  if (!execution?.executionId) {
    throw new Error("Failed to enqueue remediation execution");
  }

  console.log(`Execution queued: ${execution.executionId}`);

  let final = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    final = await Execution.findOne({ executionId: execution.executionId }).lean();
    if (final && !["PENDING", "RUNNING"].includes(final.status)) break;
    process.stdout.write(".");
  }
  console.log("");

  if (final) {
    console.log(`Execution status: ${final.status}`);
    console.log(`Step statuses: ${(final.stepStatuses || []).join(" | ")}`);
    if (final.runId) console.log(`Run detail: /governance/workflows/executions (runId=${final.runId})`);
  } else {
    console.log("Execution still running — check Remediation runs in UI.");
  }

  printUiSteps(tenantId, workflowId, campaign, freshItem, entitlementName);

  await mongoose.disconnect();
}

function printReviewItem(ri) {
  console.log("\nReview item:");
  console.log(`  id:          ${ri._id}`);
  console.log(`  user:        ${ri.itemName || ri.itemEmail || ri.userId}`);
  console.log(`  application: ${ri.itemApplicationName || ri.provisioningPayload?.applicationName || "—"}`);
  console.log(
    `  entitlement: ${ri.entitlementSnapshot?.entitlementName || ri.provisioningPayload?.entitlementName || ri.itemName || "—"}`,
  );
  console.log(`  decision:    ${ri.decision || "(pending)"}`);
  if (ri.reviewerEmail) console.log(`  reviewer:    ${ri.reviewerEmail}`);
}

function printUiSteps(tenantId, workflowId, campaign, reviewItem, entitlementName) {
  console.log("\n=== Manual UI test (same flow) ===");
  console.log("1. Governance → Workflows — confirm workflow is Enabled");
  console.log(`   Workflow ID: ${workflowId || "(create via Load enterprise template)"}`);
  console.log("2. Governance → Campaigns → open campaign:");
  console.log(`   ${campaign.name} (${campaign._id})`);
  console.log("3. Open certification review for a pending item");
  console.log(`   Review item: ${reviewItem.itemName || reviewItem._id}`);
  console.log("4. Click Revoked → select remediation workflow → add comment → Submit");
  console.log("5. Governance → Workflows → Remediation runs — verify status");
  console.log(`\nTenant ID: ${tenantId}`);
  if (entitlementName) console.log(`Entitlement: ${entitlementName}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
