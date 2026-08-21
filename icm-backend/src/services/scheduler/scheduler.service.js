import mongoose from 'mongoose';
import SchedulerConfig from '../../models/scheduler/SchedulerConfig.js';
import SchedulerExecutionLog from '../../models/scheduler/SchedulerExecutionLog.js';
import DistributedLock from '../../models/scheduler/DistributedLock.js';
import WorkflowTaskQueue from '../../models/workflowTaskQueue/WorkflowTaskQueue.js';
import { WORKFLOW_TASK_STATUS } from '../../constants/workflowTaskQueue.js';
import { runTenantWorkflowTaskQueue } from '../workflowTaskQueue/workflowTaskQueueService.js';
import { normalizeTenantId, tenantMatchFilter, isValidTenantId } from '../../utils/tenantScope.js';

function tenantRecordFilter(orgId) {
  return tenantMatchFilter(orgId, 'tenantId');
}

function newRecordsFilter(orgId) {
  return { ...tenantRecordFilter(orgId), status: WORKFLOW_TASK_STATUS.NEW };
}

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function computeNextRunAt(from, scheduleType, interval) {
  const d = new Date(from || Date.now());
  const n = Math.max(Number(interval) || 1, 1);
  if (scheduleType === 'MINUTE') d.setMinutes(d.getMinutes() + n);
  else if (scheduleType === 'HOUR') d.setHours(d.getHours() + n);
  else if (scheduleType === 'DAY') d.setDate(d.getDate() + n);
  else d.setMinutes(d.getMinutes() + n);
  return d;
}

/** Background job polls every 30s — allow that window before flagging overdue. */
const SCHEDULER_POLL_GRACE_MS = 60 * 1000;

function isSchedulerOverdue(cfg, now = new Date()) {
  if (!cfg?.enabled || !cfg.nextRunAt) return false;
  const overdueByMs = now.getTime() - new Date(cfg.nextRunAt).getTime();
  return overdueByMs > SCHEDULER_POLL_GRACE_MS;
}

async function advanceNextRunAt(cfg, fromTime = new Date()) {
  if (!cfg?._id) return;
  const next = computeNextRunAt(fromTime, cfg.scheduleType, cfg.interval);
  await SchedulerConfig.updateOne({ _id: cfg._id }, { $set: { nextRunAt: next } });
}

async function findSchedulerConfig(orgId) {
  const tid = normalizeTenantId(orgId);
  if (!tid) return null;
  let cfg = await SchedulerConfig.findOne({ orgId: tid }).lean();
  if (!cfg && mongoose.Types.ObjectId.isValid(tid)) {
    cfg = await SchedulerConfig.findOne({ orgId: new mongoose.Types.ObjectId(tid) }).lean();
  }
  if (!cfg && orgId != null && String(orgId) !== tid) {
    cfg = await SchedulerConfig.findOne({ orgId: String(orgId) }).lean();
  }
  return cfg;
}

function movedCount(log) {
  return log.recordsMovedToInProgress ?? log.recordsUpdated ?? 0;
}

function buildAlerts({ cfg, queue, last24h, scheduler }) {
  const alerts = [];

  if (!cfg?.enabled && queue.new > 0) {
    alerts.push({
      severity: 'warning',
      code: 'SCHEDULER_DISABLED',
      title: 'Scheduler is paused with pending records',
      detail: `${queue.new} record(s) are waiting in NEW status while the scheduler is disabled.`,
    });
  }

  if (cfg?.enabled && scheduler.isOverdue) {
    alerts.push({
      severity: 'error',
      code: 'SCHEDULER_OVERDUE',
      title: 'Scheduler run is overdue',
      detail: `Expected run was due at ${scheduler.nextRunAt ? new Date(scheduler.nextRunAt).toLocaleString() : 'unknown time'}.`,
    });
  }

  if (queue.new >= 20) {
    alerts.push({
      severity: 'warning',
      code: 'HIGH_BACKLOG',
      title: 'High queue backlog',
      detail: `${queue.new} records are waiting to be picked up.`,
    });
  }

  if (last24h.failedRuns > 0) {
    alerts.push({
      severity: 'error',
      code: 'FAILED_RUNS',
      title: 'Failed scheduler runs detected',
      detail: `${last24h.failedRuns} run(s) failed in the last 24 hours.`,
    });
  }

  if (last24h.skippedRuns >= 3) {
    alerts.push({
      severity: 'info',
      code: 'SKIPPED_RUNS',
      title: 'Concurrent run contention',
      detail: `${last24h.skippedRuns} run(s) were skipped because another run was already in progress.`,
    });
  }

  if (cfg?.enabled && queue.total === 0) {
    alerts.push({
      severity: 'info',
      code: 'EMPTY_QUEUE',
      title: 'No tasks in queue',
      detail: 'Remediation tasks appear here after certification revoke decisions.',
    });
  }

  return alerts;
}

