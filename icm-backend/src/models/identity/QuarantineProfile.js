import mongoose from "mongoose";

const quarantineProfileSchema = new mongoose.Schema(
  {
    identityId: { type: String, index: true },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    reason: { type: String },
    quarantinedAt: { type: Date, default: Date.now },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolution: { type: String, enum: ["CLEARED", "TERMINATED", "ESCALATED"] },
    resolvedAt: { type: Date },
  },
  { timestamps: true, collection: "quarantine_profiles" },
);

quarantineProfileSchema.index({ identityId: 1, applicationId: 1 });

export default mongoose.model("QuarantineProfile", quarantineProfileSchema);
