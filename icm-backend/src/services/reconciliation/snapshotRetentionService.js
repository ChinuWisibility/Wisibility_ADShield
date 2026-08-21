import { getReconciliationModels } from "../../utils/reconciliationCollections.js";
import { resolveTenantSlugFromTenantId } from "../../utils/applicationDynamicCollections.js";
import { applicationIdInClause } from "../applicationUserIngestService.js";

const DEFAULT_KEEP_RUNS = Math.max(
  1,
  parseInt(process.env.RECON_SNAPSHOT_RETENTION_RUNS, 10) || 2,
);

/**
 * Drop reconciliation snapshots/deltas for runs older than the N most recent COMPLETED runs.
 * Keeps audit run headers; removes unbounded snapshot growth.
 * @param {object} application
 * @param {number} [keepRuns]
 */
export async function purgeStaleReconciliationSnapshots(application, keepRuns = DEFAULT_KEEP_RUNS) {
  const tenantSlug = await resolveTenantSlugFromTenantId(application.tenantId);
  if (!tenantSlug) return { purgedRuns: 0 };

  const models = getReconciliationModels(application.name, tenantSlug);
  const appId = application._id;

  const recentRuns = await models.Runs.find({
    applicationId: applicationIdInClause(appId),
    status: "COMPLETED",
  })
    .sort({ reconciliationDate: -1 })
    .select("runId")
    .limit(keepRuns)
    .lean();

  const keepRunIds = recentRuns.map((r) => r.runId);
  if (!keepRunIds.length) return { purgedRuns: 0 };

  const staleRuns = await models.Runs.find({
    applicationId: applicationIdInClause(appId),
    status: "COMPLETED",
    runId: { $nin: keepRunIds },
  })
    .select("runId")
    .lean();

  const staleRunIds = staleRuns.map((r) => r.runId);
  if (!staleRunIds.length) return { purgedRuns: 0 };

  await models.Snapshot.deleteMany({
    applicationId: appId,
    runId: { $in: staleRunIds },
  });
  await models.Delta.deleteMany({
    applicationId: appId,
    runId: { $in: staleRunIds },
  });
  await models.EntitlementDelta.deleteMany({
    applicationId: appId,
    runId: { $in: staleRunIds },
  });

  return { purgedRuns: staleRunIds.length, keptRunIds: keepRunIds.length };
}

/**
 * Persist snapshot rows only for changed/new accounts (hash-optimized path).
 */
export async function persistPartialRunSnapshot({
  SnapshotModel,
  runId,
  applicationId,
  tenantId,
  identityKeys,
  currentMap,
  snapshotDate,
  exclusiveTimer = null,
}) {
  const { bulkInsertChunked } = await import("../../utils/reconciliationCollections.js");
  const docs = [];

  for (const identityKey of identityKeys) {
    const entry = currentMap.get(identityKey);
    if (!entry) continue;
    docs.push({
      runId,
      identityKey,
      applicationId,
      tenantId,
      snapshotDate,
      attributes: entry.attributes,
      entitlements: [...entry.entitlements],
    });
  }

  if (!docs.length) return 0;
  const run = async (name, fn) => (exclusiveTimer ? exclusiveTimer.span(name, fn) : fn());
  await run("persistPartialRunSnapshot.bulkInsertChunked", () =>
    bulkInsertChunked(SnapshotModel, docs),
  );
  return docs.length;
}
