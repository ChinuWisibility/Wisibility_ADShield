import Application from "../../models/application/Application.js";
import {
  buildFeatureConfigPayload,
  upsertFeatureQueryOverride,
} from "../../services/security/applicationSecurityQueryService.js";
import { testApplicationLdapQuery } from "../../services/security/ldapQueryTestService.js";
import { validateLdapQueryFields } from "../../services/posture/ldapFilterValidator.js";
import { normalizeAdConfig } from "../../services/ad/adLdapService.js";

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
 * POST /api/security/query/validate
 */
export async function validateSecurityLdapQuery(req, res) {
  const result = validateLdapQueryFields({
    ldapFilter: req.body?.ldapFilter,
    searchBase: req.body?.searchBase,
    searchScope: req.body?.searchScope,
  });
  return res.json({
    success: true,
    data: {
      valid: result.valid,
      errors: result.errors,
    },
  });
}

/**
 * GET /api/security/applications/:applicationId/feature-config
 */
export async function getApplicationFeatureConfig(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;
    const data = await buildFeatureConfigPayload(app._id);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to load feature configuration",
    });
  }
}

/**
 * PUT /api/security/applications/:applicationId/feature-config/:featureKey
 */
export async function upsertApplicationFeatureConfig(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;

    const doc = await upsertFeatureQueryOverride({
      applicationId: app._id,
      featureKey: req.params.featureKey,
      ldapFilter: req.body?.ldapFilter,
      searchBase: req.body?.searchBase,
      searchScope: req.body?.searchScope,
      enabled: req.body?.enabled,
      userId: req.user?._id,
    });

    return res.json({ success: true, data: doc });
  } catch (e) {
    if (e.code === "UNKNOWN_FEATURE") {
      return res.status(404).json({ success: false, message: e.message });
    }
    if (e.code === "INVALID_LDAP_QUERY") {
      return res.status(400).json({
        success: false,
        message: e.message,
        data: { valid: false, errors: e.errors || [e.message] },
      });
    }
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to save feature configuration",
    });
  }
}

/**
 * POST /api/security/applications/:applicationId/query/test
 */
export async function testApplicationSecurityQuery(req, res) {
  try {
    const app = await loadApplication(req, res);
    if (!app) return;

    const ldapFilter = String(req.body?.ldapFilter || "").trim();
    const searchBase = String(req.body?.searchBase || "").trim();
    const searchScope = String(req.body?.searchScope || "").trim();
    const validation = validateLdapQueryFields({
      ldapFilter,
      searchBase,
      searchScope,
    });
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.errors[0] || "Invalid LDAP query.",
        data: validation,
      });
    }

    const adConfig = normalizeAdConfig({
      ...(app.connectionConfig?.ad || {}),
      bindPassword:
        req.body?.bindPassword || app.connectionConfig?.ad?.bindPassword,
    });

    const result = await testApplicationLdapQuery(adConfig, ldapFilter, {
      searchBase: searchBase || undefined,
      searchScope: searchScope || undefined,
    });
    return res.json({ success: true, data: result });
  } catch (e) {
    if (e.code === "INVALID_FILTER") {
      return res.status(400).json({
        success: false,
        message: e.message,
        data: e.validation,
      });
    }
    return res.status(400).json({
      success: false,
      message: e.message || "LDAP test query failed.",
    });
  }
}
