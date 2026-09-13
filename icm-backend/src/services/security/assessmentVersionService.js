import crypto from "crypto";
import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import AdSecurityAssessmentVersion from "../../models/security/AdSecurityAssessmentVersion.js";
import AdSecurityAssessment, {
  AD_SECURITY_ASSESSMENT_STATUS,
} from "../../models/security/AdSecurityAssessment.js";
import PostureScanResult from "../../models/security/PostureScanResult.js";
import { buildFeatureConfigPayload } from "./applicationSecurityQueryService.js";
import { getPostureFeatureById } from "../posture/postureFeatureRegistry.js";

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const s = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/**
 * Fingerprint of executable configuration (ignores metadata timestamps/labels).
 */
export function fingerprintConfiguration(config = {}) {
  const payload = {
    enabledMap: config.enabledMap || {},
    queryOverrides: config.queryOverrides || {},
    featureSettings: config.featureSettings || {},
    securityScanSettings: config.securityScanSettings || {},
  };
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function deriveMapsFromFeatures(features = []) {
  const queryOverrides = {};
  const enabledMap = {};
  for (const tile of features) {
    const key = tile?.featureKey;
    if (!key) continue;
    enabledMap[key] = Boolean(tile.enabled);
    const entry = {};
    if (tile.ldapFilter?.trim()) entry.ldapFilter = tile.ldapFilter.trim();
    if (tile.searchBase?.trim()) entry.searchBase = tile.searchBase.trim();
    if (tile.searchScope?.trim()) entry.searchScope = tile.searchScope.trim();
    if (Object.keys(entry).length) queryOverrides[key] = entry;
  }
  return { queryOverrides, enabledMap };
}

/**
 * Normalize a configuration object into the canonical Working/Version shape.
 * Feature tiles are the source of truth for enablement and LDAP overrides when present.
 * (Stale enabledMap/queryOverrides must not override tile toggles — that caused
 * Execute to "Reused Version N" and run only earlier features.)
 */
export function normalizeConfiguration(raw = {}, extras = {}) {
  const features = Array.isArray(raw.features) ? raw.features : [];
  const derived = deriveMapsFromFeatures(features);

  const enabledMap = features.length
    ? derived.enabledMap
    : raw.enabledMap && typeof raw.enabledMap === "object"
      ? raw.enabledMap
      : {};

  const queryOverrides = features.length
    ? derived.queryOverrides
    : raw.queryOverrides && typeof raw.queryOverrides === "object"
      ? raw.queryOverrides
      : {};

  const config = {
    features,
    queryOverrides,
    enabledMap,
    featureSettings:
      extras.featureSettings && typeof extras.featureSettings === "object"
        ? extras.featureSettings
        : raw.featureSettings && typeof raw.featureSettings === "object"
          ? raw.featureSettings
          : {},
    securityScanSettings:
      raw.securityScanSettings && typeof raw.securityScanSettings === "object"
        ? raw.securityScanSettings
        : {},
    policySnapshotRef: extras.policySnapshotRef ?? raw.policySnapshotRef ?? null,
    source: extras.source || raw.source || "working_configuration",
  };
  config.contentFingerprint = fingerprintConfiguration(config);
  return config;
}

export function versionToApi(doc) {
  if (!doc) return null;
  const snapshot = doc.configSnapshot || null;
  return {
    assessmentVersionId: String(doc._id),
    assessmentId: String(doc.assessmentId),
    applicationId: String(doc.applicationId),
    tenantId: doc.tenantId ? String(doc.tenantId) : null,
    versionNumber: doc.versionNumber,
    label: doc.label || `Version ${doc.versionNumber}`,
    changeSummary: doc.changeSummary || "",
    configSnapshot: snapshot,
    features: Array.isArray(snapshot?.features) ? snapshot.features : null,
    contentFingerprint: doc.contentFingerprint || snapshot?.contentFingerprint || "",
    createdFromVersionId: doc.createdFromVersionId
      ? String(doc.createdFromVersionId)
      : null,
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    executionCount: doc.executionCount || 0,
    latestExecutionId: doc.latestExecutionId || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function workingConfigurationToApi(config) {
  if (!config) return null;
  const normalized = normalizeConfiguration(config);
  return {
    ...normalized,
    features: Array.isArray(normalized.features) ? normalized.features : [],
  };
}

/**
 * Build configuration from application draft overrides (seed / reset source).
 * @param {string} applicationId
 * @param {{ source?: string, featureSettings?: object, forceAllDisabled?: boolean }} [extras]
 *   forceAllDisabled — assessment Working Configuration starts opt-in (all toggles off).
 */
export async function buildConfigurationFromApplication(applicationId, extras = {}) {
  const appId = toObjectId(applicationId);
  if (!appId) throw new Error("applicationId is required");

  const [payload, app] = await Promise.all([
    buildFeatureConfigPayload(appId),
    Application.findById(appId).select("securityScanSettings").lean(),
  ]);

  let features = Array.isArray(payload?.features) ? payload.features : [];
  if (extras.forceAllDisabled) {
    features = features.map((f) => ({ ...f, enabled: false }));
  }

  return normalizeConfiguration(
    {
      features,
      securityScanSettings: app?.securityScanSettings || {},
    },
    {
      featureSettings: extras.featureSettings,
      source: extras.source || "application_overrides",
    },
  );
}

/** @deprecated Use buildConfigurationFromApplication */
export async function buildConfigurationSnapshot(applicationId, extras = {}) {
  return buildConfigurationFromApplication(applicationId, extras);
}

export function resolveExecutionConfigFromSnapshot(configSnapshot) {
  const snapshot = configSnapshot || {};
  const enabledMap = snapshot.enabledMap || {};
  const featuresFromTiles = Array.isArray(snapshot.features)
    ? snapshot.features
        .filter((f) => f?.enabled && f?.implemented !== false)
        .map((f) => f.featureKey)
    : [];
  const featuresFromMap = Object.entries(enabledMap)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);
  const features = [
    ...new Set(featuresFromTiles.length ? featuresFromTiles : featuresFromMap),
  ].filter(Boolean);

  return {
    features,
    queryOverrides: snapshot.queryOverrides || {},
    featureSettings: snapshot.featureSettings || {},
    securityScanSettings: snapshot.securityScanSettings || {},
  };
}

async function nextVersionNumber(assessmentId) {
  const latest = await AdSecurityAssessmentVersion.findOne({ assessmentId })
    .sort({ versionNumber: -1 })
    .select("versionNumber")
    .lean();
  const current = Number(latest?.versionNumber);
  if (!Number.isFinite(current)) return 1;
  return current >= 0 ? current + 1 : 1;
}

export async function getAssessmentDoc(assessmentId, { applicationId } = {}) {
  const id = toObjectId(assessmentId);
  if (!id) return null;
  const filter = { _id: id };
  if (applicationId) {
    const appId = toObjectId(applicationId);
    if (appId) filter.applicationId = appId;
  }
  return AdSecurityAssessment.findOne(filter).lean();
}

/**
 * Ensure Assessment has a Working Configuration (seed from application if missing).
 */
export async function ensureWorkingConfiguration(assessmentId, { applicationId } = {}) {
  const doc = await getAssessmentDoc(assessmentId, { applicationId });
  if (!doc) return null;

  if (doc.workingConfiguration?.features?.length || doc.workingConfiguration?.enabledMap) {
    return workingConfigurationToApi(doc.workingConfiguration);
  }

  const seeded = await buildConfigurationFromApplication(doc.applicationId, {
    source: "seeded_on_open",
    forceAllDisabled: true,
  });
  seeded.updatedAt = new Date().toISOString();

  await AdSecurityAssessment.findByIdAndUpdate(doc._id, {
    $set: {
      workingConfiguration: seeded,
      status:
        doc.status === AD_SECURITY_ASSESSMENT_STATUS.DRAFT
          ? AD_SECURITY_ASSESSMENT_STATUS.CONFIGURED
          : doc.status,
    },
  });

  return workingConfigurationToApi(seeded);
}

export async function getWorkingConfiguration(assessmentId, { applicationId } = {}) {
  return ensureWorkingConfiguration(assessmentId, { applicationId });
}

export async function replaceWorkingConfiguration(
  assessmentId,
  configuration,
  { applicationId } = {},
) {
  const doc = await getAssessmentDoc(assessmentId, { applicationId });
  if (!doc) return null;

  const normalized = normalizeConfiguration(configuration, {
    source: "working_configuration",
  });
  normalized.updatedAt = new Date().toISOString();

  const enabledCount = Object.values(normalized.enabledMap || {}).filter(Boolean).length;
  const updated = await AdSecurityAssessment.findByIdAndUpdate(
    doc._id,
    {
      $set: {
        workingConfiguration: normalized,
        status:
          enabledCount > 0
            ? AD_SECURITY_ASSESSMENT_STATUS.READY
            : AD_SECURITY_ASSESSMENT_STATUS.CONFIGURED,
      },
    },
    { new: true },
  ).lean();

  return workingConfigurationToApi(updated.workingConfiguration);
}

/**
 * Upsert a single feature into Working Configuration.
 */
export async function upsertWorkingConfigurationFeature(
  assessmentId,
  featureKey,
  patch = {},
  { applicationId } = {},
) {
  const working = await ensureWorkingConfiguration(assessmentId, { applicationId });
  if (!working) return null;

  const feature = getPostureFeatureById(featureKey);
  if (!feature && !working.features?.some((f) => f.featureKey === featureKey)) {
    const err = new Error(`Unknown security feature: ${featureKey}`);
    err.code = "UNKNOWN_FEATURE";
    throw err;
  }

  const features = Array.isArray(working.features) ? [...working.features] : [];
  const idx = features.findIndex((f) => f.featureKey === featureKey);
  const base =
    idx >= 0
      ? { ...features[idx] }
      : {
          featureKey,
          name: feature?.name || featureKey,
          description: feature?.description || "",
          category: feature?.category,
          moduleId: feature?.moduleId,
          riskLevel: feature?.riskLevel,
          executionMode: feature?.executionMode,
          objectTypes: feature?.objectTypes || [],
          implemented: feature?.implemented !== false,
          enabled: feature?.defaultEnabled ?? false,
          ldapFilter: feature?.defaultFilter || feature?.ldapFilter || "",
          defaultLdapFilter: feature?.defaultFilter || feature?.ldapFilter || "",
          searchBase: feature?.defaultSearchBaseDn || "",
          searchScope: feature?.searchScope || "Subtree",
          settings: feature?.settings || [],
        };

  if (patch.enabled !== undefined) base.enabled = Boolean(patch.enabled);
  if (patch.ldapFilter !== undefined) base.ldapFilter = String(patch.ldapFilter || "");
  if (patch.searchBase !== undefined) base.searchBase = String(patch.searchBase || "");
  if (patch.searchScope !== undefined) base.searchScope = String(patch.searchScope || "Subtree");
  base.modified = true;

  if (idx >= 0) features[idx] = base;
  else features.push(base);

  const next = {
    ...working,
    features,
    featureSettings: working.featureSettings || {},
    securityScanSettings: working.securityScanSettings || {},
  };

  if (patch.featureSettings && typeof patch.featureSettings === "object") {
    next.featureSettings = {
      ...(next.featureSettings || {}),
      [featureKey]: {
        ...((next.featureSettings || {})[featureKey] || {}),
        ...patch.featureSettings,
      },
    };
    if (patch.featureSettings.inactiveUsersDays != null) {
      next.securityScanSettings = {
        ...(next.securityScanSettings || {}),
        inactiveUsersDays: patch.featureSettings.inactiveUsersDays,
      };
    }
  }

  return replaceWorkingConfiguration(assessmentId, next, { applicationId });
}

export async function resetWorkingConfigurationFromApplication(
  assessmentId,
  { applicationId } = {},
) {
  const doc = await getAssessmentDoc(assessmentId, { applicationId });
  if (!doc) return null;
  const seeded = await buildConfigurationFromApplication(doc.applicationId, {
    source: "reset_from_application",
    // Reset returns to a blank slate; admin re-enables the features for this assessment.
    forceAllDisabled: true,
  });
  return replaceWorkingConfiguration(assessmentId, seeded, {
    applicationId: String(doc.applicationId),
  });
}

export async function cloneVersionToWorkingConfiguration(
  assessmentId,
  assessmentVersionId,
  { applicationId } = {},
) {
  const version = await getVersionById(assessmentVersionId, {
    applicationId,
    assessmentId,
  });
  if (!version?.configSnapshot) {
    const err = new Error("Assessment Version snapshot not found");
    err.code = "VERSION_NOT_FOUND";
    throw err;
  }
  return replaceWorkingConfiguration(assessmentId, version.configSnapshot, {
    applicationId,
  });
}

export async function listVersionsForAssessment(
  assessmentId,
  { applicationId, limit = 50, skip = 0, includeExecutions = false } = {},
) {
  const aId = toObjectId(assessmentId);
  if (!aId) return { items: [], total: 0 };
  const filter = { assessmentId: aId };
  if (applicationId) {
    const appId = toObjectId(applicationId);
    if (appId) filter.applicationId = appId;
  }
  const [docs, total] = await Promise.all([
    AdSecurityAssessmentVersion.find(filter)
      .sort({ versionNumber: -1 })
      .skip(Math.max(0, skip))
      .limit(Math.min(Math.max(Number(limit) || 50, 1), 200))
      .lean(),
    AdSecurityAssessmentVersion.countDocuments(filter),
  ]);

  const items = docs.map(versionToApi);

  if (includeExecutions && items.length) {
    const versionIds = items.map((v) => toObjectId(v.assessmentVersionId));
    const executions = await PostureScanResult.find({
      assessmentId: aId,
      assessmentVersionId: { $in: versionIds },
    })
      .sort({ completedAt: -1 })
      .select(
        "scanId assessmentVersionId status startedAt completedAt summary findings diagnostics",
      )
      .lean();

    const byVersion = new Map();
    for (const ex of executions) {
      const vid = String(ex.assessmentVersionId);
      if (!byVersion.has(vid)) byVersion.set(vid, []);
      byVersion.get(vid).push({
        scanId: ex.scanId,
        assessmentVersionId: vid,
        status: ex.status,
        startedAt: ex.startedAt,
        completedAt: ex.completedAt,
        totalFindings:
          ex.summary?.totalFindings ??
          (Array.isArray(ex.findings) ? ex.findings.length : 0),
      });
    }
    for (const item of items) {
      item.executions = byVersion.get(item.assessmentVersionId) || [];
    }
  }

  return { items, total };
}

export async function getVersionById(assessmentVersionId, { applicationId, assessmentId } = {}) {
  const id = toObjectId(assessmentVersionId);
  if (!id) return null;
  const filter = { _id: id };
  if (applicationId) {
    const appId = toObjectId(applicationId);
    if (appId) filter.applicationId = appId;
  }
  if (assessmentId) {
    const aId = toObjectId(assessmentId);
    if (aId) filter.assessmentId = aId;
  }
  const doc = await AdSecurityAssessmentVersion.findOne(filter).lean();
  return versionToApi(doc);
}

export async function getLatestVersion(assessmentId) {
  const aId = toObjectId(assessmentId);
  if (!aId) return null;
  const doc = await AdSecurityAssessmentVersion.findOne({ assessmentId: aId })
    .sort({ versionNumber: -1 })
    .lean();
  return versionToApi(doc);
}

/**
 * Resolve Version for execution:
 * - If Working Configuration matches latest Version fingerprint → reuse
 * - Else freeze Working Configuration into Version N+1
 */
export async function resolveVersionForExecution(
  assessmentId,
  { applicationId, createdBy = null } = {},
) {
  const doc = await getAssessmentDoc(assessmentId, { applicationId });
  if (!doc) {
    const err = new Error("Assessment not found");
    err.code = "ASSESSMENT_NOT_FOUND";
    throw err;
  }

  const working = await ensureWorkingConfiguration(assessmentId, {
    applicationId: String(doc.applicationId),
  });
  const normalized = normalizeConfiguration(working);
  const enabledCount = Object.values(normalized.enabledMap || {}).filter(Boolean).length;
  if (!enabledCount) {
    const err = new Error(
      "Enable at least one security feature in Working Configuration before executing.",
    );
    err.code = "WORKING_CONFIG_EMPTY";
    throw err;
  }

  const latest = await getLatestVersion(assessmentId);
  const latestFp = latest?.contentFingerprint || latest?.configSnapshot?.contentFingerprint || "";
  const workingFp = normalized.contentFingerprint;

  if (latest && latestFp && latestFp === workingFp && latest.configSnapshot) {
    return {
      version: latest,
      created: false,
      reused: true,
      executionConfig: resolveExecutionConfigFromSnapshot(latest.configSnapshot),
    };
  }

  const versionNumber = await nextVersionNumber(doc._id);
  const frozenAt = new Date().toISOString();
  const snapshot = {
    ...normalized,
    frozenAt,
    source: "auto_freeze_on_execute",
  };

  const created = await AdSecurityAssessmentVersion.create({
    assessmentId: doc._id,
    applicationId: doc.applicationId,
    tenantId: doc.tenantId || null,
    versionNumber,
    label: `Version ${versionNumber}`,
    changeSummary: latest
      ? `Auto-created from Working Configuration (changed since Version ${latest.versionNumber})`
      : "Auto-created from Working Configuration (first Version)",
    configSnapshot: snapshot,
    contentFingerprint: workingFp,
    createdFromVersionId: latest ? toObjectId(latest.assessmentVersionId) : null,
    createdBy: toObjectId(createdBy),
    executionCount: 0,
  });

  await AdSecurityAssessment.findByIdAndUpdate(doc._id, {
    $set: {
      latestVersionId: created._id,
      latestVersionNumber: versionNumber,
      status: AD_SECURITY_ASSESSMENT_STATUS.READY,
    },
  });

  const version = versionToApi(created.toObject());
  return {
    version,
    created: true,
    reused: false,
    executionConfig: resolveExecutionConfigFromSnapshot(snapshot),
  };
}

export async function markVersionExecuted(assessmentVersionId, executionId) {
  const id = toObjectId(assessmentVersionId);
  if (!id) return null;
  const doc = await AdSecurityAssessmentVersion.findByIdAndUpdate(
    id,
    {
      $set: {
        latestExecutionId: executionId ? String(executionId) : null,
      },
      $inc: { executionCount: 1 },
    },
    { new: true },
  ).lean();
  return versionToApi(doc);
}

export function assertVersionExecutable(version) {
  if (!version) {
    const err = new Error("Assessment Version not found");
    err.code = "VERSION_NOT_FOUND";
    throw err;
  }
  if (!version.configSnapshot) {
    const err = new Error("Assessment Version has no configuration snapshot.");
    err.code = "VERSION_NO_SNAPSHOT";
    throw err;
  }
  return resolveExecutionConfigFromSnapshot(version.configSnapshot);
}

/**
 * Create Version 0 for legacy executions and attach assessmentVersionId.
 */
export async function ensureLegacyVersionZero(assessmentId, applicationId) {
  const aId = toObjectId(assessmentId);
  const appId = toObjectId(applicationId);
  if (!aId || !appId) return null;

  let version = await AdSecurityAssessmentVersion.findOne({
    assessmentId: aId,
    versionNumber: 0,
  }).lean();

  if (!version) {
    const orphanCount = await PostureScanResult.countDocuments({
      assessmentId: aId,
      $or: [{ assessmentVersionId: null }, { assessmentVersionId: { $exists: false } }],
    });
    if (orphanCount === 0) return null;

    const snapshot = normalizeConfiguration(
      {
        features: [],
        queryOverrides: {},
        enabledMap: {},
        featureSettings: {},
        securityScanSettings: {},
      },
      { source: "legacy_migration" },
    );
    snapshot.migrated = true;
    snapshot.frozenAt = new Date().toISOString();

    const created = await AdSecurityAssessmentVersion.create({
      assessmentId: aId,
      applicationId: appId,
      versionNumber: 0,
      label: "Version 0 (legacy)",
      changeSummary: "Migrated legacy executions without a frozen configuration snapshot.",
      configSnapshot: snapshot,
      contentFingerprint: snapshot.contentFingerprint,
      executionCount: 0,
    });
    version = created.toObject();
  }

  const vId = version._id;
  const attach = await PostureScanResult.updateMany(
    {
      assessmentId: aId,
      $or: [{ assessmentVersionId: null }, { assessmentVersionId: { $exists: false } }],
    },
    { $set: { assessmentVersionId: vId } },
  );

  const executionCount = await PostureScanResult.countDocuments({
    assessmentId: aId,
    assessmentVersionId: vId,
  });
  const latest = await PostureScanResult.findOne({
    assessmentId: aId,
    assessmentVersionId: vId,
  })
    .sort({ completedAt: -1 })
    .select("scanId")
    .lean();

  const updated = await AdSecurityAssessmentVersion.findByIdAndUpdate(
    vId,
    {
      $set: {
        executionCount,
        latestExecutionId: latest?.scanId || null,
      },
    },
    { new: true },
  ).lean();

  return {
    version: versionToApi(updated),
    attached: attach.modifiedCount || 0,
  };
}

export async function migrateAssessmentExecutionsToVersionZero(assessmentId, applicationId) {
  return ensureLegacyVersionZero(assessmentId, applicationId);
}

/**
 * Seed working configuration for assessments that lack one.
 */
export async function ensureAssessmentWorkingConfigurationMigrated(assessmentId, applicationId) {
  return ensureWorkingConfiguration(assessmentId, { applicationId });
}
