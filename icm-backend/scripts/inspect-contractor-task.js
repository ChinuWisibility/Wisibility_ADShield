import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || "IGA-V3" });
const db = mongoose.connection.db;

const task = await db.collection("workflow_task_queue").findOne({
  taskId: "3e703833-10b6-455f-8e1e-a50aa87dc1b1",
});
console.log(
  "task",
  JSON.stringify(
    {
      status: task?.status,
      executionId: task?.executionId,
      failureReason: String(task?.failureReason || "").slice(0, 160),
      orphanId: task?.orphanId,
      workflowId: task?.workflowId,
    },
    null,
    2,
  ),
);

const job = await db.collection("email_jobs").findOne({
  type: "WORKFLOW",
  "metadata.executionId": task?.executionId,
});
console.log(
  "email",
  JSON.stringify({ status: job?.status, to: job?.recipientEmail, sentAt: job?.sentAt }),
);

const cols = (await db.listCollections().toArray()).map((c) => c.name).filter((n) => /flow/i.test(n));
console.log("flowCollections", cols);

for (const name of cols) {
  const wf = await db.collection(name).findOne({
    $or: [{ id: task?.workflowId }, { workflowId: task?.workflowId }],
  });
  if (!wf) continue;
  const nodes = wf.nodes || wf.definition?.nodes || [];
  const send = nodes.find((n) => n.type === "SendEmail");
  console.log("foundIn", name, "send.to=", send?.config?.to, "label=", send?.label);
}

await mongoose.disconnect();
