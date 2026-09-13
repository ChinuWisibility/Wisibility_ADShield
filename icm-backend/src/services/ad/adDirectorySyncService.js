import { applyCsvImportMappingToRows } from "../application/delimitedApplicationUserSync.js";
import { ingestApplicationUsersWithReconciliation } from "../reconciliation/ingestWithReconciliation.js";
import { upsertAggregationsFromAdUserDocs } from "./adAccountAggregationService.js";
import {
  buildAdEntitlementRows,
  ensureDefaultAdEntitlementMappings,
  upsertApplicationEntitlementsFromRows,
} from "../application/applicationEntitlementIngestService.js";
import { refreshDerivedApplicationsFromAdDirectory } from "./adDerivedApplicationService.js";
import {
  incrementalAdConnectorAccountEntitlementCorrelation,
  scheduleCorrelationStatsRebuild,
} from "./adConnectorCorrelationService.js";
import { mergeMappedAdUserDoc } from "../../utils/mergeMappedAdUserDoc.js";
import { incrementalGraphUpdateFromDirectory } from "../graph/graphIncrementalUpdateService.js";
import { normalizePrimaryKeyValue } from "../application/applicationUserIngestService.js";
import { resolveStableSyncKey } from "../sync/accountHashService.js";
import {
  createPipelineMetrics,
  recordPipelineStage,
  schedulePostSyncBackgroundWork,
  timeSyncStage,
} from "../sync/identitySyncBackground.js";
import { createIngestDetailTracker } from "../sync/adSyncProfiler.js";

function mapIdentityKeysToUserIds(userDocs, identityKeys, userIdByIdentityKey) {
  const ids = [];
  for (const key of identityKeys || []) {
    const fromMap = userIdByIdentityKey?.get?.(key);
    if (fromMap) {
      ids.push(fromMap);
      continue;
    }
    for (const doc of userDocs || []) {
      const pk = doc.user_id || doc.email;
      if (pk && normalizePrimaryKeyValue(pk) === key && doc._id) {
        ids.push(doc._id);
        break;
      }
    }
  }
  return ids;
}

/**
 * Canonical AD directory ingest — same pipeline as POST /applications/:id/ad/sync.
 * Iteration 0: fine-grained detailTracker spans (measurement only).
 */
