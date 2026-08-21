import mongoose from "mongoose";

const sodExceptionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    violationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SodViolation",
      index: true,
    },
    exceptionReason: { type: String },
    approvedBy: { type: String },
    compensatingControl: { type: String },
    validFrom: { type: Date, index: true },
    validTo: { type: Date, index: true },
    exceptionStatus: {
      type: String,
      enum: ["ACTIVE", "EXPIRED", "REVOKED"],
      default: "ACTIVE",
      index: true,
    },
  },
  { timestamps: true, collection: "sod_exceptions" },
);

sodExceptionSchema.index({ tenantId: 1, validTo: 1 });
sodExceptionSchema.index({ violationId: 1, exceptionStatus: 1 });

export default mongoose.model("SodException", sodExceptionSchema);
