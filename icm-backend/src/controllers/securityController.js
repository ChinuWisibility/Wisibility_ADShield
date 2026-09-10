import Application from "../models/application/Application.js";
import { listScanResultsForApplication, countScanResultsForApplication, deleteScanResult } from "../services/posture/postureScanResultsStore.js";
import { getScanResult } from "../services/posture/postureOrchestrator.js";
import { runPostureScan } from "../services/posture/postureOrchestrator.js";
import { normalizeAdConfig } from "../services/adLdapService.js";
import {
  resolveExecutableFeatureIds,
  getPostureFeatureById,
} from "../services/posture/postureFeatureRegistry.js";
import { validateCustomFeatureDefinitions } from "../services/posture/ldapFilterValidator.js";
import {
  getPaginatedFindings,
  getSecurityOverview,
  compareSecurityScans,
} from "../services/security/securityFindingsService.js";
import {
  getApplicationRemediationSummary,
  getTenantRemediationApplicationTiles,
} from "../services/security/securityRemediationSummaryService.js";
import {
  listAssessmentsForApplication,
  getAssessmentById,
  createAssessment,
  updateAssessment,
  markAssessmentRunning,
  markAssessmentExecutionCompleted,
  attachOrphanScansToAssessment,
} from "../services/security/assessmentService.js";
import {
  listVersionsForAssessment,
  getVersionById,
  markVersionExecuted,
  migrateAssessmentExecutionsToVersionZero,
  resolveVersionForExecution,
  getWorkingConfiguration,
  replaceWorkingConfiguration,
  upsertWorkingConfigurationFeature,
  resetWorkingConfigurationFromApplication,
  cloneVersionToWorkingConfiguration,
  ensureWorkingConfiguration,
} from "../services/security/assessmentVersionService.js";
import { validatePostureLdapConnection, friendlyLdapErrorMessage } from "../services/posture/postureLdapValidator.js";
import { isAdShieldEnabled } from "../services/security/adShield/adShieldClient.js";

function selectedFeaturesNeedLdap(featureIds) {
  return (featureIds || []).some((id) => getPostureFeatureById(id)?.requiresAdLdap);
}

/** True when any selected feature needs live ADShield (.NET) analysis. */
function selectedFeaturesNeedAdShield(featureIds) {
  return (featureIds || []).some((id) => getPostureFeatureById(id)?.requiresAdShield);
}

async function loadApplication(req, res) {
  const application = await Application.findById(req.params.applicationId);
  if (!application) {
    res.status(404).json({ success: false, message: "Application not found" });
    return null;
  }
  const scopedTenantId = req.scopedTenantId || req.user?.tenantId || null;
  if (
    scopedTenantId &&
    String(application.tenantId || "") !== String(scopedTenantId)
  ) {
    res.status(404).json({ success: false, message: "Application not found" });
    return null;
  }
  return application;
}

/**
 * GET /api/security/applications/:applicationId/overview
 */
export async function getApplicationSecurityOverview(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const data = await getSecurityOverview(String(app._id), {
      scanId: req.query.scanId,
    });
    return res.json({
      success: true,
      data: { ...data, applicationId: String(app._id), applicationName: app.name },
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to load security overview",
    });
  }
}

/**
 * GET /api/security/applications/:applicationId/findings
 */
export async function getApplicationSecurityFindings(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const data = await getPaginatedFindings(String(app._id), req.query);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to load findings",
    });
  }
}

/**
 * GET /api/security/applications/:applicationId/scans
 * Optional ?assessmentId= and ?assessmentVersionId= filter executions.
 */
export async function listApplicationSecurityScans(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const appId = String(app._id);
    const assessmentId = req.query.assessmentId || undefined;
    const assessmentVersionId = req.query.assessmentVersionId || undefined;
    const listOpts = { limit, skip, assessmentId, assessmentVersionId };
    const [scans, total] = await Promise.all([
      listScanResultsForApplication(appId, listOpts),
      countScanResultsForApplication(appId, { assessmentId, assessmentVersionId }),
    ]);
    return res.json({
      success: true,
      data: scans,
      total,
      page,
      limit,
      assessmentId: assessmentId || null,
      assessmentVersionId: assessmentVersionId || null,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to list scans",
    });
  }
}

/**
 * GET /api/security/applications/:applicationId/scans/:scanId
 */
