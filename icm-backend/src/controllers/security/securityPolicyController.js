import Application from "../models/application/Application.js";
import {
  listSecurityPoliciesForManagement,
  listAvailablePolicyConditions,
  getSecurityPolicyById,
  createSecurityPolicy,
  updateSecurityPolicy,
  cloneSecurityPolicy,
  deleteSecurityPolicy,
  ensureBuiltInSecurityPolicies,
} from "../services/security/securityPolicyService.js";

function resolveTenantId(req) {
  const tid = req.scopedTenantId || req.user?.tenantId || null;
  if (typeof tid === "object" && tid?._id) return String(tid._id);
  return tid ? String(tid) : null;
}

function resolveScope(req) {
  const tenantId = resolveTenantId(req);
  const applicationId = req.query.applicationId || req.body?.applicationId || null;
  return { tenantId, applicationId: applicationId ? String(applicationId) : null };
}

async function assertApplicationScope(req, res, applicationId) {
  if (!applicationId) return true;
  const app = await Application.findById(applicationId).select("tenantId").lean();
  if (!app) {
    res.status(404).json({ success: false, message: "Application not found" });
    return false;
  }
  const tenantId = resolveTenantId(req);
  if (tenantId && String(app.tenantId) !== tenantId) {
    res.status(404).json({ success: false, message: "Application not found" });
    return false;
  }
  return true;
}

/**
 * GET /api/security/policies
 */
export async function listSecurityPolicies(req, res) {
  try {
    const scope = resolveScope(req);
    if (!(await assertApplicationScope(req, res, scope.applicationId))) return;
    try {
      await ensureBuiltInSecurityPolicies();
    } catch {
      /* seed is best-effort; listing should still work */
    }
    const data = await listSecurityPoliciesForManagement(scope);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to list policies",
    });
  }
}

/**
 * GET /api/security/policies/conditions
 */
export async function listPolicyConditions(req, res) {
  return res.json({
    success: true,
    data: { conditions: listAvailablePolicyConditions() },
  });
}

/**
 * GET /api/security/policies/:policyId
 */
export async function getSecurityPolicy(req, res) {
  try {
    const scope = resolveScope(req);
    const doc = await getSecurityPolicyById(req.params.policyId, scope);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Policy not found" });
    }
    return res.json({ success: true, data: doc });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to load policy",
    });
  }
}

/**
 * POST /api/security/policies
 */
export async function createSecurityPolicyHandler(req, res) {
  try {
    const scope = resolveScope(req);
    if (!(await assertApplicationScope(req, res, scope.applicationId))) return;
    const data = await createSecurityPolicy(req.body, scope);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    if (e.code === "VALIDATION_ERROR") {
      return res.status(400).json({
        success: false,
        message: e.message,
        errors: e.errors,
      });
    }
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to create policy",
    });
  }
}

/**
 * PUT /api/security/policies/:policyId
 */
export async function updateSecurityPolicyHandler(req, res) {
  try {
    const scope = resolveScope(req);
    const data = await updateSecurityPolicy(req.params.policyId, req.body, scope);
    return res.json({ success: true, data });
  } catch (e) {
    if (e.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: e.message });
    }
    if (e.code === "VALIDATION_ERROR") {
      return res.status(400).json({
        success: false,
        message: e.message,
        errors: e.errors,
      });
    }
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to update policy",
    });
  }
}

/**
 * POST /api/security/policies/:policyId/clone
 */
export async function cloneSecurityPolicyHandler(req, res) {
  try {
    const scope = resolveScope(req);
    if (!(await assertApplicationScope(req, res, scope.applicationId))) return;
    const data = await cloneSecurityPolicy(req.params.policyId, scope, req.body || {});
    return res.status(201).json({ success: true, data });
  } catch (e) {
    if (e.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: e.message });
    }
    if (e.code === "VALIDATION_ERROR") {
      return res.status(400).json({
        success: false,
        message: e.message,
        errors: e.errors,
      });
    }
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to clone policy",
    });
  }
}

/**
 * DELETE /api/security/policies/:policyId
 */
export async function deleteSecurityPolicyHandler(req, res) {
  try {
    const scope = resolveScope(req);
    const data = await deleteSecurityPolicy(req.params.policyId, scope);
    return res.json({ success: true, data });
  } catch (e) {
    if (e.code === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: e.message });
    }
    return res.status(500).json({
      success: false,
      message: e.message || "Failed to delete policy",
    });
  }
}