export async function ingestApplicationFromAdDirectory(
  application,
  directory,
  options = {},
) {
  const syncGroups = options.syncGroups !== false && options.syncGroups !== "false";
  const pipelineMetrics = options.pipelineMetrics || createPipelineMetrics();
  const detail =
    options.detailTracker ||
    pipelineMetrics.detailTracker ||
    createIngestDetailTracker("ingest");
  pipelineMetrics.detailTracker = detail;

  let docs;
  await detail.span("user_doc_clone", async (c) => {
    docs = (directory?.userDocs || []).map((user) => ({
      ...user,
      applicationId: application._id,
    }));
    c.documentsProcessed = docs.length;
  });

  let source = "ad_sync";
  let skippedPk = 0;

  await detail.span("csv_import_mapping", async (c) => {
    const mapped = applyCsvImportMappingToRows(
      docs.map((doc) => doc.rawData || {}),
      application,
    );
    if (mapped?.documentsToInsert?.length > 0) {
      const sourceUserDocs = directory?.userDocs || [];
      const membershipByUserId = new Map(
        sourceUserDocs.map((d) => [String(d.user_id || "").trim(), d]),
      );
      docs = mapped.documentsToInsert.map((doc) => {
        const uid = String(doc.user_id || doc.rawData?.user_id || "").trim();
        const orig = membershipByUserId.get(uid);
        return mergeMappedAdUserDoc(
          { ...doc, applicationId: application._id },
          orig,
        );
      });
      skippedPk = mapped.skippedMissingPk || 0;
      source = "ad_sync_mapped";
      c.documentsProcessed = docs.length;
    } else {
      c.documentsProcessed = 0;
    }
  });

  await options.onProgress?.("reconciling", 45, "Running reconciliation pipeline…");

  const reconStage = await detail.span(
    "reconciliation",
    async (c) => {
      const result = await timeSyncStage("reconciliation", () =>
        ingestApplicationUsersWithReconciliation(application, docs, {
          source,
          strictPkResolution: true,
          userMappingsForPk:
            source === "ad_sync_mapped"
              ? application.csvImportMapping?.mappings
              : undefined,
          initialSkippedMissingPk: skippedPk,
        }),
      );
      c.documentsProcessed = result.canonicalUserDocs?.length || docs.length;
      return result;
    },
    { exclusive: false },
  );
  recordPipelineStage(pipelineMetrics, reconStage);

  // Flatten reconciliation orchestrator stage timings as exclusive leaves.
  // Exclude aggregate totalReconciliationMs to avoid double-counting.
  const RECON_LEAF_KEYS = [
    "canonicalizeMs",
    "buildAccountMapMs",
    "hashGenerateMs",
    "hashCompareMs",
    "hashPartitionMs",
    "stagingInsertMs",
    "baselineLoadMs",
    "deltaCompareMs",
    "snapshotPersistMs",
    "deltaPersistMs",
    "userUpsertMs",
    "syncStatePersistMs",
  ];
  // Note: finalReadMs aliases userUpsertMs in orchestrator — omit to avoid double-count.
  // Note: totalReconciliationMs is aggregate — omit.
  if (reconStage.stageTimings && typeof reconStage.stageTimings === "object") {
    for (const key of RECON_LEAF_KEYS) {
      const v = reconStage.stageTimings[key];
      if (typeof v !== "number" || v <= 0) continue;
      const normalized = `reconciliation_${key
        .replace(/Ms$/, "")
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toLowerCase()}`;
      detail.recordSync(normalized, v, {
        parent: "reconciliation",
        exclusive: true,
      });
    }
  }

  const {
    summary,
    canonicalUserDocs,
    reconciliation,
    runId,
    syncDelta,
    hashOptimized,
  } = reconStage;

  const pkField =
    (application.userMappings || []).find((m) => m.isPrimaryKey)?.standardField ||
    "user_id";

  const changedPkKeys = syncDelta
    ? [...(syncDelta.newPkKeys || []), ...(syncDelta.changedPkKeys || [])]
    : null;

  const hasAccountChanges = Boolean(changedPkKeys?.length);

  let docsForAggregation;
  let aggregationIdentityKeys;
  await detail.span("aggregation_prep", async (c) => {
    docsForAggregation =
      hasAccountChanges
        ? docs.filter((d) => {
            const pk = normalizePrimaryKeyValue(d[pkField] || d.user_id || d.email);
            return changedPkKeys.includes(pk);
          })
        : hashOptimized
          ? docs
          : canonicalUserDocs.length
            ? canonicalUserDocs
            : docs;

    aggregationIdentityKeys =
      hashOptimized && syncDelta
        ? hasAccountChanges
          ? changedPkKeys
          : []
        : null;
    c.documentsProcessed = docsForAggregation?.length || 0;
  });

  await options.onProgress?.("aggregating", 72, "Updating account aggregations…");

  const aggStage = await detail.span("aggregation", async (c) => {
    const result = await timeSyncStage("aggregation", () =>
      upsertAggregationsFromAdUserDocs({
        application,
        tenantId: application.tenantId,
        userDocs: docsForAggregation,
        identityKeysToUpsert: aggregationIdentityKeys,
        allNativeAccountIds: docs
          .map(
            (u) =>
              u.rawData?.objectGUID ||
              u.rawData?.objectguid ||
              u.user_id ||
              u.email,
          )
          .filter(Boolean)
          .map(String),
      }),
    );
    c.documentsProcessed = result.upserted || 0;
    c.mongoWrites = result.upserted || 0;
    return result;
  });
  recordPipelineStage(pipelineMetrics, {
    ...aggStage,
    counts: {
      aggregationsUpserted: aggStage.upserted || 0,
      aggregationsSkipped: aggStage.skipped || 0,
    },
  });

  let entitlements = { inserted: 0 };
  let correlationStats = null;

  if (syncGroups) {
    await options.onProgress?.("entitlements", 78, "Syncing AD group entitlements…");

    let entitlementRows;
    await detail.span("entitlement_row_build", async (c) => {
      ensureDefaultAdEntitlementMappings(application);
      entitlementRows = buildAdEntitlementRows(directory.groups || [], { source });
      c.documentsProcessed = entitlementRows.length;
    });

    const entStage = await detail.span("entitlement_upsert", async (c) => {
      const entitlementMappings = application.entitlementMappings;
      const result = await timeSyncStage("entitlements", () =>
        upsertApplicationEntitlementsFromRows(
          application,
          entitlementRows,
          entitlementMappings,
        ),
      );
      c.documentsProcessed = result.inserted || entitlementRows.length;
      c.mongoWrites = result.inserted || 0;
      return result;
    });
    entitlements = entStage;
    recordPipelineStage(pipelineMetrics, entStage);

    try {
      await options.onProgress?.("correlation", 84, "Updating membership correlation…");

      let membershipChangedUserIds;
      let removedUserIds;
      let skipCorrelation;

      await detail.span("correlation_key_map", async (c) => {
        const userIdByIdentityKey = new Map();
        for (const doc of canonicalUserDocs || []) {
          const syncKey = resolveStableSyncKey(
            { rawDoc: doc, displayPk: doc[pkField] || doc.user_id },
            pkField,
          );
          if (doc._id && syncKey) {
            userIdByIdentityKey.set(syncKey, doc._id);
          }
        }

        membershipChangedUserIds = syncDelta
          ? mapIdentityKeysToUserIds(
              canonicalUserDocs,
              syncDelta.membershipChangedKeys,
              userIdByIdentityKey,
            )
          : (canonicalUserDocs || []).map((d) => d._id).filter(Boolean);

        removedUserIds = syncDelta?.removedUserIds || [];

        skipCorrelation =
          hashOptimized &&
          syncDelta &&
          !(syncDelta.membershipChangedKeys?.length) &&
          !(removedUserIds?.length);

        c.documentsProcessed = membershipChangedUserIds?.length || 0;
      });

      const corrStage = skipCorrelation
        ? {
            label: "correlation",
            ms: 0,
            edgesAdded: 0,
            edgesRemoved: 0,
            skipped: true,
            correlationSkipped: true,
          }
        : await detail.span("correlation", async (c) => {
            const result = await timeSyncStage("correlation", () =>
              incrementalAdConnectorAccountEntitlementCorrelation(application, {
                userDocs: canonicalUserDocs.length ? canonicalUserDocs : docs,
                membershipChangedUserIds,
                removedUserIds,
                deferStats: true,
              }),
            );
            c.documentsProcessed =
              (result.edgesAdded || 0) + (result.edgesRemoved || 0);
            c.mongoWrites = (result.edgesAdded || 0) + (result.edgesRemoved || 0);
            return result;
          });

      if (skipCorrelation) {
        detail.recordSync("correlation", 0, {
          exclusive: true,
          extra: { skipped: true },
        });
      }

      correlationStats = corrStage;
      recordPipelineStage(pipelineMetrics, {
        ...corrStage,
        counts: {
          correlationEdgesAdded: corrStage.edgesAdded || 0,
          correlationEdgesRemoved: corrStage.edgesRemoved || 0,
          correlationSkipped: skipCorrelation ? 1 : 0,
        },
      });

      schedulePostSyncBackgroundWork({
        application,
        correlationStatsFn: () => scheduleCorrelationStatsRebuild(application),
        scheduleIdentitySync: true,
      });
    } catch (err) {
      console.error(
        `[ingestApplicationFromAdDirectory] AD membership correlation failed for ${application.name}:`,
        err,
      );
    }
  }

  if (syncGroups) {
    try {
      const graphStage = await detail.span(
        "graph",
        async (c) => {
          const result = await timeSyncStage("graph", () =>
            incrementalGraphUpdateFromDirectory(application, {
              directory,
              canonicalUserDocs: docs,
              groups: directory?.groups || [],
              source: "ad_sync",
              detailTracker: detail,
            }),
          );
          c.documentsProcessed = result.edgeCount || 0;
          c.mongoReads = result.mongoReads || 0;
          c.mongoWrites = result.mongoWrites || 0;
          return result;
        },
        { exclusive: false },
      );
      recordPipelineStage(pipelineMetrics, {
        ...graphStage,
        counts: {
          edgeCount: graphStage.edgeCount || 0,
          upserted: graphStage.upserted || 0,
          deleted: graphStage.deleted || 0,
          inserted: graphStage.inserted || 0,
          updated: graphStage.updated || 0,
          unchanged: graphStage.unchanged || 0,
          incremental: Boolean(graphStage.incremental),
          existingEdgeCount: graphStage.existingEdgeCount || 0,
          desiredEdgeCount: graphStage.edgeCount || 0,
          usersProcessed: graphStage.usersProcessed || 0,
          groupsProcessed: graphStage.groupsProcessed || 0,
          groupNodes: graphStage.groupNodes || 0,
          privilegedGroups: graphStage.privilegedGroups || 0,
          detailTimings: graphStage.detailTimings || null,
        },
      });
    } catch (err) {
      console.error(
        `[ingestApplicationFromAdDirectory] graph incremental update failed for ${application.name}:`,
        err,
      );
    }
  }

  if (syncDelta) {
    recordPipelineStage(pipelineMetrics, {
      label: "hash-delta",
      ms: 0,
      counts: {
        unchangedAccounts: syncDelta.unchangedKeys?.length || 0,
        changedAccounts: syncDelta.changedKeys?.length || 0,
        newAccounts: syncDelta.newKeys?.length || 0,
        removedAccounts: syncDelta.removedKeys?.length || 0,
        membershipChangedAccounts: syncDelta.membershipChangedKeys?.length || 0,
        aggregationSkipped: aggStage.skipped || 0,
      },
    });
  }

  if (reconStage.stageTimings) {
    recordPipelineStage(pipelineMetrics, {
      label: "reconciliation-stages",
      ms: Object.values(reconStage.stageTimings).reduce(
        (n, v) => (typeof v === "number" ? n + v : n),
        0,
      ),
      counts: reconStage.stageTimings,
    });
  }

  return {
    source,
    summary,
    canonicalUserDocs,
    reconciliation,
    runId,
    hashOptimized: Boolean(hashOptimized),
    syncDelta,
    accountAggregationsUpserted: aggStage.upserted || 0,
    accountAggregationsSkipped: aggStage.skipped || 0,
    entitlementsSynced: entitlements.inserted,
    correlationStats,
    directoryCounts: directory?.counts,
    pipelineMetrics,
    ingestDetail: detail.snapshot(),
  };
}