export async function getApplicationSecurityScan(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const doc = await getScanResult(req.params.scanId);
    if (!doc || String(doc.applicationId) !== String(app._id)) {
      return res.status(404).json({ success: false, message: "Scan not found" });
    }
    return res.json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to load scan",
    });
  }
}

/**
 * GET /api/security/applications/:applicationId/scans/compare
 * Additive: Resolved / New / Unchanged between two assessments.
 */
export async function compareApplicationSecurityScans(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const data = await compareSecurityScans(
      String(app._id),
      req.query.left || req.query.leftScanId,
      req.query.right || req.query.rightScanId,
      {
        assessmentId: req.query.assessmentId,
        assessmentVersionId: req.query.assessmentVersionId,
      },
    );
    return res.json({ success: true, data });
  } catch (e) {
    if (
      e.code === "ASSESSMENT_COMPARE_MISMATCH" ||
      e.code === "ASSESSMENT_VERSION_COMPARE_MISMATCH"
    ) {
      return res.status(400).json({
        success: false,
        message: e.message,
        code: e.code,
      });
    }
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to compare assessments",
    });
  }
}

/**
 * GET /api/security/applications/:applicationId/remediation-summary
 * Assessment progress dashboard payload (maps Compare API → hygiene-like widgets).
 */
export async function getApplicationSecurityRemediationSummary(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const data = await getApplicationRemediationSummary(String(app._id), {
      baselineScanId: req.query.baseline || req.query.baselineScanId || req.query.left,
      currentScanId:
        req.query.current || req.query.currentScanId || req.query.right || req.query.scanId,
      applicationName: app.name,
    });
    return res.json({
      success: true,
      data: {
        ...data,
        applicationId: String(app._id),
        applicationName: app.name,
      },
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to load remediation summary",
    });
  }
}

/**
 * GET /api/security/remediation/applications-summary
 * Tenant Applications view tiles for AD Security Remediation Center.
 */
export async function getSecurityRemediationApplicationsSummary(req, res) {
  try {
    const tenantId =
      req.query.tenantId || req.scopedTenantId || req.user?.tenantId || null;
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenantId is required",
      });
    }
    const data = await getTenantRemediationApplicationTiles(String(tenantId));
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to load applications remediation summary",
    });
  }
}

/**
 * DELETE /api/security/applications/:applicationId/scans/:scanId
 */
export async function deleteApplicationSecurityScan(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;

    const result = await deleteScanResult(req.params.scanId, {
      applicationId: String(app._id),
    });

    if (!result.deleted) {
      return res.status(404).json({
        success: false,
        message: "Scan not found",
      });
    }

    return res.json({ success: true, data: result });
  } catch (e) {
    if (e.code === "SCAN_APP_MISMATCH") {
      return res.status(404).json({ success: false, message: "Scan not found" });
    }
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to delete scan",
    });
  }
}

/**
 * POST /api/security/applications/:applicationId/scans/run
 * Requires assessmentId. Auto-freezes Working Configuration into a Version when changed;
 * otherwise reuses the latest Version. Execution always binds to an immutable Version.
 */
