/**
 * Post-CREATE reconciliation wiring.
 * Schedules AD sync when possible; does not run inside HRMS transaction.
 * Live AD sync/correlation remains AD LIVE VALIDATION PENDING until DC is reachable.
 */

export function schedulePostCreateReconciliation(payload = {}) {
  const {
    tenantId,
    applicationId,
    identityId,
    nativeIdentifier,
    jmlCorrelationId,
    taskId,
  } = payload;

  console.log(
    "[postProvision] SCHEDULE_RECONCILE",
    JSON.stringify({
      tenantId: tenantId ? String(tenantId) : null,
      applicationId: applicationId ? String(applicationId) : null,
      identityId: identityId ? String(identityId) : null,
      nativeIdentifier: nativeIdentifier || null,
      jmlCorrelationId: jmlCorrelationId || null,
      taskId: taskId || null,
      note: "AD LIVE VALIDATION PENDING — sync/correlation runs when AD reachable",
    }),
  );

  // Fire-and-forget: attempt to schedule existing AD sync job infrastructure.
  setImmediate(async () => {
    try {
      const Application = (await import("../../models/application/Application.js")).default;
      const app = await Application.findById(applicationId).lean();
      if (!app?.connectionConfig?.ad) {
        console.log("[postProvision] skip AD sync — application has no AD config");
        return;
      }
      const { createAdSyncJob } = await import("../adSyncJobService.js");
      const { scheduleAdSyncJobRun } = await import("../adSyncPipelineService.js");
      const job = await createAdSyncJob({
        applicationId,
        syncConfig: {
          reason: "post_create_reconcile",
          jmlCorrelationId,
          identityId: identityId ? String(identityId) : undefined,
          nativeIdentifier,
          triggeredBy: "jml_post_create",
        },
      });
      if (job?.jobId) {
        scheduleAdSyncJobRun(job.jobId);
        console.log(
          "[postProvision] AD sync scheduled",
          JSON.stringify({ jobId: job.jobId, jmlCorrelationId }),
        );
      }
    } catch (err) {
      console.warn(
        "[postProvision] Could not schedule AD sync (AD may be offline):",
        err.message,
      );
      console.warn("[postProvision] AD LIVE VALIDATION PENDING");
    }
  });
}
