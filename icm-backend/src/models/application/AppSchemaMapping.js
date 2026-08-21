import mongoose from "mongoose";

const appSchemaMappingSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    applicationColumn: { type: String },
    globalField: { type: String },
    transformRule: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "app_schema_mappings" },
);

appSchemaMappingSchema.index({ applicationId: 1, globalField: 1 });

export default mongoose.model("AppSchemaMapping", appSchemaMappingSchema);
