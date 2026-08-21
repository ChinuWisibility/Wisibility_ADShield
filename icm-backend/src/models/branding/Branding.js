import mongoose from "mongoose";

const brandingSchema = new mongoose.Schema(
  {
    companyName: { type: String },
    primaryColor: { type: String },
    secondaryColor: { type: String },
    logoId: { type: mongoose.Schema.Types.ObjectId, ref: "Logo" },
    faviconId: { type: mongoose.Schema.Types.ObjectId, ref: "Logo" },
    customCss: { type: String },
  },
  { timestamps: true, collection: "brandings" },
);

export default mongoose.model("Branding", brandingSchema);
