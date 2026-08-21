import mongoose from "mongoose";

const auditSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    userEmail: { type: String },
    action: { type: String, required: true },
    method: { type: String, enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
    path: { type: String },
    statusCode: { type: Number },
    ipAddress: { type: String },
    userAgent: { type: String },
    details: { type: mongoose.Schema.Types.Mixed },
    entityType: { type: String },
    entityId: { type: String },
  },
  { timestamps: true, collection: "audits" },
);

auditSchema.index({ userId: 1, createdAt: -1 });
auditSchema.index({ tenantId: 1, createdAt: -1 });
auditSchema.index({ action: 1 });
auditSchema.index({ createdAt: -1 });

export default mongoose.model("Audit", auditSchema);
