import mongoose from "mongoose";

const remediationTicketResponseSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationTicket",
      required: true,
      index: true,
    },
    respondedBy: { type: String, required: true },
    respondedByEmail: { type: String, required: true },
    decision: {
      type: String,
      enum: ["GRANT_ACCESS", "PENDING"],
      required: true,
    },
    tentativeDate: { type: Date },
    comment: { type: String },
    itemIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "RemediationTicketItem" }],
    itemCount: { type: Number, default: 0 },
    respondedAt: { type: Date, default: Date.now, index: true },
    source: {
      type: String,
      enum: ["ITSM_PORTAL", "CONSOLE"],
      default: "ITSM_PORTAL",
    },
  },
  { timestamps: true, collection: "remediation_ticket_responses" },
);

remediationTicketResponseSchema.index({ tenantId: 1, ticketId: 1, respondedAt: -1 });

export default mongoose.model(
  "RemediationTicketResponse",
  remediationTicketResponseSchema,
);
