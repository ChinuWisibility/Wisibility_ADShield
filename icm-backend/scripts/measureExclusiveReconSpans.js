/**
 * Measurement-only: run reconciliation with exclusive Mongo span timers.
 * Clears IdentitySyncState for the app so the run follows the full hash NEW path
 * (same class as a first 5k import). Does not change product business logic.
 *
 * Usage (from icm-backend):
 *   node scripts/measureExclusiveReconSpans.js [applicationId]
 */
import "dotenv/config";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import Application from "../src/models/application/Application.js";
import IdentitySyncState from "../src/models/sync/IdentitySyncState.js";
import { getDynamicUserModel } from "../src/models/application/Users.js";
import {
  resolveTenantSlugFromTenantId,
  toTenantObjectId,
} from "../src/utils/applicationDynamicCollections.js";
import { applicationIdInClause } from "../src/services/applicationUserIngestService.js";
import { runReconciliation } from "../src/services/reconciliation/reconciliationOrchestrator.js";
import { clearReconciliationIndexCache } from "../src/utils/reconciliationCollections.js";

const APP_ID = process.argv[2] || "6a6496046c2e48740dd91cfd";
const OUT =
  process.argv[3] ||
  path.resolve(process.cwd(), "../../EXCLUSIVE_RECON_SPANS_MEASUREMENT.json");

