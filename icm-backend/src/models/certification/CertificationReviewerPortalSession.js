import mongoose from "mongoose";

/**
 * Tracks each reviewer's no-login portal access session per campaign.
 * One document per (campaignId, reviewerEmail) pair — upserted on token issuance and portal access.
 */
const certificationReviewerPortalSessionSchema = new mongoose.Schema(
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
    reviewerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    tokenIssuedAt: { type: Date },
    tokenExpiresAt: { type: Date, index: true },
    firstAccessedAt: { type: Date },
    lastActivityAt: { type: Date, index: true },
    /** All unique IPs that submitted decisions — used for multi-IP anomaly detection. */
    ipAddresses: [{ type: String }],
    userAgents: [{ type: String }],
    decisionsCount: { type: Number, default: 0 },
    sessionStatus: {
      type: String,
      enum: ["ACTIVE", "EXPIRED", "COMPLETED"],
      default: "ACTIVE",
      index: true,
    },
  },
  { timestamps: true, collection: "certification_reviewer_portal_sessions" },
);

/** One session document per reviewer per campaign. */
certificationReviewerPortalSessionSchema.index(
  { campaignId: 1, reviewerEmail: 1 },
  { unique: true },
);
certificationReviewerPortalSessionSchema.index({ tenantId: 1, tokenExpiresAt: 1 });

export default mongoose.model(
  "CertificationReviewerPortalSession",
  certificationReviewerPortalSessionSchema,
);
