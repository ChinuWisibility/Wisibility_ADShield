import api from "../../../services/api";

/**
 * Remediation workflow API — uses the shared IGA axios instance (auth token,
 * 401 handling) and the /remediation-workflows mount. Response shapes match
 * the builder UI: r.data.data, r.data.validation.
 */
const BASE = "/remediation-workflows";

export const workflowApi = {
  list: (params = {}) => api.get(`${BASE}/workflows`, { params }),
  templates: (params = {}) => api.get(`${BASE}/workflow-templates`, { params }),
  useTemplate: (templateId, params = {}) =>
    api.post(`${BASE}/workflow-templates/${templateId}/use`, {}, { params }),
  enabled: (trigger, params = {}) =>
    api.get(`${BASE}/workflows/enabled`, {
      params: { ...(trigger ? { trigger } : {}), ...params },
    }),
  get: (id, params = {}) => api.get(`${BASE}/workflows/${id}`, { params }),
  create: (body, params = {}) => api.post(`${BASE}/workflows`, body, { params }),
  update: (id, body, opts = {}) =>
    api.put(`${BASE}/workflows/${id}`, body, {
      params: {
        ...(opts.allowInvalid ? { allowInvalid: "true" } : {}),
        ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      },
    }),
  remove: (id, params = {}) => api.delete(`${BASE}/workflows/${id}`, { params }),
  catalog: (remediationAction) =>
    api.get(`${BASE}/catalog`, {
      headers: { "Cache-Control": "no-cache" },
      params: { _: Date.now(), ...(remediationAction ? { remediationAction } : {}) },
    }),
  stepConfig: () => api.get(`${BASE}/catalog/step-config`),
  template: () => api.get(`${BASE}/template/cert-revoke`),
  seedTemplate: (params = {}) => api.post(`${BASE}/workflows/seed-template`, {}, { params }),
  seedIamOrphanTemplate: (params = {}) =>
    api.post(`${BASE}/workflows/seed-iam-orphan-template`, {}, { params }),
  seedAccessRevokeDualNotifyTemplate: (params = {}) =>
    api.post(`${BASE}/workflows/seed-access-revoke-dual-notify-template`, {}, { params }),
  test: (id, trigger) => api.post(`${BASE}/workflows/${id}/test`, { trigger }),
  testDefinition: (definition, trigger) =>
    api.post(`${BASE}/workflows/test-definition`, { definition, trigger }),
  validateDefinition: (definition) =>
    api.post(`${BASE}/workflows/validate-definition`, { definition }),
  validate: (id, body) => api.post(`${BASE}/workflows/${id}/validate`, body || {}),
  sampleTriggers: () => api.get(`${BASE}/samples/triggers`),
  listRuns: (workflowId) => api.get(`${BASE}/workflows/${workflowId}/runs`),
  getRun: (runId) => api.get(`${BASE}/runs/${runId}`),
  executions: (params) => api.get(`${BASE}/executions`, { params }),
  getExecution: (executionId) => api.get(`${BASE}/executions/${executionId}`),
  getExecutionNodes: (executionId) => api.get(`${BASE}/executions/${executionId}/nodes`),
};

export default api;
