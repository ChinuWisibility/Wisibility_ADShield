import SchedulerJob from '../../models/scheduler/SchedulerJob.js';
import DistributedLock from '../../models/scheduler/DistributedLock.js';

// ─── List Jobs ────────────────────────────────────────────────────────────────
export async function listJobs(req, res) {
  try {
    const { page = 1, limit = 50, search, jobType, isEnabled } = req.query;
    const query = {};
    if (search) query.jobName = new RegExp(search, 'i');
    if (jobType) query.jobType = jobType;
    if (isEnabled !== undefined) query.isEnabled = isEnabled === 'true';

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      SchedulerJob.find(query).sort({ jobName: 1 }).skip(skip).limit(Number(limit)),
      SchedulerJob.countDocuments(query),
    ]);
    return res.json({ success: true, data: { items, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get Single Job ────────────────────────────────────────────────────────────
export async function getJob(req, res) {
  try {
    const job = await SchedulerJob.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    return res.json({ success: true, data: job });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Create Job ────────────────────────────────────────────────────────────────
export async function createJob(req, res) {
  try {
    const { jobName, jobType, cronExpression, config } = req.body;
    if (!jobName || !cronExpression) {
      return res.status(400).json({ success: false, message: 'jobName and cronExpression are required' });
    }
    const job = await SchedulerJob.create({ jobName, jobType, cronExpression, config, isEnabled: true });
    return res.status(201).json({ success: true, data: job });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Job with this name already exists' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Update Job ────────────────────────────────────────────────────────────────
export async function updateJob(req, res) {
  try {
    const allowed = ['cronExpression', 'config', 'jobType'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const job = await SchedulerJob.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    return res.json({ success: true, data: job });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Enable Job ────────────────────────────────────────────────────────────────
export async function enableJob(req, res) {
  try {
    const job = await SchedulerJob.findByIdAndUpdate(req.params.id, { isEnabled: true }, { new: true });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    return res.json({ success: true, data: job });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Disable Job ───────────────────────────────────────────────────────────────
export async function disableJob(req, res) {
  try {
    const job = await SchedulerJob.findByIdAndUpdate(req.params.id, { isEnabled: false }, { new: true });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    return res.json({ success: true, data: job });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Trigger Job Now ──────────────────────────────────────────────────────────
export async function triggerJob(req, res) {
  try {
    const job = await SchedulerJob.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    // Mark as running immediately (actual execution handled by scheduler)
    job.lastRunAt = new Date();
    job.lastRunStatus = 'RUNNING';
    job.runCount = (job.runCount || 0) + 1;
    await job.save();

    return res.json({ success: true, data: { message: `Job '${job.jobName}' triggered`, job } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Health ────────────────────────────────────────────────────────────────────
export async function jobHealth(req, res) {
  try {
    const now = new Date();
    const stuckThreshold = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour

    const [total, enabled, failed, stuck, overdue] = await Promise.all([
      SchedulerJob.countDocuments(),
      SchedulerJob.countDocuments({ isEnabled: true }),
      SchedulerJob.countDocuments({ lastRunStatus: 'FAILURE' }),
      SchedulerJob.countDocuments({ lastRunStatus: 'RUNNING', lastRunAt: { $lt: stuckThreshold } }),
      SchedulerJob.countDocuments({ isEnabled: true, nextRunAt: { $lt: now } }),
    ]);

    const failedJobs = await SchedulerJob.find({ lastRunStatus: 'FAILURE' })
      .select('jobName jobType lastRunAt failureCount')
      .sort({ failureCount: -1 })
      .limit(10)
      .lean();

    return res.json({
      success: true,
      data: { total, enabled, failed, stuck, overdue, failedJobs },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── List Locks ────────────────────────────────────────────────────────────────
export async function listLocks(req, res) {
  try {
    const locks = await DistributedLock.find({}).sort({ lockedAt: -1 }).lean();
    return res.json({ success: true, data: { items: locks, total: locks.length } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get Lock Status ───────────────────────────────────────────────────────────
export async function getLockStatus(req, res) {
  try {
    const lock = await DistributedLock.findById(req.params.key).lean();
    if (!lock) return res.json({ success: true, data: { held: false, key: req.params.key } });
    return res.json({ success: true, data: { held: true, lock } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Force Release Lock ────────────────────────────────────────────────────────
export async function releaseLock(req, res) {
  try {
    const result = await DistributedLock.findByIdAndDelete(req.params.key);
    if (!result) return res.status(404).json({ success: false, message: 'Lock not found or already released' });
    return res.json({ success: true, data: { message: `Lock '${req.params.key}' released` } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
