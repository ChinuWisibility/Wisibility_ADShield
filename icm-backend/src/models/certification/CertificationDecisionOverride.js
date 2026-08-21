import mongoose from "mongoose";

/**
 * Audit trail for admin decision overrides.
 * overrideDecision() previously overwrote ReviewItem in-place with no history.
 * This table captures the before/after state and who/why/when for every override.
 */
const certificationDecisionOverrideSchema = new mongoose.Schema(
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
    previousDecision: { type: String, required: true },
    newDecision: { type: String, required: true },
    overriddenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    overriddenByEmail: { type: String },
    overrideReason: { type: String, required: true },
    ipAddress: { type: String },
    userAgent: { type: String },
    overriddenAt: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true, collection: "certification_decision_overrides" },
);

certificationDecisionOverrideSchema.index({ campaignId: 1, overriddenAt: -1 });
certificationDecisionOverrideSchema.index({ reviewItemId: 1, overriddenAt: -1 });

export default mongoose.model(
  "CertificationDecisionOverride",
  certificationDecisionOverrideSchema,
);
