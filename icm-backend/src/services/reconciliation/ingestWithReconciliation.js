import { runReconciliation } from "./reconciliationOrchestrator.js";

/**
 * Replaces direct replaceApplicationUserIngest for CSV and connector paths.
 * @param {object} application
 * @param {object[]} rawUserDocs
 * @param {object} options
 */
export async function ingestApplicationUsersWithReconciliation(application, rawUserDocs, options = {}) {
  const sourceMap = {
    csv_strict: "csv_strict",
    csv_mapped: "csv_mapped",
    csv_upload_legacy: "csv_legacy",
    ad_sync: "connector_ad",
    ad_sync_mapped: "connector_ad",
    connector_sync: "connector_universal",
    connector_sync_mapped: "connector_universal",
    delimited_hrms: "csv_mapped",
  };
  const rawSource = String(options.source || "unknown");
  const reconSource = sourceMap[rawSource] || "unknown";

  const result = await runReconciliation(application, rawUserDocs, {
    source: reconSource,
    uploadedFileName: options.uploadedFileName ?? null,
    uploadedBy: options.uploadedBy ?? null,
    strictPkResolution: options.strictPkResolution,
    initialSkippedMissingPk: options.initialSkippedMissingPk,
    userMappingsForPk: options.userMappingsForPk,
    skipFullReRead: options.skipFullReRead,
    loadCanonicalDocs: options.loadCanonicalDocs,
    skipDedupeScan: options.skipDedupeScan,
  });

  return {
    summary: result.summary,
    reconciliation: result.reconciliation,
    runId: result.runId,
    previousRunId: result.previousRunId,
    canonicalUserDocs: result.canonicalUserDocs,
    hashOptimized: result.hashOptimized,
    syncDelta: result.syncDelta,
    stageTimings: result.stageTimings,
  };
}