export async function runApplicationSecurityScan(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;

    const assessmentId = String(
      req.body?.assessmentId || req.query?.assessmentId || "",
    ).trim();
    if (!assessmentId) {
      return res.status(400).json({
        success: false,
        message: "assessmentId is required. Create or select an Assessment before executing.",
        code: "ASSESSMENT_REQUIRED",
      });
    }
    const assessment = await getAssessmentById(assessmentId, {
      applicationId: String(app._id),
    });
    if (!assessment) {
      return res.status(404).json({
        success: false,
        message: "Assessment not found for this application",
      });
    }

    const userId = req.user?._id || req.user?.id || null;
    let resolved;
    try {
      resolved = await resolveVersionForExecution(assessmentId, {
        applicationId: String(app._id),
        createdBy: userId,
      });
    } catch (verErr) {
      return res.status(400).json({
        success: false,
        message: verErr.message,
        code: verErr.code || "VERSION_RESOLVE_FAILED",
      });
    }

    const version = resolved.version;
    const assessmentVersionId = version.assessmentVersionId;
    const executionConfig = resolved.executionConfig;

    const snapshotFeatureIds = executionConfig.features || [];
    const requestedFeatures =
      Array.isArray(req.body?.features) && req.body.features.length
        ? req.body.features.filter((id) => snapshotFeatureIds.includes(id))
        : snapshotFeatureIds;
    const executableFeatures = resolveExecutableFeatureIds(requestedFeatures);

    if (!executableFeatures.length) {
      return res.status(400).json({
        success: false,
        message:
          "Working Configuration has no enabled implemented features to execute.",
      });
    }

    const queryOverrides = executionConfig.queryOverrides || {};
    const featureSettings =
      req.body?.featureSettings && typeof req.body.featureSettings === "object"
        ? { ...(executionConfig.featureSettings || {}), ...req.body.featureSettings }
        : executionConfig.featureSettings;

    let adConfig;
    const needsLdap = selectedFeaturesNeedLdap(executableFeatures);
    const needsAdShield =
      isAdShieldEnabled() && selectedFeaturesNeedAdShield(executableFeatures);

    if (needsLdap || needsAdShield) {
      const fromDb = app.connectionConfig?.ad || {};
      const pwd = req.body?.bindPassword || fromDb.bindPassword;
      adConfig = normalizeAdConfig({ ...fromDb, bindPassword: pwd });
      if (!adConfig.bindPassword) {
        return res.status(400).json({
          success: false,
          message: needsLdap
            ? "Bind password is required for LDAP-based scan features."
            : "Bind password is required for ADShield ACL analysis features.",
        });
      }
      if (!adConfig.url || !adConfig.baseDn || !adConfig.bindDn) {
        return res.status(400).json({
          success: false,
          message:
            "AD connection settings (url, baseDn, bindDn) are required for this scan.",
        });
      }
      if (needsLdap) {
        try {
          await validatePostureLdapConnection(adConfig);
        } catch (ldapErr) {
          return res.status(400).json({
            success: false,
            message: ldapErr.message || friendlyLdapErrorMessage(ldapErr),
          });
        }
      }
    }

    const customValidation = validateCustomFeatureDefinitions(req.body?.customFeatures);
    if (!customValidation.ok) {
      return res.status(400).json({
        success: false,
        message: "Invalid custom LDAP feature definitions.",
        errors: customValidation.errors,
      });
    }

    await markAssessmentRunning(assessmentId);

    let result;
    try {
      result = await runPostureScan({
        applicationId: app._id,
        application: app,
        adConfig,
        features: executableFeatures,
        options: {
          skipMaterialize: req.body?.skipMaterialize === true,
          replaceExisting: req.body?.replaceExisting !== false,
          customFeatures: customValidation.valid,
          scanSource: req.body?.scanSource || "security_center",
          featureSettings,
          queryOverrides,
          assessmentId,
          assessmentVersionId,
        },
      });
    } catch (scanErr) {
      await updateAssessment(
        assessmentId,
        {
          status:
            assessment.executionCount > 0 || assessment.latestExecutionId
              ? "completed"
              : "ready",
        },
        { applicationId: String(app._id) },
      );
      throw scanErr;
    }

    await markAssessmentExecutionCompleted(assessmentId, result?.scanId);
    await markVersionExecuted(assessmentVersionId, result?.scanId);

    return res.status(200).json({
      success: true,
      data: {
        ...result,
        assessmentId,
        assessmentName: assessment.name,
        assessmentVersionId,
        versionNumber: version.versionNumber,
        versionCreated: resolved.created,
        versionReused: resolved.reused,
      },
    });
  } catch (e) {
    console.error("[securityScan]", e?.message || e);
    return res.status(400).json({
      success: false,
      message: e.message || "Security scan failed",
    });
  }
}

/**
 * GET /api/security/applications/:applicationId/assessments
 */
export async function listApplicationAssessments(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const data = await listAssessmentsForApplication(String(app._id), { limit, skip });
    return res.json({
      success: true,
      data: data.items,
      total: data.total,
      page,
      limit,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to list assessments",
    });
  }
}

/**
 * POST /api/security/applications/:applicationId/assessments
 */
