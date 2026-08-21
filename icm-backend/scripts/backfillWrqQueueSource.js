/**
 * Backfill queueSource on remediation_workflow_events.
 *
 * Usage:
 *   node scripts/backfillWrqQueueSource.js
 *   node scripts/backfillWrqQueueSource.js --dry-run
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import WorkflowRemediationEvent from "../src/models/workflowRemediation/WorkflowRemediationEvent.js";
import {
  WORKFLOW_REMEDIATION_EVENT_TYPES,
  WORKFLOW_REMEDIATION_QUEUE_SOURCES,
} from "../src/constants/workflowRemediation.js";

dotenv.config();

function resolveQueueSource(doc) {
  if (doc.metadata?.intakeMode === "manual") {
    return WORKFLOW_REMEDIATION_QUEUE_SOURCES.MANUAL;
  }
  if (doc.eventType === WORKFLOW_REMEDIATION_EVENT_TYPES.REVOKE_ACCESS) {
    return WORKFLOW_REMEDIATION_QUEUE_SOURCES.CERTIFICATION;
  }
  if (doc.createdBy === "system") {
    return WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER;
  }
  return WORKFLOW_REMEDIATION_QUEUE_SOURCES.API;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("Set MONGODB_URI");

  await mongoose.connect(uri);

  const cursor = WorkflowRemediationEvent.find({}).lean().cursor();
  const counts = {
    MANUAL: 0,
    SCHEDULER: 0,
    CERTIFICATION: 0,
    API: 0,
    unchanged: 0,
  };

  let scanned = 0;
  let updated = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const next = resolveQueueSource(doc);
    counts[next] = (counts[next] || 0) + 1;

    if (doc.queueSource === next) {
      counts.unchanged += 1;
      continue;
    }

    if (!dryRun) {
      await WorkflowRemediationEvent.updateOne({ _id: doc._id }, { $set: { queueSource: next } });
    }
    updated += 1;
  }

  console.log(dryRun ? "DRY RUN — no writes performed" : "Backfill complete");
  console.log(`Scanned: ${scanned}`);
  console.log(`Would update / updated: ${updated}`);
  console.log("Resolved counts by source:");
  for (const key of Object.values(WORKFLOW_REMEDIATION_QUEUE_SOURCES)) {
    console.log(`  ${key}: ${counts[key] || 0}`);
  }
  console.log(`  unchanged (already correct): ${counts.unchanged}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
