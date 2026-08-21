import mongoose from "mongoose";

const schemaMapSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    mappings: [
      {
        sourceField: { type: String },
        targetField: { type: String },
        transformRule: { type: String },
      },
    ],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "schema_maps" },
);

export default mongoose.model("SchemaMap", schemaMapSchema);
