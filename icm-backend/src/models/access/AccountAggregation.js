import mongoose from "mongoose";

const accountAggregationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    nativeAccountId: { type: String, index: true },
    accountName: { type: String, index: true },
    accountType: {
      type: String,
      enum: ["USER", "SERVICE", "SHARED", "PRIVILEGED"],
      index: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "DISABLED", "LOCKED", "EXPIRED"],
      index: true,
    },
    rawAttributes: { type: mongoose.Schema.Types.Mixed },
    lastLoginAt: { type: Date, index: true },
    passwordLastChangedAt: { type: Date },
    isPrivileged: { type: Boolean, index: true, default: false },
    isNHI: { type: Boolean, index: true, default: false },
    correlatedIdentityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Identity",
      index: true,
    },
    isOrphan: { type: Boolean, index: true, default: false },
    /** True when this account's application-schema PK was part of a duplicate group on last ingest (no auto-correlation). */
    ambiguousDuplicateApplicationPk: { type: Boolean, index: true, default: false },
    aggregationBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UploadHistory",
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "account_aggregations_v2" },
);

accountAggregationSchema.index({ applicationId: 1, nativeAccountId: 1 });
accountAggregationSchema.index({ applicationId: 1, accountName: 1 });
accountAggregationSchema.index({ tenantId: 1, applicationId: 1 });

export default mongoose.model("AccountAggregation", accountAggregationSchema);
