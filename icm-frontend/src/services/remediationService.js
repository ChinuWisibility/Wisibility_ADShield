import api from "./api";
import axios from "axios";

const BASE = "/remediation";
const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

const publicApi = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

publicApi.interceptors.response.use(
  (res) => res,
  (err) => Promise.reject(err),
);

export const remediationAPI = {
  // Legacy events
  listEvents: (params) => api.get(`${BASE}/events`, { params }),
  getEvent: (id) => api.get(`${BASE}/events/${id}`),
  createEvent: (data) => api.post(`${BASE}/events`, data),
  updateEvent: (id, data) => api.patch(`${BASE}/events/${id}`, data),
  duplicateEvent: (id) => api.post(`${BASE}/events/${id}/duplicate`),
  deleteEvent: (id) => api.delete(`${BASE}/events/${id}`),

  // Legacy campaign flow (preserved)
  listApplicationCampaigns: (params) => api.get(`${BASE}/campaigns`, { params }),
  getCampaignRevokedUsers: (campaignId) =>
    api.get(`${BASE}/campaigns/${campaignId}/revoked-users`),
  importCampaignRevokeEvent: (campaignId) =>
    api.post(`${BASE}/campaigns/${campaignId}/import`),
  submitCampaignRevokeActions: (campaignId, data) =>
    api.post(`${BASE}/campaigns/${campaignId}/actions`, data),

  // ITSM ticket workflow (v2)
  listCampaignsV2: (params) => api.get(`${BASE}/campaigns-v2`, { params }),
  fetchRevokedUsers: (data) => api.post(`${BASE}/revoked-users/fetch`, data),
  listTickets: (params) => api.get(`${BASE}/tickets`, { params }),
  createTicket: (data) => api.post(`${BASE}/tickets`, data),
  getTicket: (ticketId) => api.get(`${BASE}/tickets/${ticketId}`),
  runTicket: (ticketId) => api.post(`${BASE}/tickets/${ticketId}/run`),
  submitTicketResponses: (ticketId, data) =>
    api.post(`${BASE}/tickets/${ticketId}/responses`, data),

  // Public ITSM review portal (no auth redirect)
  getTicketReview: (ticketId, token) =>
    publicApi.get(`${BASE}/tickets/${ticketId}/review`, { params: { token } }),
  submitTicketReview: (ticketId, data) =>
    publicApi.post(`${BASE}/tickets/${ticketId}/review`, data),

  // Queue-driven remediation (v3)
  getQueueSummary: () => api.get(`${BASE}/queue/summary`),
  listQueue: (params) => api.get(`${BASE}/queue`, { params }),
  getQueue: (id) => api.get(`${BASE}/queue/${id}`),
  getQueueItems: (id, params) => api.get(`${BASE}/queue/${id}/items`, { params }),
  createTicketFromQueue: (queueId, data) =>
    api.post(`${BASE}/queue/${queueId}/create-ticket`, data),
  enqueueToQueue: (data) => api.post(`${BASE}/queue/enqueue`, data),
  syncRevokeAccessQueues: () => api.post(`${BASE}/queue/sync-revoke-access`),
  syncAllQueues: () => api.post(`${BASE}/queue/sync-all`),
  listValidations: (params) => api.get(`${BASE}/validations`, { params }),
  respondValidation: (id, data) => api.post(`${BASE}/validations/${id}/respond`, data),
  getTracking: (eventId) => api.get(`${BASE}/tracking/${eventId}`),
};
