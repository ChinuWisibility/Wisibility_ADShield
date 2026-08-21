import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Drawer, Box, List, ListItemButton, ListItemIcon, ListItemText,
  Typography, Divider, Tooltip,
} from '@mui/material';
import {
  People as PeopleIcon,
  Apps as AppsIcon,
  Visibility as ApplicationViewIcon,
  Badge as ProfilesIcon,
  Security as SecurityIcon,
  FactCheck as FindingsIcon,
  DocumentScanner as ScanIcon,
  Build as RemediationIcon,
  Policy as PolicyIcon,
  GroupWork as GroupIntelIcon,
  AssignmentTurnedIn as CertIcon,
  AccountTree as AccountTreeIcon,
  EventNote as RemediationEventsIcon,
  Gavel as AuditIcon,
  FilterAlt as HygieneIcon,
  AdminPanelSettings as AdminIcon,
  CorporateFare as OrgSettingsIcon,
  Settings as SettingsIcon,
  Devices as DevicesIcon,
  Rule as RuleIcon,
  InfoOutlined as AboutIcon,
  Assessment as ComplianceIcon,
  Key as KeyIcon,
  Palette as BrandingIcon,
  Widgets as AppIconsIcon,
  CardMembership as LicenseIcon,
  Cable as ConnectorsIcon,
  SettingsInputComponent as ConnectionConfigsIcon,
  PersonAdd as TenantUsersIcon,
  Tune as TenantSettingsIcon,
  History as AuditLogsIcon,
  LockPerson as PermissionsIcon,
  Fingerprint as FingerprintIcon,
} from '@mui/icons-material';
import { useBranding } from '../contexts/BrandingContext';
import { useAuth } from '../contexts/AuthContext';
import { prefetchRouteByPath } from '../utils/routePrefetch';

const DRAWER_WIDTH = 258;
const DRAWER_COLLAPSED = 68;
const HEADER_HEIGHT = 63;

/**
 * Flat navigation config — every page is a direct item (no children / accordions).
 * Active matching uses exact path rules (see isNavItemActive).
 */
const navGroups = [
  {
    label: 'IDENTITY',
    items: [
      { label: 'Identities', icon: <PeopleIcon />, path: '/identities' },
    ],
  },
  {
    label: 'APPLICATION ONBOARD',
    items: [
      { label: 'Applications', icon: <AppsIcon />, path: '/applications' },
      { label: 'Application View', icon: <ApplicationViewIcon />, path: '/application-view' },
      { label: 'Identity Profiles', icon: <ProfilesIcon />, path: '/identities/profiles' },
    ],
  },
  {
    label: 'GOVERNANCE',
    items: [
      { label: 'Certifications', icon: <CertIcon />, path: '/governance/certifications' },
    ],
  },
  {
    label: 'REPORTS',
    items: [
      { label: 'Audit', icon: <AuditIcon />, path: '/reports/audit' },
      { label: 'Data Hygiene', icon: <HygieneIcon />, path: '/datahygine' },
    ],
  },
  {
    label: 'WORKFLOWS',
    items: [
      { label: 'Workflow Items', icon: <AccountTreeIcon />, path: '/governance/workflows' },
      { label: 'Remediation Events', icon: <RemediationEventsIcon />, path: '/governance/remediation-events' },
    ],
  },
  {
    label: 'AD SECURITY',
    items: [
      { label: 'Security Dashboard', icon: <SecurityIcon />, path: '/security/dashboard' },
      { label: 'Findings Explorer', icon: <FindingsIcon />, path: '/security/findings' },
      { label: 'Scan Center', icon: <ScanIcon />, path: '/security/scans' },
      { label: 'Remediation', icon: <RemediationIcon />, path: '/security/remediation' },
      { label: 'Policy Center', icon: <PolicyIcon />, path: '/security/policies' },
      { label: 'Group Intelligence', icon: <GroupIntelIcon />, path: '/security/groups' },
    ],
  },
];

const platformAdminGroup = {
  label: 'ADMIN',
  items: [
    { label: 'Users & Roles', icon: <AdminIcon />, path: '/admin/users' },
    { label: 'System Config', icon: <SettingsIcon />, path: '/admin/settings' },
    { label: 'Sessions', icon: <DevicesIcon />, path: '/admin/sessions' },
    { label: 'Compliance', icon: <ComplianceIcon />, path: '/reports/compliance' },
    { label: 'API Keys', icon: <KeyIcon />, path: '/admin/api-keys' },
    { label: 'Branding', icon: <BrandingIcon />, path: '/admin/branding' },
    { label: 'App Icons', icon: <AppIconsIcon />, path: '/admin/application-icons' },
    { label: 'License', icon: <LicenseIcon />, path: '/admin/license' },
    { label: 'Connectors', icon: <ConnectorsIcon />, path: '/admin/integrations/connectors' },
    { label: 'Connection Configs', icon: <ConnectionConfigsIcon />, path: '/admin/integrations/connection-configs' },
  ],
};

