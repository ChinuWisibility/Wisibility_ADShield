/**
 * Application long-running actions (Level 3).
 */

export const APPLICATION_ACTION_TARGETS = [
  {
    id: "act.applications.syncAd",
    kind: "action",
    name: "Sync from AD",
    parentId: "nav.applications",
    route: "/applications/:id?tab=users",
    trigger: { type: "button", key: "syncAd", label: "Sync from AD" },
    primaryApis: ["POST /applications/:id/ad/sync", "GET /applications/:id/ad-sync-jobs/:jobId"],
    controller: "adConnectorController.syncAdUsersFromAd",
    metricLabel: "Action_Applications_SyncAd",
    measurement: { mode: "action", driver: "action" },
    fe: { reactQuery: false, mountApiCalls: 0, duplicateRisk: "low", primaryApis: [] },
    enabled: true,
  },
];
