import mongoose from "mongoose";

/** Immutable, append-only audit log. One document per reviewer action. Never overwritten. */
const certificationReviewerActionLogSchema = new mongoose.Schema(
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
    /** Null for external / email-only reviewers not in the User table. */
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      sparse: true,
    },
    reviewerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    reviewerName: { type: String },
    action: {
      type: String,
      enum: ["APPROVED", "REVOKED", "DELEGATED", "EXCEPTION", "OVERRIDE"],
      required: true,
      index: true,
    },
    /** Previous decision value — null on the first decision for an item. */
    previousDecision: { type: String, default: null },
    newDecision: { type: String, required: true },
    comment: { type: String },
    decisionSource: {
      type: String,
      enum: ["CONSOLE", "EMAIL_LINK", "PORTAL", "SYSTEM"],
      index: true,
    },
    ipAddress: { type: String, index: true },
    userAgent: { type: String },
    sessionId: { type: String },
    actedAt: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true, collection: "certification_reviewer_action_logs" },
);

certificationReviewerActionLogSchema.index({ campaignId: 1, actedAt: -1 });
certificationReviewerActionLogSchema.index({ reviewerEmail: 1, actedAt: -1 });
certificationReviewerActionLogSchema.index({ reviewItemId: 1, actedAt: -1 });
certificationReviewerActionLogSchema.index({ tenantId: 1, actedAt: -1 });

export default mongoose.model(
  "CertificationReviewerActionLog",
  certificationReviewerActionLogSchema,
);
