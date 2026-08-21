import mongoose from 'mongoose';

const auditExportJobSchema = new mongoose.Schema(
  {
    exportType: { type: String, index: true, enum: ['FULL', 'DELTA', 'DOMAIN_FILTERED'] },
    domain: { type: String, index: true, enum: ['SOD', 'CERT', 'PROV', 'IDENTITY', 'ALL'] },
    fromDate: { type: Date },
    toDate: { type: Date },
    format: { type: String, enum: ['JSON', 'CSV', 'SYSLOG'] },
    status: { type: String, index: true, enum: ['QUEUED', 'RUNNING', 'DONE', 'FAILED'], default: 'QUEUED' },
    fileLocation: { type: String },
    rowCount: { type: Number },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'audit_export_jobs' }
);

export default mongoose.model('AuditExportJob', auditExportJobSchema);

