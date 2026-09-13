import mongoose from "mongoose";
import { getDB } from "../config/database.js";
import Application from "../models/application/Application.js";
import { getDynamicUserModel, getDynamicUserModelForTenantId } from "../models/application/Users.js";
import { getDynamicEntitlementModel, getDynamicEntitlementModelForTenantId } from "../models/application/Entitlements.js";
import { getDynamicCorrelationModel } from "../models/application/AppCorrelation.js";
import UploadHistory from "../models/application/UploadHistory.js";
import IntegrationLog from "../models/application/IntegrationLog.js";
import ConnectorConfig from "../models/application/ConnectorConfig.js";

import SchemaMap from "../models/schema/SchemaMap.js";
import SchemaBuilder from "../models/schema/SchemaBuilder.js";
import ApplicationSchema from "../models/application/ApplicationSchema.js";
import AppSchemaMapping from "../models/application/AppSchemaMapping.js";
import ApplicationRiskProfile from "../models/application/ApplicationRiskProfile.js";
import CorrelationRule from "../models/correlation/CorrelationRule.js";
import CorrelationResult from "../models/correlation/CorrelationResult.js";
import IdentityAccountLink from "../models/identity/IdentityAccountLink.js";
import IdentityProfile from "../models/identity/IdentityProfile.js";
import IdentityProfileMapping from "../models/identity/IdentityProfileMapping.js";
import {
  getDynamicIdentityModelForTenantId,
  getLegacyIdentityModel,
} from "../models/identity/Identity.js";
import {
  resolveTenantSlugFromTenantId,
  dropReconciliationCollections,
} from "../utils/applicationDynamicCollections.js";
import {
  getReconciliationRunsCollectionName,
  getAccountsSnapshotCollectionName,
  getDeltaChangesCollectionName,
  getEntitlementDeltaCollectionName,
  getStagingAccountsCollectionName,
  dropReconciliationCollectionByScope,
  RECONCILIATION_DELETION_SCOPE_KEYS,
} from "../utils/reconciliationCollections.js";
import { applicationIdInClause } from "./applicationUserIngestService.js";
import OrphanAccount from "../models/identity/OrphanAccount.js";
import QuarantineProfile from "../models/identity/QuarantineProfile.js";
import Account from "../models/access/Account.js";
import AccountAggregation from "../models/access/AccountAggregation.js";
import ApplicationUserDuplicate from "../models/application/ApplicationUserDuplicate.js";
import Entitlement from "../models/access/Entitlement.js";
import SodQueue from "../models/sod/SodQueue.js";
import SodEntitlement from "../models/sod/SodEntitlement.js";
import SodUserEntitlement from "../models/sod/SodUserEntitlement.js";

/** @typedef {Record<string, boolean>} DeletionScopes */

function appOid(id) {
  return new mongoose.Types.ObjectId(String(id));
}

function legacyCsvCollectionBase(appName) {
  return appName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
}

function entitlementAppQuery(oid) {
  return { $or: [{ applicationId: oid }, { application: oid }] };
}

function isDerivedAdApplicationLean(app) {
  if (!app) return false;
  const sid = app.sourceApplicationId;
  return Boolean(sid && app.connectionConfig?.derivedAd);
}

/** Source AD connector app (not an AD-suggestions child). */
function isPrimaryAdConnectorApplicationLean(app) {
  if (!app) return false;
  if (isDerivedAdApplicationLean(app)) return false;
  return (
    app.connectorType === "ACTIVE_DIRECTORY" || Boolean(app.connectionConfig?.ad)
  );
}

async function findDerivedAdChildApplications(parentApplicationId) {
  const oid = appOid(parentApplicationId);
  return Application.find({
    sourceApplicationId: oid,
    "connectionConfig.derivedAd": { $exists: true },
  })
    .select("name status type description createdAt")
    .sort({ name: 1 })
    .lean();
}

