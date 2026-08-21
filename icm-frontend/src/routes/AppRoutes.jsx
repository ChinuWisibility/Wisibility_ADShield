import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import MainLayout from '../layouts/MainLayout';
import AuthLayout from '../layouts/AuthLayout';
import {
  ProtectedRoute,
  PublicRoute,
  AdminRoute,
  OrgAdminRoute,
  TenantAdminRoute,
  NotSuperAdminReportPage,
  ReportsRoute,
  ComingSoon,
} from './RouteGuards';
import { useAuth } from '../contexts/AuthContext';

const Login = lazy(() => import('../pages/auth/Login'));
const ForgotPassword = lazy(() => import('../pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('../pages/auth/ResetPassword'));
const CreateOwnPassword = lazy(() => import('../pages/auth/CreateOwnPassword'));
const MaintenancePage = lazy(() => import('../pages/system/MaintenancePage'));
const Dashboard = lazy(() => import('../pages/dashboard/Dashboard'));
// const ADSecurityDashboard = lazy(() => import('../pages/dashboard/ADSecurityDashboard'));
const Profile = lazy(() => import('../pages/account/Profile'));
const UsersManagement = lazy(() => import('../pages/admin/UsersManagement'));
const SystemSettings = lazy(() => import('../pages/admin/SystemSettings'));
const AuditLog = lazy(() => import('../pages/admin/AuditLog'));
const ActivityLog = lazy(() => import('../pages/admin/ActivityLog'));
const AuditHub = lazy(() => import('../pages/audit/AuditHub'));
const SessionsManagement = lazy(() => import('../pages/admin/SessionsManagement'));
const GlobalRuleSet = lazy(() => import('../pages/admin/GlobalRuleSet'));
const IdentityPostureRules = lazy(() => import('../pages/admin/globalRuleSet/IdentityPostureRules'));
const ReportingRuleSet = lazy(() => import('../pages/admin/globalRuleSet/ReportingRuleSet'));
const UncorrelatedTrustMapping = lazy(() => import('../pages/admin/globalRuleSet/UncorrelatedTrustMapping'));
const RemediationQueueScheduler = lazy(() => import('../pages/admin/globalRuleSet/RemediationQueueScheduler'));
// const AboutADSecurity = lazy(() => import('../pages/admin/AboutADSecurity'));
const ApiKeys = lazy(() => import('../pages/admin/ApiKeys'));
const BrandingSettings = lazy(() => import('../pages/admin/BrandingSettings'));
const ApplicationIconsSettings = lazy(() => import('../pages/admin/ApplicationIconsSettings'));
const LicenseManagement = lazy(() => import('../pages/admin/LicenseManagement'));
const ConnectorsManagement = lazy(() => import('../pages/admin/ConnectorsManagement'));
const AppRegistry = lazy(() => import('../pages/applications/AppRegistry'));
const HrmsIntegration = lazy(() => import('../pages/applications/HrmsIntegration'));
const HrmsSourceList = lazy(() => import('../pages/applications/HrmsSourceList'));
const ApplicationDetail = lazy(() => import('../pages/applications/ApplicationDetail'));
const SchemaManagement = lazy(() => import('../pages/applications/SchemaManagement'));
const UploadData = lazy(() => import('../pages/applications/UploadData'));
const ApplicationViewList = lazy(() => import('../pages/application-view/ApplicationViewList'));
const ApplicationViewDetail = lazy(() => import('../pages/application-view/ApplicationViewDetail'));
const IdentityProfileList = lazy(() => import('../pages/identities/IdentityProfileList'));
const IdentityProfileDetail = lazy(() => import('../pages/identities/IdentityProfileDetail'));
const IdentityProfileSourceApps = lazy(() => import('../pages/identities/IdentityProfileSourceApps'));
const IdentitiesList = lazy(() => import('../pages/identities/IdentitiesList'));
const IdentityDetail = lazy(() => import('../pages/identities/IdentityDetail'));
const IdentityMindmapSearch = lazy(() => import('../pages/identities/IdentityMindmapSearch'));
const IdentityMindmap = lazy(() => import('../pages/identities/IdentityMindmap'));
const CorrelationEngine = lazy(() => import('../pages/identities/CorrelationEngine'));
const OrphanAccounts = lazy(() => import('../pages/identities/OrphanAccounts'));
const CorrelatedAccounts = lazy(() => import('../pages/identities/CorrelatedAccounts'));
const ApplicationUserDuplicatesPage = lazy(() => import('../pages/identities/ApplicationUserDuplicatesPage'));
const IdentityAccountsHub = lazy(() => import('../pages/identities/IdentityAccountsHub'));
const PeerComparison = lazy(() => import('../pages/identities/PeerComparison'));
const IdentityPosture = lazy(() => import('../pages/identities/posture/IdentityPosture.jsx'));
const TransformStudio = lazy(() => import('../pages/governance/TransformStudio'));
const CertificationsHub = lazy(() => import('../pages/governance/CertificationsHub'));
const AccessCertification = lazy(() => import('../pages/governance/accessCertification/AccessCertification'));
const CertDecisionPage = lazy(() => import('../pages/certifications/CertDecisionPage'));
const OrphanIamReviewPage = lazy(() => import('../pages/identities/OrphanIamReviewPage'));
const ComplianceFrameworks = lazy(() => import('../pages/reports/ComplianceFrameworks'));
const Iso2007Report = lazy(() => import('../pages/reports/Iso2007Report'));
const DataHygieneDashboard = lazy(() => import('../pages/datahygine/DataHygieneDashboard'));
const DataHygieneApplicationAnalytics = lazy(() =>
  import('../pages/datahygine/DataHygieneApplicationAnalytics'),
);
const DataHygieneWidgetDetail = lazy(() => import('../pages/datahygine/DataHygieneWidgetDetail'));
const CorrelatedEntitlements = lazy(() => import('../pages/Entitlements/CorrelatedEntitlements'));
const RoleSummaryHub = lazy(() => import('../pages/access/RoleSummaryHub'));
const SodHub = lazy(() => import('../pages/governance/sod/SodHub'));
const SodPolicies = lazy(() => import('../pages/governance/sod/SodPolicies'));
const SodPolicyDetail = lazy(() => import('../pages/governance/sod/SodPolicyDetail'));
const SodViolations = lazy(() => import('../pages/governance/sod/SodViolations'));
const DiscoveryPolicies = lazy(() => import('../pages/governance/discovery/DiscoveryPolicies'));
const DiscoveryPolicyBuilder = lazy(() => import('../pages/governance/discovery/DiscoveryPolicyBuilder'));
const DiscoveryPolicyDetail = lazy(() => import('../pages/governance/discovery/DiscoveryPolicyDetail'));
const DiscoveryResults = lazy(() => import('../pages/governance/discovery/DiscoveryResults'));
const RemediationEventsModule = lazy(() => import('../features/remediation-events/RemediationEventsModule'));
const RemediationWorkflowRules = lazy(() => import('../pages/admin/globalRuleSet/RemediationWorkflowRules'));
const CertificationEmailReminders = lazy(() => import('../pages/admin/globalRuleSet/CertificationEmailReminders'));
const WorkflowsModule = lazy(() => import('../features/workflows/WorkflowsModule'));
const ProvisioningModule = lazy(() => import('../features/provisioning/ProvisioningModule'));
const RemediationTicketReviewPage = lazy(() => import('../pages/remediation/RemediationTicketReviewPage'));
const SecurityCenter = lazy(() => import('../pages/security/SecurityCenter.jsx'));
const SecurityDashboard = lazy(() => import('../pages/security/dashboard/SecurityDashboard.jsx'));
const FindingsExplorer = lazy(() => import('../pages/security/findings/FindingsExplorer.jsx'));
const ScanCenter = lazy(() => import('../pages/security/scans/ScanCenter.jsx'));
const PolicyCenter = lazy(() => import('../pages/security/policies/PolicyCenter.jsx'));
const GroupIntelligenceView = lazy(() => import('../pages/security/groups/GroupIntelligenceView.jsx'));
const PrivilegedAccessView = lazy(() => import('../pages/security/privileged/PrivilegedAccessView.jsx'));
const AclIntelligenceView = lazy(() => import('../pages/security/acl/AclIntelligenceView.jsx'));
const ComputerSecurityView = lazy(() => import('../pages/security/computer/ComputerSecurityView.jsx'));
const KerberosSecurityView = lazy(() => import('../pages/security/kerberos/KerberosSecurityView.jsx'));
const DelegationSecurityView = lazy(() => import('../pages/security/delegation/DelegationSecurityView.jsx'));
const GraphExplorerPlaceholder = lazy(() => import('../pages/security/graph/GraphExplorerPlaceholder.jsx'));
const SecurityRemediationDashboard = lazy(() => import('../pages/security/remediation/SecurityRemediationDashboard.jsx'));
const SecurityRemediationFeatureDetail = lazy(() => import('../pages/security/remediation/SecurityRemediationFeatureDetail.jsx'));

function LegacyRemediationRedirect() {
  const location = useLocation();
  const suffix = location.pathname.replace(/^\/governance\/(?:remediation-runs|workflows\/runs)\/?/, '');
  const target = suffix
    ? `/governance/remediation-events/${suffix}`
    : '/governance/remediation-events';
  return <Navigate to={`${target}${location.search}${location.hash}`} replace />;
}

function RouteFallback() {
  return (
    <Box sx={{ p: 4, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '40vh' }}>
      <Typography variant="h6" color="text.secondary">Loading module…</Typography>
    </Box>
  );
}

function LazyRoute({ children }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

function RoleAwareHome() {
  const { user } = useAuth();
  if (user?.role === 'superAdmin') {
    return <Navigate to="/admin/users" replace />;
  }
  return <Dashboard />;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/maintenance" element={<LazyRoute><MaintenancePage /></LazyRoute>} />

      <Route element={<PublicRoute><AuthLayout /></PublicRoute>}>
        <Route path="/login" element={<LazyRoute><Login /></LazyRoute>} />
        <Route path="/register" element={<Navigate to="/login" replace />} />
        <Route path="/reset-password" element={<LazyRoute><ForgotPassword /></LazyRoute>} />
        <Route path="/reset-password/confirm" element={<LazyRoute><ResetPassword /></LazyRoute>} />
        <Route path="/create-own-password" element={<LazyRoute><CreateOwnPassword /></LazyRoute>} />
      </Route>

      <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
        <Route path="/" element={<LazyRoute><RoleAwareHome /></LazyRoute>} />
        {/* <Route path="/identity-sphere" element={<LazyRoute><ADSecurityDashboard /></LazyRoute>} /> */}
        <Route path="/account/profile" element={<LazyRoute><Profile /></LazyRoute>} />

        <Route path="/identities" element={<Outlet />}>
          <Route index element={<LazyRoute><IdentitiesList /></LazyRoute>} />
          <Route path="accounts" element={<LazyRoute><IdentityAccountsHub /></LazyRoute>}>
            <Route index element={<Navigate to="correlated" replace />} />
            {/* Accounts main tab — Correlated | Uncorrelated sub-tabs */}
            <Route path="correlated" element={<LazyRoute><CorrelatedAccounts /></LazyRoute>} />
            <Route path="uncorrelated" element={<LazyRoute><OrphanAccounts /></LazyRoute>} />
            <Route path="orphans" element={<Navigate to="/identities/accounts/uncorrelated" replace />} />
            {/* Entitlements main tab — Correlated | Uncorrelated sub-tabs */}
            <Route
              path="entitlements"
              element={<Navigate to="/identities/accounts/entitlements/correlated" replace />}
            />
            <Route
              path="entitlements/correlated"
              element={<LazyRoute><CorrelatedEntitlements /></LazyRoute>}
            />
            <Route
              path="entitlements/uncorrelated"
              element={<ComingSoon title="Uncorrelated Entitlements" />}
            />
            {/* Duplicate Accounts main tab */}
            <Route path="duplicates" element={<LazyRoute><ApplicationUserDuplicatesPage /></LazyRoute>} />
          </Route>
          {/* Legacy redirects → Correlation Summary */}
          <Route path="correlated" element={<Navigate to="/identities/accounts/correlated" replace />} />
          <Route path="orphans" element={<Navigate to="/identities/accounts/uncorrelated" replace />} />
          <Route
            path="application-user-duplicates"
            element={<Navigate to="/identities/accounts/duplicates" replace />}
          />
          <Route path="correlation" element={<LazyRoute><CorrelationEngine /></LazyRoute>} />
          <Route path="contractors" element={<ComingSoon title="Contractors" />} />
          <Route path="profiles/:profileId" element={<LazyRoute><IdentityProfileDetail /></LazyRoute>} />
          <Route path="profiles" element={<LazyRoute><IdentityProfileList /></LazyRoute>} />
          <Route path="profile-sources" element={<LazyRoute><IdentityProfileSourceApps /></LazyRoute>} />
          <Route path="mindmap" element={<LazyRoute><IdentityMindmapSearch /></LazyRoute>} />
          <Route path="mindmap/:identityId" element={<LazyRoute><IdentityMindmap /></LazyRoute>} />
          <Route path="peer-comparison" element={<LazyRoute><PeerComparison /></LazyRoute>} />
          <Route path="posture" element={<LazyRoute><IdentityPosture /></LazyRoute>} />
          <Route path=":id" element={<LazyRoute><IdentityDetail /></LazyRoute>} />
        </Route>

        <Route path="/applications" element={<LazyRoute><AppRegistry /></LazyRoute>} />
        <Route path="/applications/hrms-sources" element={<LazyRoute><HrmsSourceList /></LazyRoute>} />
        <Route path="/applications/hrms-integration/:sourceId" element={<LazyRoute><HrmsIntegration /></LazyRoute>} />
        <Route path="/applications/hrms-integration" element={<Navigate to="/applications/hrms-sources" replace />} />
        <Route path="/applications/upload" element={<LazyRoute><UploadData /></LazyRoute>} />
        <Route path="/applications/schema" element={<LazyRoute><SchemaManagement /></LazyRoute>} />
        <Route path="/applications/:id" element={<LazyRoute><ApplicationDetail /></LazyRoute>} />

        <Route path="/application-view" element={<Outlet />}>
          <Route index element={<LazyRoute><ApplicationViewList /></LazyRoute>} />
          <Route path=":id" element={<LazyRoute><ApplicationViewDetail /></LazyRoute>} />
        </Route>

        <Route path="/access" element={<Outlet />}>
          <Route element={<LazyRoute><RoleSummaryHub /></LazyRoute>}>
            <Route index element={<Navigate to="roles" replace />} />
            <Route path="roles" element={<ComingSoon title="Roles" />} />
            <Route path="role-mining" element={<ComingSoon title="Role Mining" />} />
          </Route>
          <Route
            path="entitlements"
            element={<Navigate to="/identities/accounts/entitlements/correlated" replace />}
          />
          <Route path="accounts" element={<ComingSoon title="Accounts" />} />
        </Route>
        <Route path="/security" element={<LazyRoute><SecurityCenter /></LazyRoute>}>
          <Route path="dashboard" element={<LazyRoute><SecurityDashboard /></LazyRoute>} />
          <Route path="findings" element={<LazyRoute><FindingsExplorer /></LazyRoute>} />
          <Route path="scans" element={<LazyRoute><ScanCenter /></LazyRoute>} />
          <Route path="policies" element={<LazyRoute><PolicyCenter /></LazyRoute>} />
          <Route path="groups" element={<LazyRoute><GroupIntelligenceView /></LazyRoute>} />
          <Route path="privileged" element={<LazyRoute><PrivilegedAccessView /></LazyRoute>} />
          <Route path="acl" element={<LazyRoute><AclIntelligenceView /></LazyRoute>} />
          <Route path="computer" element={<LazyRoute><ComputerSecurityView /></LazyRoute>} />
          <Route path="kerberos" element={<LazyRoute><KerberosSecurityView /></LazyRoute>} />
          <Route path="delegation" element={<LazyRoute><DelegationSecurityView /></LazyRoute>} />
          <Route path="graph" element={<LazyRoute><GraphExplorerPlaceholder /></LazyRoute>} />
          <Route path="remediation" element={<LazyRoute><SecurityRemediationDashboard /></LazyRoute>} />
          <Route path="remediation/:featureId" element={<LazyRoute><SecurityRemediationFeatureDetail /></LazyRoute>} />
        </Route>

        <Route element={<LazyRoute><SodHub /></LazyRoute>}>
          <Route path="/governance/sod-policies" element={<LazyRoute><SodPolicies /></LazyRoute>} />
          <Route path="/governance/sod-violations" element={<LazyRoute><SodViolations /></LazyRoute>} />
        </Route>
        <Route path="/governance/sod-policies/:id" element={<LazyRoute><SodPolicyDetail /></LazyRoute>} />
        <Route path="/remediation/queue" element={<LegacyRemediationRedirect />} />
        <Route path="/remediation/remediation" element={<LegacyRemediationRedirect />} />
        <Route path="/governance/remediation" element={<Navigate to="/governance/remediation-events" replace />} />
        <Route path="/governance/remediation-events/*" element={<LazyRoute><RemediationEventsModule /></LazyRoute>} />
        <Route path="/governance/remediation-runs/*" element={<LegacyRemediationRedirect />} />
        <Route path="/governance/workflows/runs/*" element={<LegacyRemediationRedirect />} />
        <Route path="/governance/workflows/remediation-queue/*" element={<LegacyRemediationRedirect />} />
        <Route path="/governance/workflows/executions" element={<Navigate to="/governance/remediation-events" replace />} />
              <Route path="/governance/workflows/*" element={<LazyRoute><WorkflowsModule /></LazyRoute>} />
              <Route path="/governance/provisioning/*" element={<LazyRoute><ProvisioningModule /></LazyRoute>} />
        <Route path="/governance/discovery/privileged-entitlement" element={<LazyRoute><DiscoveryPolicies /></LazyRoute>} />
        <Route path="/governance/discovery/privileged-user" element={<LazyRoute><DiscoveryPolicies /></LazyRoute>} />
        <Route path="/governance/discovery/ad-group" element={<LazyRoute><DiscoveryPolicies /></LazyRoute>} />
        <Route path="/governance/discovery/:slug/new" element={<LazyRoute><DiscoveryPolicyBuilder /></LazyRoute>} />
        <Route path="/governance/discovery/:slug/:id/edit" element={<LazyRoute><DiscoveryPolicyBuilder /></LazyRoute>} />
        <Route path="/governance/discovery/policy/:id" element={<LazyRoute><DiscoveryPolicyDetail /></LazyRoute>} />
        <Route path="/governance/discovery/results" element={<LazyRoute><DiscoveryResults /></LazyRoute>} />
        <Route path="/governance/transforms" element={<LazyRoute><TransformStudio /></LazyRoute>} />
        <Route path="/governance/certifications" element={<LazyRoute><CertificationsHub /></LazyRoute>} />
        <Route path="/governance/certifications/access" element={<LazyRoute><AccessCertification /></LazyRoute>} />
        <Route path="/governance/campaigns" element={<ComingSoon title="Campaigns" />} />
        <Route path="/certifications/access" element={<Navigate to="/governance/certifications/access" replace />} />

        <Route path="/reports/compliance" element={<LazyRoute><ComplianceFrameworks /></LazyRoute>} />
        <Route path="/reports/analytics" element={<ComingSoon title="Analytics" />} />
        <Route path="/datahygine" element={<LazyRoute><DataHygieneDashboard /></LazyRoute>} />
        <Route
          path="/datahygine/application/:applicationId"
          element={(
            <LazyRoute>
              <DataHygieneApplicationAnalytics />
            </LazyRoute>
          )}
        />
        <Route
          path="/datahygine/:widgetId"
          element={(
            <LazyRoute>
              <DataHygieneWidgetDetail />
            </LazyRoute>
          )}
        />
        <Route path="/reports/data-hygiene" element={<Navigate to="/datahygine" replace />} />
        <Route
          path="/reports/iso-2007"
          element={(
            <ReportsRoute>
              <NotSuperAdminReportPage>
                <LazyRoute><Iso2007Report /></LazyRoute>
              </NotSuperAdminReportPage>
            </ReportsRoute>
          )}
        />

        <Route element={<ReportsRoute><LazyRoute><AuditHub /></LazyRoute></ReportsRoute>}>
          <Route path="/reports/audit" element={<LazyRoute><AuditLog /></LazyRoute>} />
          <Route path="/reports/activity" element={<LazyRoute><ActivityLog /></LazyRoute>} />
        </Route>
        <Route path="/audit" element={<Navigate to="/reports/audit" replace />} />
        <Route path="/audit/feed" element={<Navigate to="/reports/activity" replace />} />

        <Route path="/admin/users" element={<AdminRoute><LazyRoute><UsersManagement /></LazyRoute></AdminRoute>} />
        <Route path="/admin/settings" element={<AdminRoute><LazyRoute><SystemSettings /></LazyRoute></AdminRoute>} />
        <Route path="/admin/sessions" element={<AdminRoute><LazyRoute><SessionsManagement /></LazyRoute></AdminRoute>} />
        <Route path="/admin/tenants" element={<AdminRoute><ComingSoon title="Tenants" /></AdminRoute>} />
        <Route path="/admin/api-keys" element={<AdminRoute><LazyRoute><ApiKeys /></LazyRoute></AdminRoute>} />
        <Route path="/admin/branding" element={<AdminRoute><LazyRoute><BrandingSettings /></LazyRoute></AdminRoute>} />
        <Route path="/admin/application-icons" element={<AdminRoute><LazyRoute><ApplicationIconsSettings /></LazyRoute></AdminRoute>} />
        <Route path="/admin/license" element={<AdminRoute><LazyRoute><LicenseManagement /></LazyRoute></AdminRoute>} />
        <Route path="/admin/integrations" element={<AdminRoute><Navigate to="/admin/integrations/connectors" replace /></AdminRoute>} />
        <Route path="/admin/integrations/connectors" element={<AdminRoute><LazyRoute><ConnectorsManagement /></LazyRoute></AdminRoute>} />
        <Route path="/admin/integrations/connection-configs" element={<AdminRoute><ComingSoon title="Connection Configs" /></AdminRoute>} />

        <Route element={<OrgAdminRoute><Outlet /></OrgAdminRoute>}>
          <Route path="/org-admin/users" element={<LazyRoute><UsersManagement /></LazyRoute>} />
          <Route path="/org-admin/settings" element={<LazyRoute><SystemSettings /></LazyRoute>} />
          <Route path="/org-admin/sessions" element={<LazyRoute><SessionsManagement /></LazyRoute>} />
          <Route path="/org-admin/global-rule-set" element={<LazyRoute><GlobalRuleSet /></LazyRoute>} />
          <Route path="/org-admin/global-rule-set/identity-posture" element={<LazyRoute><IdentityPostureRules /></LazyRoute>} />
          <Route path="/org-admin/global-rule-set/reporting" element={<LazyRoute><ReportingRuleSet /></LazyRoute>} />
          <Route path="/org-admin/global-rule-set/uncorrelated-trust-mapping" element={<LazyRoute><UncorrelatedTrustMapping /></LazyRoute>} />
          <Route path="/org-admin/global-rule-set/remediation-workflow-rules" element={<LazyRoute><RemediationWorkflowRules /></LazyRoute>} />
          <Route path="/org-admin/global-rule-set/remediation-queue-scheduler" element={<LazyRoute><RemediationQueueScheduler /></LazyRoute>} />
          <Route path="/org-admin/global-rule-set/certification-email-reminders" element={<LazyRoute><CertificationEmailReminders /></LazyRoute>} />
          {/* <Route path="/org-admin/about" element={<LazyRoute><AboutADSecurity /></LazyRoute>} /> */}
        </Route>
        <Route path="/tenant-admin/users" element={<TenantAdminRoute><ComingSoon title="Tenant Users" /></TenantAdminRoute>} />
        <Route path="/tenant-admin/settings" element={<TenantAdminRoute><ComingSoon title="Tenant Settings" /></TenantAdminRoute>} />
        <Route path="/tenant-admin/application-icons" element={<TenantAdminRoute><LazyRoute><ApplicationIconsSettings /></LazyRoute></TenantAdminRoute>} />
        <Route path="/tenant-admin/api-keys" element={<TenantAdminRoute><ComingSoon title="Tenant API Keys" /></TenantAdminRoute>} />
        <Route path="/tenant-admin/audit" element={<TenantAdminRoute><LazyRoute><AuditLog /></LazyRoute></TenantAdminRoute>} />
        <Route path="/tenant-admin/permissions" element={<TenantAdminRoute><ComingSoon title="Tenant Permissions" /></TenantAdminRoute>} />
      </Route>

      <Route path="/cert-review" element={<LazyRoute><CertDecisionPage /></LazyRoute>} />
      <Route path="/orphan-iam-review" element={<LazyRoute><OrphanIamReviewPage /></LazyRoute>} />
      <Route
        path="/remediation/ticket/:ticketId/review"
        element={<LazyRoute><RemediationTicketReviewPage /></LazyRoute>}
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
