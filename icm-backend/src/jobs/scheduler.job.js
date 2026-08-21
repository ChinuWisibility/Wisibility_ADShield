import SchedulerConfig from '../models/scheduler/SchedulerConfig.js';
import * as schedulerService from '../services/scheduler/scheduler.service.js';
import { isValidTenantId, normalizeTenantId } from '../utils/tenantScope.js';

let pollingHandle = null;

export function startSchedulerJob() {
  // Poll enabled configs every 30s and trigger runs when nextRunAt <= now
  const POLL_MS = 30 * 1000;
  if (pollingHandle) return;
  pollingHandle = setInterval(async () => {
    try {
      const now = new Date();
      const configs = await SchedulerConfig.find({ enabled: true }).lean();
      for (const cfg of configs) {
        const orgId = normalizeTenantId(cfg.orgId);
        if (!isValidTenantId(orgId)) {
          console.warn('[SchedulerJob] Skipping enabled config without valid orgId:', cfg._id);
          continue;
        }
        const next = cfg.nextRunAt ? new Date(cfg.nextRunAt) : null;
        if (!next || next <= now) {
          try {
            await schedulerService.runNow(orgId, { triggerType: 'SCHEDULED' });
          } catch (e) {
            console.warn('[SchedulerJob] Run failed:', e?.message || e);
          }
        }
      }
    } catch (err) {
      console.warn('[SchedulerJob] poll error:', err?.message || err);
    }
  }, POLL_MS);
}

export function stopSchedulerJob() {
  if (!pollingHandle) return;
  clearInterval(pollingHandle);
  pollingHandle = null;
}