function scopesAllTrueFromImpact(impact) {
  const scopes = {};
  for (const k of impact.allScopeKeys || []) {
    scopes[k] = true;
  }
  return scopes;
}

/**
 * Returns selectable deletion scopes with MongoDB collection hints and counts.
 */
export async function getDeletionImpactSummary(applicationId) {
  if (!mongoose.Types.ObjectId.isValid(String(applicationId))) {
    throw new Error("Invalid application id");
  }
  const app = await Application.findById(applicationId).lean();
  if (!app) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    throw err;
  }

  const oid = appOid(applicationId);
  const safeName = String(app.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const UsersModel = await getDynamicUserModelForTenantId(app.name, app.tenantId);
  const EntModel = await getDynamicEntitlementModelForTenantId(app.name, app.tenantId);
  const Identity = await getDynamicIdentityModelForTenantId(app.tenantId);
  const CorrModel = getDynamicCorrelationModel(app.name);

  const db = getDB();
  const legacyUsersCol = `${legacyCsvCollectionBase(app.name)}_users`;
  const legacyEntCol = `${legacyCsvCollectionBase(app.name)}_entitlements`;

  async function countColl(name, query = {}) {
    const exists = await db.listCollections({ name }).toArray();
    if (!exists.length) return 0;
    return db.collection(name).countDocuments(query);
  }

  const tenantSlug = await resolveTenantSlugFromTenantId(app.tenantId);
  const appIdFilter = { applicationId: applicationIdInClause(oid) };

  let reconRunsCount = 0;
  let reconSnapshotsCount = 0;
  let reconDeltaCount = 0;
  let reconEntDeltaCount = 0;
  let reconStagingCount = 0;
  let reconCollectionNames = null;

  if (tenantSlug) {
    reconCollectionNames = {
      runs: getReconciliationRunsCollectionName(app.name, tenantSlug),
      snapshots: getAccountsSnapshotCollectionName(app.name, tenantSlug),
      deltaChanges: getDeltaChangesCollectionName(app.name, tenantSlug),
      entitlementDeltas: getEntitlementDeltaCollectionName(app.name, tenantSlug),
      staging: getStagingAccountsCollectionName(app.name, tenantSlug),
    };
    [
      reconRunsCount,
      reconSnapshotsCount,
      reconDeltaCount,
      reconEntDeltaCount,
      reconStagingCount,
    ] = await Promise.all([
      countColl(reconCollectionNames.runs, appIdFilter),
      countColl(reconCollectionNames.snapshots, appIdFilter),
      countColl(reconCollectionNames.deltaChanges, appIdFilter),
      countColl(reconCollectionNames.entitlementDeltas, appIdFilter),
      countColl(reconCollectionNames.staging, appIdFilter),
    ]);
  }

  const [
    ingestedUsers,
    ingestedEntitlements,
    ingestedCorrelations,
    legacyUsers,
    legacyEntitlements,
    uploadHistory,
    integrationLogs,
    connectorConfigs,
    correlationRules,
    correlationResults,
    identityAccountLinks,
    orphanAccounts,
    accountsLegacy,
    accountAggregationsV2,
    entitlementsCatalog,
    schemaMaps,
    schemaBuilders,
    applicationSchemas,
    appSchemaMappings,
    applicationRiskProfiles,
    identityProfileMappings,
    identityProfilesReferencing,
    identitiesFromSource,
    quarantineProfiles,
    sodQueues,
    sodEntitlements,
    sodUserEntitlements,
    applicationUserDuplicates,
  ] = await Promise.all([
    UsersModel.countDocuments({ applicationId: oid }),
    EntModel.countDocuments({ applicationId: oid }),
    CorrModel.countDocuments({ applicationId: oid }),
    countColl(legacyUsersCol, { _applicationId: oid }),
    countColl(legacyEntCol, { _applicationId: oid }),
    UploadHistory.countDocuments({ applicationId: oid }),
    IntegrationLog.countDocuments({ applicationId: oid }),
    ConnectorConfig.countDocuments({ applicationId: oid }),
    CorrelationRule.countDocuments({ applicationId: oid }),
    CorrelationResult.countDocuments({ applicationId: oid }),
    IdentityAccountLink.countDocuments({ applicationId: oid }),
    OrphanAccount.countDocuments({ applicationId: oid }),
    Account.countDocuments({ application: oid }),
    AccountAggregation.countDocuments({ applicationId: oid }),
    Entitlement.countDocuments(entitlementAppQuery(oid)),
    SchemaMap.countDocuments({ applicationId: oid }),
    SchemaBuilder.countDocuments({ applicationId: oid }),
    ApplicationSchema.countDocuments({ applicationId: oid }),
    AppSchemaMapping.countDocuments({ applicationId: oid }),
    ApplicationRiskProfile.countDocuments({ applicationId: oid }),
    IdentityProfileMapping.countDocuments({ applicationId: oid }),
    IdentityProfile.countDocuments({
      $or: [
        { sourceApplicationId: oid },
        { expectedApplications: oid },
        { "attributeMappings.applicationId": oid },
        { "attributeAuthority.sourceApplicationId": oid },
      ],
    }),
    Identity.countDocuments({ sourceApplication: oid }),
    QuarantineProfile.countDocuments({ applicationId: oid }),
    SodQueue.countDocuments({ applicationId: oid }),
    SodEntitlement.countDocuments({ applicationId: oid }),
    SodUserEntitlement.countDocuments({ applicationId: oid }),
    ApplicationUserDuplicate.countDocuments({ applicationId: applicationIdInClause(oid) }),
  ]);

  const profilesSourcedHere = await IdentityProfile.countDocuments({
    sourceApplicationId: oid,
  });

  const groups = [
    {
      id: "ingested_csv",
      title: "CSV & ingested application data",
      description:
        "Per-app collections created by Schema Management / CSV upload (dynamic models). Legacy upload route may use a second naming pattern.",
      items: [
        {
          scopeKey: "ingestedUsers",
          label: "Ingested users (accounts from CSV / connector)",
          collection: UsersModel.collection.name,
          count: ingestedUsers,
        },
        {
          scopeKey: "ingestedEntitlements",
          label: "Ingested entitlements",
          collection: EntModel.collection.name,
          count: ingestedEntitlements,
        },
        {
          scopeKey: "ingestedCorrelations",
          label: "App entitlement correlation matrix (dynamic)",
          collection: CorrModel.collection.name,
          count: ingestedCorrelations,
        },
        {
          scopeKey: "legacyCsvCollections",
          label: "Legacy raw CSV rows (alternate upload path)",
          collection: `${legacyUsersCol}, ${legacyEntCol} (if present)`,
          count: legacyUsers + legacyEntitlements,
          detail: { legacyUsers, legacyEntitlements, legacyUsersCol, legacyEntCol },
        },
        {
          scopeKey: "uploadHistory",
          label: "Upload history records",
          collection: "upload_histories",
          count: uploadHistory,
        },
      ],
    },
    {
      id: "reconciliation",
      title: "Reconciliation history & delta tracking",
      description:
        "Reconciliation engine data plus duplicate primary-key rows detected during CSV/connector ingest (first row wins in live users).",
      items: tenantSlug
        ? [
            {
              scopeKey: "applicationUserDuplicates",
              label: "Duplicate account rows (PK collisions, ingest sidecar)",
              collection: "application_user_duplicates",
              count: applicationUserDuplicates,
            },
            {
              scopeKey: "reconciliationRuns",
              label: "Reconciliation runs (audit headers)",
              collection: reconCollectionNames.runs,
              count: reconRunsCount,
            },
            {
              scopeKey: "reconciliationSnapshots",
              label: "Account snapshots per reconciliation run",
              collection: reconCollectionNames.snapshots,
              count: reconSnapshotsCount,
            },
            {
              scopeKey: "reconciliationDeltaChanges",
              label: "User / attribute delta change log",
              collection: reconCollectionNames.deltaChanges,
              count: reconDeltaCount,
            },
            {
              scopeKey: "reconciliationEntitlementDeltas",
              label: "Entitlement catalog delta log",
              collection: reconCollectionNames.entitlementDeltas,
              count: reconEntDeltaCount,
            },
            {
              scopeKey: "reconciliationStaging",
              label: "Reconciliation staging accounts (temporary import)",
              collection: reconCollectionNames.staging,
              count: reconStagingCount,
            },
          ]
        : [
            {
              scopeKey: "applicationUserDuplicates",
              label: "Duplicate account rows (PK collisions, ingest sidecar)",
              collection: "application_user_duplicates",
              count: applicationUserDuplicates,
            },
            {
              scopeKey: "reconciliationRuns",
              label: "Reconciliation collections (tenant slug unavailable — drop may be skipped)",
              collection: "app_iga_*_*_reconciliation_*",
              count:
                reconRunsCount +
                reconSnapshotsCount +
                reconDeltaCount +
                reconEntDeltaCount +
                reconStagingCount,
            },
          ],
    },
    {
      id: "correlation_engine",
      title: "Correlation engine & rules",
      description:
        "Correlation rules, stored results, and per-application correlation scripts.",
      items: [
        {
          scopeKey: "correlationResults",
          label: "Correlation results",
          collection: "correlation_results",
          count: correlationResults,
        },
        {
          scopeKey: "correlationRules",
          label: "Correlation rules",
          collection: "correlation_rules",
          count: correlationRules,
        },

      ],
    },
    {
      id: "correlated_accounts",
      title: "Correlated accounts & links",
      description:
        "Links between identities and accounts, orphan detection, and entitlement catalog rows for this application.",
      items: [
        {
          scopeKey: "identityAccountLinks",
          label: "Identity ↔ account links",
          collection: "identity_account_links",
          count: identityAccountLinks,
        },
        {
          scopeKey: "orphanAccounts",
          label: "Orphan account records",
          collection: "orphan_accounts",
          count: orphanAccounts,
        },
        {
          scopeKey: "accountAggregationsV2",
          label: "Account aggregations (v2)",
          collection: "account_aggregations_v2",
          count: accountAggregationsV2,
        },
        {
          scopeKey: "accountsLegacy",
          label: "Legacy account documents",
          collection: "account_aggregations",
          count: accountsLegacy,
        },
        {
          scopeKey: "entitlementsCatalog",
          label: "Entitlement catalog rows",
          collection: "entitlements",
          count: entitlementsCatalog,
        },
        {
          scopeKey: "quarantineProfiles",
          label: "Quarantine profiles for this app",
          collection: "quarantine_profiles",
          count: quarantineProfiles,
        },
      ],
    },
    {
      id: "identity_profiles",
      title: "Identity profiles & HR mappings",
      description:
        "Profiles that reference this application, row-level mappings, and optional identity cleanup.",
      items: [
        {
          scopeKey: "identityProfileMappings",
          label: "Identity profile mapping rows",
          collection: "identity_profile_mappings",
          count: identityProfileMappings,
        },
        {
          scopeKey: "identityProfilesRemoveRefs",
          label: "Remove this application from identity profiles (safe cleanup)",
          collection: "identity_profiles",
          count: identityProfilesReferencing,
          destructive: false,
        },
        {
          scopeKey: "identityProfilesDeleteSourced",
          label: "Delete identity profiles whose HR source is this application only",
          collection: "identity_profiles",
          count: profilesSourcedHere,
          destructive: true,
        },
        {
          scopeKey: "identitiesFromSourceApp",
          label: "Delete identities created with this source application",
          collection: "identities",
          count: identitiesFromSource,
          destructive: true,
        },
      ],
    },
    {
      id: "config_schema",
      title: "Connector, schema & risk configuration",
      description: "Saved connector settings, schema maps, and risk profile rows.",
      items: [
        {
          scopeKey: "integrationLogs",
          label: "Integration / sync logs",
          collection: "integration_logs",
          count: integrationLogs,
        },
        {
          scopeKey: "connectorConfigs",
          label: "Connector configurations",
          collection: "connector_configs",
          count: connectorConfigs,
        },
        {
          scopeKey: "schemaMaps",
          label: "Schema maps",
          collection: "schema_maps",
          count: schemaMaps,
        },
        {
          scopeKey: "schemaBuilders",
          label: "Schema builders",
          collection: "schema_builders",
          count: schemaBuilders,
        },
        {
          scopeKey: "applicationSchemas",
          label: "Application schema definitions",
          collection: "application_schemas",
          count: applicationSchemas,
        },
        {
          scopeKey: "appSchemaMappings",
          label: "App schema mappings (blueprint)",
          collection: "app_schema_mappings",
          count: appSchemaMappings,
        },
        {
          scopeKey: "applicationRiskProfiles",
          label: "Application risk profiles",
          collection: "application_risk_profiles",
          count: applicationRiskProfiles,
        },
      ],
    },
    {
      id: "sod",
      title: "SoD artifacts",
      description: "Separation-of-duties rows scoped to this application.",
      items: [
        {
          scopeKey: "sodQueues",
          label: "SoD queue jobs",
          collection: "sod_queues",
          count: sodQueues,
        },
        {
          scopeKey: "sodEntitlements",
          label: "SoD entitlements",
          collection: "sod_entitlements",
          count: sodEntitlements,
        },
        {
          scopeKey: "sodUserEntitlements",
          label: "SoD user–entitlement rows",
          collection: "sod_user_entitlements",
          count: sodUserEntitlements,
        },
      ],
    },
  ];

  const flatScopeKeys = groups.flatMap((g) => g.items.map((i) => i.scopeKey));
  flatScopeKeys.push("applicationRecord");

  const isAdConnectorParent = isPrimaryAdConnectorApplicationLean(app);
  const derivedAdChildDocs = isAdConnectorParent
    ? await findDerivedAdChildApplications(oid)
    : [];

  return {
    application: {
      _id: String(app._id),
      name: app.name,
      tenantId: app.tenantId ? String(app.tenantId) : null,
    },
    isAdConnectorParent,
    derivedAdApplications: derivedAdChildDocs.map((child) => ({
      _id: String(child._id),
      name: child.name,
      status: child.status || "",
      type: child.type || "",
      description: child.description || "",
    })),
    dynamicCollectionNames: {
      users: UsersModel.collection.name,
      entitlements: EntModel.collection.name,
      correlations: CorrModel.collection.name,
      reconciliation: reconCollectionNames,
    },
    groups,
    applicationRecord: {
      scopeKey: "applicationRecord",
      label: "Remove the application registry record",
      collection: "applications",
      count: 1,
    },
    allScopeKeys: flatScopeKeys,
  };
}

