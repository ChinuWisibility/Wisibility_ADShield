import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

/** Origin for uploaded assets when API base is relative (/api + Vite proxy). */
export function resolveServerBaseUrl() {
  if (API_BASE.startsWith("http")) {
    return API_BASE.replace(/\/api\/?$/, "");
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

const STARTUP_503_MAX_RETRIES = 8;
const STARTUP_503_BASE_DELAY_MS = 400;

function isStartup503(error) {
  return (
    error?.response?.status === 503 &&
    error?.response?.data?.code !== "MAINTENANCE_MODE"
  );
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Request interceptor - attach token
api.interceptors.request.use((config) => {
  // Prevent JSON default header from breaking multipart/form-data uploads.
  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    if (typeof config.headers?.set === "function") {
      config.headers.set("Content-Type", undefined);
    } else if (config.headers) {
      delete config.headers["Content-Type"];
    }
  }

  const token = localStorage.getItem("icm_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor - handle auth errors and brief API startup windows
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config;
    if (err?.response?.data?.code === "MAINTENANCE_MODE") {
      const payload = {
        message: err.response.data.message,
        supportEmail: err.response.data.data?.supportEmail || "",
      };
      sessionStorage.setItem("iga_maintenance", JSON.stringify(payload));
      if (window.location.pathname !== "/maintenance") {
        sessionStorage.setItem(
          "iga_maintenance_return",
          `${window.location.pathname}${window.location.search}`,
        );
        window.location.replace("/maintenance");
      }
      return Promise.reject(err);
    }
    if (config && isStartup503(err)) {
      const attempt = Number(config.__startup503RetryCount || 0);
      if (attempt < STARTUP_503_MAX_RETRIES) {
        config.__startup503RetryCount = attempt + 1;
        await sleep(STARTUP_503_BASE_DELAY_MS * (attempt + 1));
        return api(config);
      }
    }

    if (err.response?.status === 401) {
      localStorage.removeItem("icm_token");
      localStorage.removeItem("icm_user");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  },
);

// Auth APIs
export const authAPI = {
  login: (data) => api.post("/auth/login", data),
  verifyLoginMfa: (data) => api.post("/auth/login/mfa", data),
  register: (data) => api.post("/auth/register", data),
  getProfile: () => api.get("/auth/profile"),
  updateProfile: (data) => api.put("/auth/profile", data),
  changePassword: (data) => api.put("/auth/change-password", data),
  logout: () => api.post("/auth/logout"),
  listUsers: (params) => api.get("/auth/users", { params }),
  deactivateUser: (id) => api.put(`/auth/users/${id}/deactivate`),
  activateUser: (id) => api.put(`/auth/users/${id}/activate`),
  assignRole: (id, role) => api.put(`/auth/users/${id}/role`, { role }),
  resetPassword: (id) => api.post(`/auth/users/${id}/reset-password`),
  revokeAllSessions: (id) => api.post(`/auth/users/${id}/sessions/revoke`),
  updateUser: (id, data) => api.put(`/auth/users/${id}`, data),
  getUserActivity: (id, params) =>
    api.get(`/auth/users/${id}/activity`, { params }),
  bulkImportUsers: (file, options = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    if (options.defaultTenantId) {
      fd.append("defaultTenantId", options.defaultTenantId);
    }
    return api.post("/auth/users/bulk", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  requestPasswordReset: (email) => api.post("/auth/forgot-password", { email }),
  verifyResetToken: (token) =>
    api.get("/auth/reset-password/verify", { params: { token } }),
  resetPasswordWithToken: (data) => api.post("/auth/reset-password", data),
  verifyCreateOwnPasswordToken: (token) =>
    api.get("/auth/create-own-password/verify", { params: { token } }),
  completeCreateOwnPassword: (data) => api.post("/auth/create-own-password", data),
  requestPasswordOtp: (email, purpose) =>
    api.post("/auth/password-otp/request", { email, purpose }),
  verifyPasswordOtp: (email, otpCode, purpose = "forgot") =>
    api.post("/auth/password-otp/verify", { email, otpCode, purpose }),
  resetPasswordWithOtp: (payload) =>
    api.post("/auth/password-otp/confirm", payload),
};

// MFA APIs
export const mfaAPI = {
  getStatus: () => api.get("/auth/mfa/status"),
  enroll: (data) => api.post("/auth/mfa/enroll", data),
  verify: (data) => api.post("/auth/mfa/verify", data),
  setupTotp: () => api.post("/auth/mfa/totp/setup"),
  disable: (data) => api.delete("/auth/mfa", { data }),
  generateBackupCodes: () => api.post("/auth/mfa/backup-codes"),
};

// Session APIs
export const sessionAPI = {
  listMySessions: () => api.get("/auth/sessions"),
  revokeSession: (id) => api.delete(`/auth/sessions/${id}`),
};

// Audit APIs
export const auditAPI = {
  list: (params) => api.get("/audit", { params }),
  getById: (id) => api.get(`/audit/${id}`),
  getByEntity: (type, id) => api.get(`/audit/entity/${type}/${id}`),
  exportLog: (data) => api.post("/audit/export", data),
  getLogins: (params) => api.get("/audit/logins", { params }),
  getStats: (params) => api.get("/audit/stats", { params }),
  purge: (data) => api.delete("/audit/purge", { data }),
};

// Activity APIs
export const activityAPI = {
  log: (data) => api.post("/activity", data),
  getFeed: (params) => api.get("/activity", { params }),
  getMyActivity: (params) => api.get("/activity/me", { params }),
  getEntityActivity: (id, params) =>
    api.get(`/activity/entity/${id}`, { params }),
};

// Tenant APIs
export const tenantAPI = {
  getConfig: () => api.get("/tenant/config"),
  updateConfig: (data) => api.put("/tenant/config", data),
  getFeatures: () => api.get("/tenant/features"),
  updateFeatures: (data) => api.put("/tenant/features", data),
  getLicence: () => api.get("/tenant/licence"),
  // Multi-tenant Management
  list: () => api.get("/tenant"),
  create: (data) => api.post("/tenant", data),
};

// Settings APIs
export const settingsAPI = {
  getPasswordPolicy: () => api.get("/settings/password-policy"),
  updatePasswordPolicy: (data) => api.put("/settings/password-policy", data),
  validatePassword: (password) =>
    api.post("/settings/password-policy/validate", { password }),
  getDeploymentAccess: () => api.get("/settings/deployment-access"),
  updateDeploymentAccess: (data) =>
    api.put("/settings/deployment-access", data),
  getPlatform: () => api.get("/settings/platform"),
  updatePlatform: (data) => api.put("/settings/platform", data),
};

// Notification Template APIs
export const notificationAPI = {
  listTemplates: (params) => api.get("/notifications/templates", { params }),
  getTemplate: (key) => api.get(`/notifications/templates/${key}`),
  updateTemplate: (key, data) =>
    api.put(`/notifications/templates/${key}`, data),
  previewTemplate: (key, data) =>
    api.post(`/notifications/templates/${key}/preview`, data),
  resetTemplate: (key) => api.post(`/notifications/templates/${key}/reset`),
};

// Admin APIs
export const adminAPI = {
  listAllSessions: (params) => api.get("/admin/sessions", { params }),
  createApiKey: (data) => api.post("/admin/api-keys", data),
  listApiKeys: (params) => api.get("/admin/api-keys", { params }),
  revokeApiKey: (id) => api.delete(`/admin/api-keys/${id}`),
  rotateApiKey: (id) => api.post(`/admin/api-keys/${id}/rotate`),
};

export const licenseAPI = {
  status: () => api.get("/license/status"),
  upload: (file) => {
    const fd = new FormData();
    fd.append("license", file);
    return api.post("/license/upload", fd, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60000,
    });
  },
  reload: () => api.post("/license/reload"),
};

export const systemAPI = {
  diagnostics: () => api.get("/system/diagnostics"),
  info: () => api.get("/system/info"),
  about: () => api.get("/system/about"),
};

// Org admin APIs
export const orgAdminAPI = {
  getIdentityPostureRules: () => api.get("/org-admin/identity-posture-rules"),
  saveIdentityPostureRules: (rules) => api.put("/org-admin/identity-posture-rules", { rules }),
  resetIdentityPostureRules: () => api.delete("/org-admin/identity-posture-rules"),
  previewIdentityPostureRules: (payload) =>
    api.post("/org-admin/identity-posture-rules/preview", payload),
  getReportingRuleSet: () => api.get("/org-admin/reporting-rule-set"),
  saveReportingRuleSet: (config) => api.put("/org-admin/reporting-rule-set", config),
  resetReportingRuleSet: () => api.delete("/org-admin/reporting-rule-set"),
  getTenantRiskBand: (metricKey) => api.get(`/org-admin/reporting-rule-set/risk-bands/${metricKey}`),
  putTenantRiskBand: (metricKey, body) =>
    api.put(`/org-admin/reporting-rule-set/risk-bands/${metricKey}`, body),
  getUncorrelatedTrustMapping: () => api.get("/org-admin/uncorrelated-trust-mapping"),
  saveUncorrelatedTrustMapping: (config) =>
    api.put("/org-admin/uncorrelated-trust-mapping", { config }),
  resetUncorrelatedTrustMapping: () => api.delete("/org-admin/uncorrelated-trust-mapping"),
};

// Branding APIs
export const brandingAPI = {
  get: () => api.get("/branding"),
  update: (data) => api.put("/branding", data),
  reset: () => api.delete("/branding/reset"),
  preview: (data) => api.post("/branding/preview", data),
};

// Logo APIs
export const logoAPI = {
  list: () => api.get("/logos"),
  get: (id) => api.get(`/logos/${id}`),
  upload: (file, logoType) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("logoType", logoType);
    // Let the browser set multipart boundary automatically.
    return api.post("/logos", fd);
  },
  delete: (id) => api.delete(`/logos/${id}`),
  setDefault: (id, data) => api.put(`/logos/${id}/default`, data),
};

/** Tenant-scoped application icon library (built-ins + uploads). */
export const applicationIconAPI = {
  list: (params) => api.get("/application-icons", { params }),
  seedBuiltins: (tenantId, body = {}) =>
    api.post("/application-icons/seed-builtins", { tenantId, ...body }),
  applyBuiltins: (tenantId, body = {}) =>
    api.post("/application-icons/apply-builtins", { tenantId, ...body }),
  upload: (file, { tenantId, name, color } = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    if (tenantId) fd.append("tenantId", tenantId);
    if (name) fd.append("name", name);
    if (color) fd.append("color", color);
    return api.post("/application-icons", fd);
  },
  delete: (id, params) => api.delete(`/application-icons/${id}`, { params }),
  imageUrl: (id) => {
    if (!id) return null;
    const path = String(id).startsWith("/api/")
      ? String(id)
      : `/api/application-icons/${id}/image`;
    return `${resolveServerBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  },
};

// Preference APIs
export const preferenceAPI = {
  get: () => api.get("/preferences"),
  update: (data) => api.put("/preferences", data),
  reset: () => api.delete("/preferences"),
};

// Dashboard Widget APIs
export const dashboardWidgetAPI = {
  get: () => api.get("/dashboard/widgets"),
  save: (data) => api.put("/dashboard/widgets", data),
  reset: () => api.delete("/dashboard/widgets"),
};
// Application APIs
export const applicationAPI = {
  // FR-134: Get all applications (with pagination, sort, filter via params)
  list: (params) => api.get("/applications", { params }),
  // For certification wizard: applications grouped by tenant (enterprise-optimized)
  getGroupedByTenant: (params) =>
    api.get("/applications/grouped-by-tenant", { params }),

  // FR-135: Get single application by ID
  getById: (id) => api.get(`/applications/${id}`),

  // FR-136: Create new application
  create: (data) => api.post("/applications", data),

  // FR-137: Update existing application
  update: (id, data) => api.put(`/applications/${id}`, data),

  /** UI-only accounts table column order / visibility (does not change application schema). */
  patchAccountsTablePreferences: (id, data) =>
    api.patch(`/applications/${id}/accounts-table-preferences`, data),

  /** Security scan thresholds (inactive users days, etc.). */
  patchSecurityScanSettings: (id, data) =>
    api.patch(`/applications/${id}/security-scan-settings`, data),

  // FR-138: Delete application (legacy: drops dynamic user/entitlement collections only)
  delete: (id) => api.delete(`/applications/${id}`),

  /** Full dependency map with MongoDB collection names and row counts */
  getDeletionImpact: (id) => api.get(`/applications/${id}/deletion-impact`),

  /** Selective delete: body `{ scopes: { [scopeKey]: boolean } }` — see deletion-impact response */
  deleteScoped: (id, scopes) =>
    api.post(`/applications/${id}/delete-scoped`, { scopes }),

  // FR-139: Upload application data via CSV
  uploadData: (id, formData) =>
    api.post(`/applications/${id}/upload`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),

  /** User CSV: headers must match saved userMappings technical names exactly (order-insensitive). */
  uploadUsersCsvStrict: (id, formData) =>
    api.post(`/applications/${id}/users/upload-strict`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 300000,
    }),

  /** Map & import: persist CSV column aliases only (does not replace userMappings). */
  saveCsvImportMapping: (id, data) =>
    api.put(`/applications/${id}/csv-import-mapping`, data),

  /** User CSV using saved csvImportMapping (aliases allowed). */
  uploadUsersCsvMapped: (id, formData) =>
    api.post(`/applications/${id}/users/upload-mapped`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 300000,
    }),

  /** Entitlement CSV: headers must match saved entitlementMappings technical names exactly. */
  uploadEntitlementsCsvStrict: (id, formData) =>
    api.post(`/applications/${id}/entitlements/upload-strict`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 120000,
    }),

  // FR-140: Fetch Users for this app
  /** @param {object} [params] — `{ page, limit, search, accountStatus, isPrivileged, privilegeLevel }` */
  getUsers: (id, params) => api.get(`/applications/${id}/users`, { params }),

  /** Active/inactive user counts for an application. */
  getUserStatusCounts: (id) =>
    api.get(`/applications/${id}/users/status-counts`),

  /** Ingest duplicate PK sidecar: paginated summary rows (v1 read-only). */
  listUserDuplicates: (applicationId, params) =>
    api.get(`/applications/${applicationId}/user-duplicates`, { params }),

  /** Full duplicate group snapshot (canonical + extra rows). */
  getUserDuplicateGroup: (applicationId, groupId) =>
    api.get(`/applications/${applicationId}/user-duplicates/${groupId}`),

  /** Reconciliation run history for an application. */
  getReconciliationRuns: (id, params) =>
    api.get(`/applications/${id}/reconciliation/runs`, { params }),

  getReconciliationRun: (id, runId) =>
    api.get(`/applications/${id}/reconciliation/runs/${runId}`),

  /** Flattened attribute-level delta rows (optional runId, changeType, search). */
  getReconciliationDeltas: (id, params) =>
    api.get(`/applications/${id}/reconciliation/deltas`, { params }),

  getReconciliationEntitlementDeltas: (id, params) =>
    api.get(`/applications/${id}/reconciliation/entitlement-deltas`, { params }),

  // FR-141: Fetch Entitlements for this app
  /** @param {object} [params] — `{ page, limit, search, isPrivileged, privilegeLevel }` */
  getEntitlements: (id, params) =>
    api.get(`/applications/${id}/entitlements`, { params }),

  /** Application View catalog overview tiles */
  getViewSummary: (id) => api.get(`/applications/${id}/view-summary`),

  /** Application View SoD policies + violations for this app */
  getSod: (id) => api.get(`/applications/${id}/sod`),

  /** Application View certification campaigns + review items for this app */
  getCertifications: (id) => api.get(`/applications/${id}/certifications`),

  /** Update Application.riskLevel / riskJustification (requires APPLICATION_RISK_WRITE). */
  updateRisk: (id, data) => api.put(`/applications/${id}/risk`, data),
  /** Update Application.complianceFrameworks (requires APPLICATION_COMPLIANCE_WRITE). */
  updateCompliance: (id, data) => api.put(`/applications/${id}/compliance`, data),

  /** ApplicationRiskProfile CRUD (requires APPLICATION_RISK_PROFILE_MANAGE for writes). */
  getRiskProfiles: (params) => api.get('/applications/risk-profiles', { params }),
  createRiskProfile: (data) => api.post('/applications/risk-profiles', data),
  updateRiskProfile: (profileId, data) => api.put(`/applications/risk-profiles/${profileId}`, data),

  // Fetch dynamic model fields for the mapping wizard
  getModelFields: (type) => api.get(`/applications/meta/fields/${type}`),

  /** Test LDAP / AD connectivity (no application id required) */
  testAdConnection: (data) =>
    api.post("/applications/ad/test-connection", data),

  /** Start AD sync (default async → HTTP 202 + jobId). Poll with getAdSyncJob or use waitForAdSyncJob. */
  syncAdUsers: (id, data, config) =>
    api.post(`/applications/${id}/ad/sync`, data || {}, {
      timeout: 30000,
      ...config,
    }),

  /** Poll AD sync job after syncAdUsers returns 202. */
  getAdSyncJob: (applicationId, jobId) =>
    api.get(`/applications/${applicationId}/ad-sync-jobs/${jobId}`),

  /**
   * Start AD sync and block until completed (polls job status).
   * @param {string} id application id
   * @param {object} [data] sync body
   * @param {{ pollMs?: number, maxWaitMs?: number }} [options]
   */
  waitForAdSyncJob: async (id, data, options = {}) => {
    const pollMs = options.pollMs ?? 1000;
    // Large AD forests often exceed 10 minutes; default 2h. Set maxWaitMs: 0 to wait indefinitely.
    const maxWaitMs =
      options.maxWaitMs === 0
        ? Number.POSITIVE_INFINITY
        : (options.maxWaitMs ?? 2 * 60 * 60 * 1000);
    const start = await api.post(`/applications/${id}/ad/sync`, data || {}, {
      timeout: 30000,
    });
    if (start.status !== 202 || !start.data?.jobId) {
      return start;
    }
    const jobId = start.data.jobId;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const st = await api.get(`/applications/${id}/ad-sync-jobs/${jobId}`, {
        timeout: 60000,
      });
      const job = st.data?.data;
      if (!job) throw new Error("AD sync job not found.");
      if (job.status === "completed") {
        return {
          ...st,
          data: {
            success: true,
            message: job.message,
            jobId,
            ...job.result,
          },
        };
      }
      if (job.status === "failed") {
        const err = new Error(job.error || job.message || "AD sync failed.");
        err.response = { data: { success: false, message: err.message } };
        throw err;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(
      "Timed out waiting for AD sync. The job may still be running — check Sync status or raise maxWaitMs.",
    );
  },

  /** Full connector catalog (label → family + payload code) */
  getConnectorCatalog: () => api.get("/applications/connectors/catalog"),

  /** Test any connector using inline or saved connectionConfig */
  testConnector: (data) => api.post("/applications/connectors/test", data),

  /** Sync users for non–Active Directory connectors (uses application.connectorType + connectionConfig) */
  syncConnector: (id, data) =>
    api.post(`/applications/${id}/connectors/sync`, data || {}, { timeout: 300000 }),

  // Paginated entitlement summaries (counts only; users loaded on demand)
  getAppEntitlementCorrelations: (id, params) =>
    api.get(`/applications/${id}/correlations`, { params }),
  getCorrelationEntitlementUsers: (id, params) =>
    api.get(`/applications/${id}/correlations/entitlement-users`, {
      params,
      timeout: 120000,
    }),

  /** Cached facet counts for manager correlation UI (counts only). */
  getManagerCorrelationFacets: (id, params) =>
    api.get(`/applications/${id}/correlations/manager-facets`, { params }),
  /** Paginated distinct manager-reference groups for the correlation tab. */
  getManagerCorrelationGroups: (id, params) =>
    api.get(`/applications/${id}/correlations/manager-groups`, { params }),
  /** Paginated users under one manager group (normalized key). */
  getManagerCorrelationGroupUsers: (id, params) =>
    api.get(`/applications/${id}/correlations/manager-group-users`, {
      params,
      timeout: 120000,
    }),

  // Triggers the engine to run and build the matrix
  executeAppEntitlementCorrelation: (id, data) =>
    api.post(`/applications/${id}/execute-correlation`, data, {
      timeout: 900000,
    }),
  // Triggers the Manager Correlation engine (default: async 202 + jobId; use sync: true for blocking 200)
  executeManagerCorrelation: (id, data, config) =>
    api.post(`/applications/${id}/execute-manager-correlation`, data, config),
  /** Poll status after executeManagerCorrelation returns 202. */
  getManagerCorrelationJob: (applicationId, jobId) =>
    api.get(`/applications/${applicationId}/manager-correlation-jobs/${jobId}`),
};

export const adAPI = {
  getSuggestedApps: (applicationId, params = {}) =>
    api.get("/ad/suggested-apps", {
      params: { applicationId, ...params },
      timeout: 30000,
    }),
  getSuggestedAppGroups: (applicationId, appName, params = {}) =>
    api.get("/ad/suggested-apps/groups", {
      params: { applicationId, appName, ...params },
      timeout: 30000,
    }),
  refreshSuggestions: (applicationId) =>
    api.post(
      "/ad/refresh-suggestions",
      { applicationId },
      {
        timeout: 600000,
      },
    ),
  recomputeSuggestions: (applicationId, data = {}) =>
    api.post(
      "/ad/recompute-suggestions",
      { applicationId, ...data },
      {
        timeout: 120000,
      },
    ),
  previewGroupRuleMatches: (applicationId, body) =>
    api.post(
      "/ad/preview-group-matches",
      { applicationId, ...body },
      { timeout: 30000 },
    ),
  onboardApplications: (data) =>
    api.post("/ad/onboard-applications", data, {
      timeout: 120000,
    }),
};

// Identity Profile APIs (FR-074 to FR-078)
export const identityProfileAPI = {
  list: (params) => api.get("/identity-profiles", { params }),
  getById: (id) => api.get(`/identity-profiles/${id}`),
  create: (data) => api.post("/identity-profiles", data),
  update: (id, data) => api.put(`/identity-profiles/${id}`, data),
  delete: (id, data) =>
    api.delete(`/identity-profiles/${id}`, { data: data || {} }),
  /** Cascade impact tree before deleting a profile (identities, account links, correlation, roles, …). */
  getDeletionImpact: (id) =>
    api.get(`/identity-profiles/${id}/deletion-impact`),
  /** Field list for the manual create-identity form, derived from this profile's mappings. */
  getCreateSchema: (id, params) =>
    api.get(`/identity-profiles/${id}/create-schema`, { params }),
  /** At most five profile-scoped identities for manager/reference autocomplete fields. */
  getReferenceOptions: (id, params, axiosConfig = {}) =>
    api.get(`/identity-profiles/${id}/reference-options`, {
      params,
      ...axiosConfig,
    }),
  /** Distinct values already stored for one mapped attribute (rule condition pickers). */
  getAttributeValues: (id, params, axiosConfig = {}) =>
    api.get(`/identity-profiles/${id}/attribute-values`, {
      params,
      ...axiosConfig,
    }),
  getMappingMeta: (params) =>
    api.get("/identity-profiles/meta/target-attributes", { params }),
  /** Target keys + labels union of all profile mappings for tenant (Identities list columns). */
  getMappedFields: (params, axiosConfig = {}) =>
    api.get("/identity-profiles/meta/mapped-fields", { params, ...axiosConfig }),
  /** Applications / legacy HRMS ids used as authoritative source on ≥1 identity profile. */
  getProfileSourceApplications: (params) =>
    api.get("/identity-profiles/meta/profile-source-applications", { params }),
  putMappings: (id, data, axiosConfig = {}) =>
    api.put(`/identity-profiles/${id}/mappings`, data, axiosConfig),
  /** Poll tenant-wide identity materialization lock (who is running refresh / save+sync). */
  getMaterializationLockStatus: (params, axiosConfig = {}) =>
    api.get("/identity-profiles/materialization/lock-status", {
      params,
      ...axiosConfig,
    }),
  /** Starts server-side bulk refresh; default `async: true` → HTTP 202 + `jobId` (poll `getBulkMaterializationJob`). */
  bulkMaterializationRefresh: (data) =>
    api.post("/identity-profiles/materialization/bulk-refresh", data, {
      timeout: 120000,
    }),
  getBulkMaterializationJob: (jobId, params) =>
    api.get(`/identity-profiles/materialization/bulk-refresh/jobs/${jobId}`, {
      params,
      timeout: 30000,
    }),
  previewMappings: (id, data) =>
    api.post(`/identity-profiles/${id}/mappings/preview`, data),
  /** Upsert identities from last uploaded CSV using this profile's mappings (delimited HRMS only). */
  importFromDelimited: (id) =>
    api.post(
      `/identity-profiles/${id}/import-from-delimited`,
      {},
      { timeout: 120000 },
    ),
  /** SailPoint-style checklist for source → schema → data → mappings. */
  getReadiness: (id) => api.get(`/identity-profiles/${id}/readiness`),
  /** Confirms CSV rows are loaded (aggregation complete). */
  aggregateDelimited: (id) =>
    api.post(`/identity-profiles/${id}/aggregate-delimited`, {}),
  /** Identity refresh: apply mappings, upsert identities, manager linking (can run minutes on large CSVs). */
  identityRefresh: (id) =>
    api.post(
      `/identity-profiles/${id}/identity-refresh`,
      {},
      { timeout: 600000 },
    ),
  /**
   * Save draft mapping rows without final validation (no manager correlation required).
   * @param {string} id - Profile ID
   * @param {{ mappingDraftData: object[] }} data
   */
  saveDraft: (id, data) => api.patch(`/identity-profiles/${id}/draft`, data),
  /** Clear draft after successful final save. */
  clearDraft: (id) => api.delete(`/identity-profiles/${id}/draft`),
  /**
   * Sample values from one source user for manager/reference field sanity check.
   * @param {string} id - Profile ID
   * @param {{ managerAttribute: string, referenceAttribute: string }} params
   */
  getManagerCorrelationPreview: (id, params) =>
    api.get(`/identity-profiles/${id}/manager-correlation-preview`, { params }),
};

// Global Identity APIs (Human Beings)
export const identityAPI = {
  // Core CRUD
  list: (params, axiosConfig = {}) =>
    api.get("/identities", { params, ...axiosConfig }),
  getById: (id) => api.get(`/identities/${id}`),
  create: (data) => api.post("/identities", data),
  update: (id, data) => api.put(`/identities/${id}`, data),
  delete: (id) => api.delete(`/identities/${id}`),

  // Bulk & Mapping
  bulkImport: (data) => api.post("/identities/bulk", data, { timeout: 300000 }),
  autoMap: () => api.post("/identities/auto-map"),
  getMetaFields: (axiosConfig = {}) =>
    api.get("/identities/meta/fields", axiosConfig),
  getDepartments: (params, axiosConfig = {}) =>
    api.get("/identities/meta/departments", { params, ...axiosConfig }),
  deleteAll: (params) => api.delete("/identities/clear-all", { params }),

  // Accounts & Governance (Phase 2 updates)
  getAccounts: (id) => api.get(`/identities/${id}/accounts`),
  linkAccount: (id, data) => api.post(`/identities/${id}/accounts`, data),
  setAccountLinkActive: (linkId, body) =>
    api.patch(`/identities/accounts/links/${linkId}`, body),
  unlinkAccount: (linkId) => api.delete(`/identities/accounts/links/${linkId}`),

  // Identity Mind Map (Phase 3)
  getGraph: (id, params) => api.get(`/identities/${id}/graph`, { params }),

  // Peer Access Comparison (Phase 4)
  peerComparison: (id, data) =>
    api.post(`/identities/${id}/peer-comparison`, data, { timeout: 120000 }),

  // Identity Posture Dashboard
  getPosture: (id) => api.get(`/identities/${id}/posture`, { timeout: 120000 }),

  // Identity catalog insight tabs
  getSod: (id) => api.get(`/identities/${id}/sod`, { timeout: 60000 }),
  getCertifications: (id) =>
    api.get(`/identities/${id}/certifications`, { timeout: 60000 }),
  getHygiene: (id) => api.get(`/identities/${id}/hygiene`, { timeout: 120000 }),
  getPrivileges: (id) => api.get(`/identities/${id}/privileges`, { timeout: 120000 }),

  uploadProfilePhoto: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/identities/${id}/profile-photo`, fd);
  },
  getProfilePhotoBlob: (id, cacheKey) =>
    api.get(`/identities/${id}/profile-photo/image`, {
      responseType: 'blob',
      params: cacheKey ? { v: cacheKey } : undefined,
    }),
  deleteProfilePhoto: (id) => api.delete(`/identities/${id}/profile-photo`),
};

// Connectors APIs
export const connectorsAPI = {
  list: (params) => api.get("/connectors", { params }),
  getById: (id) => api.get(`/connectors/${id}`),
  create: (data) => api.post("/connectors", data),
  update: (id, data) => api.put(`/connectors/${id}`, data),
  delete: (id) => api.delete(`/connectors/${id}`),
};

/** Tenant-scoped HRMS (OrangeHRM OAuth, delimited CSV, identity sync). Pass `profileSourcesOnly: true` to list only sources used on an identity profile. */
export const hrmsIntegrationAPI = {
  listSources: (params) => api.get("/integrations/hrms/sources", { params }),
  createSource: (data) => api.post("/integrations/hrms/sources", data),
  updateSource: (id, data) => api.put(`/integrations/hrms/sources/${id}`, data),
  deleteSource: (id) => api.delete(`/integrations/hrms/sources/${id}`),
  uploadDelimitedCsv: (sourceId, file, params) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post(`/integrations/hrms/sources/${sourceId}/csv-upload`, fd, {
      params,
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  getDelimitedSchema: (sourceId, params) =>
    api.get(`/integrations/hrms/sources/${sourceId}/delimited-schema`, {
      params,
    }),
  getConfig: (params) => api.get("/integrations/hrms/config", { params }),
  updateConfig: (data) => api.put("/integrations/hrms/config", data),
  startOAuth: (body) => api.post("/integrations/hrms/oauth/start", body || {}),
  testConnection: (params) =>
    api.post("/integrations/hrms/test", {}, { params }),
  syncIdentities: (body) =>
    api.post("/integrations/hrms/sync-identities", body || {}, {
      timeout: 120000,
    }),
};

// Transform engine (schema-aware JSON transforms)
export const transformAPI = {
  list: (params) => api.get("/transforms", { params }),
  getById: (id) => api.get(`/transforms/${id}`),
  create: (data) => api.post("/transforms", data),
  update: (id, data) => api.put(`/transforms/${id}`, data),
  delete: (id) => api.delete(`/transforms/${id}`),
  validate: (data) => api.post("/transforms/validate", data),
  execute: (data) => api.post("/transforms/execute", data),
};

export const schemaAPI = {
  getByAppId: (appId) => api.get(`/schemas/${appId}`),
};

// Compliance Framework APIs
export const complianceFrameworkAPI = {
  list: (params) => api.get("/compliance/frameworks", { params }),
  getById: (id) => api.get(`/compliance/frameworks/${id}`),
  create: (data) => api.post("/compliance/frameworks", data),
  getCoverage: (id) => api.get(`/compliance/frameworks/${id}/coverage`),
};

/** SailPoint-style hygiene KPIs (tenant: user scope or `params.tenantId` for platform admins). */
export const dataHygieneAPI = {
  getSummary: (params, options = {}) =>
    api.get("/data-hygiene/summary", {
      params: {
        ...params,
        ...(options.refresh ? { refresh: "1" } : {}),
      },
      signal: options.signal,
      timeout: options.timeout ?? 120000,
    }),
  getWidgetItems: (params, options = {}) =>
    api.get("/data-hygiene/widget-items", {
      params,
      signal: options.signal,
      timeout: options.timeout ?? 120000,
    }),
};

// --- NEW: Correlation & Orphan Accounts Engine ---
export const correlationAPI = {
  /** Dry-run manual correlation: counts + samples; no DB writes. */
  previewRun: (applicationId, data = {}) =>
    api.post(`/correlation/preview/${applicationId}`, data, {
      timeout: 120000,
    }),
  runEngine: (applicationId, data = {}) =>
    api.post(`/correlation/run/${applicationId}`, data, { timeout: 120000 }),
  /** Tenant-scoped identity ↔ target app links (correlation key from last manual run when set). */
  getCorrelatedAccounts: (params) =>
    api.get("/correlation/correlated-accounts", { params, timeout: 120000 }),
  getOrphans: (params) =>
    api.get("/correlation/orphans", { params, timeout: 120000 }),
  /** ISO report: totals, stats, queue↔population digest for charts (no orphan rows). */
  getOrphansIsoSummary: (applicationId, params) =>
    api.get(`/correlation/orphans/application/${applicationId}/iso-summary`, {
      params,
      timeout: 120000,
    }),
  /** Full OPEN orphan list for one app — server batches DB pages; one HTTP round-trip. */
  getOrphansIsoFull: (applicationId, params) =>
    api.get(`/correlation/orphans/application/${applicationId}/iso-full`, {
      params,
      timeout: 120000,
    }),
  remediateOrphan: (orphanId, data) =>
    api.post(`/correlation/orphans/${orphanId}/remediate`, data),

  // Configuration Rules (CRUD Factory)
  getRules: (params) => api.get("/correlation/rules", { params }),
  createRule: (data) => api.post("/correlation/rules", data),
  updateRule: (id, data) => api.put(`/correlation/rules/${id}`, data),
  deleteRule: (id) => api.delete(`/correlation/rules/${id}`),
};

/** Governance report settings (risk bands, etc.) */
export const REPORT_METRIC_KEY_ORPHAN_UNCORRELATED_SHARE = 'orphan_uncorrelated_share';
export const REPORT_METRIC_KEY_ACTIVE_USERS_SHARE = 'active_users_share';
export const REPORT_METRIC_KEY_INACTIVE_USERS_SHARE = 'inactive_users_share';
export const REPORT_METRIC_KEY_PRIVILEGED_USERS_SHARE = 'privileged_users_share';

export const reportAPI = {
  getGovernanceRiskBandSetting: (applicationId, params) =>
    api.get(`/reports/governance-risk-bands/${applicationId}`, { params, timeout: 60000 }),
  putGovernanceRiskBandSetting: (applicationId, body, params) =>
    api.put(`/reports/governance-risk-bands/${applicationId}`, body, { params, timeout: 60000 }),
  getEffectiveReportingRuleSet: (applicationId, params) =>
    api.get(`/reports/reporting-rule-set/${applicationId}`, { params, timeout: 60000 }),
  putApplicationReportingRuleSet: (applicationId, body, params) =>
    api.put(`/reports/reporting-rule-set/${applicationId}`, body, { params, timeout: 60000 }),
};

/** Governance Intelligence (ISO 2007) — server-built PDF / Excel / ZIP pack. */
export const governanceIntelligenceExportAPI = {
  /**
   * @param {Record<string, unknown>} body — tenantId, applicationId, asOf, format (pdf|excel|pack), includeAppendix, includeCharts, thresholds
   * @param {{ timeout?: number }} [options]
   */
  exportReport: (body, options = {}) =>
    api.post("/reports/governance-intelligence/export", body, {
      responseType: "blob",
      timeout: options.timeout ?? 300000,
    }),
};

export const workflowAPI = {
  triggerIAMOrphanWorkflow: (orphanId, body = {}) =>
    api.post(`/remediation-workflows/orphan-accounts/${orphanId}/trigger-iam-workflow`, body),
  recordOrphanIamDecision: (orphanId, body) =>
    api.post(`/remediation-workflows/orphan-accounts/${orphanId}/iam-decision`, body),
  listTasks: (params) => api.get("/remediation-workflows/tasks", { params }),
  listExecutions: (params) => api.get("/remediation-workflows/executions", { params }),
};

export default api;
