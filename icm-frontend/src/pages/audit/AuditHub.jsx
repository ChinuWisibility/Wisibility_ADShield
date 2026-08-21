import React, { useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Box, ButtonBase, Typography } from '@mui/material';
import {
  Gavel as AuditLogIcon,
  DynamicFeed as AuditFeedIcon,
} from '@mui/icons-material';
import { palette } from '../../theme/palette';

const accent = palette.brand?.primary || '#2563EB';
const track = '#E8EEF5';
const surface = palette.bg?.secondary || '#FFFFFF';

/** Audit page sub-tabs: Audit Log | Audit Feed (under Reports) */
export const AUDIT_SUB_TABS = [
  {
    id: 'audit-log',
    label: 'Audit Log',
    path: '/reports/audit',
    icon: AuditLogIcon,
  },
  {
    id: 'audit-feed',
    label: 'Audit Feed',
    path: '/reports/activity',
    icon: AuditFeedIcon,
  },
];

function auditTabIndex(pathname) {
  if (pathname.includes('/activity') || pathname.endsWith('/feed')) return 1;
  return 0;
}

function AuditSubTabs({ tabs, value, onChange }) {
  const scoop = 12;

  return (
    <Box
      role="tablist"
      aria-label="Audit"
      sx={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: `${scoop + 2}px`,
        px: `${scoop + 4}px`,
        pt: 1,
        mb: 0,
        bgcolor: track,
        borderRadius: '12px 12px 0 0',
        border: `1px solid ${palette.border.default}`,
        borderBottom: 'none',
        overflow: 'visible',
      }}
    >
      {tabs.map((tab, index) => {
        const selected = value === index;
        const Icon = tab.icon;
        return (
          <ButtonBase
            key={tab.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(null, index)}
            disableRipple
            sx={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              px: 2.75,
              py: 1.25,
              mb: 0,
              minWidth: 168,
              borderRadius: selected ? `${scoop}px ${scoop}px 0 0` : '8px 8px 0 0',
              bgcolor: selected ? surface : 'transparent',
              color: selected ? accent : palette.text.secondary,
              fontWeight: selected ? 700 : 550,
              zIndex: selected ? 3 : 1,
              transition: 'color 0.15s ease, background-color 0.15s ease',
              '&:hover': {
                color: selected ? accent : palette.text.primary,
                bgcolor: selected ? surface : 'rgba(255,255,255,0.45)',
              },
              ...(selected
                ? {
                    '&::before, &::after': {
                      content: '""',
                      position: 'absolute',
                      bottom: 0,
                      width: scoop,
                      height: scoop,
                      bgcolor: 'transparent',
                      pointerEvents: 'none',
                      zIndex: 0,
                    },
                    '&::before': {
                      left: -scoop,
                      background: `radial-gradient(circle at top left, transparent ${scoop - 0.5}px, ${surface} ${scoop}px)`,
                    },
                    '&::after': {
                      right: -scoop,
                      background: `radial-gradient(circle at top right, transparent ${scoop - 0.5}px, ${surface} ${scoop}px)`,
                    },
                  }
                : {}),
            }}
          >
            <Icon sx={{ fontSize: 18, opacity: selected ? 1 : 0.7, position: 'relative', zIndex: 2 }} />
            <Typography
              component="span"
              sx={{
                position: 'relative',
                zIndex: 2,
                fontSize: '0.875rem',
                fontWeight: 'inherit',
                letterSpacing: '-0.01em',
                lineHeight: 1,
              }}
            >
              {tab.label}
            </Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}

/**
 * Audit board — Reports → Audit; page sub-tabs: Audit Log | Audit Feed.
 */
export default function AuditHub() {
  const location = useLocation();
  const navigate = useNavigate();
  const tabIndex = useMemo(
    () => auditTabIndex(location.pathname),
    [location.pathname],
  );

  return (
    <Box sx={{ width: '100%' }}>
      <Box sx={{ mb: 2 }}>
        <Typography
          variant="h5"
          sx={{ fontWeight: 700, color: palette.text.primary, letterSpacing: '-0.02em' }}
        >
          Audit
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          Platform request trail and user activity stream for compliance review.
        </Typography>
      </Box>

      <AuditSubTabs
        tabs={AUDIT_SUB_TABS}
        value={tabIndex}
        onChange={(_e, next) => {
          const tab = AUDIT_SUB_TABS[next];
          if (tab) navigate(tab.path);
        }}
      />

      <Box
        sx={{
          bgcolor: surface,
          border: `1px solid ${palette.border.default}`,
          borderRadius: '0 0 12px 12px',
          mt: '-1px',
          position: 'relative',
          zIndex: 1,
          p: 0,
          overflow: 'hidden',
        }}
      >
        <Outlet context={{ embeddedInAuditHub: true }} />
      </Box>
    </Box>
  );
}
