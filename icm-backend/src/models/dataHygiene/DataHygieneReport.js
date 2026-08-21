import mongoose from 'mongoose';

const dataHygieneReportSchema = new mongoose.Schema(
  {
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', index: true },
    uploadHistoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'UploadHistory', index: true },
    totalRecords: { type: Number },
    duplicates: { type: Number },
    missingRequiredFields: { type: Number },
    qualityScore: { type: Number },
    recommendations: [{ type: mongoose.Schema.Types.Mixed }],
    generatedAt: { type: Date, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'data_hygiene_reports' }
);

export default mongoose.model('DataHygieneReport', dataHygieneReportSchema);

