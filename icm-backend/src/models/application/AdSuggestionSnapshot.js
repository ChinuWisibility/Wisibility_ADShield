import mongoose from "mongoose";

const adGroupSuggestionSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    dn: { type: String, default: "" },
    memberCount: { type: Number, default: 0 },
  },
  { _id: false },
);

const adAppSuggestionSchema = new mongoose.Schema(
  {
    appName: { type: String, required: true },
    groupCount: { type: Number, default: 0 },
    userCount: { type: Number, default: 0 },
    groups: { type: [adGroupSuggestionSchema], default: [] },
    sampleEntitlements: { type: [mongoose.Schema.Types.Mixed], default: [] },
    suggestionSource: {
      type: String,
      enum: ["custom", "prefix", "hybrid"],
      default: "prefix",
    },
    ruleOrder: { type: Number, default: null },
  },
  { _id: false },
);

const adSuggestionSnapshotSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    sourceApplicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    generatedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["refreshing", "ready", "failed"],
      default: "refreshing",
      index: true,
    },
    refreshError: { type: String, default: "" },
    totalGroups: { type: Number, default: 0 },
    totalSuggestions: { type: Number, default: 0 },
    suggestions: { type: [adAppSuggestionSchema], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: "ad_suggestion_snapshots" },
);

adSuggestionSnapshotSchema.index(
  { tenantId: 1, sourceApplicationId: 1 },
  { unique: true },
);

export default mongoose.model(
  "AdSuggestionSnapshot",
  adSuggestionSnapshotSchema,
);
