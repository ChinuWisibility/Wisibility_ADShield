import React, { useCallback, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Typography, Button, Avatar, Chip, Alert, Link as MuiLink,
  IconButton, Tooltip, CircularProgress,
} from '@mui/material';
import {
  ArrowBack,
  Security,
  SupervisorAccount,
  LockOutlined,
  BusinessOutlined,
  EmailOutlined,
  EventOutlined,
  PhotoCameraOutlined,
} from '@mui/icons-material';
import { looksLikeEmployeeIdOnlyLabel } from './identityDetailHelpers';
import {
  CATALOG,
  catalogLabelSx,
  lifecycleTone,
  riskTone,
} from './catalogTheme';
import { useIdentityProfilePhoto } from './useIdentityProfilePhoto';
import ManageProfilePhotoDialog from './ManageProfilePhotoDialog';
import { resolveApplicationIconSrc } from '../../../components/applications/ApplicationIconPicker';

function StackedMeta({ icon, label, children }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, minWidth: 0, alignItems: 'flex-start' }}>
      <Box sx={{ color: CATALOG.inkFaint, display: 'flex', mt: 0.15, flexShrink: 0 }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: '0.68rem',
            fontWeight: 600,
            letterSpacing: '0.02em',
            color: CATALOG.inkFaint,
            lineHeight: 1.2,
            mb: 0.35,
          }}
        >
          {label}
        </Typography>
        <Box sx={{ minWidth: 0 }}>{children}</Box>
      </Box>
    </Box>
  );
}

function HeaderAppIcon({ name, icon, color, size = 34 }) {
  const src = resolveApplicationIconSrc(icon);
  const initial = String(name || '?').charAt(0).toUpperCase();
  return (
    <Tooltip title={name || 'Application'} arrow>
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: 1.25,
          border: `1px solid ${CATALOG.border}`,
          bgcolor: src ? '#fff' : (color || '#DBEAFE'),
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
          flexShrink: 0,
          p: src ? 0.4 : 0,
          fontSize: size * 0.38,
          fontWeight: 800,
          color: color || CATALOG.accent,
          boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
        }}
      >
        {src ? (
          <Box
            component="img"
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          initial
        )}
      </Box>
    </Tooltip>
  );
}

/** Unique applications this identity has access to (from linked accounts). */
function appsFromAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const acc of accounts) {
    if (acc?.isActive === false) continue;
    const id = acc.applicationId != null ? String(acc.applicationId) : '';
    const name = String(acc.applicationName || '').trim();
    const key = id || name.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: key,
      name: name || 'Application',
      icon: acc.applicationIcon || acc.icon || null,
      color: acc.applicationColor || acc.color || null,
    });
  }
  return out;
}

