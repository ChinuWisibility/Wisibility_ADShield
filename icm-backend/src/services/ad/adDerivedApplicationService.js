import Application from "../models/application/Application.js";
import { normalizeDn } from "./ldapNormalizer.js";
import { buildGroupDnToNameMap } from "./adDirectoryIngestService.js";
import { applyCsvImportMappingToRows } from "./delimitedApplicationUserSync.js";
import { ingestApplicationUsersWithReconciliation } from "./reconciliation/ingestWithReconciliation.js";
import { upsertAggregationsFromAdUserDocs } from "./adAccountAggregationService.js";
import {
  buildAdEntitlementRows,
  ensureDefaultAdEntitlementMappings,
  getDefaultAdEntitlementMappings,
  upsertApplicationEntitlementsFromRows,
} from "./applicationEntitlementIngestService.js";
import { incrementalAdConnectorAccountEntitlementCorrelation } from "./adConnectorCorrelationService.js";
import { mergeMappedAdUserDoc } from "../utils/mergeMappedAdUserDoc.js";
import { incrementalGraphUpdateFromDirectory } from "./graph/graphIncrementalUpdateService.js";
import { validateUserMappings } from "../utils/applicationMappingValidation.js";
import { persistAppIgaUserImportSchemaDocument } from "../controllers/applicationController.js";
import { resolveStableSyncKey } from "./sync/accountHashService.js";

const DEFAULT_AD_USER_MAPPING_DRAFT = [
  {
    csvColumn: "user_id",
    standardField: "user_id",
    dataType: "String",
    displayName: "User ID",
    isPrimaryKey: true,
  },
  {
    csvColumn: "employee_id",
    standardField: "employee_id",
    dataType: "String",
    displayName: "Employee ID",
  },
  {
    csvColumn: "username",
    standardField: "username",
    dataType: "String",
    displayName: "Username",
  },
  {
    csvColumn: "email",
    standardField: "email",
    dataType: "String",
    displayName: "Email",
  },
  {
    csvColumn: "display_name",
    standardField: "display_name",
    dataType: "String",
    displayName: "Display Name",
  },
  {
    csvColumn: "userAccountControl",
    standardField: "status",
    dataType: "String",
    displayName: "Status",
  },
  {
    csvColumn: "department",
    standardField: "department",
    dataType: "String",
    displayName: "Department",
  },
  {
    csvColumn: "title",
    standardField: "title",
    dataType: "String",
    displayName: "Title",
  },
  {
    csvColumn: "manager_id",
    standardField: "manager_id",
    dataType: "String",
    displayName: "Manager ID",
  },
  {
    csvColumn: "telephone",
    standardField: "telephone",
    dataType: "String",
    displayName: "Telephone",
  },
  {
    csvColumn: "member_of_entitlements",
    standardField: "member_of_entitlements",
    dataType: "String",
    displayName: "Member Of (Entitlements)",
  },
];

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

export function getDefaultAdUserMappings() {
  const result = validateUserMappings(DEFAULT_AD_USER_MAPPING_DRAFT);
  if (!result.ok) {
    throw new Error(result.message || "Invalid default AD user mappings");
  }
  return result.normalized.map((mapping) => ({ ...mapping }));
}

export function cloneAdSchemaFieldsFromSource(sourceApplication) {
  const userMappings =
    Array.isArray(sourceApplication?.userMappings) &&
    sourceApplication.userMappings.length > 0
      ? cloneJson(sourceApplication.userMappings)
      : getDefaultAdUserMappings();

  const entitlementMappings =
    Array.isArray(sourceApplication?.entitlementMappings) &&
    sourceApplication.entitlementMappings.length > 0
      ? cloneJson(sourceApplication.entitlementMappings)
      : getDefaultAdEntitlementMappings();

  const csvImportMapping =
    sourceApplication?.csvImportMapping &&
    typeof sourceApplication.csvImportMapping === "object" &&
    Array.isArray(sourceApplication.csvImportMapping.mappings) &&
    sourceApplication.csvImportMapping.mappings.length > 0
      ? cloneJson(sourceApplication.csvImportMapping)
      : undefined;

  const accountsTablePreferences =
    sourceApplication?.accountsTablePreferences &&
    typeof sourceApplication.accountsTablePreferences === "object"
      ? cloneJson(sourceApplication.accountsTablePreferences)
      : undefined;

  return {
    userMappings,
    entitlementMappings,
    csvImportMapping,
    accountsTablePreferences,
  };
}

