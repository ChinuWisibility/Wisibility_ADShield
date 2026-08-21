import mongoose from "mongoose";

const sodAuditLogSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    entityType: {
      type: String,
      enum: ["POLICY", "RULE", "VIOLATION", "EXCEPTION", "REMEDIATION"],
      index: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },
    action: {
      type: String,
      enum: ["CREATE", "UPDATE", "DELETE", "ARCHIVE", "APPROVE"],
      index: true,
    },
    performedBy: { type: String },
    performedAt: { type: Date, default: Date.now, index: true },
    oldValue: { type: String },
    newValue: { type: String },
  },
  { timestamps: true, collection: "sod_audit_logs" },
);

sodAuditLogSchema.index({ tenantId: 1, performedAt: -1 });
sodAuditLogSchema.index({ entityType: 1, entityId: 1 });

export default mongoose.model("SodAuditLog", sodAuditLogSchema);
