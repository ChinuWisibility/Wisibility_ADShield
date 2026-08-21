/**
 * Delete remediation workflow executions (+ run traces) and optionally reset
 * ReviewItem workflow linkage so the review board starts clean.
 *
 * Usage:
 *   node scripts/qa/purgeRemediationExecutions.js --all
 *   node scripts/qa/purgeRemediationExecutions.js --all --reset-review-items
 *   node scripts/qa/purgeRemediationExecutions.js --campaignId=<id>
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

function arg(name) {
  const hit = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  if (!hit) return null;
  if (hit.includes("=")) return hit.slice(hit.indexOf("=") + 1);
  return true;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("Set MONGODB_URI in icm-backend/.env");

  const purgeAll = Boolean(arg("--all"));
  const campaignId = arg("--campaignId");
  const resetReviewItems = Boolean(arg("--reset-review-items"));

  if (!purgeAll && !campaignId) {
    console.error("Pass --all or --campaignId=<mongoId>");
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName: process.env.DB_NAME || "IGA-V3" });

  const Execution = (await import("../../src/models/workflow/RemediationWorkflowExecution.js"))
    .default;
  const Run = (await import("../../src/models/workflow/RemediationWorkflowRun.js")).default;
  const ReviewItem = (await import("../../src/models/certification/ReviewItem.js")).default;

  const execFilter = purgeAll ? {} : { campaignId: String(campaignId) };

  const execs = await Execution.find(execFilter).select("executionId runId").lean();
  const runIds = execs.map((e) => e.runId).filter(Boolean);

  const execRes = await Execution.deleteMany(execFilter);
  let runRes = { deletedCount: 0 };
  if (runIds.length) {
    runRes = await Run.deleteMany({ runId: { $in: runIds } });
  }

  let reviewReset = 0;
  if (resetReviewItems) {
    const riFilter = purgeAll ? {} : { campaignId };
    const top = await ReviewItem.updateMany(riFilter, {
      $unset: {
        remediationWorkflowId: "",
        remediationExecutionId: "",
        remediationStatus: "",
        provisioningStatus: "",
      },
    });
    const ent = await ReviewItem.updateMany(
      { ...riFilter, entitlementDecisions: { $exists: true, $ne: [] } },
      {
        $set: {
          "entitlementDecisions.$[].remediationWorkflowId": null,
          "entitlementDecisions.$[].remediationExecutionId": null,
          "entitlementDecisions.$[].remediationStatus": null,
          "entitlementDecisions.$[].provisioningStatus": null,
        },
      },
    );
    reviewReset = (top.modifiedCount || 0) + (ent.modifiedCount || 0);
  }

  console.log("Purge complete:");
  console.log(`  executions removed: ${execRes.deletedCount || 0}`);
  console.log(`  run traces removed: ${runRes.deletedCount || 0}`);
  if (resetReviewItems) {
    console.log(`  review items reset:  ${reviewReset} update(s)`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
