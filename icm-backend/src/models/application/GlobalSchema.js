import mongoose from "mongoose";

const globalSchemaSchema = new mongoose.Schema(
  {
    fieldName: { type: String, required: true, unique: true },
    displayName: { type: String },
    dataType: { type: String },
    isRequired: { type: Boolean, default: false },
    category: { type: String, enum: ["IDENTITY", "ENTITLEMENT", "ACCOUNT"] },
    description: { type: String },
  },
  { timestamps: true, collection: "global_schemas" },
);

globalSchemaSchema.index({ category: 1 });

export default mongoose.model("GlobalSchema", globalSchemaSchema);
