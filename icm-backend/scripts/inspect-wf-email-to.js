import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME || "IGA-V3" });
const db = mongoose.connection.db;
const wf = await db.collection("remediation_workflow_definitions").findOne({
  _id: new mongoose.Types.ObjectId("6a3f82184f82436579627956"),
});
const send = (wf?.nodes || []).find((n) => n.type === "SendEmail" || n.id === "sendEmail");
console.log("name", wf?.name);
console.log("send", JSON.stringify(send, null, 2));
await mongoose.disconnect();
