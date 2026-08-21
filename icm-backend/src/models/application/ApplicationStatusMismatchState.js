import mongoose from "mongoose";

/**
 * Per-application build marker for the status-mismatch hygiene sidecar.
 */
const applicationStatusMismatchStateSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      unique: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    predicateVersion: { type: Number, required: true },
    builtAt: { type: Date, required: true },
    hitCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "application_status_mismatch_state" },
);

export default mongoose.model(
  "ApplicationStatusMismatchState",
  applicationStatusMismatchStateSchema,
);