export default function IdentityCatalogHeader({
  identity,
  accounts = [],
  bannerTitle,
  managerLinkLabel,
  managerProfileId,
  onBack,
  onManagerNavigate,
  onPhotoUpdated,
}) {
  const identityId = identity?._id || identity?.id;
  const [manageOpen, setManageOpen] = useState(false);
  const {
    photoSrc, loading, uploading, error, hasPhoto, uploadPhoto, deletePhoto,
  } = useIdentityProfilePhoto(identityId, {
    enabled: Boolean(identityId),
    hasUploadedPhoto: Boolean(identity?.profilePhotoId || identity?.profilePhotoUrl),
    onChanged: onPhotoUpdated,
  });

  const accessApps = useMemo(() => appsFromAccounts(accounts), [accounts]);

  const openManage = useCallback(() => {
    if (uploading) return;
    setManageOpen(true);
  }, [uploading]);

  if (!identity) return null;

  const life = lifecycleTone(identity.lifecycleState);
  const risk = riskTone(identity.riskLevel);
  const empId = identity.employeeId || identity.attributes?.employeeId;
  const email = identity.email;
  const title = identity.title || 'No title';
  const department = identity.department || '—';
  const lastSynced = identity.lastSyncedAt
    ? new Date(identity.lastSyncedAt).toLocaleDateString()
    : 'Never';
  const initial = (bannerTitle || identity.displayName || 'U').charAt(0).toUpperCase();
  const showManager =
    Boolean(identity.managerResolutionStatus || managerProfileId || identity.isRoot);

  const managerNode = (() => {
    if (identity.managerResolutionStatus === 'resolved' && managerProfileId) {
      return (
        <MuiLink
          component={RouterLink}
          to={`/identities/${managerProfileId}`}
          onClick={onManagerNavigate}
          underline="hover"
          sx={{ fontWeight: 700, fontSize: '0.9rem', color: CATALOG.accent }}
        >
          {managerLinkLabel}
        </MuiLink>
      );
    }
    if (identity.managerResolutionStatus === 'root') {
      return (
        <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', color: CATALOG.inkFaint }}>
          No manager
        </Typography>
      );
    }
    if (identity.managerResolutionStatus === 'unresolved') {
      return (
        <Alert severity="warning" sx={{ py: 0, px: 1, display: 'inline-flex' }}>
          <Typography variant="caption" sx={{ fontWeight: 500 }}>
            Unresolved · {identity.managerKeyRaw || '—'}
          </Typography>
        </Alert>
      );
    }
    if (!identity.managerResolutionStatus && managerProfileId) {
      return (
        <MuiLink
          component={RouterLink}
          to={`/identities/${managerProfileId}`}
          onClick={onManagerNavigate}
          underline="hover"
          sx={{ fontWeight: 700, fontSize: '0.9rem', color: CATALOG.accent }}
        >
          {managerLinkLabel}
        </MuiLink>
      );
    }
    return (
      <Typography sx={{ fontWeight: 600, fontSize: '0.9rem', color: CATALOG.inkFaint }}>—</Typography>
    );
  })();

  return (
    <Box sx={{ mb: 2 }}>
      <Button
        startIcon={<ArrowBack />}
        onClick={onBack}
        size="small"
        sx={{
          mb: 1.25,
          textTransform: 'none',
          fontWeight: 600,
          color: CATALOG.inkMuted,
          px: 0.5,
          '&:hover': { bgcolor: 'transparent', color: CATALOG.accent },
        }}
      >
        Back to identities
      </Button>

      <Box
        sx={{
          position: 'relative',
          borderRadius: 2.5,
          border: `1px solid ${CATALOG.border}`,
          bgcolor: CATALOG.surface,
          boxShadow: CATALOG.cardShadow,
          overflow: 'hidden',
        }}
      >
        {/* App icons — connected to card top + status divider; curve only bottom-left */}
        {accessApps.length > 0 ? (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              right: { xs: 0, lg: 220 },
              zIndex: 2,
              height: 52,
              display: 'inline-flex',
              flexWrap: 'nowrap',
              alignItems: 'center',
              gap: 0.85,
              pl: 2.5,
              pr: 1.25,
              m: 0,
              /* no top curve — top edge joins the card top line */
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
              borderBottomRightRadius: 0,
              borderBottomLeftRadius: 40,
              borderLeft: `1px solid ${CATALOG.border}`,
              borderBottom: `1px solid ${CATALOG.border}`,
              borderTop: 'none',
              borderRight: 'none',
              bgcolor: '#F8FAFC',
              maxWidth: { xs: '78%', sm: '52%', lg: '42%' },
              overflowX: 'auto',
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
            aria-label="Linked applications"
          >
            {accessApps.map((app) => (
              <HeaderAppIcon
                key={app.id}
                name={app.name}
                icon={app.icon}
                color={app.color}
                size={34}
              />
            ))}
          </Box>
        ) : null}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 220px' },
            gap: 0,
          }}
        >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            position: 'relative',
            borderRight: { lg: `1px solid ${CATALOG.border}` },
            borderBottom: { xs: `1px solid ${CATALOG.border}`, lg: 'none' },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              gap: 2.25,
              p: { xs: 2.25, sm: 2.75 },
              pr: {
                xs: 2.25,
                sm: accessApps.length > 0 ? 3 : 2.75,
              },
              alignItems: 'flex-start',
              minWidth: 0,
            }}
          >
          <Box sx={{ position: 'relative', flexShrink: 0 }}>
            <Tooltip title="Manage profile photo">
              <IconButton
                onClick={openManage}
                disabled={uploading}
                aria-label="Manage profile photo"
                sx={{
                  p: 0,
                  borderRadius: '50%',
                  '&:hover .profile-photo-overlay': { opacity: 1 },
                }}
              >
                <Avatar
                  src={photoSrc || undefined}
                  imgProps={{ style: { objectFit: 'cover' } }}
                  sx={{
                    width: 76,
                    height: 76,
                    bgcolor: '#1E3A5F',
                    fontSize: '1.85rem',
                    fontWeight: 700,
                  }}
                >
                  {!photoSrc && !loading ? initial : null}
                </Avatar>
                <Box
                  className="profile-photo-overlay"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    bgcolor: 'rgba(15, 23, 42, 0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: uploading || loading ? 1 : 0,
                    transition: 'opacity 0.2s ease',
                    pointerEvents: 'none',
                  }}
                >
                  {uploading || loading ? (
                    <CircularProgress size={24} sx={{ color: '#fff' }} />
                  ) : (
                    <PhotoCameraOutlined sx={{ color: '#fff', fontSize: 24 }} />
                  )}
                </Box>
              </IconButton>
            </Tooltip>
          </Box>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            {error ? (
              <Typography variant="caption" color="error" sx={{ display: 'block', mb: 0.75 }}>
                {error}
              </Typography>
            ) : null}

            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.75 }}>
                <Typography
                  sx={{
                    fontWeight: 800,
                    fontSize: { xs: '1.4rem', sm: '1.6rem' },
                    letterSpacing: '-0.025em',
                    color: CATALOG.ink,
                    lineHeight: 1.1,
                  }}
                >
                  {bannerTitle}
                </Typography>
                <Chip
                  label="IDENTITY"
                  size="small"
                  sx={{
                    height: 22,
                    fontSize: '0.62rem',
                    fontWeight: 800,
                    letterSpacing: '0.06em',
                    bgcolor: '#DBEAFE',
                    color: CATALOG.accent,
                    border: 'none',
                  }}
                />
                {empId ? (
                  <Chip
                    icon={<LockOutlined sx={{ fontSize: '13px !important' }} />}
                    label={empId}
                    size="small"
                    variant="outlined"
                    sx={{
                      height: 22,
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      bgcolor: CATALOG.surface,
                      borderColor: CATALOG.borderStrong,
                      color: CATALOG.inkMuted,
                      '& .MuiChip-icon': { color: CATALOG.inkFaint },
                    }}
                  />
                ) : null}
              </Box>

              <Typography sx={{ fontSize: '0.95rem', color: CATALOG.inkMuted, fontWeight: 500 }}>
                {title}
              </Typography>

              {looksLikeEmployeeIdOnlyLabel(identity.displayName) &&
                bannerTitle !== String(identity.displayName || '').trim() &&
                empId && (
                  <Typography variant="caption" sx={{ display: 'block', color: CATALOG.inkFaint, mt: 0.5 }}>
                    Source label: {identity.displayName}
                  </Typography>
                )}
            </Box>

            <Box
              sx={{
                mt: 2.25,
                display: 'grid',
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(3, minmax(0, 1fr))',
                },
                gap: { xs: 1.5, sm: 2 },
                maxWidth: 720,
              }}
            >
              <StackedMeta icon={<BusinessOutlined sx={{ fontSize: 18 }} />} label="Department">
                <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: CATALOG.ink }}>
                  {department}
                </Typography>
              </StackedMeta>
              <StackedMeta icon={<EmailOutlined sx={{ fontSize: 18 }} />} label="Email">
                <Typography
                  sx={{
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    color: CATALOG.ink,
                    wordBreak: 'break-all',
                  }}
                >
                  {email || '—'}
                </Typography>
              </StackedMeta>
              {showManager ? (
                <StackedMeta icon={<SupervisorAccount sx={{ fontSize: 18 }} />} label="Manager">
                  {managerNode}
                </StackedMeta>
              ) : null}
            </Box>
          </Box>
          </Box>
        </Box>

        <Box
          sx={{
            p: { xs: 2.25, sm: 2.5 },
            bgcolor: CATALOG.surface,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            justifyContent: 'center',
          }}
        >
          <Box>
            <Typography sx={{ ...catalogLabelSx, mb: 1 }}>Status</Typography>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
              <Chip
                label={identity.lifecycleState || 'UNKNOWN'}
                size="small"
                sx={{
                  height: 26,
                  fontWeight: 700,
                  fontSize: '0.7rem',
                  bgcolor: life.color,
                  color: '#fff',
                  border: 'none',
                }}
              />
              <Chip
                icon={<Security sx={{ fontSize: '14px !important' }} />}
                label={`Risk · ${identity.riskLevel || 'LOW'}`}
                size="small"
                variant="outlined"
                sx={{
                  height: 26,
                  fontWeight: 700,
                  fontSize: '0.7rem',
                  bgcolor: risk.bg,
                  color: risk.color,
                  borderColor: risk.border,
                  '& .MuiChip-icon': { color: risk.color },
                }}
              />
            </Box>
          </Box>

          <Box>
            <Typography sx={{ ...catalogLabelSx, mb: 0.65 }}>Last synced</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <EventOutlined sx={{ fontSize: 16, color: CATALOG.inkFaint }} />
              <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: CATALOG.ink }}>
                {lastSynced}
              </Typography>
            </Box>
          </Box>
        </Box>
        </Box>
      </Box>

      <ManageProfilePhotoDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        photoSrc={photoSrc}
        uploading={uploading}
        hasPhoto={hasPhoto}
        onSaveFile={uploadPhoto}
        onRemove={deletePhoto}
      />
    </Box>
  );
}
