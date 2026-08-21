/**
 * One-time migration: fix RemediationWorkflowExecution records stuck in WAITING
 * for IAM orphan review workflows where the OrphanAccount already has an iamDecision.
 *
 * These executions were left in WAITING because either the workflow resume failed
 * or the WorkflowTaskQueue update was missing before the code fix was applied.
 *
 * Usage:
 *   node scripts/migrations/fixStuckOrphanQueueTasks.js --dry-run   (preview)
 *   node scripts/migrations/fixStuckOrphanQueueTasks.js              (apply)
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("Set MONGODB_URI or MONGO_URI in .env");
  const dbName = process.env.DB_NAME || "IGA-V3";
  await mongoose.connect(uri, { dbName });

  const db = mongoose.connection.db;
  const queueCol  = db.collection("workflow_task_queue");
  const orphanCol = db.collection("orphan_accounts");
  const taskCol   = db.collection("task_executions");

  // --- Diagnostic ---
  console.log(`\nConnected to database: "${db.databaseName}"`);

  // Probe all remediation/queue collections for records tied to orphan accounts.
  const probeNames = [
    "remediation_workflow_executions",
    "remediation_workflow_runs",
    "remediation_workflow_events",
    "remediation_queue",
    "remediation_queue_items",
    "remediation_events",
    "remediation_tracking",
    "workflow_task_queue",
    "task_executions",
  ];

  console.log("\nProbing collections for orphan-linked records:");
  for (const name of probeNames) {
    const col = db.collection(name);
    const total = await col.countDocuments();
    const withOrphan = await col.countDocuments({ orphanId: { $exists: true, $ne: null } });
    const waiting = await col.countDocuments({ status: { $in: ["WAITING", "IN_PROGRESS"] } });
    console.log(`  ${name}: total=${total}  withOrphanId=${withOrphan}  waiting/in-progress=${waiting}`);
    if (withOrphan > 0) {
      const s = await col.find({ orphanId: { $exists: true, $ne: null } }).limit(2).toArray();
      for (const r of s) {
        const keys = Object.keys(r).filter((k) => !["_id", "__v"].includes(k)).slice(0, 8);
        console.log("    sample:", Object.fromEntries(keys.map((k) => [k, r[k]])));
      }
    }
  }
  console.log();

  // --- Find stuck queue tasks with orphanId (any action value) ---
  const distinctActions = await queueCol.distinct("action");
  console.log("Distinct action values in workflow_task_queue:", distinctActions);

  const stuckTasks = await queueCol
    .find({ status: { $in: ["WAITING", "IN_PROGRESS"] }, orphanId: { $exists: true, $ne: null } })
    .toArray();

  console.log(`Found ${stuckTasks.length} open task(s) with orphanId to check.`);

  let fixed = 0;
  let skipped = 0;

  for (const task of stuckTasks) {
    const orphan = await orphanCol.findOne({
      _id: new mongoose.Types.ObjectId(task.orphanId),
      iamDecision: { $exists: true, $ne: null },
    });

    if (!orphan) {
      console.log(`  [SKIP] taskId=${task.taskId}  status=${task.status} — no decision on orphan yet`);
      skipped++;
      continue;
    }

    const decision = orphan.iamDecision;
    const decidedAt = orphan.iamDecisionMeta?.decidedAt || new Date();
    console.log(
      `  [${DRY_RUN ? "DRY RUN" : "FIX"}] taskId=${task.taskId}  status=${task.status}  action=${task.action}  decision=${decision}  decidedAt=${decidedAt}`,
    );

    if (!DRY_RUN) {
      const now = new Date();
      await queueCol.updateOne(
        { _id: task._id },
        {
          $set: { status: "COMPLETED", completedAt: now },
          $push: {
            stepLog: {
              label: `Decision: ${decision} — backfill migration`,
              status: "COMPLETED",
              at: now,
            },
          },
        },
      );

      // Ensure orphan account is also marked completed.
      await orphanCol.updateOne(
        { _id: new mongoose.Types.ObjectId(task.orphanId), workflowStatus: { $ne: "COMPLETED" } },
        { $set: { workflowStatus: "COMPLETED", currentStepLabel: `IAM decision: ${decision}` } },
      );

      // Ensure a IAM_ORPHAN_DECISION task_execution exists so the step timeline renders correctly.
      const executionId = task.executionId || null;
      if (executionId) {
        const existing = await taskCol.findOne({ executionId, taskName: "IAM_ORPHAN_DECISION" });
        if (!existing) {
          await taskCol.insertOne({
            tenantId: task.tenantId || null,
            taskName: "IAM_ORPHAN_DECISION",
            taskType: "TRIGGERED",
            status: "COMPLETED",
            orphanId: String(task.orphanId),
            executionId,
            accountName: orphan.accountName || null,
            detail: `IAM decision recorded: ${decision} — backfill migration`,
            startedAt: decidedAt,
            completedAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    fixed++;
  }

  console.log(`\nDone. Fixed: ${fixed}  Skipped (no decision yet): ${skipped}`);
  if (DRY_RUN) console.log("(Dry run — no changes written. Remove --dry-run to apply.)");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
