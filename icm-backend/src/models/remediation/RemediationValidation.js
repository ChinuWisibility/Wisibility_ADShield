import mongoose from "mongoose";

const remediationValidationSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    queueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationQueue",
      required: true,
      index: true,
    },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationTicket",
      required: true,
      index: true,
    },
    ticketItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationTicketItem",
      required: true,
      index: true,
    },
    validationMode: {
      type: String,
      enum: ["AUTO", "MANUAL", "HYBRID"],
      default: "AUTO",
    },
    validationOwnerEmail: { type: String },
    validationStatus: {
      type: String,
      enum: ["PENDING", "PASSED", "FAILED", "EXPIRED"],
      default: "PENDING",
      index: true,
    },
    validationStartDate: { type: Date, default: Date.now },
    validationDueDate: { type: Date, index: true },
    validationCompletedDate: { type: Date },
    autoValidationResult: { type: mongoose.Schema.Types.Mixed },
    comments: { type: String },
  },
  { timestamps: true, collection: "remediation_validations" },
);

remediationValidationSchema.index({ tenantId: 1, queueId: 1, ticketItemId: 1 });
remediationValidationSchema.index({ tenantId: 1, validationStatus: 1, validationDueDate: 1 });

export default mongoose.model("RemediationValidation", remediationValidationSchema);