function padDot(name, width = 48) {
  const n = String(name);
  if (n.length >= width) return n;
  return n + ".".repeat(width - n.length);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.DB_NAME || process.env.MONGODB_DB_NAME;
  if (!uri) throw new Error("MONGODB_URI required");

  await mongoose.connect(uri, dbName ? { dbName } : undefined);
  console.log("connected", mongoose.connection.name);

  const application = await Application.findById(APP_ID);
  if (!application) throw new Error(`Application not found: ${APP_ID}`);

  const tenantOid = toTenantObjectId(application.tenantId);
  const tenantSlug = await resolveTenantSlugFromTenantId(tenantOid);
  if (!tenantSlug) throw new Error("tenant slug missing");

  const UsersModel = getDynamicUserModel(application.name, tenantSlug);
  const clause = applicationIdInClause(application._id);

  const liveUsers = await UsersModel.find({ applicationId: clause }).lean();
  console.log("liveUsers", liveUsers.length, application.name);

  if (liveUsers.length < 100) {
    throw new Error(
      `Expected ~5k live users for measurement; found ${liveUsers.length}`,
    );
  }

  // Force full hash NEW path (not fast-path): clear sync-state only.
  const del2 = await IdentitySyncState.deleteMany({
    applicationId: {
      $in: [application._id, String(application._id)],
    },
  });
  console.log("cleared identity_sync_state", del2.deletedCount);

  clearReconciliationIndexCache();

  const rawUserDocs = liveUsers.map((u) => {
    const { _id, __v, createdAt, updatedAt, lastReconRunId, ...rest } = u;
    return rest.rawData && typeof rest.rawData === "object"
      ? { ...rest.rawData, ...rest }
      : rest;
  });

  const t0 = Date.now();
  const result = await runReconciliation(application, rawUserDocs, {
    source: "csv_mapped",
    uploadedFileName: "exclusive_span_measurement.csv",
    loadCanonicalDocs: false,
    skipFullReRead: true,
    skipDedupeScan: true,
  });
  const wallMs = Date.now() - t0;

  const spans = result.exclusiveSpans || result.stageTimings?.exclusiveSpans || [];
  const totalMs =
    result.stageTimings?.exclusiveTotalMs ||
    result.stageTimings?.totalReconciliationMs ||
    wallMs;

  const applyNames = [
    "apply.bulkWriteChunkedParallel",
    "apply.postUpsertFind",
    "duplicateSidecar.bulkWriteChunkedParallel",
    "duplicateSidecar.deleteMany.replaceAll",
    "duplicateSidecar.deleteMany.clearAll",
    "duplicateSidecar.deleteMany.staleNorms",
    "apply.removedById.deleteMany",
    "apply.removedByPk.findCandidates",
    "apply.removedByPk.bulkWriteMarkInactive",
    "apply.removedByPk.deleteMany",
    "apply.ensureManagedUserPkUniqueIndex",
    "apply.countDocuments",
    "apply.application.save",
    "apply.buildBulkOps",
    "apply.coll.indexes",
    "apply.dedupeLiveUsersByNormalizedPkField",
    "apply.loadCanonicalDocsById",
    "apply.findAllLiveUsers",
    "apply.replaceAll.deleteMany",
    "apply.replaceAll.dropManagedPkIndexes",
    "apply.replaceAll.findLiveUsers",
    "apply.replaceAll.deleteStale",
  ];

  const byName = new Map();
  for (const s of spans) {
    byName.set(s.name, (byName.get(s.name) || 0) + s.ms);
  }

  const applyRows = [];
  let applySum = 0;
  for (const name of applyNames) {
    const ms = byName.get(name);
    if (ms == null) continue;
    applySum += ms;
    applyRows.push({ stage: name, ms: Math.round(ms * 1000) / 1000 });
  }
  for (const [name, ms] of byName) {
    if (
      (name.startsWith("apply.") || name.startsWith("duplicateSidecar.")) &&
      !applyNames.includes(name)
    ) {
      applySum += ms;
      applyRows.push({ stage: name, ms: Math.round(ms * 1000) / 1000 });
    }
  }
  applyRows.sort((a, b) => b.ms - a.ms);
  for (const row of applyRows) {
    row.pctOfApply =
      applySum > 0 ? Math.round((row.ms / applySum) * 10000) / 100 : 0;
    row.pctOfTotal =
      totalMs > 0 ? Math.round((row.ms / totalMs) * 10000) / 100 : 0;
  }

  const ranked = [...spans].sort((a, b) => b.ms - a.ms).slice(0, 10);

  const report = {
    runId: result.runId,
    applicationId: APP_ID,
    applicationName: application.name,
    liveUsersInput: rawUserDocs.length,
    wallMs,
    totalReconciliationMs: result.stageTimings?.totalReconciliationMs,
    exclusiveTotalMs: result.stageTimings?.exclusiveTotalMs,
    exclusiveAccountedMs: result.stageTimings?.exclusiveAccountedMs,
    exclusiveUnaccountedMs: result.stageTimings?.exclusiveUnaccountedMs,
    stageTimings: result.stageTimings,
    hashOptimized: result.hashOptimized,
    summary: result.summary,
    applyCanonicalUsersBreakdown: applyRows,
    applyCanonicalUsersSumMs: Math.round(applySum * 1000) / 1000,
    waterfall: spans,
    top10ExclusiveSpans: ranked,
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("\n=== applyCanonicalUsers exclusive breakdown ===");
  console.log(
    `${"Stage".padEnd(52)} ${"Time(ms)".padStart(12)} ${"% apply".padStart(10)} ${"% total".padStart(10)}`,
  );
  for (const row of applyRows) {
    console.log(
      `${row.stage.padEnd(52)} ${String(row.ms).padStart(12)} ${String(row.pctOfApply).padStart(10)} ${String(row.pctOfTotal).padStart(10)}`,
    );
  }
  console.log(`apply sum: ${applySum.toFixed(1)} ms`);

  console.log("\n=== Waterfall (exclusive, chronological) ===");
  for (const s of spans) {
    console.log(`${padDot(s.name)}${Math.round(s.ms)}ms`);
  }

  console.log("\n=== Top 10 exclusive spans ===");
  ranked.forEach((s, i) => {
    const pct = totalMs > 0 ? ((s.ms / totalMs) * 100).toFixed(1) : "?";
    console.log(
      `${i + 1}. ${s.name}  ${Math.round(s.ms)}ms  (${pct}% of exclusive total)`,
    );
  });

  console.log("\nWrote", OUT);
  console.log("runId", result.runId, "wallMs", wallMs);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