/**
 * @param {DeletionScopes} scopes
 */
export async function executeScopedApplicationDeletion(applicationId, scopes = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(applicationId))) {
    throw new Error("Invalid application id");
  }
  const app = await Application.findById(applicationId);
  if (!app) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    throw err;
  }

  const oid = appOid(applicationId);
  const db = getDB();
  const legacyBase = legacyCsvCollectionBase(app.name);
  const results = {};
  const Identity = await getDynamicIdentityModelForTenantId(app.tenantId);
  const LegacyIdentity = getLegacyIdentityModel();

  const run = async (key, fn) => {
    if (!scopes[key]) return;
    results[key] = await fn();
  };

  // Order: results & links before rules; entitlements after accounts; dynamic drops near end
  await run("correlationResults", () =>
    CorrelationResult.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );
  await run("identityAccountLinks", () =>
    IdentityAccountLink.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );
  await run("orphanAccounts", () =>
    OrphanAccount.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );
  await run("accountsLegacy", () =>
    Account.deleteMany({ application: oid }).then((r) => r.deletedCount),
  );
  await run("accountAggregationsV2", () =>
    AccountAggregation.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );
  await run("entitlementsCatalog", () =>
    Entitlement.deleteMany(entitlementAppQuery(oid)).then((r) => r.deletedCount),
  );
  await run("correlationRules", () =>
    CorrelationRule.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );
  await run("quarantineProfiles", () =>
    QuarantineProfile.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );

  await run("sodUserEntitlements", () =>
    SodUserEntitlement.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );
  await run("sodEntitlements", () =>
    SodEntitlement.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );
  await run("sodQueues", () =>
    SodQueue.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );

  await run("integrationLogs", () =>
    IntegrationLog.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );
  await run("connectorConfigs", () =>
    ConnectorConfig.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );

  await run("identityProfileMappings", () =>
    IdentityProfileMapping.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );

  await run("identityProfilesDeleteSourced", () =>
    IdentityProfile.deleteMany({ sourceApplicationId: oid }).then((r) => r.deletedCount),
  );

  await run("identityProfilesRemoveRefs", async () => {
    let n = 0;
    const r1 = await IdentityProfile.updateMany(
      { expectedApplications: oid },
      { $pull: { expectedApplications: oid } },
    );
    n += r1.modifiedCount || 0;
    const r2 = await IdentityProfile.updateMany(
      { "attributeMappings.applicationId": oid },
      { $pull: { attributeMappings: { applicationId: oid } } },
    );
    n += r2.modifiedCount || 0;
    const r3 = await IdentityProfile.updateMany(
      { "attributeAuthority.sourceApplicationId": oid },
      { $pull: { attributeAuthority: { sourceApplicationId: oid } } },
    );
    n += r3.modifiedCount || 0;
    const r4 = await IdentityProfile.updateMany(
      { sourceApplicationId: oid },
      { $unset: { sourceApplicationId: "" } },
    );
    n += r4.modifiedCount || 0;
    return n;
  });

  await run("identitiesFromSourceApp", () =>
    Promise.all([
      Identity.deleteMany({ sourceApplication: oid }),
      LegacyIdentity.deleteMany({ sourceApplication: oid }),
    ]).then(([r]) => r.deletedCount),
  );

  await run("schemaMaps", () =>
    SchemaMap.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );
  await run("schemaBuilders", () =>
    SchemaBuilder.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );
  await run("applicationSchemas", () =>
    ApplicationSchema.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );
  await run("appSchemaMappings", () =>
    AppSchemaMapping.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );
  await run("applicationRiskProfiles", () =>
    ApplicationRiskProfile.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );
  await run("uploadHistory", () =>
    UploadHistory.deleteMany({ applicationId: oid }).then((r) => r.deletedCount),
  );

  const UsersModel = await getDynamicUserModelForTenantId(app.name, app.tenantId);
  const EntModel = await getDynamicEntitlementModelForTenantId(app.name, app.tenantId);
  const CorrModel = getDynamicCorrelationModel(app.name);

  await run("ingestedCorrelations", async () => {
    const appSlug = app.name.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
    const statsName = `app_${appSlug}_correlation_stats`;
    try {
      await db.collection(statsName).drop();
    } catch (e) {
      if (!String(e?.message || e).includes("ns not found")) throw e;
    }
    try {
      await CorrModel.collection.drop();
      return true;
    } catch (e) {
      if (String(e?.message || e).includes("ns not found")) return 0;
      throw e;
    }
  });
  await run("ingestedEntitlements", async () => {
    try {
      await EntModel.collection.drop();
      return true;
    } catch (e) {
      if (String(e?.message || e).includes("ns not found")) return 0;
      throw e;
    }
  });
  await run("applicationUserDuplicates", () =>
    ApplicationUserDuplicate.deleteMany({ applicationId: applicationIdInClause(oid) }).then(
      (r) => r.deletedCount,
    ),
  );
  await run("applicationUserInactiveAccess", async () => {
    const { deleteInactiveAccessSidecarForApplication } = await import(
      "./datahygine/applicationUserInactiveAccessSidecar.js"
    );
    await deleteInactiveAccessSidecarForApplication(oid);
    return true;
  });
  await run("applicationManagerMismatches", async () => {
    const { deleteManagerMismatchSidecarForApplication } = await import(
      "./datahygine/applicationManagerMismatchSidecar.js"
    );
    await deleteManagerMismatchSidecarForApplication(oid);
    return true;
  });
  await run("applicationStatusMismatches", async () => {
    const { deleteStatusMismatchSidecarForApplication } = await import(
      "./datahygine/applicationStatusMismatchSidecar.js"
    );
    await deleteStatusMismatchSidecarForApplication(oid);
    return true;
  });

  // Always clear hygiene V2 rollups/jobs for this app (not client-scoped).
  try {
    const { deleteHygieneRollupsForApplication, invalidateHygieneTenantSummary } =
      await import("./datahygine/hygieneRollupService.js");
    await deleteHygieneRollupsForApplication(oid);
    if (app.tenantId) {
      await invalidateHygieneTenantSummary(app.tenantId);
      const { scheduleDataHygieneSummaryRecompute } = await import(
        "./datahygine/dataHygieneSummaryCacheService.js"
      );
      scheduleDataHygieneSummaryRecompute(app.tenantId);
    }
    results.hygieneAppRollups = true;
  } catch (e) {
    console.error("[applicationDeletion] hygiene rollup cleanup failed", e?.message || e);
  }
  try {
    const HygieneJob = (await import("../models/dataHygiene/HygieneJob.js")).default;
    const r = await HygieneJob.deleteMany({ applicationId: oid });
    results.hygieneJobs = r.deletedCount;
  } catch (e) {
    console.error("[applicationDeletion] hygiene job cleanup failed", e?.message || e);
  }

  const tenantSlugForDelete = await resolveTenantSlugFromTenantId(app.tenantId);
  for (const scopeKey of RECONCILIATION_DELETION_SCOPE_KEYS) {
    await run(scopeKey, async () => {
      if (!tenantSlugForDelete) return 0;
      return dropReconciliationCollectionByScope(db, app.name, tenantSlugForDelete, scopeKey);
    });
  }
  /** @deprecated Use individual reconciliation* scopes; kept for older clients. */
  await run("reconciliationCollections", async () => {
    if (!tenantSlugForDelete) return 0;
    return dropReconciliationCollections(db, app.name, tenantSlugForDelete);
  });
  await run("ingestedUsers", async () => {
    try {
      await UsersModel.collection.drop();
      return true;
    } catch (e) {
      if (String(e?.message || e).includes("ns not found")) return 0;
      throw e;
    }
  });

  await run("legacyCsvCollections", async () => {
    let total = 0;
    for (const suffix of ["users", "entitlements"]) {
      const name = `${legacyBase}_${suffix}`;
      const exists = await db.listCollections({ name }).toArray();
      if (!exists.length) continue;
      const r = await db.collection(name).deleteMany({
        $or: [{ _applicationId: oid }, { applicationId: oid }],
      });
      total += r.deletedCount || 0;
    }
    return total;
  });

  if (scopes.applicationRecord) {
    const derivedChildrenDeleted = [];
    if (isPrimaryAdConnectorApplicationLean(app)) {
      const children = await findDerivedAdChildApplications(oid);
      for (const child of children) {
        const childImpact = await getDeletionImpactSummary(child._id);
        const childScopes = scopesAllTrueFromImpact(childImpact);
        await executeScopedApplicationDeletion(child._id, childScopes);
        derivedChildrenDeleted.push({
          applicationId: String(child._id),
          name: child.name,
        });
      }
    }
    await Application.findByIdAndDelete(oid);
    results.applicationRecord = 1;
    if (derivedChildrenDeleted.length) {
      results.derivedAdChildrenDeleted = derivedChildrenDeleted;
    }
  }

  return { results, applicationId: String(oid) };
}
