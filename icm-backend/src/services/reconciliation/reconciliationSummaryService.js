/**
 * Merge delta comparison summary with duplicate ingest stats.
 */
export function buildRunSummary(deltaSummary, ingestMeta = {}) {
  const base = {
    totalUsers: deltaSummary.totalUsers ?? 0,
    activeUsers: deltaSummary.activeUsers ?? 0,
    inactiveUsers: deltaSummary.inactiveUsers ?? 0,
    newUsers: deltaSummary.newUsers ?? 0,
    updatedUsers: deltaSummary.updatedUsers ?? 0,
    removedUsers: deltaSummary.removedUsers ?? 0,
    newEntitlements: deltaSummary.newEntitlements ?? 0,
    removedEntitlements: deltaSummary.removedEntitlements ?? 0,
    duplicateGroups: ingestMeta.duplicateGroups ?? 0,
    duplicateRows: ingestMeta.duplicateRows ?? 0,
    skippedMissingPk: ingestMeta.skippedMissingPk ?? 0,
    liveRows: ingestMeta.liveRows ?? deltaSummary.totalUsers ?? 0,
  };

  if (ingestMeta.hashOptimized) {
    return {
      ...base,
      totalUsers: ingestMeta.liveRows ?? base.liveRows ?? base.totalUsers,
      newUsers: ingestMeta.hashNewUsers ?? 0,
      updatedUsers: ingestMeta.hashChangedUsers ?? 0,
      removedUsers: ingestMeta.hashRemovedUsers ?? base.removedUsers,
      skippedUnchanged: ingestMeta.skippedUnchanged ?? 0,
    };
  }

  return base;
}
