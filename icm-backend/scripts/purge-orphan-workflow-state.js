/**
 * Clear stale IAM orphan workflow state from uncorrelated accounts.
 *
 * Use after purge-remediation-runtime-data.js when orphan rows still show
 * "Awaiting IAM" / step labels from deleted workflow executions.
 *
 * Usage:
 *   node scripts/purge-orphan-workflow-state.js
 *   node scripts/purge-orphan-workflow-state.js --delete-all-orphans
 */
import mongoose from "mongoose";
import { connectDB } from "../src/config/database.js";

const IAM_ORPHAN_TASK_NAMES = ["IAM_ORPHAN_REVIEW", "IAM_ORPHAN_REMINDER", "IAM_ORPHAN_DECISION"];

const ORPHAN_WORKFLOW_UNSET = {
  workflowStatus: "",
  workflowExecutionId: "",
  currentStepLabel: "",
  nextCheckAt: "",
  reminderPhaseIndex: "",
  iamDecision: "",
};

async function resetOrphanWorkflowState(db) {
  const col = db.collection("orphan_accounts");

  const withWorkflow = await col.countDocuments({
    $or: [
      { workflowStatus: { $exists: true, $ne: null } },
      { workflowExecutionId: { $exists: true, $ne: null } },
      { currentStepLabel: { $exists: true, $ne: null } },
      { nextCheckAt: { $exists: true, $ne: null } },
      { iamDecision: { $exists: true, $ne: null } },
    ],
  });

  const resetWorkflow = await col.updateMany(
    {
      $or: [
        { workflowStatus: { $exists: true, $ne: null } },
        { workflowExecutionId: { $exists: true, $ne: null } },
        { currentStepLabel: { $exists: true, $ne: null } },
        { nextCheckAt: { $exists: true, $ne: null } },
        { iamDecision: { $exists: true, $ne: null } },
      ],
    },
    { $unset: ORPHAN_WORKFLOW_UNSET },
  );

  const reopenReview = await col.updateMany(
    { status: "UNDER_REVIEW" },
    { $set: { status: "OPEN" } },
  );

  return {
    withWorkflow,
    workflowFieldsCleared: resetWorkflow.modifiedCount ?? 0,
    reopenedFromUnderReview: reopenReview.modifiedCount ?? 0,
  };
}

async function purgeIamOrphanTaskExecutions(db) {
  const col = db.collection("task_executions");
  const before = await col.countDocuments({
    $or: [
      { taskName: { $in: IAM_ORPHAN_TASK_NAMES } },
      { orphanId: { $exists: true, $ne: null, $ne: "" } },
      { executionId: { $exists: true, $ne: null, $ne: "" } },
    ],
  });
  if (before === 0) return { deleted: 0 };
  const res = await col.deleteMany({
    $or: [
      { taskName: { $in: IAM_ORPHAN_TASK_NAMES } },
      { orphanId: { $exists: true, $ne: null, $ne: "" } },
    ],
  });
  return { deleted: res.deletedCount ?? before };
}

async function deleteAllOrphanAccounts(db) {
  const col = db.collection("orphan_accounts");
  const before = await col.countDocuments();
  if (before === 0) return { deleted: 0 };
  const res = await col.deleteMany({});
  return { deleted: res.deletedCount ?? before };
}

async function main() {
  const deleteAll = process.argv.includes("--delete-all-orphans");
  await connectDB();
  const db = mongoose.connection.db;
  const summary = {};

  summary.orphanWorkflowReset = await resetOrphanWorkflowState(db);
  console.log(
    `[purge] orphan_accounts workflow reset: cleared ${summary.orphanWorkflowReset.workflowFieldsCleared}, reopened ${summary.orphanWorkflowReset.reopenedFromUnderReview}`,
  );

  summary.taskExecutions = await purgeIamOrphanTaskExecutions(db);
  console.log(`[purge] task_executions (IAM orphan): deleted ${summary.taskExecutions.deleted}`);

  if (deleteAll) {
    summary.orphanAccountsDeleted = await deleteAllOrphanAccounts(db);
    console.log(`[purge] orphan_accounts: deleted ${summary.orphanAccountsDeleted.deleted}`);
  }

  console.log("\nPurge complete.");
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
