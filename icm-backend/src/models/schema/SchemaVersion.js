import mongoose from "mongoose";

const schemaVersionSchema = new mongoose.Schema(
  {
    collectionName: { type: String, index: true },
    version: { type: Number, default: 1, index: true },
    changes: [
      {
        field: { type: String },
        action: { type: String, enum: ["ADD", "REMOVE", "MODIFY"] },
        details: { type: String },
      },
    ],
    migratedAt: { type: Date, default: Date.now },
    migratedBy: { type: String },
    rollbackScript: { type: String },
  },
  { timestamps: true, collection: "schema_versions" },
);

schemaVersionSchema.index({ collectionName: 1, version: 1 }, { unique: true });

export default mongoose.model("SchemaVersion", schemaVersionSchema);
