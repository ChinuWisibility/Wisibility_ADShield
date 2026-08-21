import mongoose from "mongoose";

const certificationReviewerAssignmentSchema = new mongoose.Schema(
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

    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      sparse: true,
      index: true,
    },
    reviewerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    reviewerName: { type: String },
    reviewerType: {
      type: String,
      enum: ["MANAGER", "EXTERNAL", "IDENTITY_ADMIN"],
    },
    reviewerSource: {
      type: String,
      enum: ["MANAGER", "BACKUP_MANAGER", "EXTERNAL", "INTERNAL"],
    },

    assignedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      name: { type: String },
      email: { type: String },
    },
    assignedAt: { type: Date, default: Date.now },

    assignedUsersCount: { type: Number, default: 0 },
    assignedItemsCount: { type: Number, default: 0 },
    approvedCount: { type: Number, default: 0 },
    revokedCount: { type: Number, default: 0 },
    pendingCount: { type: Number, default: 0 },
    completionPercentage: { type: Number, default: 0 },

    lastActionAt: { type: Date },
    completedAt: { type: Date },

    assignmentStatus: {
      type: String,
      enum: ["ACTIVE", "OVERDUE", "COMPLETED", "ESCALATED"],
      default: "ACTIVE",
      index: true,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    collection: "access_certification_reviewer_assignments",
  },
);

certificationReviewerAssignmentSchema.index(
  { campaignId: 1, reviewerEmail: 1 },
  { unique: true },
);
certificationReviewerAssignmentSchema.index({
  campaignId: 1,
  assignmentStatus: 1,
});
certificationReviewerAssignmentSchema.index({
  tenantId: 1,
  assignedAt: -1,
});

export default mongoose.model(
  "CertificationReviewerAssignment",
  certificationReviewerAssignmentSchema,
);
