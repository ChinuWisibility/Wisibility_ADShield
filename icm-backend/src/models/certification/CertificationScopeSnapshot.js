import mongoose from "mongoose";

const certificationScopeSnapshotSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true,
    },
    reviewItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReviewItem",
      required: true,
      index: true,
    },
    userSnapshot: {
      userId: { type: String },
      userName: { type: String },
      userEmail: { type: String },
      title: { type: String },
      department: { type: String },
      managerName: { type: String },
      managerEmail: { type: String },
    },
    accessSnapshot: {
      entitlementName: { type: String },
      applicationName: { type: String },
      isPrivileged: { type: Boolean, default: false },
      grantedAt: { type: Date },
    },
    capturedAt: { type: Date, default: Date.now, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "certification_scope_snapshots" },
);

certificationScopeSnapshotSchema.index(
  { campaignId: 1, reviewItemId: 1, "accessSnapshot.entitlementName": 1 },
  { unique: true },
);
certificationScopeSnapshotSchema.index({ campaignId: 1, capturedAt: 1 });

export default mongoose.model(
  "CertificationScopeSnapshot",
  certificationScopeSnapshotSchema,
);
