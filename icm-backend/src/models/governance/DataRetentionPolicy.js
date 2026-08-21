import mongoose from "mongoose";

const dataRetentionPolicySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    collectionName: { type: String, required: true, index: true },
    retentionDays: { type: Number },
    archiveBeforeDelete: { type: Boolean, default: false },
    archiveLocation: { type: String },
    regulatoryBasis: { type: String },
    lastPurgeAt: { type: Date },
    nextPurgeAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "data_retention_policies" },
);

export default mongoose.model("DataRetentionPolicy", dataRetentionPolicySchema);
