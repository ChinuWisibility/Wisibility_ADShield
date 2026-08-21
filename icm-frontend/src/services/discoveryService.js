import api from './api';

const BASE = '/discovery';

export const discoveryAPI = {
  // ── Policy CRUD ──
  listPolicies: (params) => api.get(`${BASE}/policies`, { params }),
  getPolicy: (id) => api.get(`${BASE}/policies/${id}`),
  createPolicy: (data) => api.post(`${BASE}/policies`, data),
  updatePolicy: (id, data) => api.put(`${BASE}/policies/${id}`, data),
  deletePolicy: (id) => api.delete(`${BASE}/policies/${id}`),
  clonePolicy: (id) => api.post(`${BASE}/policies/${id}/clone`),
  getPolicyStats: () => api.get(`${BASE}/policies/stats`),
  getNextPolicyId: () => api.get(`${BASE}/policies/next-id`),

  // ── Evaluation ──
  evaluatePolicy: (id, dryRun = false) =>
    api.post(`${BASE}/policies/${id}/evaluate`, { dryRun }, { timeout: 120000 }),
  evaluateAll: () =>
    api.post(`${BASE}/evaluate-all`, {}, { timeout: 300000 }),

  // ── Results ──
  getResults: (params) => api.get(`${BASE}/results`, { params }),
  getResultsSummary: () => api.get(`${BASE}/results/summary`),
  markResults: (resultIds) => api.put(`${BASE}/results/mark`, { resultIds }),
  unmarkResults: (resultIds) => api.put(`${BASE}/results/unmark`, { resultIds }),

  // ── Field Discovery ──
  getFields: (applicationId, entityType) =>
    api.get(`${BASE}/fields/${applicationId}/${entityType}`),
};
