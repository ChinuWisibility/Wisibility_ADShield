/**
 * Design tokens for the Identity Access Map.
 * Dark "storm" palette: glass cards floating over a thunderstorm canvas, with
 * blue identity, purple applications, sky accounts, amber roles, red high-risk.
 */

export const GRAPH_FONT = `"Plus Jakarta Sans", "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

export const GRAPH_COLORS = {
  canvas: '#070B16',
  ink: '#EAF1FF',
  inkSoft: '#B3C4DE',
  inkFaint: '#8497B4',
  border: 'rgba(148, 178, 226, 0.22)',
  /** Dark glass card surfaces. */
  surface: 'rgba(15, 24, 43, 0.86)',
  surfaceAlt: 'rgba(24, 36, 60, 0.78)',
  surfaceRing: 'rgba(11, 18, 34, 0.95)',
  identity: '#60A5FA',
  identitySoft: 'rgba(96, 165, 250, 0.18)',
  application: '#A78BFA',
  applicationSoft: 'rgba(167, 139, 250, 0.18)',
  account: '#38D6EC',
  accountSoft: 'rgba(56, 214, 236, 0.14)',
  accountFill: 'rgba(20, 44, 66, 0.85)',
  entitlement: '#FBBF24',
  entitlementDot: '#FB923C',
  entitlementSoft: 'rgba(251, 191, 36, 0.16)',
  privileged: '#F87171',
  privilegedSoft: 'rgba(248, 113, 113, 0.16)',
  success: '#4ADE80',
  successSoft: 'rgba(74, 222, 128, 0.16)',
  warning: '#FBBF24',
  match: '#38D6EC',
  /** Dashed relationship links (app → account → role). */
  link: '#9FC6F0',
  /** Decorative orbit rings. */
  orbit: 'rgba(159, 198, 240, 0.45)',
};

export const RISK_TONES = {
  critical: { label: 'Critical', color: '#FCA5A5', bg: 'rgba(220,38,38,0.22)' },
  high: { label: 'High', color: '#FDBA74', bg: 'rgba(234,88,12,0.22)' },
  medium: { label: 'Medium', color: '#FCD34D', bg: 'rgba(217,119,6,0.22)' },
  low: { label: 'Low', color: '#86EFAC', bg: 'rgba(22,163,74,0.22)' },
};

export function riskTone(level, score) {
  const key = String(level || '').trim().toLowerCase();
  if (RISK_TONES[key]) return RISK_TONES[key];
  const n = Number(score);
  if (Number.isFinite(n)) {
    if (n >= 80) return RISK_TONES.critical;
    if (n >= 60) return RISK_TONES.high;
    if (n >= 30) return RISK_TONES.medium;
    return RISK_TONES.low;
  }
  return RISK_TONES.low;
}

/** Node footprints. */
export const NODE_SIZE = {
  identity: { w: 236, h: 288 },
  application: { w: 122, h: 122 },
  account: { w: 168, h: 60 },
  entitlement: { w: 168, h: 40 },
  /** Invisible branch hub kept for the application-rooted graph. */
  junction: { w: 10, h: 10 },
};

/** Centre-to-centre distances along each spoke. */
export const RING = {
  /** Identity → application ring (must clear the identity card corner + app circle). */
  appMin: 300,
  /** Application → account centre distance along the spoke. */
  accountOffset: 156,
  /** Account → role centre distance along the spoke. */
  entitlementOffset: 158,
  /** Legacy alias used by older layouts. */
  entitlementSpoke: 96,
  entitlementRingStep: 168,
};

/**
 * Node surface. No backdrop-filter on purpose — the graph renders dozens of
 * these at once and each blurred backdrop is re-composited on every pan/zoom
 * frame, which is the single largest source of canvas lag.
 */
export const GLASS_SURFACE = {
  background: 'linear-gradient(150deg, rgba(23, 35, 60, 0.96) 0%, rgba(12, 19, 35, 0.94) 100%)',
};

export const SOFT_SHADOW = '0 14px 34px rgba(2, 6, 18, 0.55), 0 0 0 1px rgba(148, 178, 226, 0.10)';
export const HOVER_SHADOW = '0 20px 46px rgba(2, 6, 18, 0.62), 0 0 22px rgba(96, 165, 250, 0.35)';

/** Dark storm canvas wash behind the (transparent) React Flow pane. */
export const STORM_CANVAS_BG = `
  radial-gradient(ellipse 92% 70% at 50% 36%, rgba(59, 86, 178, 0.22) 0%, transparent 60%),
  radial-gradient(ellipse 72% 62% at 78% 78%, rgba(124, 58, 237, 0.18) 0%, transparent 62%),
  linear-gradient(160deg, #0a0f20 0%, #070b16 55%, #04060d 100%)
`;

export const TYPE_ACCENT = {
  identity: GRAPH_COLORS.identity,
  application: GRAPH_COLORS.application,
  account: GRAPH_COLORS.account,
  entitlement: GRAPH_COLORS.entitlement,
};
