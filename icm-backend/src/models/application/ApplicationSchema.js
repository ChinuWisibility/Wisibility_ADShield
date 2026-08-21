import mongoose from "mongoose";

const applicationSchemaModel = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    schemaName: { type: String },
    columns: [
      { name: String, type: String, required: Boolean, isMapped: Boolean },
    ],
    version: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "application_schemas" },
);

applicationSchemaModel.index({ applicationId: 1, isActive: 1 });

export default mongoose.model("ApplicationSchema", applicationSchemaModel);
