/**
 * Orphan document identity helpers.
 *
 * Orphan rows represent individual application accounts. Document identity MUST be
 * (applicationId, accountId). correlationKey is descriptive/search metadata only.
 */

/**
 * Upsert / find filter for a single orphan account document.
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 * @param {string|import('mongoose').Types.ObjectId} accountId
 */
export function orphanDocumentFilter(applicationId, accountId) {
  return {
    applicationId,
    accountId: String(accountId),
  };
}

/**
 * Purge filter for matched (correlated) accounts.
 * Deletes ONLY the intended account rows — never by shared correlationKey.
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 * @param {Array<string|import('mongoose').Types.ObjectId>} accountIds
 */
export function orphanPurgeFilter(applicationId, accountIds) {
  return {
    applicationId,
    accountId: { $in: accountIds.map((id) => String(id)) },
  };
}

/**
 * Build a bulkWrite updateOne upsert for an OPEN orphan row.
 * Filter is always (applicationId, accountId); correlationKey is stored as metadata.
 */
export function buildOrphanUpsertOp({
  applicationId,
  tenantId,
  accountId,
  accountName,
  correlationKey,
  lastLoginAt = null,
  riskLevel = 'HIGH',
}) {
  const aid = String(accountId);
  return {
    updateOne: {
      filter: orphanDocumentFilter(applicationId, aid),
      update: {
        $set: {
          tenantId,
          applicationId,
          accountId: aid,
          accountName: accountName || '',
          correlationKey,
          status: 'OPEN',
          riskLevel,
          lastLoginAt: lastLoginAt || null,
        },
        $setOnInsert: { detectedAt: new Date() },
      },
      upsert: true,
    },
  };
}
