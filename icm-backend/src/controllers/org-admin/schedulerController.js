import * as schedulerService from '../../services/scheduler/scheduler.service.js';
import * as dummySvc from '../../services/scheduler/dummyRemediation.service.js';

export async function getConfig(req, res, next) {
  try {
    const orgId = req.scopedTenantId || req.user?.tenantId || null;
    const cfg = await schedulerService.getConfig(orgId);
    res.json({ success: true, data: cfg });
  } catch (err) {
    next(err);
  }
}

export async function putConfig(req, res, next) {
  try {
    const orgId = req.scopedTenantId || req.user?.tenantId || null;
    const cfg = await schedulerService.saveConfig(orgId, req.body);
    res.json({ success: true, data: cfg });
  } catch (err) {
    next(err);
  }
}

export async function postDummyRecords(req, res, next) {
  try {
    const orgId = req.scopedTenantId || req.user?.tenantId || null;
    const count = req.body?.count ?? Math.floor(Math.random() * 6) + 5; // 5-10
    const created = await dummySvc.createDummyRecords(orgId, count);
    res.json({ success: true, data: { created } });
  } catch (err) {
    next(err);
  }
}

export async function deleteDummyRecords(req, res, next) {
  try {
    const orgId = req.scopedTenantId || req.user?.tenantId || null;
    const deleted = await dummySvc.deleteDummyRecords(orgId);
    res.json({ success: true, data: { deleted } });
  } catch (err) {
    next(err);
  }
}

export async function postRunNow(req, res, next) {
  try {
    const orgId = req.scopedTenantId || req.user?.tenantId || null;
    const result = await schedulerService.runNow(orgId, { triggerType: 'MANUAL' });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getStats(req, res, next) {
  try {
    const orgId = req.scopedTenantId || req.user?.tenantId || null;
    const stats = await schedulerService.getDashboard(orgId);
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
}

export async function getDashboard(req, res, next) {
  try {
    const orgId = req.scopedTenantId || req.user?.tenantId || null;
    const dashboard = await schedulerService.getDashboard(orgId);
    res.json({ success: true, data: dashboard });
  } catch (err) {
    next(err);
  }
}

export async function getExecutionLogs(req, res, next) {
  try {
    const orgId = req.scopedTenantId || req.user?.tenantId || null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const range = String(req.query.range || 'all').toLowerCase();
    const [logs, meta] = await Promise.all([
      schedulerService.listExecutionLogs(orgId, { limit, range }),
      schedulerService.countExecutionLogs(orgId, range),
    ]);
    res.json({ success: true, data: logs, meta });
  } catch (err) {
    next(err);
  }
}

export async function deleteExecutionLogs(req, res, next) {
  try {
    const orgId = req.scopedTenantId || req.user?.tenantId || null;
    const mode = String(req.body?.mode || req.query.mode || 'all');
    const result = await schedulerService.deleteExecutionLogs(orgId, mode);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