/**
 * Full source AD sync + propagate to derived child applications (shared directory payload).
 */
export async function syncSourceApplicationAndDerivedFromDirectory(
  sourceApplication,
  directory,
  options = {},
) {
  const { onProgress } = options;
  const pipelineMetrics = createPipelineMetrics();
  pipelineMetrics.detailTracker = createIngestDetailTracker("ingest");

  await onProgress?.("ingesting", 35, "Reconciling and ingesting users…");
  const sourceResult = await ingestApplicationFromAdDirectory(
    sourceApplication,
    directory,
    { ...options, pipelineMetrics },
  );

  await onProgress?.(
    "derived_apps",
    88,
    "Refreshing derived applications from directory…",
  );

  const detail = pipelineMetrics.detailTracker;
  let derivedResults = [];
  const derivedAppsStart = Date.now();
  await detail.span(
    "derived_apps",
    async (c) => {
      await detail.span("derived_apps_prepare", async (c2) => {
        // Child discovery is inside refreshDerivedApplications; timed as prepare+execute wall.
        c2.documentsProcessed = 0;
      });
      derivedResults = await detail.span("derived_apps_execute", async (c2) => {
        const results = await refreshDerivedApplicationsFromAdDirectory({
          sourceApplication,
          directory,
        });
        c2.documentsProcessed = results.length;
        return results;
      });
      c.documentsProcessed = derivedResults.length;
      return derivedResults;
    },
    { exclusive: false },
  );
  const derivedAppsMs = Date.now() - derivedAppsStart;
  recordPipelineStage(pipelineMetrics, {
    label: "derived_apps",
    ms: derivedAppsMs,
    counts: {
      derivedOk: derivedResults.filter((d) => !d.skipped && !d.error).length,
      derivedTotal: derivedResults.length,
    },
  });

  schedulePostSyncBackgroundWork({
    application: sourceApplication,
    snapshotRetentionFn: async () => {
      const { purgeStaleReconciliationSnapshots } = await import(
        "../reconciliation/snapshotRetentionService.js"
      );
      return purgeStaleReconciliationSnapshots(sourceApplication);
    },
    scheduleIdentitySync: false,
  });

  return {
    source: sourceResult,
    derived: derivedResults,
    pipelineMetrics,
    derivedAppsMs,
    ingestDetail: detail.snapshot(),
  };
}
