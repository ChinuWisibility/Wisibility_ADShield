import mongoose from 'mongoose';

const schedulerExecutionLogSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: false, index: true },
    executionTime: { type: Date, default: Date.now, index: true },
    triggerType: { type: String, enum: ['SCHEDULED', 'MANUAL'], default: 'MANUAL' },
    durationMs: { type: Number, default: 0 },
    recordsFound: { type: Number, default: 0 },
    recordsUpdated: { type: Number, default: 0 },
    recordsNewCaptured: { type: Number, default: 0 },
    recordsMovedToInProgress: { type: Number, default: 0 },
    backlogBefore: { type: Number, default: 0 },
    backlogAfter: { type: Number, default: 0 },
    status: { type: String, enum: ['SUCCESS', 'FAILED', 'SKIPPED'], default: 'SUCCESS' },
    message: { type: String },
  },
  { timestamps: true, collection: 'scheduler_execution_logs' },
);

export default mongoose.model('SchedulerExecutionLog', schedulerExecutionLogSchema);
