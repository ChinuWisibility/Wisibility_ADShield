import api from "../../../services/api";

/**
 * Identity provisioning API — shared IGA axios instance (auth token, 401 handling)
 * on the /provisioning mount. Tenant scope is always an explicit query param: a
 * platform admin has no tenantId in their JWT.
 */
const BASE = "/provisioning";

export const provisioningApi = {
  listRules: (params = {}) => api.get(`${BASE}/identity-rules`, { params }),
  createRule: (body, params = {}) => api.post(`${BASE}/identity-rules`, body, { params }),
  updateRule: (id, body, params = {}) => api.put(`${BASE}/identity-rules/${id}`, body, { params }),
  removeRule: (id, params = {}) => api.delete(`${BASE}/identity-rules/${id}`, { params }),

  listLifecycleRequests: (params = {}) => api.get(`${BASE}/lifecycle-requests`, { params }),
  listLifecycleEvents: (params = {}) => api.get(`${BASE}/lifecycle-events`, { params }),

  approve: (requestId, params = {}) =>
    api.post(`${BASE}/joiner/${requestId}/approve`, {}, { params }),
  reject: (requestId, params = {}) =>
    api.post(`${BASE}/joiner/${requestId}/reject`, {}, { params }),

  runTask: (taskId, params = {}) => api.post(`${BASE}/tasks/${taskId}/run`, {}, { params }),
  retryTask: (taskId, params = {}) => api.post(`${BASE}/tasks/${taskId}/retry`, {}, { params }),

  evaluateJoiner: (identityIds, params = {}) =>
    api.post(`${BASE}/joiner/evaluate`, { identityIds }, { params }),
};

export function apiErrorMessage(error, fallback) {
  return (
    error?.response?.data?.error?.message
    || error?.response?.data?.message
    || error?.message
    || fallback
  );
}

export default provisioningApi;
