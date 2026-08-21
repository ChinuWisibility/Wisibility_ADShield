import mongoose from "mongoose";

/**
 * Multi-hop escalation/delegation chain.
 * Each reassignment = one document. hopNumber allows full chain reconstruction.
 * CertificationEscalation captures the event; this table captures the full chain history.
 */
const certificationEscalationChainSchema = new mongoose.Schema(
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
    escalationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CertificationEscalation",
      index: true,
    },
    /** 1-based hop counter within a campaign — allows ordering the full chain. */
    hopNumber: { type: Number, required: true, default: 1 },
    fromReviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      sparse: true,
      index: true,
    },
    fromReviewerEmail: { type: String, required: true, index: true },
    toReviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      sparse: true,
      index: true,
    },
    toReviewerEmail: { type: String, required: true, index: true },
    reason: {
      type: String,
      enum: ["NO_RESPONSE", "UNAVAILABLE", "CONFLICT"],
    },
    escalatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    escalatedByEmail: { type: String },
    escalatedAt: { type: Date, required: true, default: Date.now, index: true },
    /** ReviewItem ObjectIds whose ownership was transferred in this hop. */
    itemsTransferred: [{ type: mongoose.Schema.Types.ObjectId }],
  },
  { timestamps: true, collection: "certification_escalation_chain" },
);

certificationEscalationChainSchema.index({ campaignId: 1, hopNumber: 1 });
certificationEscalationChainSchema.index({ campaignId: 1, escalatedAt: -1 });

export default mongoose.model(
  "CertificationEscalationChain",
  certificationEscalationChainSchema,
);
