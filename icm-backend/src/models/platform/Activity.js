import mongoose from "mongoose";

const activitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    type: { type: String, required: true },
    description: { type: String },
    entityType: { type: String },
    entityId: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, collection: "activities" },
);

activitySchema.index({ userId: 1, createdAt: -1 });
activitySchema.index({ tenantId: 1, createdAt: -1 });
activitySchema.index({ entityType: 1, entityId: 1 });

export default mongoose.model("Activity", activitySchema);
