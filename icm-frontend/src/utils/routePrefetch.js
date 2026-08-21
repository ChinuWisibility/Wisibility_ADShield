const runIdle = (cb) => {
  if (typeof window === "undefined") return;
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(cb, { timeout: 2000 });
    return;
  }
  window.setTimeout(cb, 200);
};

const prefetchedKeys = new Set();

const PREFETCH_BY_PATH = {
  "/": () => import("../pages/dashboard/Dashboard.jsx"),
  "/account/profile": () => import("../pages/account/Profile.jsx"),
  "/applications": () => import("../pages/applications/AppRegistry.jsx"),
  "/application-view": () => import("../pages/application-view/ApplicationViewList.jsx"),
  "/applications/hrms-sources": () => import("../pages/applications/HrmsSourceList.jsx"),
  // Legacy pages kept in code (not deleted):
  // "/applications/schema": () =>
  //   import("../pages/applications/SchemaManagement.jsx"),
  // "/applications/upload": () => import("../pages/applications/UploadData.jsx"),
  "/governance/workflows": () => import("../features/workflows/WorkflowsModule.jsx"),
  "/governance/provisioning": () => import("../features/provisioning/ProvisioningModule.jsx"),
  "/governance/transforms": () =>
    import("../pages/governance/TransformStudio.jsx"),
  "/governance/certifications": () =>
    import("../pages/governance/CertificationsHub.jsx"),
  "/governance/certifications/access": () =>
    import("../pages/governance/accessCertification/AccessCertification.jsx"),
  "/reports/compliance": () => import("../pages/reports/ComplianceFrameworks.jsx"),
  "/datahygine": () => import("../pages/datahygine/DataHygieneDashboard.jsx"),
  "/security/dashboard": () => import("../pages/security/SecurityCenter.jsx"),
  "/security/findings": () => import("../pages/security/findings/FindingsExplorer.jsx"),
  "/security/scans": () => import("../pages/security/scans/ScanCenter.jsx"),
  "/security/policies": () => import("../pages/security/policies/PolicyCenter.jsx"),
  "/security/groups": () => import("../pages/security/groups/GroupIntelligenceView.jsx"),
  "/security/privileged": () => import("../pages/security/privileged/PrivilegedAccessView.jsx"),
  "/reports/audit": () => import("../pages/audit/AuditHub.jsx"),
  "/reports/activity": () => import("../pages/audit/AuditHub.jsx"),
  "/governance/sod-policies": () => import("../pages/governance/sod/SodHub.jsx"),
  "/governance/sod-violations": () => import("../pages/governance/sod/SodHub.jsx"),
  "/access/roles": () => import("../pages/access/RoleSummaryHub.jsx"),
  "/access/role-mining": () => import("../pages/access/RoleSummaryHub.jsx"),
  "/access/entitlements": () =>
    import("../pages/Entitlements/CorrelatedEntitlements.jsx"),
  "/identities/accounts": () => import("../pages/identities/IdentityAccountsHub.jsx"),
  "/identities/accounts/correlated": () => import("../pages/identities/CorrelatedAccounts.jsx"),
  "/identities/accounts/uncorrelated": () => import("../pages/identities/OrphanAccounts.jsx"),
  "/identities/accounts/entitlements/correlated": () =>
    import("../pages/Entitlements/CorrelatedEntitlements.jsx"),
  "/identities/accounts/duplicates": () =>
    import("../pages/identities/ApplicationUserDuplicatesPage.jsx"),
  "/identities/correlated": () => import("../pages/identities/CorrelatedAccounts.jsx"),
  "/identities/posture": () => import("../pages/identities/posture/IdentityPosture.jsx"),
  "/identities/profile-sources": () =>
    import("../pages/identities/IdentityProfileSourceApps.jsx"),
  "/admin/users": () => import("../pages/admin/UsersManagement.jsx"),
  "/admin/settings": () => import("../pages/admin/SystemSettings.jsx"),
  "/admin/branding": () => import("../pages/admin/BrandingSettings.jsx"),
  "/admin/application-icons": () => import("../pages/admin/ApplicationIconsSettings.jsx"),
  "/tenant-admin/application-icons": () => import("../pages/admin/ApplicationIconsSettings.jsx"),
  "/org-admin/global-rule-set": () => import("../pages/admin/GlobalRuleSet.jsx"),
  "/admin/global-rule-set/identity-posture": () =>
    import("../pages/admin/globalRuleSet/IdentityPostureRules.jsx"),
  "/org-admin/global-rule-set/identity-posture": () =>
    import("../pages/admin/globalRuleSet/IdentityPostureRules.jsx"),
  "/org-admin/global-rule-set/reporting": () =>
    import("../pages/admin/globalRuleSet/ReportingRuleSet.jsx"),
  "/org-admin/global-rule-set/uncorrelated-trust-mapping": () =>
    import("../pages/admin/globalRuleSet/UncorrelatedTrustMapping.jsx"),
  "/org-admin/global-rule-set/remediation-queue-scheduler": () =>
    import("../pages/admin/globalRuleSet/RemediationQueueScheduler.jsx"),
  "/org-admin/global-rule-set/certification-email-reminders": () =>
    import("../pages/admin/globalRuleSet/CertificationEmailReminders.jsx"),
  // "/org-admin/about": () => import("../pages/admin/AboutADSecurity.jsx"),
};

const findPrefetcher = (path) => {
  if (!path) return null;
  if (path.startsWith("/datahygine/application/")) {
    return () => import("../pages/datahygine/DataHygieneApplicationAnalytics.jsx");
  }
  if (path !== "/datahygine" && path.startsWith("/datahygine/")) {
    return () => import("../pages/datahygine/DataHygieneWidgetDetail.jsx");
  }
  if (PREFETCH_BY_PATH[path]) return PREFETCH_BY_PATH[path];

  const hit = Object.entries(PREFETCH_BY_PATH).find(
    ([key]) => path === key || path.startsWith(`${key}/`),
  );
  return hit ? hit[1] : null;
};

export const prefetchRouteByPath = (path) => {
  const prefetcher = findPrefetcher(path);
  if (!prefetcher) return;

  const cacheKey = `route:${path}`;
  if (prefetchedKeys.has(cacheKey)) return;
  prefetchedKeys.add(cacheKey);

  runIdle(() => {
    prefetcher().catch(() => {});
  });
};

export const prefetchPostLoginRoutes = (role = "user") => {
  runIdle(() => {
    const routePaths = [
      "/",
      "/account/profile",
      "/governance/certifications",
      "/applications",
    ];

    if (String(role).toLowerCase() === "admin") {
      routePaths.push("/admin/users", "/admin/settings", "/admin/branding");
    }

    routePaths.forEach((path, index) => {
      window.setTimeout(() => {
        prefetchRouteByPath(path);
      }, index * 220);
    });
  });
};
