import mongoose from "mongoose";

const unifiedAuditEventSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
      enum: [
        "IDENTITY_CHANGE",
        "ACCESS_CHANGE",
        "POLICY_CHANGE",
        "CERT_DECISION",
        "PROV_COMPLETE",
      ],
    },
    entityType: {
      type: String,
      index: true,
      enum: [
        "IDENTITY",
        "APPLICATION",
        "ENTITLEMENT",
        "ROLE",
        "SOD",
        "CERT",
        "PROVISIONING",
      ],
    },
    entityId: { type: String, index: true },
    action: { type: String, index: true },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    performedByEmail: { type: String },
    performedAt: { type: Date, index: true },
    ipAddress: { type: String },
    oldValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
    sourceDomain: {
      type: String,
      index: true,
      enum: ["PLATFORM", "IDENTITY", "SOD", "CERT", "PROVISIONING"],
    },
    correlationId: { type: String, index: true },
    tags: [{ type: String }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "unified_audit_events" },
);

export default mongoose.model("UnifiedAuditEvent", unifiedAuditEventSchema);
