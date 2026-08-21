import { useMemo, useState } from 'react';
import { Box, Paper, Tooltip, Typography } from '@mui/material';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import {
  postureCardAnimate,
  POSTURE_COLORS,
} from './identityPostureTheme';
import { ACCESS_DETAILS_TITLE, ACCESS_DETAILS_FIELDS } from '../identityPostureLabels';
import { LOCAL_BRAND_LOGOS, resolveLocalBrandKey } from './applicationBrandLogos';
import { resolveApplicationIconSrc } from '../../../../components/applications/ApplicationIconPicker';

const detailCardSx = {
  p: 1.75,
  height: '100%',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
};

const AVATAR_PALETTE = [
  '#2563eb', '#0d9488', '#7c3aed', '#db2777', '#ea580c',
  '#0891b2', '#4f46e5', '#059669', '#ca8a04', '#dc2626',
];

function appInitials(name) {
  const parts = String(name || '').trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function hashColor(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function isImageSrc(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  return (
    v.startsWith('http://')
    || v.startsWith('https://')
    || v.startsWith('data:image')
    || v.startsWith('/')
    || v.startsWith('blob:')
  );
}

function ApplicationLogo({ name, icon, color, size = 32 }) {
  const [remoteFailed, setRemoteFailed] = useState(false);
  const resolvedSrc = useMemo(() => {
    if (!isImageSrc(icon)) return null;
    return resolveApplicationIconSrc(icon);
  }, [icon]);
  const remoteSrc = !remoteFailed && resolvedSrc ? resolvedSrc : null;
  const brandKey = useMemo(
    () => (remoteSrc ? null : resolveLocalBrandKey(name)),
    [name, remoteSrc],
  );
  const localMark = brandKey ? LOCAL_BRAND_LOGOS[brandKey] : null;
  const initials = useMemo(() => appInitials(name), [name]);
  const fallbackBg = color || hashColor(name);

  return (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '8px',
        border: '1px solid #e8edf4',
        bgcolor: remoteSrc || localMark ? '#fff' : fallbackBg,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        p: remoteSrc || localMark ? '3px' : 0,
        fontSize: size * 0.36,
        fontWeight: 800,
        lineHeight: 1,
      }}
      aria-hidden
    >
      {remoteSrc ? (
        <Box
          component="img"
          src={remoteSrc}
          alt=""
          onError={() => setRemoteFailed(true)}
          loading="lazy"
          referrerPolicy="no-referrer"
          sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : localMark || initials}
    </Box>
  );
}

function SummaryPill({ label, value }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        px: 1.25,
        py: 0.75,
        borderRadius: 1.5,
        bgcolor: '#f8fafc',
        border: '1px solid #e8ecf1',
        textAlign: 'center',
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, fontSize: '0.62rem', display: 'block', lineHeight: 1.2 }}>
        {label}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 800, lineHeight: 1.2, color: POSTURE_COLORS.blueDark }}>
        {value ?? 0}
      </Typography>
    </Box>
  );
}

function MetricIconBadge({ icon: Icon, value, label, active = false, activeColor = POSTURE_COLORS.orange }) {
  return (
    <Tooltip title={`${value} ${label}`}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.35,
          px: 0.6,
          py: 0.25,
          borderRadius: 1,
          bgcolor: active ? `${activeColor}14` : '#eef2f6',
          color: active ? activeColor : POSTURE_COLORS.grey,
          minWidth: 34,
          justifyContent: 'center',
        }}
      >
        <Icon sx={{ fontSize: 14 }} />
        <Typography component="span" sx={{ fontWeight: 700, fontSize: '0.68rem', lineHeight: 1 }}>
          {value ?? 0}
        </Typography>
      </Box>
    </Tooltip>
  );
}

function ApplicationAccessRow({ app }) {
  const privCount = app.privilegedEntitlements ?? 0;
  const entCount = app.entitlements ?? 0;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        py: 0.65,
        borderBottom: '1px solid #eef2f6',
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      <ApplicationLogo
        name={app.applicationName}
        icon={app.applicationIcon || app.icon}
        color={app.applicationColor || app.color}
      />
      <Typography
        variant="body2"
        sx={{
          flex: 1,
          minWidth: 0,
          fontWeight: 600,
          fontSize: '0.8rem',
          lineHeight: 1.25,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {app.applicationName}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
        <MetricIconBadge
          icon={GroupsOutlinedIcon}
          value={entCount}
          label="entitlements"
          active={entCount > 0}
          activeColor={POSTURE_COLORS.blue}
        />
        <MetricIconBadge
          icon={AdminPanelSettingsOutlinedIcon}
          value={privCount}
          label="privileged entitlements"
          active={privCount > 0}
          activeColor={POSTURE_COLORS.orange}
        />
      </Box>
    </Box>
  );
}

export default function AccessDetailsPostureCard({ accessDetails, animateIndex = 9 }) {
  if (!accessDetails) return null;

  const byApplication = Array.isArray(accessDetails.byApplication) ? accessDetails.byApplication : [];
  const linkedAccounts = Array.isArray(accessDetails.linkedAccounts) ? accessDetails.linkedAccounts : [];
  // Prefer app-rolled inventory (matches summary totals); fall back to account rows.
  const rows = byApplication.length > 0
    ? byApplication
    : linkedAccounts.map((account) => ({
        applicationId: account.applicationId,
        applicationName: account.applicationName,
        applicationIcon: account.applicationIcon,
        applicationColor: account.applicationColor,
        entitlements: account.entitlements,
        privilegedEntitlements: account.privilegedEntitlements,
      }));

  const totals = {
    accounts: accessDetails.totalAccounts ?? linkedAccounts.length ?? 0,
    entitlements: accessDetails.totalEntitlements ?? 0,
    privilegedEntitlements: accessDetails.privilegedEntitlementCount ?? accessDetails.privilegedCount ?? 0,
  };

  return (
    <Paper sx={{ ...postureCardAnimate(animateIndex), ...detailCardSx }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, fontSize: '0.95rem' }}>
        {ACCESS_DETAILS_TITLE}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, mb: 1.25 }}>
        {ACCESS_DETAILS_FIELDS.map(({ key, label }) => (
          <SummaryPill key={key} label={label} value={totals[key]} />
        ))}
      </Box>

      <Box
        sx={{
          borderRadius: 1.5,
          border: '1px solid #e8ecf1',
          bgcolor: '#f8fafc',
          px: 1.25,
          py: 0.5,
        }}
      >
        {rows.length === 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ py: 0.5, display: 'block' }}>
            No linked accounts.
          </Typography>
        ) : (
          rows.map((app, i) => (
            <ApplicationAccessRow
              key={`${app.applicationId || app.applicationName}-${i}`}
              app={app}
            />
          ))
        )}
      </Box>
    </Paper>
  );
}