const orgAdminGroup = {
  label: 'ADMIN',
  items: [
    { label: 'Users & Roles', icon: <AdminIcon />, path: '/org-admin/users' },
    { label: 'Org Settings', icon: <OrgSettingsIcon />, path: '/org-admin/settings' },
    { label: 'Sessions', icon: <DevicesIcon />, path: '/org-admin/sessions' },
    { label: 'Global rule set', icon: <RuleIcon />, path: '/org-admin/global-rule-set' },
    { label: 'About', icon: <AboutIcon />, path: '/org-admin/about' },
  ],
};

const tenantAdminGroup = {
  label: 'ADMIN',
  items: [
    { label: 'Tenant Users', icon: <TenantUsersIcon />, path: '/tenant-admin/users' },
    { label: 'Tenant Settings', icon: <TenantSettingsIcon />, path: '/tenant-admin/settings' },
    { label: 'App Icons', icon: <AppIconsIcon />, path: '/tenant-admin/application-icons' },
    { label: 'API Keys', icon: <KeyIcon />, path: '/tenant-admin/api-keys' },
    { label: 'Audit Logs', icon: <AuditLogsIcon />, path: '/tenant-admin/audit' },
    { label: 'Permissions', icon: <PermissionsIcon />, path: '/tenant-admin/permissions' },
  ],
};

