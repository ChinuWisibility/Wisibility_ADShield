import mongoose from "mongoose";

const certificationSignOffSchema = new mongoose.Schema(
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
    reportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CertificationReport",
    },
    signerName: { type: String },
    signerTitle: { type: String },
    signerEmail: { type: String },
    signatureHash: { type: String },
    ipAddress: { type: String },
    signedAt: { type: Date, index: true },
    comments: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "certification_signoffs" },
);

export default mongoose.model(
  "CertificationSignOff",
  certificationSignOffSchema,
);
