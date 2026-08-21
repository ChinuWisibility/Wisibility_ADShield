import mongoose from "mongoose";

const userPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    timezone: { type: String },
    language: {
      type: String,
      enum: ["en", "es", "de", "fr", "ja"],
      default: "en",
    },
    dateFormat: { type: String },
    notificationEmail: { type: Boolean, default: true },
    notificationInApp: { type: Boolean, default: true },
    /** AD Security Posture Dashboard layout — persisted per user. */
    securityDashboard: {
      hideZeroMetrics: { type: Boolean, default: false },
      hiddenTiles: { type: [String], default: [] },
    },
  },
  { timestamps: true, collection: "user_preferences" },
);

export default mongoose.model("UserPreference", userPreferenceSchema);
