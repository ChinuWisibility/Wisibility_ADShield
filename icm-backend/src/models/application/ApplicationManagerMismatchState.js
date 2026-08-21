import mongoose from "mongoose";

/**
 * Per-application build marker for the manager-mismatch hygiene sidecar.
 */
const applicationManagerMismatchStateSchema = new mongoose.Schema(
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
  { timestamps: true, collection: "application_manager_mismatch_state" },
);

export default mongoose.model(
  "ApplicationManagerMismatchState",
  applicationManagerMismatchStateSchema,
);
