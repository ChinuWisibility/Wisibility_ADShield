import Application from "../models/application/Application.js";
import { normalizeAdConfig } from "../services/adLdapService.js";
import {
  getScanResult,
  listScanResultsForApplication,
  runPostureScan,
  resolvePostureModules,
  USER_ACCOUNT_SECURITY_FEATURES,
  IDENTITY_GRAPH_SECURITY_FEATURES,
  COMPUTER_SECURITY_FEATURES,
  KERBEROS_SECURITY_FEATURES,
  DELEGATION_SECURITY_FEATURES,
  POSTURE_MODULES,
} from "../services/posture/postureOrchestrator.js";
import {
  buildPostureFeaturesDiscoveryPayload,
  resolveExecutableFeatureIds,
} from "../services/posture/postureFeatureRegistry.js";
import { validateCustomFeatureDefinitions } from "../services/posture/ldapFilterValidator.js";

function resolveAdConfig(application, req) {
  const fromDb = application.connectionConfig?.ad || {};
  const fromBody = req.body?.ad || {};
  const pwd = fromBody.bindPassword || req.body?.bindPassword || fromDb.bindPassword;
  return normalizeAdConfig({
    ...fromDb,
    ...fromBody,
    bindPassword: pwd,
  });
}

function isAdApplication(application, req) {
  return (
    application.connectorType === "ACTIVE_DIRECTORY" ||
    Boolean(application.connectionConfig?.ad) ||
    Boolean(req.body?.ad)
  );
}

/**
 * POST /applications/:id/posture/scan
 * Body: { features?: string[], modules?: string[], ad?: object, maxUsers?: number, skipMaterialize?: boolean }
 */
export async function runApplicationPostureScan(req, res) {
  try {
    const application = await Application.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }

    const features = Array.isArray(req.body?.features)
      ? req.body.features
      : Array.isArray(req.body?.modules)
        ? req.body.modules
        : undefined;

    const modules = resolvePostureModules(features);
    const needsLdap = modules.some((id) => POSTURE_MODULES[id]?.requiresAdLdap);

    if (needsLdap && !isAdApplication(application, req)) {
      return res.status(400).json({
        success: false,
        message: "User account security scan requires an Active Directory application.",
      });
    }

    let adConfig;
    if (needsLdap) {
      adConfig = resolveAdConfig(application, req);
      if (!adConfig.bindPassword) {
        return res.status(400).json({
          success: false,
          message: "Bind password is required for LDAP-based scans.",
        });
      }
    }

    const maxUsers = parseInt(req.body?.maxUsers, 10);
    const customValidation = validateCustomFeatureDefinitions(req.body?.customFeatures);
    if (!customValidation.ok) {
      return res.status(400).json({
        success: false,
        message: "Invalid custom LDAP feature definitions.",
        errors: customValidation.errors,
      });
    }

    const executableFeatures = resolveExecutableFeatureIds(features);
    const options = {
      ...(Number.isFinite(maxUsers) ? { maxUsers } : {}),
      skipMaterialize: req.body?.skipMaterialize === true,
      replaceExisting: req.body?.replaceExisting !== false,
      customFeatures: customValidation.valid,
      scanSource: req.body?.scanSource || "manual",
      featureSettings: req.body?.featureSettings,
    };

    const result = await runPostureScan({
      applicationId: application._id,
      application,
      adConfig,
      features: executableFeatures.length ? executableFeatures : features,
      options,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (e) {
    console.error("[postureScan]", e?.message || e);
    return res.status(400).json({
      success: false,
      message: e.message || "Posture scan failed.",
    });
  }
}

/**
 * GET /applications/:id/posture/scans/:scanId
 */
export async function getApplicationPostureScan(req, res) {
  try {
    const doc = await getScanResult(req.params.scanId);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Scan not found" });
    }
    if (String(doc.applicationId) !== String(req.params.id)) {
      return res.status(404).json({ success: false, message: "Scan not found for application" });
    }
    return res.json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to load scan results.",
    });
  }
}

/**
 * GET /applications/:id/posture/scans
 */
export async function listApplicationPostureScans(req, res) {
  try {
    const limit = Math.min(parseInt(req.query?.limit, 10) || 20, 100);
    const scans = await listScanResultsForApplication(req.params.id, limit);
    return res.json({ success: true, data: scans });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to list scans.",
    });
  }
}

/**
 * GET /applications/:id/posture/features
 */
export async function listPostureFeatures(req, res) {
  const discovery = buildPostureFeaturesDiscoveryPayload();
  return res.json({
    success: true,
    data: {
      ...discovery,
      modules: Object.values(POSTURE_MODULES).map((m) => ({
        id: m.id,
        label: m.label,
        requiresAdLdap: m.requiresAdLdap,
        featureCount: m.features.length,
      })),
      featuresByModule: {
        user_account_security: USER_ACCOUNT_SECURITY_FEATURES,
        computer_security: COMPUTER_SECURITY_FEATURES,
        kerberos_security: KERBEROS_SECURITY_FEATURES,
        delegation_security: DELEGATION_SECURITY_FEATURES,
        identity_graph_security: IDENTITY_GRAPH_SECURITY_FEATURES,
      },
    },
  });
}

/**
 * POST /applications/:id/posture/validate-custom-features
 */
export async function validatePostureCustomFeatures(req, res) {
  const result = validateCustomFeatureDefinitions(req.body?.customFeatures);
  if (!result.ok) {
    return res.status(400).json({
      success: false,
      message: "Custom feature validation failed.",
      errors: result.errors,
    });
  }
  return res.json({ success: true, data: { customFeatures: result.valid } });
}
