import { useState, useRef } from 'react';
import {
  AppBar, Toolbar, Box, IconButton, Typography, InputBase, Badge,
  Avatar, Popover, Divider, alpha, Chip, Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Notifications as NotificationsIcon,
  Fingerprint as FingerprintIcon,
  Person as PersonIcon,
  Settings as SettingsIcon,
  Logout as LogoutIcon,
  Business as BusinessIcon,
  ExpandMore as ExpandMoreIcon,
  Circle as CircleIcon,
  MenuOpen as MenuOpenIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { palette } from '../theme/palette';
import { useAuth } from '../contexts/AuthContext';
import { useBranding } from '../contexts/BrandingContext';
import { BRANDING } from '../constants/branding';

/* ── SailPoint Blue constants (used as fallbacks when layoutColors absent) ── */
const ACCENT_BLUE = '#2563EB';
const ACCENT_DARK = '#0f172a';
const ACCENT_BG = 'rgba(37,99,235,0.09)';
const ACCENT_SHADOW = 'rgba(37,99,235,0.22)';

export default function TopBar({
  drawerOpen = true,
  drawerWidth = 258,
  drawerCollapsed = 68,
  onToggle,
}) {
  const navigate = useNavigate();
  const { user, logout, isAdmin, isPlatformAdmin, isOrgAdmin, isTenantAdmin } = useAuth();
  const { branding } = useBranding();
  const topbarLogoH = 38;
  const topbarLogoMaxW = 150;
  const [profileAnchor, setProfileAnchor] = useState(null);
  const [notifAnchor, setNotifAnchor] = useState(null);

  const lc = branding.layoutColors || {};
  const AC = lc.accentPrimary || ACCENT_BLUE;
  const ACd = lc.topbarText || ACCENT_DARK;
  const TBG = lc.topbarBg || '#ffffff';
  const TBD = lc.topbarBorder || 'rgba(59,130,246,0.15)';
  const AC2 = lc.accentSecondary || '#7C3AED';
  /* Derived */
  const AC_BG = `${AC}16`;
  const AC_SHADOW = `${AC}38`;
  const brandColor = AC;
  const initials = user
    ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase()
    : 'U';
  const fullName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'User';
  const emailText = user?.email || 'No email';
  const roleLabel = (() => {
    const role = user?.role;
    if (role === 'superAdmin') return 'Super Admin';
    if (role === 'admin') return isOrgAdmin ? 'Org Admin' : 'Platform Admin';
    if (role === 'certAdmin') return 'Cert Admin';
    if (role === 'sodAdmin') return 'SoD Admin';
    if (role === 'manager') return 'Manager';
    if (role === 'viewer') return 'Viewer';
    if (role === 'auditAnalytics') return 'Audit Analytics';
    return 'User';
  })();
  const roleBadgeLabel = (roleLabel || '').toUpperCase();
  const tenantOrgName = (
    user?.tenantId?.name ||
    user?.tenantId?.code ||
    user?.tenant?.name ||
    user?.tenant?.code ||
    user?.tenant?.displayName ||
    user?.tenantName ||
    user?.tenantDisplayName ||
    user?.orgName ||
    user?.organizationName ||
    user?.organization?.name ||
    user?.organization?.displayName ||
    ''
  ).toString().trim();
  const roleWithOrgLabel = tenantOrgName ? `${tenantOrgName} · ${roleLabel}` : roleLabel;
  const settingsPath = isPlatformAdmin ? '/admin/settings' : '/org-admin/settings';

  const handleLogout = () => {
    setProfileAnchor(null);
    logout();
    navigate('/login');
  };

  const profileOpen = Boolean(profileAnchor);
  const notifOpen = Boolean(notifAnchor);

  const drawerSpacer = drawerOpen ? drawerWidth : drawerCollapsed;

  return (
    <>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: (t) => t.zIndex.drawer - 1,
          width: { xs: '100%', sm: `calc(100% - ${drawerSpacer}px)` },
          ml: { xs: 0, sm: `${drawerSpacer}px` },
          background: TBG,
          color: ACd,
          height: 63,
          boxSizing: 'border-box',
          borderBottom: `1.5px solid ${TBD}`,
          boxShadow: `0 2px 0 ${AC}14, 0 4px 16px rgba(0,0,0,0.04)`,
          transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1), margin 0.25s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <Toolbar sx={{ gap: 2, height: '100%', minHeight: '100%', pl: { xs: 2, sm: 2 }, pr: { xs: 2, sm: 3 } }}>
          {onToggle && (
            <Tooltip title={drawerOpen ? 'Collapse sidebar' : 'Expand sidebar'} arrow placement="bottom">
              <IconButton
                onClick={onToggle}
                size="small"
                aria-label={drawerOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                aria-expanded={drawerOpen}
                sx={{
                  color: '#64748b',
                  background: '#f8fafc',
                  borderRadius: '10px',
                  width: 38,
                  height: 38,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    background: ACCENT_BG,
                    color: ACCENT_BLUE,
                    borderColor: 'rgba(37,99,235,0.3)',
                    boxShadow: `0 3px 6px ${ACCENT_SHADOW}`,
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                {/* Menu fold: MenuOpen (hamburger + arrow). Flip when collapsed so arrow points right. */}
                <MenuOpenIcon
                  fontSize="small"
                  sx={{
                    transform: drawerOpen ? 'none' : 'scaleX(-1)',
                    transition: 'transform 0.2s ease',
                  }}
                />
              </IconButton>
            </Tooltip>
          )}

          {/* ── Global Search ── */}
          <Box sx={{
            display: 'flex', alignItems: 'center',
            background: `${AC}0d`,
            border: `1.5px solid ${AC}33`,
            borderRadius: '14px',
            px: 1.5, py: 0.65,
            flex: 1, maxWidth: 460,
            boxShadow: `0 3px 0 ${AC}1e`,
            transition: 'all 0.25s ease',
            '&:focus-within': {
              borderColor: AC,
              background: '#fff',
              boxShadow: `0 5px 0 ${AC_SHADOW}, 0 8px 16px rgba(0,0,0,0.06)`,
              transform: 'translateY(-1px)',
            },
          }}>
            <SearchIcon sx={{ color: AC, mr: 1, fontSize: 18, opacity: 0.7 }} />
            <InputBase
              placeholder="Search identities, applications, roles..."
              sx={{
                flex: 1,
                color: ACd,
                fontSize: '0.85rem',
                fontWeight: 500,
                '& input::placeholder': { color: `${AC}88`, opacity: 1 },
              }}
            />
            <Box sx={{
              px: 0.75, py: 0.2,
              background: AC_BG,
              border: `1px solid ${AC}33`,
              borderRadius: '7px',
              boxShadow: `0 2px 0 ${AC}26`,
            }}>
              <Typography variant="caption" sx={{ color: AC, fontWeight: 700, fontSize: '0.62rem' }}>
                ⌘K
              </Typography>
            </Box>
          </Box>

          <Box sx={{ flex: 1 }} />

          {/* ── Notifications bell ── */}
          <Tooltip title="Notifications" arrow>
            <IconButton
              onClick={(e) => setNotifAnchor(e.currentTarget)}
              sx={{
                color: '#64748b',
                background: 'rgba(0,0,0,0.02)',
                borderRadius: '12px',
                width: 38, height: 38,
                border: '1.5px solid rgba(0,0,0,0.06)',
                boxShadow: '0 3px 0 rgba(0,0,0,0.06)',
                transition: 'all 0.2s ease',
                '&:hover': {
                  background: ACCENT_BG,
                  color: ACCENT_BLUE,
                  border: `1.5px solid rgba(37,99,235,0.25)`,
                  boxShadow: `0 4px 0 ${ACCENT_SHADOW}`,
                  transform: 'translateY(-1px)',
                },
              }}
            >
              <Badge
                badgeContent={3}
                color="error"
                sx={{ '& .MuiBadge-badge': { fontSize: 10, minWidth: 15, height: 15, fontWeight: 700 } }}
              >
                <NotificationsIcon fontSize="small" />
              </Badge>
            </IconButton>
          </Tooltip>

          {/* ── Profile trigger ── */}
          <Box
            onClick={(e) => setProfileAnchor(e.currentTarget)}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1,
              cursor: 'pointer',
              px: 1, py: 0.5,
              borderRadius: '14px',
              background: profileOpen ? ACCENT_BG : 'rgba(0,0,0,0.02)',
              border: profileOpen
                ? `1.5px solid rgba(37,99,235,0.3)`
                : '1.5px solid rgba(0,0,0,0.06)',
              boxShadow: profileOpen
                ? `0 4px 0 ${ACCENT_SHADOW}`
                : '0 3px 0 rgba(0,0,0,0.06)',
              transition: 'all 0.2s ease',
              '&:hover': {
                background: ACCENT_BG,
                border: `1.5px solid rgba(37,99,235,0.3)`,
                boxShadow: `0 4px 0 ${ACCENT_SHADOW}`,
                transform: 'translateY(-1px)',
              },
            }}
          >
            {/* Avatar bubble — clay style */}
            <Avatar sx={{
              width: 30, height: 30,
              background: `linear-gradient(145deg, ${AC}cc, ${AC})`,
              boxShadow: `0 3px 0 ${AC}55, 0 4px 10px ${AC}40`,
              fontSize: '0.75rem',
              fontWeight: 800,
              color: '#fff',
              border: '2px solid rgba(255,255,255,0.8)',
            }}>
              {initials}
            </Avatar>

            {/* Name + role */}
            <Box sx={{ display: { xs: 'none', md: 'block' }, lineHeight: 1.1 }}>
              <Typography variant="body2" fontWeight={700} sx={{ color: ACd, fontSize: '0.8rem', lineHeight: 1.2 }}>
                {fullName}
              </Typography>
              <Typography variant="caption" sx={{ color: AC, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.05em' }}>
                {roleWithOrgLabel}
              </Typography>
            </Box>

            <ExpandMoreIcon sx={{
              fontSize: 16, color: '#94a3b8',
              transform: profileOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.25s ease',
            }} />
          </Box>
        </Toolbar>
      </AppBar>

      {/* ════════════════════════════════════
          PROFILE POPOVER — clay card
      ════════════════════════════════════ */}
      <Popover
        open={profileOpen}
        anchorEl={profileAnchor}
        onClose={() => setProfileAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          elevation: 0,
          sx: {
            mt: 1.5,
            width: 280,
            borderRadius: '20px',
            background: '#fff',
            border: '1.5px solid rgba(37,99,235,0.15)',
            boxShadow: '0 12px 0 rgba(37,99,235,0.18), 0 20px 40px rgba(0,0,0,0.12)',
            overflow: 'visible',
            /* Caret arrow */
            '&::before': {
              content: '""',
              position: 'absolute',
              top: -6, right: 20,
              width: 12, height: 12,
              background: '#fff',
              border: '1.5px solid rgba(37,99,235,0.15)',
              borderBottom: 'none',
              borderRight: 'none',
              transform: 'rotate(45deg)',
              zIndex: 1,
            },
          },
        }}
      >
        {/* ── User identity card ── */}
        <Box sx={{
          px: 2.5, pt: 2.5, pb: 2,
          background: 'linear-gradient(145deg, rgba(37,99,235,0.08), rgba(37,99,235,0.04))',
          borderRadius: '18px 18px 0 0',
          borderBottom: '1.5px solid rgba(37,99,235,0.1)',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.25 }}>
            {/* Large clay avatar */}
            <Avatar sx={{
              width: 48, height: 48,
              background: 'linear-gradient(145deg, #3b82f6, #2563EB)',
              boxShadow: '0 6px 0 rgba(30,58,138,0.3), 0 8px 20px rgba(37,99,235,0.25)',
              border: '3px solid #fff',
              fontSize: '1.1rem',
              fontWeight: 800,
              color: '#fff',
            }}>
              {initials}
            </Avatar>
            <Box>
              <Typography fontWeight={800} sx={{ color: '#0f172a', fontSize: '0.95rem', lineHeight: 1.2 }}>
                {fullName}
              </Typography>
              <Tooltip title={emailText} arrow placement="bottom-start">
                <Typography
                  variant="caption"
                  sx={{
                    color: '#93a3b8',
                    fontWeight: 500,
                    display: 'block',
                    maxWidth: 180,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {emailText}
                </Typography>
              </Tooltip>
            </Box>
          </Box>

          {/* Org + status row */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {tenantOrgName && (
              <Box sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                px: 1, py: 0.35,
                background: '#fff',
                borderRadius: '9px',
                border: '1px solid rgba(37,99,235,0.2)',
                boxShadow: '0 3px 0 rgba(37,99,235,0.15)',
              }}>
                <BusinessIcon sx={{ fontSize: 11, color: ACCENT_BLUE }} />
                <Typography variant="caption" sx={{ color: ACCENT_DARK, fontWeight: 700, fontSize: '0.65rem' }}>
                  {tenantOrgName}
                </Typography>
              </Box>
            )}
            {isAdmin && (
              <Box sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                px: 1, py: 0.35,
                background: 'rgba(37,99,235,0.1)',
                borderRadius: '9px',
                border: '1px solid rgba(37,99,235,0.25)',
                boxShadow: '0 3px 0 rgba(37,99,235,0.18)',
              }}>
                <Tooltip title={roleLabel} arrow>
                  <Typography variant="caption" sx={{ color: ACCENT_DARK, fontWeight: 800, fontSize: '0.6rem', letterSpacing: '0.06em', maxWidth: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {roleBadgeLabel}
                  </Typography>
                </Tooltip>
              </Box>
            )}
          </Box>

          {/* Online status */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mt: 0.8 }}>
            <CircleIcon sx={{ fontSize: 8, color: ACCENT_BLUE }} />
            <Typography variant="caption" sx={{ color: '#93a3b8', fontWeight: 600, fontSize: '0.68rem' }}>
              {tenantOrgName ? `Online · ${tenantOrgName}` : 'Online'}
            </Typography>
          </Box>
        </Box>

        {/* ── Menu items ── */}
        <Box sx={{ p: 1.25 }}>
          {[
            { icon: <PersonIcon sx={{ fontSize: 17 }} />, label: 'View Profile', sub: 'Manage your account', path: '/account/profile' },
            { icon: <SettingsIcon sx={{ fontSize: 17 }} />, label: 'Settings', sub: 'Preferences & security', path: settingsPath },
          ].map((item) => (
            <Box
              key={item.label}
              onClick={() => { setProfileAnchor(null); navigate(item.path); }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.5,
                px: 1.25, py: 1,
                borderRadius: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  background: ACCENT_BG,
                  '& .clay-icon-wrap': {
                    boxShadow: `0 4px 0 ${ACCENT_SHADOW}`,
                    transform: 'translateY(-1px)',
                  },
                },
              }}
            >
              <Box
                className="clay-icon-wrap"
                sx={{
                  width: 34, height: 34, borderRadius: '10px',
                  background: '#f0f4ff',
                  border: '1.5px solid rgba(37,99,235,0.2)',
                  boxShadow: '0 3px 0 rgba(37,99,235,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: ACCENT_BLUE,
                  flexShrink: 0,
                  transition: 'all 0.2s ease',
                }}
              >
                {item.icon}
              </Box>
              <Box>
                <Typography variant="body2" fontWeight={700} sx={{ color: '#0f172a', lineHeight: 1.2 }}>
                  {item.label}
                </Typography>
                <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 500 }}>
                  {item.sub}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>

        {/* ── Sign out ── */}
        <Box sx={{
          px: 1.25, pb: 1.25,
          borderTop: '1.5px solid rgba(37,99,235,0.08)',
          pt: 1,
        }}>
          <Box
            onClick={handleLogout}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.5,
              px: 1.25, py: 1,
              borderRadius: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              '&:hover': {
                background: 'rgba(220,38,38,0.06)',
                '& .signout-icon': {
                  boxShadow: '0 4px 0 rgba(220,38,38,0.18)',
                  transform: 'translateY(-1px)',
                },
              },
            }}
          >
            <Box
              className="signout-icon"
              sx={{
                width: 34, height: 34, borderRadius: '10px',
                background: '#fff5f5',
                border: '1.5px solid rgba(220,38,38,0.2)',
                boxShadow: '0 3px 0 rgba(220,38,38,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                transition: 'all 0.2s ease',
              }}
            >
              <LogoutIcon sx={{ fontSize: 17, color: '#dc2626' }} />
            </Box>
            <Box>
              <Typography variant="body2" fontWeight={700} sx={{ color: '#dc2626', lineHeight: 1.2 }}>
                Sign out
              </Typography>
              <Typography variant="caption" sx={{ color: '#fca5a5', fontWeight: 500 }}>
                End your session
              </Typography>
            </Box>
          </Box>
        </Box>
      </Popover>

      {/* ════════════════════════════════════
          NOTIFICATIONS POPOVER (stub)
      ════════════════════════════════════ */}
      <Popover
        open={notifOpen}
        anchorEl={notifAnchor}
        onClose={() => setNotifAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{
          elevation: 0,
          sx: {
            mt: 1.5, width: 320,
            borderRadius: '20px',
            background: '#fff',
            border: '1.5px solid rgba(37,99,235,0.15)',
            boxShadow: '0 12px 0 rgba(37,99,235,0.18), 0 20px 40px rgba(0,0,0,0.12)',
            overflow: 'hidden',
          },
        }}
      >
        {/* Header */}
        <Box sx={{
          px: 2.5, py: 2,
          background: 'linear-gradient(145deg, rgba(37,99,235,0.08), rgba(37,99,235,0.04))',
          borderBottom: '1.5px solid rgba(37,99,235,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <Typography fontWeight={800} sx={{ color: '#0f172a', fontSize: '0.9rem' }}>
            Notifications
          </Typography>
          <Box sx={{
            px: 0.9, py: 0.3,
            background: ACCENT_BG,
            border: '1px solid rgba(37,99,235,0.25)',
            borderRadius: '8px',
            boxShadow: '0 2px 0 rgba(37,99,235,0.15)',
          }}>
            <Typography variant="caption" sx={{ color: ACCENT_BLUE, fontWeight: 800, fontSize: '0.65rem' }}>
              3 new
            </Typography>
          </Box>
        </Box>

        {/* Notification items */}
        {[
          { title: 'Campaign review due', sub: 'Q1 Access Certification · 2h ago', dot: '#f59e0b' },
          { title: 'SoD violation detected', sub: 'User john.doe@corp · 4h ago', dot: '#ef4444' },
          { title: 'Role mining complete', sub: '47 roles suggested · 1d ago', dot: ACCENT_BLUE },
        ].map((n, i) => (
          <Box key={i} sx={{
            display: 'flex', alignItems: 'flex-start', gap: 1.25,
            px: 2, py: 1.5,
            borderBottom: i < 2 ? '1px solid rgba(37,99,235,0.07)' : 'none',
            cursor: 'pointer',
            transition: 'background 0.2s',
            '&:hover': { background: 'rgba(37,99,235,0.04)' },
          }}>
            <Box sx={{
              width: 8, height: 8, borderRadius: '50%',
              background: n.dot, mt: 0.6, flexShrink: 0,
              boxShadow: `0 2px 4px ${n.dot}55`,
            }} />
            <Box>
              <Typography variant="body2" fontWeight={700} sx={{ color: '#0f172a', lineHeight: 1.3 }}>
                {n.title}
              </Typography>
              <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 500 }}>
                {n.sub}
              </Typography>
            </Box>
          </Box>
        ))}

        <Box sx={{ p: 1.5, textAlign: 'center' }}>
          <Typography variant="caption" sx={{
            color: ACCENT_BLUE, fontWeight: 700, cursor: 'pointer',
            '&:hover': { textDecoration: 'underline' },
          }}>
            View all notifications →
          </Typography>
        </Box>
      </Popover>
    </>
  );
}