/** Child app created from AD suggestions (scoped group membership). */
export function isDerivedAdApplication(app) {
  if (!app) return false;
  const sourceId = app.sourceApplicationId?._id || app.sourceApplicationId;
  return Boolean(sourceId && app.connectionConfig?.derivedAd);
}

export function buildDerivedAdConnectionConfig(
  selectedGroups,
  detectedAppName,
  sourceApplicationId,
) {
  const derivedAd = {
    selectedGroups: (selectedGroups || []).map((group) => ({
      dn: String(group?.groupDN || group?.dn || "").trim(),
      name: String(group?.groupName || group?.name || "").trim(),
      objectSid: String(group?.objectSid || "").trim(),
      memberCount: Number(group?.memberCount) || 0,
    })),
    detectedAppName: String(detectedAppName || "").trim(),
    onboardedAt: new Date().toISOString(),
    inheritsIntegrationFromSource: true,
  };
  if (sourceApplicationId) {
    derivedAd.sourceApplicationId = String(sourceApplicationId);
  }
  return { derivedAd };
}

function normalizeSelectedGroupDns(selectedGroups) {
  const dns = new Set();
  for (const group of selectedGroups || []) {
    const dn = normalizeDn(group?.groupDN || group?.dn);
    if (dn) dns.add(dn);
  }
  return dns;
}

function resolveGroupsFromDirectory(directory, selectedGroupDns) {
  const allGroups = directory?.groups || [];
  return allGroups.filter((group) =>
    selectedGroupDns.has(normalizeDn(group?.groupDN)),
  );
}

/**
 * Users who belong to selected groups, with membership limited to those groups only.
 * Preserves delimiter-separated member_of_entitlements and rawData.ad_memberOf_dns.
 */
export function buildScopedUserDocsForDerivedApp({
  userDocs,
  userToGroups,
  groupToUsers: groupToUsersInput,
  groupDnToName,
  selectedGroupDns,
}) {
  const selectedSet =
    selectedGroupDns instanceof Set
      ? selectedGroupDns
      : normalizeSelectedGroupDns(selectedGroupDns);

  const userIds = new Set();
  const groupToUsers = directoryGroupToUsersMap(groupToUsersInput);

  for (const [groupDn, members] of groupToUsers.entries()) {
    if (!selectedSet.has(groupDn)) continue;
    for (const userId of members || []) {
      const key = String(userId || "").trim();
      if (key) userIds.add(key);
    }
  }

  return (userDocs || [])
    .filter((doc) => userIds.has(String(doc?.user_id || "").trim()))
    .map((doc) => {
      const uid = String(doc.user_id || "").trim();
      const allMemberDns = userToGroups?.get?.(uid) || [];
      const scopedDns = allMemberDns.filter((dn) =>
        selectedSet.has(normalizeDn(dn)),
      );
      const labels = scopedDns.map(
        (dn) => groupDnToName.get(normalizeDn(dn)) || dn,
      );

      return {
        ...doc,
        member_of_entitlements: labels.join("; "),
        rawData: applyScopedMembershipToRawData(doc.rawData, scopedDns),
      };
    });
}

function directoryGroupToUsersMap(groupToUsers) {
  if (!groupToUsers) return new Map();
  if (groupToUsers instanceof Map) return groupToUsers;
  return new Map(Object.entries(groupToUsers));
}

function applyScopedMembershipToRawData(rawData, scopedDns) {
  const raw = { ...(rawData || {}) };
  raw.ad_memberOf_dns = scopedDns;
  raw.memberOf = scopedDns.length === 1 ? scopedDns[0] : scopedDns;
  return raw;
}

/**
 * Copy integration metadata from source AD onto derived child applications.
 * @param {import('../models/application/Application.js').default} child
 * @param {object} sourceApplication
 */
