import React, { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Typography, Button, Chip, IconButton, Tooltip, Menu, MenuItem, CircularProgress, ListItemIcon, ListItemText,
} from '@mui/material';
import {
  ArrowBack,
  Circle,
  PersonOutline,
  HubOutlined,
  CheckCircle,
  FavoriteBorder,
  ShieldOutlined,
  LinkOutlined,
  VerifiedUserOutlined,
  MoreHoriz,
  SyncOutlined,
  OpenInNewOutlined,
} from '@mui/icons-material';
import { CATALOG } from '../../identities/catalog/catalogTheme';
import { resolveApplicationIconSrc } from '../../../components/applications/ApplicationIconPicker';
import { applicationAPI } from '../../../services/api';
import {
  deriveHealth,
  healthLabel,
  riskLabel,
  relativeTime,
  formatConnector,
  toDisplayLabel,
} from './applicationHealthUtils';

function AppIcon({ application, size = 56 }) {
  const src = resolveApplicationIconSrc(application?.icon);
  const initial = String(application?.name || '?').charAt(0).toUpperCase();
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: 2.25,
        border: `1px solid ${CATALOG.border}`,
        bgcolor: src ? '#fff' : (application?.color || '#DBEAFE'),
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        flexShrink: 0,
        p: src ? 0.75 : 0,
        fontSize: size * 0.34,
        fontWeight: 800,
        color: application?.color || CATALOG.accent,
        boxShadow: '0 2px 6px rgba(15,23,42,0.08)',
      }}
    >
      {src ? (
        <Box component="img" src={src} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : initial}
    </Box>
  );
}

function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'active' || s === 'enabled') {
    return { color: '#059669', bg: 'rgba(5,150,105,0.1)', label: 'Active' };
  }
  if (s === 'inactive' || s === 'disabled') {
    return { color: '#64748B', bg: 'rgba(100,116,139,0.12)', label: 'Inactive' };
  }
  return { color: CATALOG.inkMuted, bg: CATALOG.surfaceAlt, label: toDisplayLabel(status, 'Unknown') };
}

function MetaPill({ icon, label, value }) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.65,
        px: 1.15,
        py: 0.5,
        borderRadius: 999,
        bgcolor: CATALOG.surfaceAlt,
      }}
    >
      {icon}
      <Typography sx={{ fontSize: '0.76rem', color: CATALOG.inkMuted, lineHeight: 1.3 }}>
        {label}: <Box component="span" sx={{ fontWeight: 700, color: CATALOG.ink }}>{value}</Box>
      </Typography>
    </Box>
  );
}

function StatCell({ label, value, first }) {
  return (
    <Box
      sx={{
        px: { xs: 1.5, md: 2 },
        py: 1,
        borderLeft: first ? 'none' : `1px solid ${CATALOG.border}`,
      }}
    >
      <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: CATALOG.inkFaint }}>
        {label}
      </Typography>
      <Typography sx={{ mt: 0.4, fontWeight: 800, fontSize: '1.3rem', color: CATALOG.ink, lineHeight: 1.15 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Typography>
    </Box>
  );
}

function SignalPill({ icon, label, value, color, first }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: { xs: 1.5, md: 2 },
        py: 1,
        borderLeft: first ? 'none' : `1px solid ${CATALOG.border}`,
      }}
    >
      <Box
        sx={{
          width: 30,
          height: 30,
          borderRadius: 1.5,
          display: 'grid',
          placeItems: 'center',
          bgcolor: `${color}14`,
          color,
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: CATALOG.inkFaint }}>
          {label}
        </Typography>
        <Typography sx={{ fontWeight: 750, fontSize: '0.85rem', color, lineHeight: 1.3 }} noWrap>
          {value}
        </Typography>
      </Box>
    </Box>
  );
}

