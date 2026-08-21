import mongoose from 'mongoose';

const schedulerConfigSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: false },
    enabled: { type: Boolean, default: false },
    scheduleType: { type: String, enum: ['MINUTE', 'HOUR', 'DAY'], default: 'MINUTE' },
    interval: { type: Number, default: 5 },
    lastRunAt: { type: Date, default: null },
    nextRunAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'scheduler_configs' },
);

export default mongoose.model('SchedulerConfig', schedulerConfigSchema);
