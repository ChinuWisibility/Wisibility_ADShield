import mongoose from "mongoose";
import PostureScanResult from "../../models/security/PostureScanResult.js";

function toObjectId(value) {
  if (!value) return undefined;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const s = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(s)) return undefined;
  return new mongoose.Types.ObjectId(s);
}

function toDate(value) {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toIsoString(value) {
  if (!value) return value;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Convert a DB document to the API payload shape (same as legacy JSON files).
 * @param {object|null} doc
 */
export function docToApiPayload(doc) {
  if (!doc) return null;
  return {
    scanId: doc.scanId,
    tenantId: doc.tenantId ? String(doc.tenantId) : undefined,
    applicationId: String(doc.applicationId),
    assessmentId: doc.assessmentId ? String(doc.assessmentId) : null,
    assessmentVersionId: doc.assessmentVersionId
      ? String(doc.assessmentVersionId)
      : null,
    status: doc.status,
    startedAt: toIsoString(doc.startedAt),
    completedAt: toIsoString(doc.completedAt),
    modules: doc.modules || [],
    results: doc.results || [],
    findings: doc.findings || [],
    scanConfig: doc.scanConfig || {},
    summary: doc.summary || {},
    diagnostics: doc.diagnostics || [],
    policySnapshot: doc.policySnapshot || null,
  };
}

function buildDocumentFields(payload) {
  const scanId = String(payload?.scanId || "").trim();
  const applicationId = toObjectId(payload?.applicationId);
  if (!scanId) throw new Error("scanId is required to save scan results.");
  if (!applicationId) throw new Error("applicationId is required to save scan results.");

  return {
    scanId,
    applicationId,
    assessmentId: toObjectId(payload?.assessmentId) || null,
    assessmentVersionId: toObjectId(payload?.assessmentVersionId) || null,
    tenantId: toObjectId(payload?.tenantId),
    status: payload?.status || "completed",
    startedAt: toDate(payload?.startedAt),
    completedAt: toDate(payload?.completedAt) || new Date(),
    modules: Array.isArray(payload?.modules) ? payload.modules : [],
    results: payload?.results ?? [],
    findings: payload?.findings ?? [],
    scanConfig: payload?.scanConfig ?? {},
    summary: payload?.summary ?? {},
    diagnostics: Array.isArray(payload?.diagnostics) ? payload.diagnostics : [],
    policySnapshot: payload?.policySnapshot ?? null,
  };
}

/**
 * Persist posture scan payload to MongoDB.
 * @param {object} payload
 */
export async function saveScanResult(payload) {
  const fields = buildDocumentFields(payload);
  await PostureScanResult.findOneAndUpdate(
    { scanId: fields.scanId },
    { $set: fields },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return { scanId: fields.scanId, storage: "mongodb" };
}

/**
 * @param {string} scanId
 */
export async function getScanResult(scanId) {
  const id = String(scanId || "").trim();
  if (!id) return null;
  const doc = await PostureScanResult.findOne({ scanId: id }).lean();
  return docToApiPayload(doc);
}

/**
 * List scan results for an application (newest first).
 * @param {string} applicationId
 * @param {number|object} [limitOrOptions]
 * @param {number} [limitOrOptions.limit]
 * @param {number} [limitOrOptions.skip]
 * @param {string} [limitOrOptions.assessmentId] — filter executions for an Assessment
 * @param {string} [limitOrOptions.assessmentVersionId] — filter executions for a Version
 * @returns {Promise<object[]>}
 */
export async function listScanResultsForApplication(applicationId, limitOrOptions = 20) {
  const appId = toObjectId(applicationId);
  if (!appId) return [];

  const options =
    limitOrOptions && typeof limitOrOptions === "object"
      ? limitOrOptions
      : { limit: limitOrOptions };
  const limit = Math.max(1, Number(options.limit) || 20);
  const skip = Math.max(0, Number(options.skip) || 0);
  const filter = { applicationId: appId };
  const assessmentId = toObjectId(options.assessmentId);
  if (assessmentId) filter.assessmentId = assessmentId;
  const assessmentVersionId = toObjectId(options.assessmentVersionId);
  if (assessmentVersionId) filter.assessmentVersionId = assessmentVersionId;

  const docs = await PostureScanResult.find(filter)
    .sort({ completedAt: -1, startedAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return docs.map(docToApiPayload);
}

/**
 * Count stored scan results for an application.
 * @param {string} applicationId
 * @param {object} [options]
 * @param {string} [options.assessmentId]
 * @param {string} [options.assessmentVersionId]
 * @returns {Promise<number>}
 */
export async function countScanResultsForApplication(applicationId, options = {}) {
  const appId = toObjectId(applicationId);
  if (!appId) return 0;
  const filter = { applicationId: appId };
  const assessmentId = toObjectId(options?.assessmentId);
  if (assessmentId) filter.assessmentId = assessmentId;
  const assessmentVersionId = toObjectId(options?.assessmentVersionId);
  if (assessmentVersionId) filter.assessmentVersionId = assessmentVersionId;
  return PostureScanResult.countDocuments(filter);
}

/**
 * Query stored scan results for downstream security modules.
 * @param {object} [filter]
 * @param {string} [filter.applicationId]
 * @param {string} [filter.tenantId]
 * @param {string} [filter.scanId]
 * @param {string[]} [filter.modules]
 * @param {Date|string} [filter.completedAfter]
 * @param {number} [filter.limit]
 */
export async function queryScanResults({
  applicationId,
  tenantId,
  scanId,
  modules,
  completedAfter,
  limit = 50,
} = {}) {
  const query = {};
  const appId = toObjectId(applicationId);
  const tenId = toObjectId(tenantId);
  if (appId) query.applicationId = appId;
  if (tenId) query.tenantId = tenId;
  if (scanId) query.scanId = String(scanId).trim();
  if (Array.isArray(modules) && modules.length) query.modules = { $in: modules };
  const after = toDate(completedAfter);
  if (after) query.completedAt = { $gte: after };

  const docs = await PostureScanResult.find(query)
    .sort({ completedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .lean();

  return docs.map(docToApiPayload);
}

/**
 * @param {string} scanId
 * @param {object} [options]
 * @param {string} [options.applicationId] - when set, scan must belong to this app
 */
export async function deleteScanResult(scanId, { applicationId } = {}) {
  const id = String(scanId || "").trim();
  if (!id) throw new Error("scanId is required to delete scan results.");

  const doc = await PostureScanResult.findOne({ scanId: id }).lean();
  if (!doc) {
    return { deleted: false, scanId: id, reason: "not_found" };
  }

  const appId = String(applicationId || "").trim();
  if (appId && String(doc.applicationId) !== appId) {
    const err = new Error("Scan does not belong to this application");
    err.code = "SCAN_APP_MISMATCH";
    throw err;
  }

  await PostureScanResult.deleteOne({ scanId: id });
  return {
    deleted: true,
    scanId: id,
    applicationId: String(doc.applicationId),
    findingsRemoved: doc.summary?.totalFindings ?? doc.findings?.length ?? 0,
  };
}

export { PostureScanResult };
