import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { retryFailedNotifications } from "../src/services/workflowTaskQueue/workflowTaskQueueService.js";

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || "IGA-V3" });

const task = await mongoose.connection.db.collection("workflow_task_queue").findOne({
  taskId: "f27e84e8-acf3-4d1e-8a08-e2a911a10efd",
});
console.log("before", task?.status, String(task?.failureReason || "").slice(0, 80));

// Fix Option 2 CompareStrings to check sent (live workflow copy)
if (task?.workflowId) {
  await mongoose.connection.db.collection("remediation_workflow_definitions").updateOne(
    { _id: new mongoose.Types.ObjectId(task.workflowId), "nodes.id": "emailSent" },
    { $set: { "nodes.$.config.left": "$.steps.emailUser.sent" } },
  );
  console.log("updated emailSent compare to $.steps.emailUser.sent");
}

try {
  const result = await retryFailedNotifications(
    "f27e84e8-acf3-4d1e-8a08-e2a911a10efd",
    task.tenantId,
    "system-retry",
  );
  console.log("retry result", JSON.stringify(result, null, 2));
} catch (err) {
  console.error("retry failed:", err.message);
}

const after = await mongoose.connection.db.collection("workflow_task_queue").findOne({
  taskId: "f27e84e8-acf3-4d1e-8a08-e2a911a10efd",
});
console.log("after", after?.status, after?.failureReason);

await mongoose.disconnect();
