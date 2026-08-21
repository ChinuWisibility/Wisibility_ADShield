import mongoose from 'mongoose';
import User from '../models/platform/User.js';
import { AppError } from '../middleware/errorHandler.js';
import { runCorrelationEngine } from '../services/correlationEngineService.js';
import { recomputeTenantCorrelationStats } from '../services/tenantCorrelationStatsService.js';
import { scheduleDataHygieneSummaryRecompute } from '../services/datahygine/dataHygieneSummaryCacheService.js';

async function resolveTenantId(req) {
  const user = await User.findById(req.user.id).select('tenantId role').lean();
  if (!user) throw new AppError('User not found', 404);
  if (user.role === 'superAdmin' && (req.query.tenantId || req.body?.tenantId)) {
    const tid = req.query.tenantId || req.body?.tenantId;
    return new mongoose.Types.ObjectId(String(tid));
  }
  if (!user.tenantId) {
    throw new AppError('Your account has no tenant.', 400, 'NO_TENANT');
  }
  return user.tenantId;
}

/**
 * POST /api/correlation/run — apply correlation rules (Identity ↔ AccountAggregation).
 * Body: { applicationId: ObjectId } — typically the Active Directory application used for aggregation.
 */
export async function runCorrelation(req, res, next) {
  try {
    const tenantId = await resolveTenantId(req);
    const applicationId = req.body?.applicationId;
    if (!applicationId) {
      throw new AppError('applicationId is required', 400);
    }
    const result = await runCorrelationEngine({ tenantId, applicationId });
    res.json({ success: true, data: result });
    setImmediate(() => {
      void recomputeTenantCorrelationStats(tenantId);
    });
    scheduleDataHygieneSummaryRecompute(tenantId);
    if (applicationId) {
      void import("../services/datahygine/hygieneRollupService.js").then((mod) =>
        mod.emitHygieneDirty({
          tenantId,
          applicationId,
          widgetIds: [...mod.DEFAULT_APP_DIRTY_WIDGETS],
          reason: "identity_cube_correlation",
        }),
      );
      void import("../services/datahygine/applicationManagerMismatchSidecar.js").then((mod) => {
        mod.scheduleManagerMismatchSidecarRebuild(applicationId, tenantId, {
          skipDirtyEmit: true,
        });
      });
      void import("../services/datahygine/applicationStatusMismatchSidecar.js").then((mod) => {
        mod.scheduleStatusMismatchSidecarRebuild(applicationId, tenantId, {
          skipDirtyEmit: true,
        });
      });
    }
  } catch (e) {
    next(e instanceof AppError ? e : new AppError(e.message || 'Correlation failed', 400, 'CORRELATION'));
  }
}
