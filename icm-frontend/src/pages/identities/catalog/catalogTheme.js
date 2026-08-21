/**
 * Identity catalog visual system — professional cyber / ops-console (light).
 * Dense telemetry, monospace labels, slate panels — stays on product brand blue.
 */

import { palette } from '../../../theme/palette';

export const CATALOG = {
  ink: '#0B1220',
  inkMuted: '#475569',
  inkFaint: '#64748B',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F5F9',
  surfaceTint: '#EEF4FF',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  accent: palette.brand?.primary || '#2563EB',
  accentDeep: '#1E3A5F',
  accentSoft: 'rgba(37, 99, 235, 0.08)',
  gridLine: 'rgba(15, 23, 42, 0.04)',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  radius: 12,
  cardShadow: '0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.04)',
};

export const catalogPageSx = {
  width: '100%',
  position: 'relative',
  backgroundColor: palette.bg?.primary || '#f8fafc',
  mx: { xs: -1, md: -1.5 },
  px: { xs: 1, md: 1.5 },
  pt: 0.5,
  pb: 3,
  borderRadius: 1,
};

export const catalogTabsPaperSx = {
  mb: 0,
  borderRadius: '12px 12px 0 0',
  border: `1px solid ${CATALOG.border}`,
  borderBottom: 'none',
  bgcolor: '#E8EEF5',
  boxShadow: 'none',
  overflow: 'visible',
  px: 1,
  pt: 1,
};

const scoop = 12;

export const catalogTabsSx = {
  minHeight: 48,
  px: 0,
  '& .MuiTabs-indicator': {
    display: 'none',
  },
  '& .MuiTabs-flexContainer': {
    alignItems: 'flex-end',
    gap: '4px',
  },
  '& .MuiTab-root': {
    position: 'relative',
    isolation: 'isolate',
    minHeight: 44,
    textTransform: 'none',
    fontWeight: 550,
    fontSize: '0.875rem',
    letterSpacing: '-0.01em',
    color: CATALOG.inkFaint,
    px: 1.75,
    py: 1.15,
    mr: 0,
    gap: 0.75,
    borderRadius: '8px 8px 0 0',
    bgcolor: 'transparent',
    transition: 'color 0.15s ease, background-color 0.15s ease',
    '&:hover': {
      color: CATALOG.ink,
      bgcolor: 'rgba(255,255,255,0.45)',
    },
    '&.Mui-selected': {
      color: CATALOG.accent,
      fontWeight: 700,
      bgcolor: CATALOG.surface,
      borderRadius: `${scoop}px ${scoop}px 0 0`,
      zIndex: 3,
      '& .MuiSvgIcon-root': { opacity: 1 },
      // Chrome-style concave scoops
      '&::before, &::after': {
        content: '""',
        position: 'absolute',
        bottom: 0,
        width: scoop,
        height: scoop,
        bgcolor: 'transparent',
        pointerEvents: 'none',
        zIndex: 1,
      },
      '&::before': {
        left: -scoop,
        borderBottomRightRadius: scoop,
        boxShadow: `${scoop / 2}px ${scoop / 2}px 0 ${scoop / 2}px ${CATALOG.surface}`,
      },
      '&::after': {
        right: -scoop,
        borderBottomLeftRadius: scoop,
        boxShadow: `-${scoop / 2}px ${scoop / 2}px 0 ${scoop / 2}px ${CATALOG.surface}`,
      },
    },
    '& .MuiSvgIcon-root': { fontSize: 18, opacity: 0.75 },
  },
};

export const catalogLabelSx = {
  fontSize: '0.7rem',
  fontWeight: 500,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: CATALOG.inkFaint,
  lineHeight: 1.35,
};

/** Field values in the dossier — readable, never bold/mono. */
export const catalogValueSx = {
  fontWeight: 400,
  fontSize: '0.9rem',
  lineHeight: 1.45,
  color: CATALOG.ink,
  wordBreak: 'break-word',
};

export const catalogPanelSx = {
  border: `1px solid ${CATALOG.border}`,
  borderRadius: `${CATALOG.radius}px`,
  bgcolor: CATALOG.surface,
  boxShadow: CATALOG.cardShadow,
  overflow: 'hidden',
};

export function riskTone(level) {
  const l = String(level || 'LOW').toUpperCase();
  if (l === 'CRITICAL' || l === 'HIGH') {
    return { color: palette.risk?.high || '#EA580C', bg: '#FFF7ED', border: '#FDBA74' };
  }
  if (l === 'MEDIUM' || l === 'MODERATE') {
    return { color: palette.risk?.medium || '#D97706', bg: '#FFFBEB', border: '#FDE68A' };
  }
  return { color: palette.risk?.low || '#16A34A', bg: '#F0FDF4', border: '#BBF7D0' };
}

export function lifecycleTone(state) {
  const s = String(state || '').toUpperCase();
  if (s === 'ACTIVE') return { color: '#166534', bg: '#DCFCE7', border: '#86EFAC' };
  if (s === 'TERMINATED' || s === 'LEAVER' || s === 'INACTIVE') {
    return { color: '#991B1B', bg: '#FEE2E2', border: '#FECACA' };
  }
  if (s === 'MOVER' || s === 'QUARANTINE' || s === 'NEW') {
    return { color: '#9A3412', bg: '#FFEDD5', border: '#FDBA74' };
  }
  return { color: CATALOG.inkMuted, bg: CATALOG.surfaceAlt, border: CATALOG.border };
}

/** Group HR keys into dossier sections for clearer scan. */
export function classifyHrField(key, label) {
  const k = String(key || '').toLowerCase().replace(/[\s_-]/g, '');
  const lbl = String(label || '').toLowerCase();
  if (/email|phone|mobile|location|country|city|address/.test(k) || /email|phone|location|country/.test(lbl)) {
    return 'contact';
  }
  if (/manager|department|title|division|costcenter|org|company|business/.test(k)
    || /manager|department|title|division|organization/.test(lbl)) {
    return 'org';
  }
  return 'identity';
}

export const HR_SECTION_META = {
  identity: {
    title: 'Profile summary',
    subtitle: 'Primary identifiers and profile fields',
    accent: '#2563EB',
    tint: 'rgba(37, 99, 235, 0.06)',
  },
  org: {
    title: 'Organization',
    subtitle: 'Role, department, and reporting line',
    accent: '#7C3AED',
    tint: 'rgba(124, 58, 237, 0.06)',
  },
  contact: {
    title: 'Contact & location',
    subtitle: 'Reachability and geographic attributes',
    accent: '#0E7490',
    tint: 'rgba(14, 116, 144, 0.06)',
  },
};
