import api from "./api.js";

/**
 * Identity Security Posture Management API layer.
 */
export const securityAPI = {
  getOverview: (applicationId, params) =>
    api.get(`/security/applications/${applicationId}/overview`, { params }),

  getFindings: (applicationId, params) =>
    api.get(`/security/applications/${applicationId}/findings`, { params }),

  listScans: (applicationId, params) =>
    api.get(`/security/applications/${applicationId}/scans`, { params }),

  getScan: (applicationId, scanId) =>
    api.get(`/security/applications/${applicationId}/scans/${scanId}`),

  deleteScan: (applicationId, scanId) =>
    api.delete(`/security/applications/${applicationId}/scans/${scanId}`),

  compareScans: (applicationId, params) =>
    api.get(`/security/applications/${applicationId}/scans/compare`, { params }),

  listAssessments: (applicationId, params) =>
    api.get(`/security/applications/${applicationId}/assessments`, { params }),

  createAssessment: (applicationId, body) =>
    api.post(`/security/applications/${applicationId}/assessments`, body),

  getAssessment: (applicationId, assessmentId) =>
    api.get(`/security/applications/${applicationId}/assessments/${assessmentId}`),

  updateAssessment: (applicationId, assessmentId, body) =>
    api.patch(`/security/applications/${applicationId}/assessments/${assessmentId}`, body),

  attachOrphanScans: (applicationId, assessmentId) =>
    api.post(
      `/security/applications/${applicationId}/assessments/${assessmentId}/attach-orphan-scans`,
    ),

  executeAssessment: (applicationId, assessmentId, body) =>
    api.post(
      `/security/applications/${applicationId}/assessments/${assessmentId}/execute`,
      body || {},
      { timeout: 600000 },
    ),

  getWorkingConfiguration: (applicationId, assessmentId) =>
    api.get(
      `/security/applications/${applicationId}/assessments/${assessmentId}/working-configuration`,
    ),

  putWorkingConfiguration: (applicationId, assessmentId, body) =>
    api.put(
      `/security/applications/${applicationId}/assessments/${assessmentId}/working-configuration`,
      body,
    ),

  upsertWorkingFeature: (applicationId, assessmentId, featureKey, body) =>
    api.put(
      `/security/applications/${applicationId}/assessments/${assessmentId}/working-configuration/features/${featureKey}`,
      body,
    ),

  resetWorkingConfiguration: (applicationId, assessmentId) =>
    api.post(
      `/security/applications/${applicationId}/assessments/${assessmentId}/working-configuration/reset`,
    ),

  listAssessmentVersions: (applicationId, assessmentId, params) =>
    api.get(
      `/security/applications/${applicationId}/assessments/${assessmentId}/versions`,
      { params },
    ),

  getAssessmentVersion: (applicationId, assessmentId, versionId) =>
    api.get(
      `/security/applications/${applicationId}/assessments/${assessmentId}/versions/${versionId}`,
    ),

  getAssessmentVersionConfig: (applicationId, assessmentId, versionId) =>
    api.get(
      `/security/applications/${applicationId}/assessments/${assessmentId}/versions/${versionId}/config`,
    ),

  cloneVersionToWorking: (applicationId, assessmentId, versionId) =>
    api.post(
      `/security/applications/${applicationId}/assessments/${assessmentId}/versions/${versionId}/clone-to-working`,
    ),

  migrateLegacyVersions: (applicationId, assessmentId) =>
    api.post(
      `/security/applications/${applicationId}/assessments/${assessmentId}/migrate-legacy-versions`,
    ),

  getRemediationSummary: (applicationId, params) =>
    api.get(`/security/applications/${applicationId}/remediation-summary`, { params }),

  getRemediationApplicationsSummary: (params) =>
    api.get("/security/remediation/applications-summary", { params }),

  /**
   * Preview (dryRun: true) or apply ADShield remediation for a Security Posture finding.
   */
  remediateFinding: (applicationId, body) =>
    api.post(`/security/applications/${applicationId}/remediate`, body, {
      timeout: 180000,
    }),

  runScan: (applicationId, body) =>
    api.post(`/security/applications/${applicationId}/scans/run`, body, {
      timeout: 600000,
    }),

  validateLdapQuery: (body) =>
    api.post("/security/query/validate", body),

  getFeatureConfig: (applicationId) =>
    api.get(`/security/applications/${applicationId}/feature-config`),

  upsertFeatureConfig: (applicationId, featureKey, body) =>
    api.put(
      `/security/applications/${applicationId}/feature-config/${featureKey}`,
      body,
    ),

  testLdapQuery: (applicationId, body) =>
    api.post(`/security/applications/${applicationId}/query/test`, body),

  listPolicies: (params) => api.get("/security/policies", { params }),

  getPolicyConditions: () => api.get("/security/policies/conditions"),

  getPolicy: (policyId, params) =>
    api.get(`/security/policies/${policyId}`, { params }),

  createPolicy: (body, params) =>
    api.post("/security/policies", body, { params }),

  updatePolicy: (policyId, body, params) =>
    api.put(`/security/policies/${policyId}`, body, { params }),

  clonePolicy: (policyId, body, params) =>
    api.post(`/security/policies/${policyId}/clone`, body, { params }),

  deletePolicy: (policyId, params) =>
    api.delete(`/security/policies/${policyId}`, { params }),
};

export function isTransientScanError(err) {
  return (
    err?.message === "Network Error" ||
    err?.code === "ECONNABORTED" ||
    (err?.response?.status ?? 0) >= 502
  );
}

export async function recoverLatestSecurityScan(applicationId, { attempts = 6, delayMs = 2000 } = {}) {
  if (!applicationId) return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      const res = await securityAPI.listScans(applicationId, { limit: 1 });
      const scans = Array.isArray(res.data?.data) ? res.data.data : [];
      if (scans[0]?.scanId) return scans[0];
    } catch {
      /* server may still be restarting */
    }
  }
  return null;
}

export default securityAPI;
