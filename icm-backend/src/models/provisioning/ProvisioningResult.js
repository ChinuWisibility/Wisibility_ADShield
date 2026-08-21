import mongoose from 'mongoose';

const provisioningResultSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProvisioningTask', required: true, index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', index: true },
    statusCode: { type: Number },
    responseBody: { type: mongoose.Schema.Types.Mixed },
    jmlCorrelationId: { type: String, index: true },
    executedAt: { type: Date, index: true, default: Date.now },
    durationMs: { type: Number },
    isSuccess: { type: Boolean, index: true, default: false },
    rollbackRequired: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'provisioning_results' }
);

export default mongoose.model('ProvisioningResult', provisioningResultSchema);
