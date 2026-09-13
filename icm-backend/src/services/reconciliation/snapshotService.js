import {
  getReconciliationModels,
  bulkInsertChunked,
} from "../../utils/reconciliationCollections.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import { applicationIdInClause } from "../application/applicationUserIngestService.js";
import { buildAccountEntryFromDoc } from "./reconciliationAccountUtils.js";

/**
 * Load previous run snapshot into identityKey → account entry map.
 * @param {import('mongoose').Model} SnapshotModel
 * @param {import('mongoose').Types.ObjectId} applicationId
 * @param {string} runId
 */
export async function loadSnapshotMap(SnapshotModel, applicationId, runId, options = {}) {
  const map = new Map();
  const run = async (name, fn) =>
    options.exclusiveTimer ? options.exclusiveTimer.span(name, fn) : fn();
  await run("loadSnapshotMap.Snapshot.cursor", async () => {
    const cursor = SnapshotModel.find({
      applicationId: applicationIdInClause(applicationId),
      runId,
    })
      .select("identityKey attributes entitlements")
      .lean()
      .cursor();

    for await (const row of cursor) {
      map.set(row.identityKey, {
        identityKey: row.identityKey,
        attributes: row.attributes || {},
        entitlements: new Set(row.entitlements || []),
      });
    }
  });
  return map;
}

/**
 * When no prior reconciliation snapshot exists, compare against live materialized users
 * (e.g. app was loaded before reconciliation was enabled, or a prior run failed before snapshot).
 *
 * @param {object} application
 * @param {string} tenantSlug
 * @param {object[]} userMappings
 * @param {object} [csvImportMapping]
 */
export async function loadLiveUsersAccountMap(
  application,
  tenantSlug,
  userMappings,
  csvImportMapping,
) {
  const pk = (userMappings || []).find((m) => m.isPrimaryKey);
  const pkField = pk ? String(pk.standardField || "").trim() : "";
  if (!pkField) return new Map();

  const UsersModel = await getDynamicUserModelForTenantId(
    application.name,
    application.tenantId,
  );
  const map = new Map();
  const cursor = UsersModel.find({
    applicationId: applicationIdInClause(application._id),
  })
    .lean()
    .cursor();

  for await (const doc of cursor) {
    const entry = buildAccountEntryFromDoc(doc, userMappings, pkField, csvImportMapping);
    if (!entry.identityKey) continue;
    map.set(entry.identityKey, {
      identityKey: entry.identityKey,
      attributes: entry.attributes,
      entitlements: entry.entitlements,
    });
  }
  return map;
}

/**
 * @param {object} params
 */
export async function persistRunSnapshot({
  SnapshotModel,
  runId,
  applicationId,
  tenantId,
  canonicalDocs,
  userMappings,
  csvImportMapping,
  snapshotDate,
  exclusiveTimer = null,
}) {
  const pk = (userMappings || []).find((m) => m.isPrimaryKey);
  const pkField = pk ? String(pk.standardField || "").trim() : "";
  const docs = [];

  for (const doc of canonicalDocs || []) {
    const entry = buildAccountEntryFromDoc(doc, userMappings, pkField, csvImportMapping);
    if (!entry.identityKey) continue;
    docs.push({
      runId,
      identityKey: entry.identityKey,
      applicationId,
      tenantId,
      snapshotDate,
      attributes: entry.attributes,
      entitlements: [...entry.entitlements],
    });
  }

  const run = async (name, fn) => (exclusiveTimer ? exclusiveTimer.span(name, fn) : fn());
  return run("persistRunSnapshot.bulkInsertChunked", () =>
    bulkInsertChunked(SnapshotModel, docs),
  );
}

/**
 * @param {string} appName
 * @param {string} tenantSlug
 */
export function getSnapshotModel(appName, tenantSlug) {
  return getReconciliationModels(appName, tenantSlug).Snapshot;
}
