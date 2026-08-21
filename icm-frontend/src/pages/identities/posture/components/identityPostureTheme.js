export const POSTURE_COLORS = {
  green: '#22c55e',
  greenBg: '#f0fdf4',
  greenText: '#166534',
  orange: '#f59e0b',
  orangeBg: '#fffbeb',
  orangeText: '#b45309',
  red: '#ef4444',
  redBg: '#fef2f2',
  redText: '#dc2626',
  blue: '#3b82f6',
  blueDark: '#1e40af',
  blueBg: '#eff6ff',
  grey: '#64748b',
  greyLight: '#e2e8f0',
  border: '#e8ecf1',
  pageBg: '#f4f6f9',
};

export const postureCardSx = {
  borderRadius: 3,
  border: `1px solid ${POSTURE_COLORS.border}`,
  boxShadow: '0 2px 8px rgba(15, 23, 42, 0.06)',
  bgcolor: '#fff',
  height: '100%',
};

/** Staggered entrance animation for dashboard cards */
export function postureCardAnimate(index = 0) {
  const delay = Math.min(index * 0.08, 0.48);
  return {
    ...postureCardSx,
    animation: `postureFadeSlide 0.55s ease-out ${delay}s both`,
    '@keyframes postureFadeSlide': {
      from: { opacity: 0, transform: 'translateY(12px)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
  };
}

export const POSTURE_MATURITY_BADGE = {
  EXCELLENT: { color: POSTURE_COLORS.greenText, bg: POSTURE_COLORS.greenBg, border: '#bbf7d0' },
  GOOD: { color: POSTURE_COLORS.greenText, bg: POSTURE_COLORS.greenBg, border: '#bbf7d0' },
  FAIR: { color: POSTURE_COLORS.orangeText, bg: POSTURE_COLORS.orangeBg, border: '#fde68a' },
  POOR: { color: POSTURE_COLORS.redText, bg: POSTURE_COLORS.redBg, border: '#fecaca' },
};

export const POSTURE_INDICATOR_BADGE = {
  /** Higher overall ranking percentile is better */
  ABOVE_AVERAGE: { color: POSTURE_COLORS.greenText, bg: POSTURE_COLORS.greenBg, label: 'ABOVE AVERAGE' },
  BELOW_AVERAGE: { color: POSTURE_COLORS.orangeText, bg: POSTURE_COLORS.orangeBg, label: 'BELOW AVERAGE' },
  AVERAGE: { color: POSTURE_COLORS.orangeText, bg: POSTURE_COLORS.orangeBg, label: 'AVERAGE' },
  SAFE: { color: POSTURE_COLORS.greenText, bg: POSTURE_COLORS.greenBg, label: 'SAFE' },
  RISKY: { color: POSTURE_COLORS.redText, bg: POSTURE_COLORS.redBg, label: 'RISKY' },
  LOW: { color: '#4d7c0f', bg: '#ecfccb', label: 'LOW' },
  MEDIUM: { color: POSTURE_COLORS.orangeText, bg: POSTURE_COLORS.orangeBg, label: 'MEDIUM' },
  HIGH: { color: POSTURE_COLORS.redText, bg: POSTURE_COLORS.redBg, label: 'HIGH' },
};

/** Peer comparison: higher posture score is better. */
export const PEER_POSTURE_INDICATOR_BADGE = {
  ABOVE_AVERAGE: { color: POSTURE_COLORS.greenText, bg: POSTURE_COLORS.greenBg, label: 'BETTER THAN PEERS' },
  BELOW_AVERAGE: { color: POSTURE_COLORS.redText, bg: POSTURE_COLORS.redBg, label: 'BELOW PEERS' },
  AVERAGE: { color: POSTURE_COLORS.grey, bg: '#f1f5f9', label: 'SIMILAR TO PEERS' },
};

export function postureScoreColor(score) {
  if (score >= 80) return POSTURE_COLORS.green;
  if (score >= 40) return POSTURE_COLORS.orange;
  return POSTURE_COLORS.red;
}

export function postureMetricChipStyle(label) {
  const l = String(label || '').toLowerCase();
  if (['safe', 'optimal', 'good', 'excellent', 'strong'].includes(l)) {
    return { color: POSTURE_COLORS.greenText, bg: POSTURE_COLORS.greenBg };
  }
  if (l === 'low' || l === 'low risk') {
    return { color: '#4d7c0f', bg: '#ecfccb' };
  }
  if (l === 'medium' || l === 'medium risk' || l === 'moderate' || l === 'fair') {
    return { color: POSTURE_COLORS.orangeText, bg: POSTURE_COLORS.orangeBg };
  }
  if (['critical', 'poor', 'high', 'high risk', 'risky'].includes(l)) {
    return { color: POSTURE_COLORS.redText, bg: POSTURE_COLORS.redBg };
  }
  return { color: POSTURE_COLORS.orangeText, bg: POSTURE_COLORS.orangeBg };
}

export const postureTableHeaderCellSx = {
  fontWeight: 700,
  fontSize: '0.72rem',
  color: 'text.secondary',
  bgcolor: '#f8fafc',
  py: 1.25,
  borderBottom: '1px solid #e2e8f0',
};

export const postureTableBodyCellSx = {
  fontSize: '0.8rem',
  py: 1.25,
  borderBottom: '1px solid #f1f5f9',
};

export const postureTableTotalCellSx = {
  ...postureTableBodyCellSx,
  fontWeight: 800,
  bgcolor: '#f8fafc',
  borderBottom: 'none',
};

/** Animated horizontal progress bar used in peer comparison */
export const postureProgressBarSx = (pct, color, delay = 0) => ({
  height: 10,
  borderRadius: 5,
  bgcolor: POSTURE_COLORS.greyLight,
  overflow: 'hidden',
  '& .fill': {
    height: '100%',
    width: `${Math.max(0, Math.min(100, pct))}%`,
    bgcolor: color,
    borderRadius: 5,
    transition: 'width 0.9s cubic-bezier(0.4, 0, 0.2, 1)',
    transitionDelay: `${delay}s`,
  },
});

/** e.g. 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", 22 → "22nd" */
export function formatPercentileOrdinal(value) {
  const n = Math.round(Number(value) || 0);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
