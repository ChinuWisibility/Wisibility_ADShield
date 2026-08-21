import mongoose from "mongoose";

const schemaBuilderSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    fields: [
      {
        fieldName: { type: String },
        dataType: {
          type: String,
          enum: ["STRING", "NUMBER", "DATE", "BOOLEAN", "ARRAY"],
        },
        isRequired: { type: Boolean, default: false },
        defaultValue: { type: mongoose.Schema.Types.Mixed },
      },
    ],
    version: { type: Number, default: 1 },
  },
  { timestamps: true, collection: "schema_builders" },
);

export default mongoose.model("SchemaBuilder", schemaBuilderSchema);