export async function getConfig(orgId) {
  const tid = normalizeTenantId(orgId);
  if (!tid) {
    throw new Error("Tenant context required for scheduler config");
  }
  let cfg = await SchedulerConfig.findOne({ orgId: tid }).lean();
  if (!cfg) {
    const created = await SchedulerConfig.create({ orgId: tid, enabled: false });
    cfg = created.toObject();
  }
  return cfg;
}

export async function saveConfig(orgId, payload) {
  const tid = normalizeTenantId(orgId);
  if (!tid) {
    throw new Error("Tenant context required for scheduler config");
  }
  const { enabled, scheduleType, interval } = payload;
  const cfg = await SchedulerConfig.findOneAndUpdate(
    { orgId: tid },
    { $set: { enabled, scheduleType, interval } },
    { upsert: true, new: true },
  ).lean();
  const next = computeNextRunAt(cfg.lastRunAt || Date.now(), cfg.scheduleType, cfg.interval);
  const now = new Date();
  const nextRunAt = enabled && (!cfg.nextRunAt || new Date(cfg.nextRunAt) < now) ? now : next;
  await SchedulerConfig.updateOne({ _id: cfg._id }, { $set: { nextRunAt } });
  return SchedulerConfig.findById(cfg._id).lean();
}

async function persistSkippedRun(orgId, triggerType, message) {
  await SchedulerExecutionLog.create({
    orgId,
    executionTime: new Date(),
    triggerType,
    status: 'SKIPPED',
    message,
    durationMs: 0,
  });
}

export async function runNow(orgId, options = {}) {
  const { triggerType = 'MANUAL' } = options;
  const tid = normalizeTenantId(orgId);
  if (!tid) {
    throw new Error('Tenant context required for scheduler run');
  }
  const startMs = Date.now();
  const lockId = `scheduler_job_lock_${tid || 'global'}`;
  const baseFilter = tenantRecordFilter(tid);
  const newFilter = newRecordsFilter(tid);

  const cfg = await findSchedulerConfig(orgId);
  const since = cfg?.lastRunAt || new Date(startMs - 24 * 60 * 60 * 1000);

  try {
    await DistributedLock.create({
      _id: lockId,
      lockedBy: 'scheduler',
      expiresAt: new Date(Date.now() + 1000 * 60 * 10),
    });
  } catch {
    const message = 'Another scheduler run is in progress';
    await persistSkippedRun(tid, triggerType, message);
    // Prevent nextRunAt from staying in the past when scheduled polls collide on the lock.
    if (triggerType === 'SCHEDULED' && cfg) {
      await advanceNextRunAt(cfg);
    }
    return { skipped: true, message };
  }

  const executionLog = {
    orgId: tid,
    executionTime: new Date(),
    triggerType,
    recordsFound: 0,
    recordsUpdated: 0,
    recordsNewCaptured: 0,
    recordsMovedToInProgress: 0,
    backlogBefore: 0,
    backlogAfter: 0,
    durationMs: 0,
    status: 'SUCCESS',
  };

  try {
    const [backlogBefore, recordsNewCaptured] = await Promise.all([
      WorkflowTaskQueue.countDocuments(newFilter),
      WorkflowTaskQueue.countDocuments({ ...baseFilter, dateOfEntry: { $gte: since } }),
    ]);

    executionLog.backlogBefore = backlogBefore;
    executionLog.recordsNewCaptured = recordsNewCaptured;

    const queueResult = await runTenantWorkflowTaskQueue(tid);
    const recordsFound = queueResult.pickup.recordsFound;
    const recordsUpdated = queueResult.pickup.recordsUpdated;

    executionLog.recordsFound = recordsFound;
    executionLog.recordsUpdated = recordsUpdated;
    executionLog.recordsMovedToInProgress = recordsUpdated;
    executionLog.backlogAfter = await WorkflowTaskQueue.countDocuments(newFilter);
    executionLog.durationMs = Date.now() - startMs;

    if (executionLog.backlogBefore > 0 && recordsUpdated === 0) {
      executionLog.status = 'FAILED';
      executionLog.message =
        `${executionLog.backlogBefore} NEW task(s) matched before pickup but none were updated — check tenantId/orgId alignment`;
      await SchedulerExecutionLog.create(executionLog);
      const now = new Date();
      if (cfg) {
        const next = computeNextRunAt(now, cfg.scheduleType, cfg.interval);
        await SchedulerConfig.updateOne({ _id: cfg._id }, { $set: { lastRunAt: now, nextRunAt: next } });
      }
      return {
        skipped: false,
        recordsFound,
        recordsUpdated: 0,
        recordsNewCaptured,
        backlogBefore: executionLog.backlogBefore,
        backlogAfter: executionLog.backlogAfter,
        durationMs: executionLog.durationMs,
        message: executionLog.message,
        pickupFailed: true,
      };
    }

    await SchedulerExecutionLog.create(executionLog);

    const now = new Date();
    if (cfg) {
      const next = computeNextRunAt(now, cfg.scheduleType, cfg.interval);
      await SchedulerConfig.updateOne({ _id: cfg._id }, { $set: { lastRunAt: now, nextRunAt: next } });
    } else {
      await SchedulerConfig.create({
        orgId: tid,
        lastRunAt: now,
        nextRunAt: computeNextRunAt(now, 'MINUTE', 5),
      });
    }

    return {
      skipped: false,
      recordsFound,
      recordsUpdated,
      recordsNewCaptured,
      backlogBefore,
      backlogAfter: executionLog.backlogAfter,
      durationMs: executionLog.durationMs,
      message: recordsUpdated > 0
        ? `${recordsUpdated} record(s) moved from NEW to IN_PROGRESS`
        : 'No NEW records found — nothing to process',
    };
  } catch (err) {
    executionLog.status = 'FAILED';
    executionLog.message = err?.message || String(err);
    executionLog.durationMs = Date.now() - startMs;
    await SchedulerExecutionLog.create(executionLog);
    throw err;
  } finally {
    try {
      await DistributedLock.findByIdAndDelete(lockId);
    } catch {
      // ignore
    }
  }
}

