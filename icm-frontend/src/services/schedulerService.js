import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
function authHeaders() {
  const token = localStorage.getItem('icm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const schedulerAPI = {
  getConfig: () => axios.get(`${API_BASE}/org-admin/scheduler/config`, { headers: authHeaders() }),
  saveConfig: (data) => axios.put(`${API_BASE}/org-admin/scheduler/config`, data, { headers: authHeaders() }),
  generateDummy: (count) => axios.post(`${API_BASE}/org-admin/scheduler/dummy-records`, { count }, { headers: authHeaders() }),
  deleteDummyRecords: () => axios.delete(`${API_BASE}/org-admin/scheduler/dummy-records`, { headers: authHeaders() }),
  runNow: () => axios.post(`${API_BASE}/org-admin/scheduler/run-now`, {}, { headers: authHeaders() }),
  getStats: () => axios.get(`${API_BASE}/org-admin/scheduler/stats`, { headers: authHeaders() }),
  getDashboard: () => axios.get(`${API_BASE}/org-admin/scheduler/dashboard`, { headers: authHeaders() }),
  getExecutionLogs: ({ limit = 50, range = 'today' } = {}) =>
    axios.get(`${API_BASE}/org-admin/scheduler/execution-logs?limit=${limit}&range=${range}`, { headers: authHeaders() }),
  clearExecutionLogs: (mode) =>
    axios.delete(`${API_BASE}/org-admin/scheduler/execution-logs`, { data: { mode }, headers: authHeaders() }),
};

export default schedulerAPI;
