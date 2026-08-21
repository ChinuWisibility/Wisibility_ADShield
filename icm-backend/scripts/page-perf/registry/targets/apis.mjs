/**
 * Shared API registry entries + legacy SHARED_BACKENDS bridge.
 */

export const SHARED_APIS = [
  {
    id: "api.identities.list",
    kind: "sharedApi",
    name: "Identities List",
    api: "GET /identities",
    controller: "identityController.getIdentities",
    consumerTargetIds: ["nav.allIdentities", "nav.peerComparison", "nav.identityPosture"],
    pages: ["AllIdentities", "PeerComparison", "IdentityPosture"],
    legacySharedBackendId: "identities-list",
    recommendation:
      "Optimize GET /identities once (index + list projection). Peer Comparison and Posture picker inherit the fix. Mindmap autocomplete is a related but separate limit=50 projection opportunity.",
    enabled: true,
  },
  {
    id: "api.security.findings",
    kind: "sharedApi",
    name: "Security Findings",
    api: "GET /security/applications/:id/findings",
    controller: "securityController.getApplicationSecurityFindings",
    consumerTargetIds: ["nav.securityDashboard", "nav.findingsExplorer", "nav.groupIntelligence", "feat.security.topFindings"],
    pages: ["SecurityDashboard", "FindingsExplorer", "GroupIntelligence"],
    legacySharedBackendId: "security-findings",
    recommendation:
      "Add a thin findings list DTO (severity/title/refs); keep evidence on detail. One fix covers Dashboard, Findings, and Groups.",
    enabled: true,
  },
  {
    id: "api.discovery.policies",
    kind: "sharedApi",
    name: "Discovery Policies",
    api: "GET /discovery/policies",
    controller: "discoveryController.listPolicies",
    consumerTargetIds: ["nav.privilegedEntitlements", "nav.privilegedUsers"],
    pages: ["PrivilegedEntitlements", "PrivilegedUsers"],
    legacySharedBackendId: "discovery-policies",
    recommendation:
      "Shared discovery policies collection — optimize list projection once for both privileged views.",
    enabled: true,
  },
  {
    id: "api.applications.list",
    kind: "sharedApi",
    name: "Applications List",
    api: "GET /applications",
    controller: "applicationController.getApplications",
    consumerTargetIds: ["nav.applications", "nav.entitlements", "nav.isoReport", "nav.correlationEngine"],
    pages: ["Applications", "Entitlements", "IsoReport", "CorrelationEngine"],
    legacySharedBackendId: "applications-list",
    recommendation:
      "Keep applications list projection lean; shared by Entitlements mount, ISO fan-out, and Correlation Engine.",
    enabled: true,
  },
  {
    id: "api.applications.users",
    kind: "sharedApi",
    name: "Application Users / Accounts",
    api: "GET /applications/:id/users",
    controller: "applicationController.getApplicationUsers",
    consumerTargetIds: ["feat.applications.accounts"],
    pages: [],
    recommendation: "List projection + pagination for Accounts tab; avoid full account blobs on grid.",
    enabled: true,
  },
  {
    id: "api.applications.entitlements",
    kind: "sharedApi",
    name: "Application Entitlements",
    api: "GET /applications/:id/entitlements",
    controller: "applicationController.getApplicationEntitlements",
    consumerTargetIds: ["feat.applications.entitlements"],
    pages: [],
    recommendation: "Thin entitlement list DTO for Entitlements tab.",
    enabled: true,
  },
];

/** v2 catalog shape used by enrich-raw.mjs */
export const SHARED_BACKENDS = SHARED_APIS.filter((a) => a.legacySharedBackendId && (a.pages || []).length > 0).map(
  (a) => ({
    id: a.legacySharedBackendId,
    api: a.api,
    controller: a.controller,
    pages: a.pages,
    recommendation: a.recommendation,
  }),
);
