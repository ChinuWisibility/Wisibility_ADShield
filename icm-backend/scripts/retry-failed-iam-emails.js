import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { deliverWorkflowEmailNow } from "../src/services/workflow/workflowEmailImmediateDelivery.js";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
await mongoose.connect(uri, { dbName: process.env.DB_NAME || "IGA-V3" });

const db = mongoose.connection.db;
const failed = await db
  .collection("email_jobs")
  .find({
    type: "WORKFLOW",
    status: "FAILED",
    subject: /IAM Review Required/,
  })
  .sort({ createdAt: -1 })
  .limit(3)
  .toArray();

console.log("retrying", failed.length, "failed jobs");
for (const j of failed) {
  await db.collection("email_jobs").updateOne(
    { _id: j._id },
    {
      $set: { status: "PENDING", lastError: null, nextRunAt: new Date() },
      $unset: { processingStartedAt: "" },
    },
  );
  const result = await deliverWorkflowEmailNow(j._id);
  console.log(String(j._id), (j.subject || "").slice(0, 50), "->", result);
}

await mongoose.disconnect();
