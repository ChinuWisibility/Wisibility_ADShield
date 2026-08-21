import api from "./api";

const BASE = "/sod";

/** Client-side max wait for SoD evaluation before failing the UI. */
export const SOD_EVAL_TIMEOUT_MS = 30000;
export const SOD_EVAL_TIMEOUT_MESSAGE =
  "Evaluation failed — timed out after 30 seconds.";

export function isSodEvaluationTimeoutError(err) {
  return (
    err?.code === "ECONNABORTED" ||
    err?.code === "ERR_TIMEOUT" ||
    err?.code === "ERR_EVAL_TIMEOUT" ||
    err?.code === "ERR_CANCELED" ||
    err?.name === "CanceledError" ||
    err?.name === "AbortError" ||
    /timeout|aborted|canceled/i.test(String(err?.message || ""))
  );
}

export const sodAPI = {
  // Policies
  listPolicies: (params) => api.get(`${BASE}/policies`, { params }),
  getPolicy: (id) => api.get(`${BASE}/policies/${id}`),
  createPolicy: (data) => api.post(`${BASE}/policies`, data),
  updatePolicy: (id, data) => api.put(`${BASE}/policies/${id}`, data),
  deletePolicy: (id) => api.delete(`${BASE}/policies/${id}`),
  clonePolicy: (id) => api.post(`${BASE}/policies/${id}/clone`),
  getPolicyStats: () => api.get(`${BASE}/policies/stats`),
  getNextPolicyId: () => api.get(`${BASE}/policies/next-id`),
  getPolicyViolationSummary: (policyMongoId, params = {}) =>
    api.get(`${BASE}/policies/${policyMongoId}/violation-summary`, { params }),

  // Violations
  listViolations: (params) => api.get(`${BASE}/violations`, { params }),
  getViolation: (id) => api.get(`${BASE}/violations/${id}`),
  updateViolationStatus: (id, status, comment) =>
    api.patch(`${BASE}/violations/${id}/status`, { status, comment }),
  bulkUpdateViolations: (violationIds, status, comment) =>
    api.post(`${BASE}/violations/bulk-update`, {
      violationIds,
      status,
      comment,
    }),

  // Exceptions
  listExceptions: (params) => api.get(`${BASE}/exceptions`, { params }),
  createException: (data) => api.post(`${BASE}/exceptions`, data),
  revokeException: (id) => api.post(`${BASE}/exceptions/${id}/revoke`),
  extendException: (id, validTo, reason) =>
    api.post(`${BASE}/exceptions/${id}/extend`, { validTo, reason }),

  // Remediations
  listRemediations: (params) => api.get(`${BASE}/remediations`, { params }),
  createRemediation: (data) => api.post(`${BASE}/remediations`, data),
  updateRemediation: (id, data) =>
    api.patch(`${BASE}/remediations/${id}`, data),

  // Dashboard
  getDashboard: () => api.get(`${BASE}/dashboard`),

  /**
   * Run SoD evaluation. Aborts after {@link SOD_EVAL_TIMEOUT_MS} so the UI
   * cannot stay on "Running…" forever when the request hangs.
   */
  runEvaluation: (data, config = {}) => {
    const timeoutMs =
      Number(config.timeout) > 0 ? Number(config.timeout) : SOD_EVAL_TIMEOUT_MS;
    const controller = new AbortController();
    const outerSignal = config.signal;
    const onOuterAbort = () => controller.abort();
    if (outerSignal) {
      if (outerSignal.aborted) controller.abort();
      else outerSignal.addEventListener("abort", onOuterAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const { timeout: _t, signal: _s, ...rest } = config;

    return api
      .post(`${BASE}/run-evaluation`, data || {}, {
        ...rest,
        timeout: timeoutMs,
        signal: controller.signal,
      })
      .catch((err) => {
        if (isSodEvaluationTimeoutError(err) || controller.signal.aborted) {
          const timeoutErr = new Error(SOD_EVAL_TIMEOUT_MESSAGE);
          timeoutErr.code = "ERR_EVAL_TIMEOUT";
          throw timeoutErr;
        }
        throw err;
      })
      .finally(() => {
        clearTimeout(timer);
        if (outerSignal) {
          outerSignal.removeEventListener("abort", onOuterAbort);
        }
      });
  },

  // Certification helpers
  getAppsForCertification: () => api.get(`${BASE}/certification/applications`),
  getPoliciesByApplication: (appId) =>
    api.get(`${BASE}/certification/applications/${appId}/policies`),
  getViolationsForCertification: (policyIds) =>
    api.post(`${BASE}/certification/violations`, { policyIds }),
  getSodManagers: (params) =>
    api.get(`${BASE}/certification/managers`, { params }),

  // Policy builder helpers
  getAppEntitlements: (appId) =>
    api.get(`${BASE}/applications/${appId}/entitlements`),

  // Audit
  listAuditLogs: (params) => api.get(`${BASE}/audit-logs`, { params }),
};