export async function createApplicationAssessment(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const userId = req.user?._id || req.user?.id || null;
    const assessment = await createAssessment({
      applicationId: String(app._id),
      tenantId: app.tenantId,
      name: req.body?.name,
      description: req.body?.description,
      purpose: req.body?.purpose,
      ownerUserId: req.body?.ownerUserId || userId,
      createdBy: userId,
    });

    let attach = null;
    if (req.body?.attachOrphanScans === true) {
      attach = await attachOrphanScansToAssessment(
        assessment.assessmentId,
        String(app._id),
      );
      const refreshed = await getAssessmentById(assessment.assessmentId, {
        applicationId: String(app._id),
      });
      return res.status(201).json({
        success: true,
        data: refreshed || assessment,
        attach,
      });
    }

    return res.status(201).json({ success: true, data: assessment });
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: e.message || "Failed to create assessment",
    });
  }
}

/**
 * GET /api/security/applications/:applicationId/assessments/:assessmentId
 */
export async function getApplicationAssessment(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const assessment = await getAssessmentById(req.params.assessmentId, {
      applicationId: String(app._id),
    });
    if (!assessment) {
      return res.status(404).json({ success: false, message: "Assessment not found" });
    }
    return res.json({ success: true, data: assessment });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to load assessment",
    });
  }
}

/**
 * PATCH /api/security/applications/:applicationId/assessments/:assessmentId
 */
export async function patchApplicationAssessment(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const assessment = await updateAssessment(
      req.params.assessmentId,
      {
        name: req.body?.name,
        description: req.body?.description,
        purpose: req.body?.purpose,
        ownerUserId: req.body?.ownerUserId,
        status: req.body?.status,
      },
      { applicationId: String(app._id) },
    );
    if (!assessment) {
      return res.status(404).json({ success: false, message: "Assessment not found" });
    }
    return res.json({ success: true, data: assessment });
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: e.message || "Failed to update assessment",
    });
  }
}

/**
 * POST /api/security/applications/:applicationId/assessments/:assessmentId/attach-orphan-scans
 * Migration helper: attach legacy scans (no assessmentId) to this Assessment.
 */
export async function attachOrphanScansToApplicationAssessment(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const assessment = await getAssessmentById(req.params.assessmentId, {
      applicationId: String(app._id),
    });
    if (!assessment) {
      return res.status(404).json({ success: false, message: "Assessment not found" });
    }
    const attach = await attachOrphanScansToAssessment(
      assessment.assessmentId,
      String(app._id),
    );
    const refreshed = await getAssessmentById(assessment.assessmentId, {
      applicationId: String(app._id),
    });
    return res.json({ success: true, data: refreshed, attach });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to attach orphan scans",
    });
  }
}

/**
 * GET /api/security/applications/:applicationId/assessments/:assessmentId/versions
 */
export async function listApplicationAssessmentVersions(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const assessment = await getAssessmentById(req.params.assessmentId, {
      applicationId: String(app._id),
    });
    if (!assessment) {
      return res.status(404).json({ success: false, message: "Assessment not found" });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const data = await listVersionsForAssessment(assessment.assessmentId, {
      applicationId: String(app._id),
      limit,
      skip,
      includeExecutions: req.query.includeExecutions !== "false",
    });
    return res.json({
      success: true,
      data: data.items,
      total: data.total,
      page,
      limit,
      assessmentId: assessment.assessmentId,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to list assessment versions",
    });
  }
}

/**
 * GET .../assessments/:assessmentId/working-configuration
 */
export async function getApplicationAssessmentWorkingConfiguration(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const assessment = await getAssessmentById(req.params.assessmentId, {
      applicationId: String(app._id),
    });
    if (!assessment) {
      return res.status(404).json({ success: false, message: "Assessment not found" });
    }
    const data = await getWorkingConfiguration(assessment.assessmentId, {
      applicationId: String(app._id),
    });
    return res.json({
      success: true,
      data: {
        assessmentId: assessment.assessmentId,
        ...data,
      },
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to load working configuration",
    });
  }
}

/**
 * PUT .../assessments/:assessmentId/working-configuration
 */
export async function putApplicationAssessmentWorkingConfiguration(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const data = await replaceWorkingConfiguration(
      req.params.assessmentId,
      req.body || {},
      { applicationId: String(app._id) },
    );
    if (!data) {
      return res.status(404).json({ success: false, message: "Assessment not found" });
    }
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: e.message || "Failed to update working configuration",
    });
  }
}

/**
 * PUT .../working-configuration/features/:featureKey
 */
