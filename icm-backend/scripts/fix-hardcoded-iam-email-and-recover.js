import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { recoverRemediationAfterEmailDelivered } from "../src/services/workflow/recoverRemediationAfterEmailDelivered.js";

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || "IGA-V3" });
const db = mongoose.connection.db;

// 1) Un-hardcode workflow Send Email "to" → live IAM_TEAM_EMAIL binding
const wfId = new mongoose.Types.ObjectId("6a3f82184f82436579627956");
const wf = await db.collection("remediation_workflow_definitions").findOne({ _id: wfId });
const send = (wf?.nodes || []).find((n) => n.id === "sendEmail" || n.type === "SendEmail");
console.log("before to=", send?.config?.to);

await db.collection("remediation_workflow_definitions").updateOne(
  { _id: wfId, "nodes.id": "sendEmail" },
  { $set: { "nodes.$.config.to": "$.config.iamTeamEmail" } },
);

const wf2 = await db.collection("remediation_workflow_definitions").findOne({ _id: wfId });
const send2 = (wf2?.nodes || []).find((n) => n.id === "sendEmail");
console.log("after to=", send2?.config?.to);

// 2) Recover contractor.temp01 (and any FAILED + SENT IAM orphans)
const failed = await db
  .collection("workflow_task_queue")
  .find({ action: "IAM_ORPHAN_REVIEW", status: "FAILED" })
  .toArray();

for (const task of failed) {
  const result = await recoverRemediationAfterEmailDelivered({ task });
  console.log(task.taskName, "->", result);
}

await mongoose.disconnect();
