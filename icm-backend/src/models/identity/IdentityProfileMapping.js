import mongoose from "mongoose";

const identityProfileMappingSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    identityId: { type: String, index: true },
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IdentityProfile",
      index: true,
    },
    confidenceScore: { type: Number, min: 0, max: 100 },
    mappingType: { type: String, enum: ["AUTO", "MANUAL", "OVERRIDE"] },
    mappedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    mappedAt: { type: Date },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, collection: "identity_profile_mappings" },
);

identityProfileMappingSchema.index({ applicationId: 1, identityId: 1 });

export default mongoose.model(
  "IdentityProfileMapping",
  identityProfileMappingSchema,
);
