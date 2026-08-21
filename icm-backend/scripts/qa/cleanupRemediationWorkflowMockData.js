/**
 * Remove QA/smoke-seeded remediation workflow data from MongoDB.
 *
 * Run: node scripts/qa/cleanupRemediationWorkflowMockData.js
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const QA_CREATORS = ["qa@local", "smoke-test@local"];

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("Set MONGODB_URI in icm-backend/.env");

  await mongoose.connect(uri, { dbName: process.env.DB_NAME || "IGA-V3" });

  const Definition = (await import("../../src/models/workflow/RemediationWorkflowDefinition.js"))
    .default;
  const Run = (await import("../../src/models/workflow/RemediationWorkflowRun.js")).default;
  const Execution = (await import("../../src/models/workflow/RemediationWorkflowExecution.js"))
    .default;

  const seeded = await Definition.find({
    $or: [
      { createdBy: { $in: QA_CREATORS } },
      { name: /Smoke Test/i },
    ],
  }).lean();

  const workflowIds = seeded.map((d) => String(d._id));

  let runsDeleted = 0;
  let execDeleted = 0;
  if (workflowIds.length) {
    const runRes = await Run.deleteMany({ workflowId: { $in: workflowIds } });
    runsDeleted = runRes.deletedCount || 0;
    const execRes = await Execution.deleteMany({
      $or: [
        { workflowId: { $in: workflowIds } },
        { eventOwner: { $in: QA_CREATORS } },
        { identityId: "qa-identity" },
      ],
    });
    execDeleted = execRes.deletedCount || 0;
  }

  const defRes = await Definition.deleteMany({
    $or: [
      { createdBy: { $in: QA_CREATORS } },
      { name: /Smoke Test/i },
    ],
  });

  console.log("Cleanup complete:");
  console.log(`  workflows removed: ${defRes.deletedCount || 0}`);
  console.log(`  test runs removed:  ${runsDeleted}`);
  console.log(`  executions removed: ${execDeleted}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