export async function syncInheritedMetadataFromSource(child, sourceApplication) {
  if (!child?.connectionConfig?.derivedAd || !sourceApplication) return child;

  child.type = sourceApplication.type || child.type || "directory";
  child.status = sourceApplication.status || child.status || "active";
  child.owner = sourceApplication.owner ?? child.owner;
  child.ownerEmail = sourceApplication.ownerEmail ?? child.ownerEmail;
  child.connectorType = sourceApplication.connectorType ?? child.connectorType;
  child.integrationType =
    sourceApplication.integrationType ?? child.integrationType;
  child.connectionConfig.derivedAd.inheritsIntegrationFromSource = true;
  await child.save();
  return child;
}

export async function persistDerivedApplicationSchemaArtifacts(application) {
  const mappings = application.userMappings || [];
  if (!mappings.length) return;

  await persistAppIgaUserImportSchemaDocument({
    application,
    mappings,
    importedAt: new Date(),
    cfgPlain: application.csvImportMapping || {},
  });
}

/**
 * Ingest users + entitlements + reconciliation + aggregation for one derived AD app.
 */
export async function syncDerivedApplicationFromAdDirectory({
  derivedApplication,
  directory,
  selectedGroups,
}) {
  const selectedGroupDns = normalizeSelectedGroupDns(selectedGroups);
  if (!selectedGroupDns.size) {
    throw new Error("Derived AD application has no selected groups configured.");
  }

  const scopedGroups = resolveGroupsFromDirectory(directory, selectedGroupDns);
  const groupDnToName = buildGroupDnToNameMap(scopedGroups);
  const userToGroups = directory?.membership?.userToGroups;

  const scopedUserDocs = buildScopedUserDocsForDerivedApp({
    userDocs: directory?.userDocs || [],
    userToGroups,
    groupToUsers: directory?.membership?.groupToUsers,
    groupDnToName,
    selectedGroupDns,
  });

  let docs = scopedUserDocs.map((user) => ({
    ...user,
    applicationId: derivedApplication._id,
  }));

  let source = "ad_sync";
  let skippedPk = 0;

  const mapped = applyCsvImportMappingToRows(
    docs.map((doc) => doc.rawData || {}),
    derivedApplication,
  );
  if (mapped?.documentsToInsert?.length > 0) {
    const membershipByUserId = new Map(
      scopedUserDocs.map((d) => [String(d.user_id || "").trim(), d]),
    );
    docs = mapped.documentsToInsert.map((doc) => {
      const uid = String(doc.user_id || doc.rawData?.user_id || "").trim();
      const orig = membershipByUserId.get(uid);
      return mergeMappedAdUserDoc(
        { ...doc, applicationId: derivedApplication._id },
        orig,
      );
    });
    skippedPk = mapped.skippedMissingPk || 0;
    source = "ad_sync_mapped";
  }

  const { summary, canonicalUserDocs, reconciliation, runId, syncDelta, hashOptimized } =
    await ingestApplicationUsersWithReconciliation(derivedApplication, docs, {
      source,
      strictPkResolution: true,
      userMappingsForPk:
        source === "ad_sync_mapped"
          ? derivedApplication.csvImportMapping?.mappings
          : undefined,
      initialSkippedMissingPk: skippedPk,
    });

  const pkField =
    (derivedApplication.userMappings || []).find((m) => m.isPrimaryKey)?.standardField ||
    "user_id";

  const changedPkKeys = syncDelta
    ? [...(syncDelta.newPkKeys || []), ...(syncDelta.changedPkKeys || [])]
    : null;
  const hasAccountChanges = Boolean(changedPkKeys?.length);
  const aggregationIdentityKeys =
    hashOptimized && syncDelta ? (hasAccountChanges ? changedPkKeys : []) : null;

  const agg = await upsertAggregationsFromAdUserDocs({
    application: derivedApplication,
    tenantId: derivedApplication.tenantId,
    userDocs: canonicalUserDocs,
    identityKeysToUpsert: aggregationIdentityKeys,
    allNativeAccountIds: (canonicalUserDocs || docs)
      .map(
        (u) =>
          u.rawData?.objectGUID ||
          u.rawData?.objectguid ||
          u.user_id ||
          u.email,
      )
      .filter(Boolean)
      .map(String),
  });

  const entitlementMappings =
    ensureDefaultAdEntitlementMappings(derivedApplication);
  const memberCountByDn = buildMemberCountByDn(scopedGroups, userToGroups);
  const entitlementRows = buildAdEntitlementRows(scopedGroups, {
    source,
    memberCountByDn,
  });
  const entitlements = await upsertApplicationEntitlementsFromRows(
    derivedApplication,
    entitlementRows,
    entitlementMappings,
  );

  await persistDerivedApplicationSchemaArtifacts(derivedApplication);

  try {
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

    const membershipChangedUserIds = syncDelta
      ? (syncDelta.membershipChangedKeys || [])
          .map((k) => userIdByIdentityKey.get(k))
          .filter(Boolean)
      : (canonicalUserDocs || []).map((d) => d._id).filter(Boolean);

    const removedUserIds = syncDelta?.removedUserIds || [];
    const skipCorrelation =
      hashOptimized &&
      syncDelta &&
      !(syncDelta.membershipChangedKeys?.length) &&
      !removedUserIds.length;

    if (!skipCorrelation) {
      await incrementalAdConnectorAccountEntitlementCorrelation(derivedApplication, {
        userDocs: canonicalUserDocs.length ? canonicalUserDocs : docs,
        membershipChangedUserIds,
        removedUserIds,
        deferStats: true,
      });
    }
  } catch (err) {
    console.error(
      `[syncDerivedApplicationFromAdDirectory] AD membership correlation failed for ${derivedApplication.name}:`,
      err,
    );
  }

  try {
    await incrementalGraphUpdateFromDirectory(derivedApplication, {
      directory,
      canonicalUserDocs,
      groups: scopedGroups,
      source: "ad_sync_derived",
    });
  } catch (err) {
    console.error(
      `[syncDerivedApplicationFromAdDirectory] graph incremental update failed for ${derivedApplication.name}:`,
      err,
    );
  }

  return {
    source,
    summary,
    reconciliation,
    runId,
    usersImported: summary?.liveRows ?? 0,
    entitlementsSynced: entitlements.inserted,
    accountAggregationsUpserted: agg.upserted,
    scopedGroupCount: scopedGroups.length,
    scopedUserCount: scopedUserDocs.length,
  };
}

