import AccountAggregation from '../models/access/AccountAggregation.js';
import {
  loadDuplicatePrimaryKeyNormalizedSet,
  normalizePrimaryKeyValue,
} from './applicationUserIngestService.js';
import { getPrimaryKeyValueFromAccountDoc } from '../utils/identityProfileMappingUtils.js';

const BULK_CHUNK = 500;

function nativeAccountIdFromUser(u) {
  return String(
    u.rawData?.objectGUID ||
      u.rawData?.objectguid ||
      u.rawData?.employeeNumber ||
      u.rawData?.employeeID ||
      u.user_id ||
      u.email ||
      '',
  ).trim();
}

function buildAggregationOp({ application, tenantId, u, dupPkSet, userMappings }) {
  const appId = application._id;
  const nativeAccountId = nativeAccountIdFromUser(u);
  if (!nativeAccountId) return null;

  const disabled = u.status === 'disabled';
  const raw = {
    ...(u.rawData || {}),
    ldap_user_id: u.user_id,
    ldap_email: u.email,
    ldap_employee_id: u.employee_id,
  };

  const docLike = { ...u, applicationId: appId, rawData: u.rawData || {} };
  const pkNorm = normalizePrimaryKeyValue(
    getPrimaryKeyValueFromAccountDoc(docLike, userMappings),
  );
  const ambiguousDuplicateApplicationPk = Boolean(pkNorm && dupPkSet.has(pkNorm));

  return {
    nativeAccountId,
    op: {
      updateOne: {
        filter: { applicationId: appId, nativeAccountId },
        update: {
          $set: {
            tenantId,
            applicationId: appId,
            nativeAccountId,
            accountName: u.user_id || u.email || nativeAccountId,
            accountType: 'USER',
            status: disabled ? 'DISABLED' : 'ACTIVE',
            rawAttributes: raw,
            isOrphan: false,
            ambiguousDuplicateApplicationPk,
          },
        },
        upsert: true,
      },
    },
  };
}

/**
 * Upsert LDAP/AD user docs into account_aggregations_v2 for identity correlation.
 * When identityKeysToUpsert is provided, only changed/new accounts are rewritten.
 */
export async function upsertAggregationsFromAdUserDocs({
  application,
  tenantId,
  userDocs,
  identityKeysToUpsert = null,
  allNativeAccountIds = null,
}) {
  const appId = application._id;
  if (!tenantId) {
    throw new Error('tenantId is required for account aggregation.');
  }

  if (!userDocs.length) {
    await AccountAggregation.deleteMany({ applicationId: appId, tenantId });
    application.totalAccounts = 0;
    application.lastAggregation = new Date();
    await application.save();
    return { upserted: 0, skipped: 0 };
  }

  const dupPkSet = await loadDuplicatePrimaryKeyNormalizedSet(appId);
  const userMappings = application.userMappings || [];
  const upsertKeySet =
    identityKeysToUpsert === null
      ? null
      : new Set((identityKeysToUpsert || []).map((k) => normalizePrimaryKeyValue(k)));

  const ops = [];
  const nativeIds = allNativeAccountIds ? new Set(allNativeAccountIds) : new Set();
  let skipped = 0;

  for (const u of userDocs) {
    const docLike = { ...u, applicationId: appId, rawData: u.rawData || {} };
    const pkNorm = normalizePrimaryKeyValue(
      getPrimaryKeyValueFromAccountDoc(docLike, userMappings),
    );

    const nativeAccountId = nativeAccountIdFromUser(u);
    if (nativeAccountId && !allNativeAccountIds) nativeIds.add(nativeAccountId);

    if (upsertKeySet && pkNorm && !upsertKeySet.has(pkNorm)) {
      skipped += 1;
      continue;
    }

    const built = buildAggregationOp({
      application,
      tenantId,
      u,
      dupPkSet,
      userMappings,
    });
    if (built?.op) ops.push(built.op);
  }

  if (ops.length > 0) {
    for (let i = 0; i < ops.length; i += BULK_CHUNK) {
      const chunk = ops.slice(i, i + BULK_CHUNK);
      await AccountAggregation.bulkWrite(chunk, { ordered: false });
    }
  }

  if (nativeIds.size > 0) {
    await AccountAggregation.updateMany(
      {
        applicationId: appId,
        tenantId,
        nativeAccountId: { $nin: [...nativeIds] },
      },
      { $set: { isOrphan: true }, $unset: { correlatedIdentityId: 1 } },
    );
  }

  application.totalAccounts = nativeIds.size;
  application.lastAggregation = new Date();
  await application.save();

  return { upserted: ops.length, skipped };
}
