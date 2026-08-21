import mongoose from 'mongoose';

const uploadHistorySchema = new mongoose.Schema(
  {
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number },
    uploadType: { type: String, enum: ['users', 'entitlements', 'accounts'], default: 'users' },
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'partial'], default: 'pending' },
    totalRows: { type: Number, default: 0 },
    processedRows: { type: Number, default: 0 },
    failedRows: { type: Number, default: 0 },
    errorDetails: [{ row: Number, field: String, message: String }],
    columnMappings: { type: mongoose.Schema.Types.Mixed },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    completedAt: { type: Date },
  },
  { timestamps: true, collection: 'upload_histories' }
);

uploadHistorySchema.index({ applicationId: 1, createdAt: -1 });

export default mongoose.model('UploadHistory', uploadHistorySchema);
