import mongoose from "mongoose";

const riskMatrixSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    matrixName: { type: String, required: true, index: true },
    dimensions: [{ type: mongoose.Schema.Types.Mixed }],
    thresholds: { type: mongoose.Schema.Types.Mixed },
    isDefault: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "risk_matrices" },
);

export default mongoose.model("RiskMatrix", riskMatrixSchema);
