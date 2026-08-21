import api from "../../../services/api";

const BASE = "/workflow-remediation";

export const workflowRemediationApi = {
  summary: () => api.get(`${BASE}/summary`),
  workflows: (params) => api.get(`${BASE}/workflows`, { params }),
  getOpenEvent: (params) => api.get(`${BASE}/open-event`, { params }),
  listEvents: (params) => api.get(`${BASE}/events`, { params }),
  getEvent: (eventId) => api.get(`${BASE}/events/${eventId}`),
  getEventItems: (eventId, params) => api.get(`${BASE}/events/${eventId}/items`, { params }),
  createTicket: (eventId, body) => api.post(`${BASE}/events/${eventId}/ticket`, body),
  triggerWorkflow: (eventId, body) => api.post(`${BASE}/events/${eventId}/trigger`, body),
  getColumnConfig: (eventType) => api.get(`${BASE}/column-config/${eventType}`),
  manualEnqueue: (body) => api.post(`${BASE}/manual-enqueue`, body),
  enqueue: (body) => api.post(`${BASE}/manual-enqueue`, body),
  checkQueued: (body) => api.post(`${BASE}/check-queued`, body),
};
