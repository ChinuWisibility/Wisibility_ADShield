import mongoose from "mongoose";

/**
 * Snapshot of duplicate application-user rows per primary key (one document per PK group with 2+ ingested rows).
 * Rebuilt on each full user refresh; not linked to live user Mongo _ids.
 */
const applicationUserDuplicateSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    primaryKeyField: { type: String, required: true },
    primaryKeyValue: { type: String, required: true },
    primaryKeyNormalized: { type: String, required: true, index: true },
    canonicalization: {
      type: String,
      enum: ["first_row_wins"],
      default: "first_row_wins",
    },
    canonicalRow: { type: mongoose.Schema.Types.Mixed, required: true },
    rows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    duplicateCount: { type: Number, required: true, min: 0 },
    observedAt: { type: Date, required: true, index: true },
    source: { type: String, required: true },
  },
  { timestamps: true, collection: "application_user_duplicates" },
);

applicationUserDuplicateSchema.index(
  { applicationId: 1, primaryKeyNormalized: 1 },
  { unique: true },
);

export default mongoose.model(
  "ApplicationUserDuplicate",
  applicationUserDuplicateSchema,
);
