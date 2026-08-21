import mongoose from "mongoose";

const itsmIntegrationSchema = new mongoose.Schema(
  {
    itsmType: {
      type: String,
      enum: ["SERVICENOW", "JIRA", "REMEDY"],
      index: true,
    },
    endpointUrl: { type: String },
    credentialsEncrypted: { type: mongoose.Schema.Types.Mixed },
    createTicketOnProvisioning: { type: Boolean, default: false },
    createTicketOnViolation: { type: Boolean, default: false },
    ticketTemplate: { type: mongoose.Schema.Types.Mixed },
    isActive: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, collection: "itsm_integrations" },
);

export default mongoose.model("ITSMIntegration", itsmIntegrationSchema);
