/**
 * Security long-running actions (Level 3).
 */

export const SECURITY_ACTION_TARGETS = [
  {
    id: "act.security.runScan",
    kind: "action",
    name: "Run Scan",
    parentId: "nav.scanCenter",
    route: "/security/scans",
    trigger: { type: "button", key: "runScan", label: "Run full scan / feature scan" },
    primaryApis: ["POST /security/applications/:id/scan"],
    controller: "securityController.runScan",
    metricLabel: "Action_Security_RunScan",
    measurement: { mode: "action", driver: "action" },
    fe: { reactQuery: true, mountApiCalls: 0, duplicateRisk: "low", primaryApis: [] },
    enabled: true,
  },
];
