import mongoose from "mongoose";

const transformSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    transformJson: { type: mongoose.Schema.Types.Mixed, required: true },
    linkedAppId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      default: null,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "transforms" },
);

transformSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export default mongoose.model("Transform", transformSchema);
