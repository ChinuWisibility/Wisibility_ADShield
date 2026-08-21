import api from "../../../services/api";

const BASE = "/workflow-task-queue";
const LIST_TASKS_DEDUPE_MS = 1000;
const listTasksRequestCache = new Map();

function buildListTasksKey(params = {}) {
  return JSON.stringify(
    Object.entries(params)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function dedupeListTasks(params) {
  const now = Date.now();
  const key = buildListTasksKey(params);
  const cached = listTasksRequestCache.get(key);
  if (cached?.expiresAt > now) {
    return cached.promise;
  }

  const promise = api.get(`${BASE}/tasks`, { params }).finally(() => {
    window.setTimeout(() => {
      const current = listTasksRequestCache.get(key);
      if (current?.promise === promise && current.expiresAt <= Date.now()) {
        listTasksRequestCache.delete(key);
      }
    }, LIST_TASKS_DEDUPE_MS + 25);
  });

  listTasksRequestCache.set(key, {
    promise,
    expiresAt: now + LIST_TASKS_DEDUPE_MS,
  });
  return promise;
}

export const workflowTaskQueueApi = {
  listTasks: (params) => dedupeListTasks(params),
  getTask: (taskId) => api.get(`${BASE}/tasks/${taskId}`),
  summary: () => api.get(`${BASE}/tasks/summary`),
  checkIamOrphanQueued: (orphanIds) =>
    api.get(`${BASE}/iam-orphan-review/check`, {
      params: { orphanIds: Array.isArray(orphanIds) ? orphanIds.join(",") : orphanIds },
    }),
  enqueueIamOrphanReview: (orphanIds, { workflowId } = {}) =>
    api.post(`${BASE}/iam-orphan-review`, {
      orphanIds,
      ...(workflowId ? { workflowId } : {}),
    }),
  enqueueAccessRevoke: (items, { workflowId } = {}) =>
    api.post(`${BASE}/access-revoke`, {
      items,
      ...(workflowId ? { workflowId } : {}),
    }),
  launchImmediately: (taskId) => api.post(`${BASE}/tasks/${taskId}/launch-immediately`),
  retryNotifications: (taskId) => api.post(`${BASE}/tasks/${taskId}/retry-notifications`),
  markComplete: (taskId) => api.post(`${BASE}/tasks/${taskId}/mark-complete`),
  cancel: (taskId, body = {}) => api.post(`${BASE}/tasks/${taskId}/cancel`, body),
};

export const remediationWorkflowRulesApi = {
  get: () => api.get("/org-admin/remediation-workflow-rules"),
  put: (actionMappings) =>
    api.put("/org-admin/remediation-workflow-rules", { actionMappings }),
};