export async function upsertApplicationAssessmentWorkingFeature(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const data = await upsertWorkingConfigurationFeature(
      req.params.assessmentId,
      req.params.featureKey,
      req.body || {},
      { applicationId: String(app._id) },
    );
    if (!data) {
      return res.status(404).json({ success: false, message: "Assessment not found" });
    }
    return res.json({ success: true, data });
  } catch (e) {
    const status = e.code === "UNKNOWN_FEATURE" ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: e.message || "Failed to update feature in working configuration",
      code: e.code,
    });
  }
}

/**
 * POST .../working-configuration/reset
 * Reset Working Configuration from application overrides.
 */
export async function resetApplicationAssessmentWorkingConfiguration(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const data = await resetWorkingConfigurationFromApplication(req.params.assessmentId, {
      applicationId: String(app._id),
    });
    if (!data) {
      return res.status(404).json({ success: false, message: "Assessment not found" });
    }
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: e.message || "Failed to reset working configuration",
    });
  }
}

/**
 * GET /api/security/applications/:applicationId/assessments/:assessmentId/versions/:versionId
 */
export async function getApplicationAssessmentVersion(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const version = await getVersionById(req.params.versionId, {
      applicationId: String(app._id),
      assessmentId: req.params.assessmentId,
    });
    if (!version) {
      return res.status(404).json({ success: false, message: "Assessment Version not found" });
    }
    return res.json({ success: true, data: version });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to load assessment version",
    });
  }
}

/**
 * GET .../versions/:versionId/config — read-only snapshot viewer
 */
export async function getApplicationAssessmentVersionConfig(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const version = await getVersionById(req.params.versionId, {
      applicationId: String(app._id),
      assessmentId: req.params.assessmentId,
    });
    if (!version) {
      return res.status(404).json({ success: false, message: "Assessment Version not found" });
    }
    const snapshot = version.configSnapshot || {};
    return res.json({
      success: true,
      data: {
        assessmentVersionId: version.assessmentVersionId,
        assessmentId: version.assessmentId,
        versionNumber: version.versionNumber,
        label: version.label,
        readOnly: true,
        features: Array.isArray(snapshot.features) ? snapshot.features : version.features || [],
        securityScanSettings: snapshot.securityScanSettings || {},
        featureSettings: snapshot.featureSettings || {},
        policySnapshotRef: snapshot.policySnapshotRef || null,
        contentFingerprint: version.contentFingerprint,
        createdAt: version.createdAt,
        createdFromVersionId: version.createdFromVersionId,
      },
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to load version configuration",
    });
  }
}

/**
 * POST .../versions/:versionId/clone-to-working
 * Copy immutable Version snapshot into Working Configuration.
 */
export async function cloneApplicationAssessmentVersionToWorking(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const data = await cloneVersionToWorkingConfiguration(
      req.params.assessmentId,
      req.params.versionId,
      { applicationId: String(app._id) },
    );
    return res.json({
      success: true,
      data,
      message: "Version cloned into Working Configuration",
    });
  } catch (e) {
    const status = e.code === "VERSION_NOT_FOUND" ? 404 : 400;
    return res.status(status).json({
      success: false,
      message: e.message || "Failed to clone version",
      code: e.code,
    });
  }
}

/**
 * POST .../assessments/:assessmentId/execute
 * Execute Assessment (auto Version freeze/reuse).
 */
export async function executeApplicationAssessment(req, res) {
  req.body = {
    ...(req.body || {}),
    assessmentId: req.params.assessmentId,
  };
  return runApplicationSecurityScan(req, res);
}

/**
 * POST .../assessments/:assessmentId/migrate-legacy-versions
 */
export async function migrateApplicationAssessmentLegacyVersions(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const assessment = await getAssessmentById(req.params.assessmentId, {
      applicationId: String(app._id),
    });
    if (!assessment) {
      return res.status(404).json({ success: false, message: "Assessment not found" });
    }
    await ensureWorkingConfiguration(assessment.assessmentId, {
      applicationId: String(app._id),
    });
    const result = await migrateAssessmentExecutionsToVersionZero(
      assessment.assessmentId,
      String(app._id),
    );
    return res.json({
      success: true,
      data: result?.version || null,
      attached: result?.attached || 0,
      message: result
        ? "Legacy executions attached to Version 0"
        : "No legacy executions to migrate",
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to migrate legacy versions",
    });
  }
}
