import mongoose from "mongoose";

/**
 * Immutable snapshot of a CertificationProfile's defaults taken at campaign creation.
 * Allows retrospective audits to reconstruct "what scope/rules were in effect when certified."
 * Never mutated after creation.
 */
const certificationProfileSnapshotSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    /** One snapshot per campaign — unique constraint enforces immutability. */
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      unique: true,
      index: true,
    },
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CertificationProfile",
      index: true,
    },
    snapshotAt: { type: Date, required: true, default: Date.now },
    category: { type: String },
    /** Full profile document (toObject()) at the moment the campaign was created. */
    snapshotData: { type: mongoose.Schema.Types.Mixed },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "certification_profile_snapshots" },
);

export default mongoose.model(
  "CertificationProfileSnapshot",
  certificationProfileSnapshotSchema,
);