export async function getStats(orgId) {
  return getDashboard(orgId);
}

export async function getDashboard(orgId) {
  const tid = normalizeTenantId(orgId);
  const baseFilter = tenantRecordFilter(tid);
  const todayStart = startOfDay();
  const last24hStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const last7dStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const cfg = await getConfig(tid);
  const now = new Date();

  const [total, newCount, inProgress, completed, failed] = await Promise.all([
    WorkflowTaskQueue.countDocuments(baseFilter),
    WorkflowTaskQueue.countDocuments({ ...baseFilter, status: WORKFLOW_TASK_STATUS.NEW }),
    WorkflowTaskQueue.countDocuments({ ...baseFilter, status: WORKFLOW_TASK_STATUS.IN_PROGRESS }),
    WorkflowTaskQueue.countDocuments({ ...baseFilter, status: WORKFLOW_TASK_STATUS.COMPLETED }),
    WorkflowTaskQueue.countDocuments({ ...baseFilter, status: WORKFLOW_TASK_STATUS.FAILED }),
  ]);

  const [todayNewCaptured, todayMovedToInProgress] = await Promise.all([
    WorkflowTaskQueue.countDocuments({ ...baseFilter, dateOfEntry: { $gte: todayStart } }),
    WorkflowTaskQueue.countDocuments({
      ...baseFilter,
      status: WORKFLOW_TASK_STATUS.IN_PROGRESS,
      updatedAt: { $gte: todayStart },
    }),
  ]);

  const [logsToday, logs24h, recentLogs] = await Promise.all([
    SchedulerExecutionLog.find({ orgId: tid, executionTime: { $gte: todayStart } }).lean(),
    SchedulerExecutionLog.find({ orgId: tid, executionTime: { $gte: last24hStart } }).lean(),
    SchedulerExecutionLog.find({ orgId: tid }).sort({ executionTime: -1 }).limit(5).lean(),
  ]);

  const todayRuns = logsToday.length;
  const todayProcessed = logsToday.reduce((sum, log) => sum + movedCount(log), 0);
  const todayFailedRuns = logsToday.filter((log) => log.status === 'FAILED').length;
  const todaySkippedRuns = logsToday.filter((log) => log.status === 'SKIPPED').length;
  const todayNewCapturedFromRuns = logsToday.reduce((sum, log) => sum + (log.recordsNewCaptured || 0), 0);

  const runs24h = logs24h.length;
  const processed24h = logs24h.reduce((sum, log) => sum + movedCount(log), 0);
  const failedRuns24h = logs24h.filter((log) => log.status === 'FAILED').length;
  const skippedRuns24h = logs24h.filter((log) => log.status === 'SKIPPED').length;
  const successfulRuns24h = logs24h.filter((log) => log.status === 'SUCCESS').length;
  const successRate24h = runs24h > 0 ? Math.round((successfulRuns24h / runs24h) * 100) : 100;
  const avgProcessedPerRun24h = successfulRuns24h > 0
    ? Math.round((processed24h / successfulRuns24h) * 10) / 10
    : 0;

  const trend = await SchedulerExecutionLog.aggregate([
    { $match: { orgId: tid, executionTime: { $gte: last7dStart } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$executionTime' } },
        runs: { $sum: 1 },
        processed: { $sum: { $ifNull: ['$recordsMovedToInProgress', '$recordsUpdated'] } },
        captured: { $sum: { $ifNull: ['$recordsNewCaptured', 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
        skipped: { $sum: { $cond: [{ $eq: ['$status', 'SKIPPED'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const nextRunAt = cfg.nextRunAt ? new Date(cfg.nextRunAt) : null;
  const isOverdue = isSchedulerOverdue(cfg, now);

  const queue = { total, new: newCount, inProgress, completed, failed };
  const today = {
    newCaptured: todayNewCaptured,
    movedToInProgress: todayMovedToInProgress,
    runs: todayRuns,
    processed: todayProcessed,
    failedRuns: todayFailedRuns,
    skippedRuns: todaySkippedRuns,
    newCapturedFromRuns: todayNewCapturedFromRuns,
  };
  const last24h = {
    runs: runs24h,
    processed: processed24h,
    failedRuns: failedRuns24h,
    skippedRuns: skippedRuns24h,
    successRate: successRate24h,
    avgProcessedPerRun: avgProcessedPerRun24h,
  };
  const scheduler = {
    enabled: Boolean(cfg.enabled),
    scheduleType: cfg.scheduleType,
    interval: cfg.interval,
    lastRunAt: cfg.lastRunAt,
    nextRunAt: cfg.nextRunAt,
    isOverdue,
  };

  const lastRunRaw = recentLogs[0] || null;
  const lastRun = lastRunRaw ? { ...lastRunRaw, summary: buildRunSummary(lastRunRaw) } : null;
  const alerts = buildAlerts({ cfg, queue, last24h, scheduler });

  return {
    queue,
    today,
    last24h,
    scheduler,
    trend,
    alerts,
    lastRun,
    // backward-compatible flat fields
    total,
    new: newCount,
    inProgress,
    totalRuns: todayRuns,
  };
}

export async function listExecutionLogs(orgId, options = {}) {
  const tid = normalizeTenantId(orgId);
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 200);
  const range = options.range || 'all';

  const filter = { orgId: tid, ...buildLogDateFilter(range) };

  const logs = await SchedulerExecutionLog.find(filter)
    .sort({ executionTime: -1 })
    .limit(limit)
    .lean();

  return logs.map((log) => ({
    ...log,
    recordsMovedToInProgress: movedCount(log),
    summary: buildRunSummary(log),
  }));
}

function buildLogDateFilter(range) {
  const todayStart = startOfDay();
  if (range === 'today') {
    return { executionTime: { $gte: todayStart } };
  }
  if (range === 'yesterday') {
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    return { executionTime: { $gte: yesterdayStart, $lt: todayStart } };
  }
  if (range === 'last7days') {
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 6);
    return { executionTime: { $gte: weekStart } };
  }
  return {};
}

export async function deleteExecutionLogs(orgId, mode = 'all') {
  const tid = normalizeTenantId(orgId);
  const base = { orgId: tid };
  const todayStart = startOfDay();
  let filter = base;

  if (mode === 'all') {
    filter = base;
  } else if (mode === 'before_today') {
    filter = { ...base, executionTime: { $lt: todayStart } };
  } else if (mode === 'older_than_7_days') {
    const cutoff = new Date(todayStart);
    cutoff.setDate(cutoff.getDate() - 7);
    filter = { ...base, executionTime: { $lt: cutoff } };
  } else {
    throw new Error(`Invalid log delete mode: ${mode}`);
  }

  const res = await SchedulerExecutionLog.deleteMany(filter);
  return { deleted: res.deletedCount ?? 0, mode };
}

export async function countExecutionLogs(orgId, range = 'all') {
  const tid = normalizeTenantId(orgId);
  const filter = { orgId: tid, ...buildLogDateFilter(range) };
  const count = await SchedulerExecutionLog.countDocuments(filter);
  return { count, range };
}

function buildRunSummary(log) {
  const moved = movedCount(log);
  const trigger = log.triggerType === 'SCHEDULED' ? 'Scheduled' : 'Manual';
  const parts = [`${trigger} run`];

  if (log.status === 'SKIPPED') {
    parts.push(log.message || 'skipped — another run in progress');
    return parts.join(' · ');
  }

  if (log.status === 'FAILED') {
    parts.push(`failed — ${log.message || 'unknown error'}`);
    return parts.join(' · ');
  }

  if (moved > 0) {
    parts.push(`moved ${moved} to IN_PROGRESS`);
  } else {
    parts.push('no records to process');
  }

  if (log.recordsNewCaptured > 0) {
    parts.push(`${log.recordsNewCaptured} new since last run`);
  }

  if (typeof log.backlogBefore === 'number' && typeof log.backlogAfter === 'number') {
    parts.push(`backlog ${log.backlogBefore} → ${log.backlogAfter}`);
  }

  if (log.durationMs > 0) {
    parts.push(`${log.durationMs}ms`);
  }

  return parts.join(' · ');
}
