import mongoose from "mongoose";

/** Atomic per-tenant sequence used to mint human-readable ticket ids (TKT-000001). */
const ticketCounterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { collection: "workflow_ticket_counters" },
);

export default mongoose.model("WorkflowTicketCounter", ticketCounterSchema);
