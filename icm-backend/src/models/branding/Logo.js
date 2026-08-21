import mongoose from "mongoose";

const logoSchema = new mongoose.Schema(
  {
    logoType: {
      type: String,
      enum: ["PLATFORM", "APPLICATION", "FAVICON"],
      index: true,
    },
    fileName: { type: String },
    fileUrl: { type: String },
    mimeType: { type: String },
    data: { type: Buffer },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "logos" },
);

export default mongoose.model("Logo", logoSchema);
