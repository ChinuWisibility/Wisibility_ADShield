import mongoose from "mongoose";

const deprovisioningRecordSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", index: true },
    identityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Identity",
      required: true,
      index: true,
    },
    terminationDate: { type: Date, required: true, index: true },
    status: {
      type: String,
      index: true,
      enum: ["INITIATED", "IN_PROGRESS", "COMPLETED", "PARTIAL", "FAILED"],
      default: "INITIATED",
    },
    lifecycleEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LifecycleEvent",
      index: true,
    },
    provisioningRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProvisioningRequest",
      index: true,
    },
    jmlCorrelationId: { type: String, index: true },
    applicationsRevoked: [{ type: String }],
    applicationsFailed: [{ type: String }],
    completedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    verifiedAt: { type: Date },
    retentionDays: { type: Number },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "deprovisioning_records" },
);

deprovisioningRecordSchema.index(
  { tenantId: 1, identityId: 1, status: 1 },
  { background: true },
);

export default mongoose.model("DeprovisioningRecord", deprovisioningRecordSchema);