/** Exact-path active rules so siblings under the same prefix do not steal highlight. */
function isNavItemActive(pathname, path) {
  if (path === '/') {
    return pathname === '/';
  }
  if (path === '/identities') {
    return pathname === '/identities';
  }
  // Correlation Summary page tabs — keep siblings from stealing highlight
  if (path === '/identities/accounts/correlated') {
    return pathname === '/identities/accounts'
      || pathname === '/identities/accounts/correlated'
      || pathname === '/identities/accounts/uncorrelated'
      || pathname === '/identities/accounts/orphans';
  }
  if (path === '/identities/accounts/entitlements/correlated') {
    return pathname.startsWith('/identities/accounts/entitlements');
  }
  if (path === '/identities/accounts/duplicates') {
    return pathname === '/identities/accounts/duplicates'
      || pathname.startsWith('/identities/accounts/duplicates/');
  }
  if (path === '/governance/sod-policies') {
    return pathname === '/governance/sod-policies'
      || pathname.startsWith('/governance/sod-policies/')
      || pathname === '/governance/sod-violations'
      || pathname.startsWith('/governance/sod-violations/');
  }
  if (path === '/reports/audit') {
    return pathname === '/reports/audit'
      || pathname.startsWith('/reports/audit/')
      || pathname === '/reports/activity'
      || pathname.startsWith('/reports/activity/');
  }
  if (path === '/access/roles') {
    return pathname === '/access/roles'
      || pathname === '/access'
      || pathname.startsWith('/access/roles/')
      || pathname === '/access/role-mining'
      || pathname.startsWith('/access/role-mining/');
  }
  if (path === '/identities/profiles') {
    return pathname === '/identities/profiles'
      || /^\/identities\/profiles\//.test(pathname);
  }
  if (path === '/applications') {
    return pathname === '/applications'
      || (pathname.startsWith('/applications/')
        && !pathname.startsWith('/applications/hrms-sources')
        && !pathname.startsWith('/applications/hrms-integration/'));
  }
  if (path === '/application-view') {
    return pathname === '/application-view'
      || pathname.startsWith('/application-view/');
  }
  if (path === '/security/dashboard') {
    return pathname === '/security/dashboard' || pathname === '/security';
  }
  if (path === '/admin/integrations/connectors') {
    return pathname === '/admin/integrations/connectors'
      || pathname.startsWith('/admin/integrations/connectors/');
  }
  if (path === '/admin/integrations/connection-configs') {
    return pathname === '/admin/integrations/connection-configs'
      || pathname.startsWith('/admin/integrations/connection-configs/');
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function Sidebar({ open }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { branding } = useBranding();
  const sidebarLogoWidth = 44;
  const sidebarLogoHeight = 40;
  const sidebarLogoCollapsed = 34;
  const { user, isPlatformAdmin, isOrgAdmin, isTenantAdmin } = useAuth();

  /* ── Dark navy theme colors ── */
  const SBD = '#253554';
  const AC = '#ffffff';
  /** Inactive nav: brighter for contrast against navy background */
  const ACd = '#c5d4e8';
  const GROUP_LBL = '#a8bdd4';
  const SBG_GRAD = 'linear-gradient(165deg, #1d2e4f 0%, #1b2f52 35%, #182542 70%, #151f35 100%)';
  const SBG_OVERLAY = 'radial-gradient(140% 90% at 0% 0%, #243a5e 0%, rgba(0,0,0,0) 55%)';
  const SBG_GLOW = 'radial-gradient(120% 80% at 100% 100%, rgba(79,140,255,0.12) 0%, rgba(0,0,0,0) 55%)';
  const ACCENT = '#4f8cff';
  const ACTIVE_BG = 'rgba(79,140,255,0.18)';
  const ACTIVE_RING = 'rgba(79,140,255,0.35)';
  const HOVER_BG = 'rgba(255,255,255,0.08)';
  const COLLAPSED_BG = 'rgba(255,255,255,0.07)';
  const COLLAPSED_HOVER = 'rgba(255,255,255,0.12)';
  const COLLAPSED_ACTIVE = 'rgba(79,140,255,0.24)';

  /** Keep Assessment workspace (applicationId/scanId) when hopping Security Posture nav items. */
  const navigateNavPath = (path) => {
    const isSecurityPath = path === '/security' || path.startsWith('/security/');
    const onSecurity =
      location.pathname === '/security' || location.pathname.startsWith('/security/');
    if (isSecurityPath && onSecurity && location.search) {
      navigate({ pathname: path, search: location.search });
      return;
    }
    navigate(path);
  };

  const isSuperAdmin = user?.role === 'superAdmin';

  const visibleNavGroups = isSuperAdmin ? [platformAdminGroup] : [...navGroups];
  if (!isSuperAdmin && isPlatformAdmin) visibleNavGroups.push(platformAdminGroup);
  if (!isSuperAdmin && isOrgAdmin) visibleNavGroups.push(orgAdminGroup);
  if (!isSuperAdmin && isTenantAdmin) visibleNavGroups.push(tenantAdminGroup);

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: open ? DRAWER_WIDTH : DRAWER_COLLAPSED,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: open ? DRAWER_WIDTH : DRAWER_COLLAPSED,
          height: '100vh',
          top: 0,
          left: 0,
          borderRadius: 0,
          margin: 0,
          padding: 0,
          paddingTop: 0,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
          overflowX: 'hidden',
          overflowY: 'hidden',
          backgroundImage: `${SBG_OVERLAY}, ${SBG_GLOW}, ${SBG_GRAD}`,
          border: 'none',
          borderRight: `1px solid ${SBD}`,
          boxShadow: '6px 0 22px rgba(10,16,28,0.35)',
        },
      }}
    >
      {/* ──────── Logo / Brand header ──────── */}
      <Box sx={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
        px: 0,
        py: 0,
        height: HEADER_HEIGHT,
        minHeight: HEADER_HEIGHT,
        position: 'relative',
        backgroundImage: `${SBG_OVERLAY}, ${SBG_GLOW}, ${SBG_GRAD}`,
        borderBottom: `1px solid ${SBD}`,
      }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            width: '100%',
            px: open ? 2.5 : 0,
            justifyContent: open ? 'flex-start' : 'center',
          }}
        >
          {branding.logoUrl ? (
            <Box sx={{ flexShrink: 0 }}>
              <Box
                component="img"
                src={branding.logoUrl}
                alt={branding.companyName || 'Platform Logo'}
                sx={{
                  width: open ? sidebarLogoWidth : sidebarLogoCollapsed,
                  height: open ? sidebarLogoHeight : sidebarLogoCollapsed,
                  objectFit: 'contain',
                  display: 'block',
                }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </Box>
          ) : (
            <Box sx={{
              width: open ? 36 : 30,
              height: open ? 36 : 30,
              borderRadius: open ? '11px' : '10px',
              background: `linear-gradient(145deg, #3b82f6cc, #3b82f6)`,
              boxShadow: `0 5px 0 rgba(59,130,246,0.3), 0 8px 16px rgba(59,130,246,0.2)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <FingerprintIcon sx={{ color: '#fff', fontSize: open ? 20 : 18 }} />
            </Box>
          )}
          {open && (
            <Box>
              <Typography variant="subtitle1" sx={{
                color: '#ffffff',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
                textTransform: 'uppercase',
              }}>
                {branding.companyName || 'Wisibility'}
              </Typography>
              <Typography variant="caption" sx={{
                color: '#c5d4e8',
                fontWeight: 600,
                fontSize: '0.65rem',
                letterSpacing: '0.05em',
                display: 'block',
                textTransform: 'uppercase',
              }}>
                ADSHIELD
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* ──────── Navigation ──────── */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          py: open ? 0.75 : 1,
          px: open ? 0 : 0.5,
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.2) transparent',
          '&::-webkit-scrollbar': { width: 2 },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(255,255,255,0.2)',
            borderRadius: 99,
          },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
        }}
      >
        {visibleNavGroups.map((group, gi) => (
          <Box key={group.label || `top-${gi}`}>
            {group.label && open && (
              <Typography variant="subtitle2" sx={{
                px: 2, pt: 1.4, pb: 0.5,
                color: GROUP_LBL,
                fontSize: '0.65rem',
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'none',
              }}>
                {group.label}
              </Typography>
            )}
            {group.label && !open && gi > 0 && (
              <Divider sx={{ mx: 1.5, my: 0.75, borderColor: SBD }} />
            )}

            <List dense disablePadding>
              {group.items
                .filter((item) => !(item.hideForRoles || []).includes(user?.role))
                .map((item) => {
                  const active = isNavItemActive(location.pathname, item.path);
                  return (
                    <Tooltip
                      key={item.path}
                      title={!open ? item.label : ''}
                      placement="right"
                      arrow
                    >
                      <ListItemButton
                        selected={false}
                        onMouseEnter={() => prefetchRouteByPath(item.path)}
                        onClick={() => navigateNavPath(item.path)}
                        sx={{
                          minHeight: open ? 42 : 48,
                          mx: open ? 1 : 1, mb: open ? 0.4 : 0.6,
                          px: open ? 1.25 : 0,
                          justifyContent: open ? 'flex-start' : 'center',
                          borderRadius: open ? '10px' : '14px',
                          transition: 'all 0.2s ease',
                          position: 'relative',
                          ...(active ? {
                            background: open ? ACTIVE_BG : COLLAPSED_ACTIVE,
                            boxShadow: open
                              ? 'inset 0 0 0 1px rgba(79,140,255,0.22)'
                              : '0 10px 18px rgba(79,140,255,0.18)',
                            '&:hover': {
                              background: open ? 'rgba(79,140,255,0.22)' : 'rgba(79,140,255,0.28)',
                            },
                          } : {
                            '&:hover': {
                              background: open ? HOVER_BG : COLLAPSED_HOVER,
                              transform: open ? 'translateX(2px)' : 'translateY(-1px)',
                            },
                          }),
                          ...(open && active ? {
                            '&::before': {
                              content: '""',
                              position: 'absolute',
                              left: 6,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              width: 3,
                              height: 18,
                              borderRadius: 2,
                              background: ACCENT,
                              boxShadow: '0 0 8px rgba(79,140,255,0.6)',
                            },
                          } : {}),
                        }}
                      >
                        <ListItemIcon sx={{
                          minWidth: open ? 34 : 'auto',
                          color: active ? AC : ACd,
                          transition: 'color 0.2s',
                          '& svg': { fontSize: 19 },
                          ...(open ? {} : {
                            width: 38,
                            height: 38,
                            borderRadius: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: active ? COLLAPSED_ACTIVE : COLLAPSED_BG,
                            border: `1px solid ${active ? ACTIVE_RING : 'rgba(255,255,255,0.1)'}`,
                            boxShadow: active
                              ? '0 10px 18px rgba(79,140,255,0.22)'
                              : 'inset 0 0 0 1px rgba(255,255,255,0.02)',
                          }),
                        }}>
                          {item.icon}
                        </ListItemIcon>
                        {open && (
                          <ListItemText
                            primary={item.label}
                            primaryTypographyProps={{
                              fontSize: '0.85rem',
                              fontWeight: active ? 600 : 500,
                              color: active ? AC : ACd,
                              letterSpacing: '-0.01em',
                            }}
                          />
                        )}
                      </ListItemButton>
                    </Tooltip>
                  );
                })}
            </List>
          </Box>
        ))}
      </Box>

      {/* ──────── Footer version ──────── */}
      {open && (
        <Box sx={{
          p: 1.5,
          borderTop: `1px solid ${SBD}`,
          background: 'rgba(0,0,0,0.1)',
        }}>
          <Box sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1.25,
            py: 0.5,
            borderRadius: '8px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: `1px solid rgba(255, 255, 255, 0.1)`,
          }}>
            <VerifiedUserOutlinedIcon sx={{
              fontSize: 16,
              color: '#c5d4e8',
            }} />
            <Typography variant="caption" sx={{
              color: '#c5d4e8',
              fontWeight: 600,
              fontSize: '0.7rem',
              letterSpacing: 0.3
            }}>
              ADSecurity IGA v1.0.0
            </Typography>
          </Box>
        </Box>
      )}
    </Drawer>
  );
}
