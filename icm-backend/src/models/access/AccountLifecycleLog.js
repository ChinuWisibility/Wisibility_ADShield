import mongoose from "mongoose";

const accountLifecycleLogSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountAggregation",
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    action: {
      type: String,
      enum: ["ENABLE", "DISABLE", "DELETE", "RESET_PASSWORD", "LOCK", "UNLOCK"],
      index: true,
    },
    previousStatus: { type: String },
    newStatus: { type: String },
    triggeredBy: {
      type: String,
      enum: ["SYSTEM", "PROVISIONING", "MANUAL", "CERTIFICATION"],
    },
    triggeredByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    provisioningRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProvisioningRequest",
    },
    certificationId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign" },
    actionAt: { type: Date, index: true },
    success: { type: Boolean },
    errorMessage: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "account_lifecycle_logs" },
);

export default mongoose.model("AccountLifecycleLog", accountLifecycleLogSchema);