function buildMemberCountByDn(groups, userToGroups) {
  const map = new Map();
  const g2u = directoryGroupToUsersMap(userToGroups);
  for (const group of groups || []) {
    const dn = normalizeDn(group?.groupDN);
    if (!dn) continue;
    const count = g2u.get(dn)?.length ?? (group?.members?.length || 0);
    map.set(dn, count);
  }
  return map;
}

/**
 * After source AD LDAP sync, refresh all derived child applications from the same directory payload.
 */
export async function refreshDerivedApplicationsFromAdDirectory({
  sourceApplication,
  directory,
}) {
  const sourceId = sourceApplication?._id;
  if (!sourceId) return [];

  const children = await Application.find({
    sourceApplicationId: sourceId,
  }).exec();

  const DERIVED_SYNC_CONCURRENCY = 2;
  const work = children.map((child) => async () => {
    const selectedGroups =
      child.connectionConfig?.derivedAd?.selectedGroups || [];
    if (!selectedGroups.length) {
      return {
        applicationId: String(child._id),
        applicationName: child.name,
        skipped: true,
        reason: "No selectedGroups in derivedAd config",
      };
    }

    try {
      await syncInheritedMetadataFromSource(child, sourceApplication);
      const syncResult = await syncDerivedApplicationFromAdDirectory({
        derivedApplication: child,
        directory,
        selectedGroups,
      });
      return {
        applicationId: String(child._id),
        applicationName: child.name,
        skipped: false,
        ...syncResult,
      };
    } catch (err) {
      return {
        applicationId: String(child._id),
        applicationName: child.name,
        skipped: false,
        error: err?.message || String(err),
      };
    }
  });

  return runWithConcurrency(work, DERIVED_SYNC_CONCURRENCY);
}

/**
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} concurrency
 * @returns {Promise<T[]>}
 */
async function runWithConcurrency(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const idx = next++;
        results[idx] = await tasks[idx]();
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function applyDerivedAdSchemaToApplication(
  application,
  sourceApplication,
) {
  const { userMappings, entitlementMappings, csvImportMapping } =
    cloneAdSchemaFieldsFromSource(sourceApplication);

  application.userMappings = userMappings;
  application.entitlementMappings = entitlementMappings;
  if (csvImportMapping) {
    application.csvImportMapping = csvImportMapping;
  }
  await application.save();
  await persistDerivedApplicationSchemaArtifacts(application);
  return application;
}