export default function ApplicationViewHeader({
  application,
  summary,
  onBack,
}) {
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  const scores = useMemo(() => deriveHealth(summary), [summary]);
  const healthTone = healthLabel(scores?.health);
  const riskTone = scores ? riskLabel(scores.risk) : { label: '—', color: CATALOG.inkFaint };

  if (!application) return null;

  const status = statusTone(application.status);
  const appId = application._id || application.id;
  const lastSync = summary?.lastSyncedAt || application.lastSyncedAt || application.updatedAt;
  const owner = application.owner || application.ownerEmail || '—';
  const connector = formatConnector(summary?.connectorType || application.connectorType);
  const tags = Array.isArray(application.tags) && application.tags.length
    ? application.tags
    : [
      toDisplayLabel(application.type, null),
      application.environment || application.deployment || null,
    ].filter(Boolean);

  const users = Number(summary?.users ?? application.totalUsers) || 0;
  const privUsers = Number(summary?.privilegedUsers) || 0;
  const ents = Number(summary?.entitlements) || 0;
  const entitlementTypeCount = Number(summary?.entitlementTypeCount) || 0;

  const handleSync = async () => {
    if (syncing || !appId) return;
    setMenuAnchor(null);
    setSyncing(true);
    setSyncMsg(null);
    try {
      const isAd = String(application.connectorType || '').toUpperCase() === 'ACTIVE_DIRECTORY'
        || Boolean(application.connectionConfig?.ad);
      if (isAd) {
        await applicationAPI.syncAdUsers(appId, {});
      } else {
        await applicationAPI.syncConnector(appId, {});
      }
      setSyncMsg({ ok: true, text: 'Sync started' });
    } catch (err) {
      setSyncMsg({ ok: false, text: err?.response?.data?.message || err?.message || 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Box sx={{ mb: 2 }}>
      <Button
        startIcon={<ArrowBack />}
        onClick={onBack}
        size="small"
        sx={{
          mb: 1.1,
          textTransform: 'none',
          fontWeight: 600,
          color: CATALOG.inkMuted,
          px: 0.5,
          '&:hover': { bgcolor: 'transparent', color: CATALOG.accent },
        }}
      >
        Back to applications
      </Button>

      <Box
        sx={{
          borderRadius: 2.5,
          border: `1px solid ${CATALOG.border}`,
          bgcolor: '#fff',
          boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.04)',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ height: 4, bgcolor: healthTone.color }} />

        <Box sx={{ p: { xs: 2, md: 3 } }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', minWidth: 0, flex: 1 }}>
              <AppIcon application={application} />
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography
                    sx={{
                      fontWeight: 800,
                      fontSize: { xs: '1.4rem', md: '1.65rem' },
                      color: CATALOG.ink,
                      letterSpacing: '-0.03em',
                      lineHeight: 1.15,
                    }}
                  >
                    {application.name || 'Application'}
                  </Typography>
                  <Chip
                    size="small"
                    icon={<Circle sx={{ fontSize: '9px !important', color: `${status.color} !important` }} />}
                    label={status.label}
                    sx={{
                      height: 24,
                      fontWeight: 700,
                      bgcolor: status.bg,
                      color: status.color,
                      '& .MuiChip-icon': { ml: 0.75 },
                    }}
                  />
                </Box>

                {tags.length ? (
                  <Typography sx={{ mt: 0.55, fontSize: '0.8rem', color: CATALOG.inkFaint, fontWeight: 500 }}>
                    {tags.map((t) => toDisplayLabel(t, t)).join('  ·  ')}
                  </Typography>
                ) : null}

                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 0.85,
                    mt: 1.25,
                    alignItems: 'center',
                  }}
                >
                  <MetaPill
                    icon={<PersonOutline sx={{ fontSize: 15, color: CATALOG.inkFaint }} />}
                    label="Owner"
                    value={owner}
                  />
                  <MetaPill
                    icon={<HubOutlined sx={{ fontSize: 15, color: CATALOG.inkFaint }} />}
                    label="Connector"
                    value={connector}
                  />
                  <MetaPill
                    icon={<CheckCircle sx={{ fontSize: 15, color: '#059669' }} />}
                    label="Last Sync"
                    value={relativeTime(lastSync)}
                  />
                </Box>
              </Box>
            </Box>

            <Tooltip title="More actions">
              <IconButton
                size="small"
                onClick={(e) => setMenuAnchor(e.currentTarget)}
                sx={{ border: `1px solid ${CATALOG.border}`, borderRadius: 2, flexShrink: 0 }}
              >
                <MoreHoriz />
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={menuAnchor}
              open={Boolean(menuAnchor)}
              onClose={() => setMenuAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MenuItem
                component={RouterLink}
                to={`/applications/${appId}`}
                onClick={() => setMenuAnchor(null)}
              >
                <ListItemIcon><OpenInNewOutlined fontSize="small" /></ListItemIcon>
                <ListItemText>Manage Application</ListItemText>
              </MenuItem>
              <MenuItem onClick={handleSync} disabled={syncing}>
                <ListItemIcon>
                  {syncing ? <CircularProgress size={16} /> : <SyncOutlined fontSize="small" />}
                </ListItemIcon>
                <ListItemText>{syncing ? 'Syncing…' : 'Sync Now'}</ListItemText>
              </MenuItem>
            </Menu>
          </Box>

          {syncMsg ? (
            <Typography
              sx={{
                mt: 1.25,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: syncMsg.ok ? '#059669' : '#DC2626',
              }}
            >
              {syncMsg.text}
            </Typography>
          ) : null}
        </Box>

        <Box
          sx={{
            borderTop: `1px solid ${CATALOG.border}`,
            display: 'flex',
            flexWrap: 'wrap',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              flex: 1,
              minWidth: { xs: '100%', md: 'auto' },
              borderRight: { md: `1px solid ${CATALOG.border}` },
              bgcolor: '#FAFBFC',
            }}
          >
            <StatCell first label="Users" value={users} />
            <StatCell label="Privileged Users" value={privUsers} />
            <StatCell label="Entitlements" value={ents} />
            <StatCell label="Entitlement Types" value={entitlementTypeCount} />
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', flex: 1, minWidth: { xs: '100%', md: 'auto' } }}>
            <SignalPill
              first
              icon={<FavoriteBorder sx={{ fontSize: 16 }} />}
              label="Health"
              value={scores ? `${healthTone.label} · ${scores.health}%` : '—'}
              color={healthTone.color}
            />
            <SignalPill
              icon={<ShieldOutlined sx={{ fontSize: 16 }} />}
              label="Risk"
              value={riskTone.label}
              color={riskTone.color}
            />
            <SignalPill
              icon={<LinkOutlined sx={{ fontSize: 16 }} />}
              label="Correlation"
              value={scores ? `${scores.correlationRate}% Linked` : '—'}
              color="#2563EB"
            />
            <SignalPill
              icon={<VerifiedUserOutlined sx={{ fontSize: 16 }} />}
              label="Compliance"
              value={
                !scores
                  ? '—'
                  : scores.compliance >= 85
                    ? 'Compliant'
                    : scores.compliance >= 60
                      ? 'Watch'
                      : 'Non-compliant'
              }
              color={
                !scores
                  ? CATALOG.inkFaint
                  : scores.compliance >= 85
                    ? '#059669'
                    : '#D97706'
              }
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
