import IdentityGraphMetadata from "../../models/security/IdentityGraphMetadata.js";

const DEFAULT_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

export async function getGraphMetadata(tenantId, applicationId) {
  return IdentityGraphMetadata.findOne({ tenantId, applicationId }).lean();
}

export async function isGraphFreshForScan(
  tenantId,
  applicationId,
  maxAgeMs = DEFAULT_FRESHNESS_MS,
) {
  const meta = await getGraphMetadata(tenantId, applicationId);
  if (!meta?.lastIncrementalUpdateAt) return false;
  if (!meta.edgeCount && meta.edgeCount !== 0) return false;

  const age = Date.now() - new Date(meta.lastIncrementalUpdateAt).getTime();
  return age >= 0 && age < maxAgeMs;
}

export async function updateGraphMetadata(tenantId, applicationId, patch) {
  const { skipVersionBump, ...setFields } = patch;
  const update = { $set: setFields };
  if (!skipVersionBump) {
    update.$inc = { graphVersion: 1 };
  }
  return IdentityGraphMetadata.findOneAndUpdate(
    { tenantId, applicationId },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

export async function markScanAnalyzed(tenantId, applicationId) {
  return updateGraphMetadata(tenantId, applicationId, {
    lastScanAnalyzedAt: new Date(),
    skipVersionBump: true,
  });
}
