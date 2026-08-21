import mongoose from "mongoose";

const applicationIconSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    /** Stable key for built-in pack (unique per tenant). */
    key: { type: String, trim: true, lowercase: true, default: null },
    source: {
      type: String,
      enum: ["builtin", "upload"],
      required: true,
    },
    mimeType: { type: String, required: true },
    data: { type: Buffer, required: true },
    color: { type: String, default: null },
  },
  { timestamps: true, collection: "application_icons" },
);

applicationIconSchema.index(
  { tenantId: 1, key: 1 },
  {
    unique: true,
    partialFilterExpression: { key: { $type: "string" } },
  },
);

applicationIconSchema.index({ tenantId: 1, source: 1, createdAt: -1 });

export default mongoose.model("ApplicationIcon", applicationIconSchema);
