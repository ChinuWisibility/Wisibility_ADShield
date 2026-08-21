import mongoose from "mongoose";

const remediationAuditLogSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    remediationEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationEvent",
      index: true,
    },
    action: {
      type: String,
      enum: [
        "CREATE",
        "UPDATE",
        "STATUS_CHANGE",
        "TICKET_UPDATE",
        "NOTIFY",
        "RECORD_UPDATE",
      ],
      index: true,
    },
    performedBy: { type: String },
    performedAt: { type: Date, default: Date.now, index: true },
    oldValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
    note: { type: String },
  },
  { timestamps: true, collection: "remediation_audit" },
);

remediationAuditLogSchema.index({ tenantId: 1, remediationEventId: 1, performedAt: -1 });

export default mongoose.model("RemediationAuditLog", remediationAuditLogSchema);
