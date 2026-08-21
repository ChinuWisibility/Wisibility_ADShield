import mongoose from "mongoose";

/**
 * Per-application build marker for the inactive-with-access hygiene sidecar.
 */
const applicationUserInactiveAccessStateSchema = new mongoose.Schema(
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
  { timestamps: true, collection: "application_user_inactive_access_state" },
);

export default mongoose.model(
  "ApplicationUserInactiveAccessState",
  applicationUserInactiveAccessStateSchema,
);
