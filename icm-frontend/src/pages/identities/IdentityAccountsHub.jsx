import React, { useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Box, ButtonBase, Typography } from '@mui/material';
import {
  HowToReg as CorrelatedIcon,
  PersonOff as UncorrelatedIcon,
} from '@mui/icons-material';
import { palette } from '../../theme/palette';

const accent = palette.brand?.primary || '#2563EB';
const track = '#E8EEF5';
const surface = palette.bg?.secondary || '#FFFFFF';

/** Accounts sub-tabs (one page): Correlated | Uncorrelated */
export const ACCOUNT_SUB_TABS = [
  {
    id: 'correlated',
    label: 'Correlated',
    path: '/identities/accounts/correlated',
    icon: CorrelatedIcon,
  },
  {
    id: 'uncorrelated',
    label: 'Uncorrelated',
    path: '/identities/accounts/uncorrelated',
    icon: UncorrelatedIcon,
  },
];

/** Entitlements sub-tabs (one page): Correlated | Uncorrelated */
export const ENTITLEMENT_SUB_TABS = [
  {
    id: 'correlated',
    label: 'Correlated',
    path: '/identities/accounts/entitlements/correlated',
    icon: CorrelatedIcon,
  },
  {
    id: 'uncorrelated',
    label: 'Uncorrelated',
    path: '/identities/accounts/entitlements/uncorrelated',
    icon: UncorrelatedIcon,
  },
];

export function correlationSummarySectionFromPath(pathname) {
  if (pathname.includes('/entitlements')) return 'entitlements';
  if (pathname.includes('/duplicates')) return 'duplicates';
  return 'accounts';
}

function accountSubIndex(pathname) {
  if (pathname.includes('/uncorrelated') || pathname.includes('/orphans')) return 1;
  return 0;
}

function entitlementSubIndex(pathname) {
  if (pathname.includes('/uncorrelated')) return 1;
  return 0;
}

/**
 * Browser-tab style switcher with Chrome scoop curves on the active tab.
 */
function CorrelationSubTabs({ tabs, value, onChange }) {
  const scoop = 12;

  return (
    <Box
      role="tablist"
      aria-label="Correlation status"
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
              // Chrome-style concave scoops (radial — reliably visible)
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
 * Correlation Summary hub — section nav is in the sidebar.
 * Correlated | Uncorrelated use browser-style folder tabs.
 */
export default function IdentityAccountsHub() {
  const location = useLocation();
  const navigate = useNavigate();
  const section = useMemo(
    () => correlationSummarySectionFromPath(location.pathname),
    [location.pathname],
  );
  const showSubs = section === 'accounts' || section === 'entitlements';

  return (
    <Box sx={{ width: '100%' }}>
      {section === 'accounts' ? (
        <CorrelationSubTabs
          tabs={ACCOUNT_SUB_TABS}
          value={accountSubIndex(location.pathname)}
          onChange={(_e, next) => {
            const tab = ACCOUNT_SUB_TABS[next];
            if (tab) navigate(tab.path);
          }}
        />
      ) : null}

      {section === 'entitlements' ? (
        <CorrelationSubTabs
          tabs={ENTITLEMENT_SUB_TABS}
          value={entitlementSubIndex(location.pathname)}
          onChange={(_e, next) => {
            const tab = ENTITLEMENT_SUB_TABS[next];
            if (tab) navigate(tab.path);
          }}
        />
      ) : null}

      <Box
        sx={
          showSubs
            ? {
                bgcolor: surface,
                border: `1px solid ${palette.border.default}`,
                borderRadius: '0 0 12px 12px',
                mt: '-1px',
                position: 'relative',
                zIndex: 1,
                '& > .MuiBox-root > .MuiPaper-root': {
                  border: 'none',
                  borderRadius: 0,
                  boxShadow: 'none',
                },
                px: 2,
                pt: 2.5,
                pb: 2,
                overflow: 'hidden',
              }
            : undefined
        }
      >
        <Outlet context={{ embeddedInCorrelationSummary: true }} />
      </Box>
    </Box>
  );
}
