import mongoose from "mongoose";

const certificationEscalationSchema = new mongoose.Schema(
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
    originalReviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    originalReviewerEmail: { type: String },
    escalatedToId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    escalatedToEmail: { type: String },
    /** The admin/system user who triggered the escalation. */
    escalatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    escalatedByEmail: { type: String },
    escalationReason: {
      type: String,
      enum: ["NO_RESPONSE", "UNAVAILABLE", "CONFLICT"],
    },
    escalatedAt: { type: Date, index: true },
    resolvedAt: { type: Date },
    pendingItems: { type: Number },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "certification_escalations" },
);

export default mongoose.model(
  "CertificationEscalation",
  certificationEscalationSchema,
);
