/**
 * Action driver (Level 3) — measures long-running jobs from persisted history.
 * Does NOT trigger live sync/scan (safe for CI / shared tenants).
 * Records queue / execution / completion / heap / success rate from job docs.
 */
import { ObjectId } from "mongodb";
import { bytesOf } from "../lib/bytes.mjs";
import { timeLabel } from "../lib/timing.mjs";

function durationMs(start, end) {
  const a = start ? Date.parse(start) : NaN;
  const b = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

/**
 * @param {{ db: import("mongodb").Db, tenantId: string, adAppId?: string|null, applicationId?: string|null }} ctx
 */
export async function runActionSuite(ctx) {
  const db = ctx.db;
  const tid = new ObjectId(String(ctx.tenantId));
  const time = timeLabel;
  const results = [];
  const actionProbes = {};

  const appId = ctx.adAppId || ctx.applicationId;
  const appOid = appId ? new ObjectId(String(appId)) : null;

  // --- Sync from AD (AdSyncJob history) ---
  results.push(
    await time("Action_Applications_SyncAd", async () => {
      const coll = db.collection("adsyncjobs");
      const filter = appOid ? { applicationId: appOid } : {};
      let jobs = await coll.find(filter).sort({ createdAt: -1 }).limit(20).toArray().catch(() => []);
      if (!jobs.length) {
        jobs = await coll.find({}).sort({ createdAt: -1 }).limit(20).toArray().catch(() => []);
      }
      // Alternate collection name casing
      if (!jobs.length) {
        const alt = db.collection("ad_sync_jobs");
        jobs = await alt.find(appOid ? { applicationId: appOid } : {}).sort({ createdAt: -1 }).limit(20).toArray().catch(() => []);
      }

      const completed = jobs.filter((j) => j.status === "completed" || j.status === "success" || j.completedAt);
      const failed = jobs.filter((j) => j.status === "failed" || j.status === "error");
      const samples = completed
        .map((j) => ({
          jobId: j.jobId || String(j._id),
          queueMs: durationMs(j.createdAt, j.startedAt || j.runningAt),
          executionMs: durationMs(j.startedAt || j.runningAt || j.createdAt, j.completedAt || j.updatedAt),
          completionMs: durationMs(j.createdAt, j.completedAt || j.updatedAt),
          status: j.status,
          heapDeltaMb: j.result?.profilerSummary?.heapDeltaMb ?? j.heapDeltaMb ?? null,
        }))
        .filter((s) => s.completionMs != null);

      const avg = (arr, key) => {
        const vals = arr.map((x) => x[key]).filter((n) => n != null);
        if (!vals.length) return null;
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      };

      const successRate =
        jobs.length > 0 ? completed.length / jobs.length : samples.length ? 1 : null;

      const action = {
        trigger: "button",
        endpoint: "POST /applications/:id/ad/sync",
        pollEndpoint: "GET /applications/:id/ad-sync-jobs/:jobId",
        queueMs: avg(samples, "queueMs"),
        executionMs: avg(samples, "executionMs"),
        completionMs: avg(samples, "completionMs"),
        pollCount: null,
        heapDeltaMb: avg(samples, "heapDeltaMb"),
        status: samples[0]?.status || jobs[0]?.status || "no_jobs",
        retries: null,
        successRate,
        sampleCount: samples.length,
        jobsExamined: jobs.length,
        failedCount: failed.length,
        mode: "historical",
        note: "Measured from AdSyncJob history (does not start a live sync)",
      };

      actionProbes["act.applications.syncAd"] = { ok: samples.length > 0 || jobs.length > 0, action };

      return {
        rows: samples.length,
        total: jobs.length,
        payloadBytes: bytesOf(samples.slice(0, 5)),
        collections: ["adsyncjobs"],
        meta: action,
      };
    }),
  );

  // --- Run Scan (posture_scan_results history as scan runs) ---
  results.push(
    await time("Action_Security_RunScan", async () => {
      const coll = db.collection("posture_scan_results");
      const filter = appOid ? { applicationId: appOid } : { tenantId: tid };
      const rows = await coll
        .aggregate([
          { $match: filter },
          { $sort: { createdAt: -1 } },
          { $limit: 200 },
          {
            $group: {
              _id: "$scanId",
              startedAt: { $min: "$startedAt" },
              completedAt: { $max: "$completedAt" },
              createdAt: { $first: "$createdAt" },
              status: { $first: "$status" },
              findingCount: { $sum: 1 },
            },
          },
          { $sort: { createdAt: -1 } },
          { $limit: 20 },
        ])
        .toArray()
        .catch(() => []);

      const samples = rows
        .map((r) => ({
          scanId: r._id,
          completionMs: durationMs(r.startedAt || r.createdAt, r.completedAt || r.createdAt),
          executionMs: durationMs(r.startedAt || r.createdAt, r.completedAt || r.createdAt),
          queueMs: null,
          status: r.status || "completed",
          findingCount: r.findingCount,
        }))
        .filter((s) => s.completionMs != null);

      const avgCompletion =
        samples.length > 0
          ? Math.round(samples.reduce((a, s) => a + s.completionMs, 0) / samples.length)
          : null;

      const action = {
        trigger: "button",
        endpoint: "POST /security/applications/:id/scan",
        pollEndpoint: "GET /security/applications/:id/scans",
        queueMs: null,
        executionMs: avgCompletion,
        completionMs: avgCompletion,
        pollCount: null,
        heapDeltaMb: null,
        status: samples[0]?.status || "no_scans",
        retries: null,
        successRate: samples.length ? 1 : null,
        sampleCount: samples.length,
        jobsExamined: rows.length,
        failedCount: 0,
        mode: "historical",
        note: "Measured from posture_scan_results scan groupings (does not start a live scan)",
      };

      actionProbes["act.security.runScan"] = { ok: samples.length > 0, action };

      return {
        rows: samples.length,
        total: rows.length,
        payloadBytes: bytesOf(samples.slice(0, 5)),
        collections: ["posture_scan_results"],
        meta: action,
      };
    }),
  );

  return { results, actionProbes };
}
