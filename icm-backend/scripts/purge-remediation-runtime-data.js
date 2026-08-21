/**
 * Purge remediation runtime/queue data (keeps workflow definitions + Global Rule Set rules).
 * Usage: node scripts/purge-remediation-runtime-data.js
 */
import mongoose from "mongoose";
import { connectDB } from "../src/config/database.js";

const RUNTIME_COLLECTIONS = [
  "remediation_workflow_executions",
  "remediation_workflow_runs",
  "remediation_workflow_node_executions",
  "workflow_task_queue",
  "remediation_workflow_events",
  "remediation_workflow_event_items",
  "remediation_events",
  "remediation_queue",
  "remediation_queue_items",
  "remediation_tickets",
  "remediation_ticket_items",
  "remediation_ticket_responses",
  "remediation_tracking",
  "remediation_audit",
  "remediation_notifications",
  "remediation_execution_logs",
  "remediation_validations",
  "scheduler_execution_logs",
];

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

async function main() {
  await connectDB();
  const db = mongoose.connection.db;
  const summary = {};

  for (const name of RUNTIME_COLLECTIONS) {
    try {
      const col = db.collection(name);
      const before = await col.countDocuments();
      if (before === 0) {
        summary[name] = { deleted: 0, skipped: true };
        continue;
      }
      const res = await col.deleteMany({});
      summary[name] = { deleted: res.deletedCount ?? before };
      console.log(`[purge] ${name}: deleted ${summary[name].deleted}`);
    } catch (err) {
      summary[name] = { error: err.message };
      console.warn(`[purge] ${name}: ${err.message}`);
    }
  }

  try {
    summary.orphanWorkflowReset = await resetOrphanWorkflowState(db);
    console.log(
      `[purge] orphan_accounts workflow reset: cleared ${summary.orphanWorkflowReset.workflowFieldsCleared}, reopened ${summary.orphanWorkflowReset.reopenedFromUnderReview}`,
    );
  } catch (err) {
    summary.orphanWorkflowReset = { error: err.message };
    console.warn(`[purge] orphan_accounts workflow reset: ${err.message}`);
  }

  try {
    summary.taskExecutionsIamOrphan = await purgeIamOrphanTaskExecutions(db);
    console.log(`[purge] task_executions (IAM orphan): deleted ${summary.taskExecutionsIamOrphan.deleted}`);
  } catch (err) {
    summary.taskExecutionsIamOrphan = { error: err.message };
    console.warn(`[purge] task_executions (IAM orphan): ${err.message}`);
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
