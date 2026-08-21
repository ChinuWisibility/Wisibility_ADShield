import mongoose from "mongoose";

const siemConfigSchema = new mongoose.Schema(
  {
    siemType: {
      type: String,
      enum: ["SPLUNK", "QRADAR", "SENTINEL", "ELASTIC"],
      index: true,
    },
    endpointUrl: { type: String },
    apiKeyEncrypted: { type: String },
    eventTypes: [String],
    isActive: { type: Boolean, default: false, index: true },
    lastSentAt: { type: Date },
  },
  { timestamps: true, collection: "siem_configs" },
);

export default mongoose.model("SIEMConfig", siemConfigSchema);
