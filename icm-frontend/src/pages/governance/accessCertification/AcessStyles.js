// ✅ Shared SC-style design tokens for MUI sx (no CSS file needed)
// Muted corporate palette (governance-style): dusty blues, sage, ochre, dusty rose — not vibrant.

export const AC_PALETTE = {
  pageBg: "#EEF1F5",
  cardBg: "#FFFFFF",
  surface: "#E6EAEF",
  surfaceMuted: "#D9DEE6",
  border: "#D0D5DD",
  text: "#1E293B",
  textMuted: "#5C6578",
  textLight: "#7A8496",
  accent: "#334E68",
  accentHover: "#2A4156",
  accentSoft: "#E4EAF0",
  onAccent: "#FFFFFF",
  tooltipBg: "#2D3748",
};

/** Charts — low-chroma, boardroom-friendly */
export const DASHBOARD_CHART = {
  donut: {
    Active: { fill: "#4A6FA5", stroke: "#FFFFFF" },
    Complete: { fill: "#6B8E7D", stroke: "#FFFFFF" },
    Expire: { fill: "#9A6565", stroke: "#FFFFFF" },
  },
  bar: ["#4A6FA5", "#B89B72", "#9A7B62", "#7D8FA3", "#8B7355", "#6B8E7D", "#8A7E9A"],
  areaGradient: {
    stroke: "#3D5A73",
    stopHigh: "rgba(61, 90, 115, 0.14)",
    stopLow: "rgba(61, 90, 115, 0)",
  },
};

/** Full-page shell */
export const DASHBOARD_PAGE = {
  maxWidth: 1680,
  background: "linear-gradient(180deg, #ECEFF3 0%, #EEF1F5 40%, #E9EDF2 100%)",
  cardShadow: "0 1px 2px rgba(30, 41, 59, 0.04), 0 6px 18px -4px rgba(30, 41, 59, 0.06)",
  cardShadowSubtle: "0 1px 2px rgba(30, 41, 59, 0.04)",
  heroBarGradient: "linear-gradient(90deg, #2d4a5e 0%, #3d5a73 45%, #5a6f82 100%)",
  borderTint: "rgba(51, 78, 104, 0.1)",
};

/**
 * KPI snapshot — white card + thin bottom accent (reference layout).
 */
export const KPI_CARD_STYLES = {
  primary: {
    bottomBar: "#3D5A73",
    border: "rgba(30, 41, 59, 0.08)",
    title: "#64748B",
    value: "#1E293B",
    iconBg: "#E8EDF2",
    iconColor: "#3D5A73",
  },
  warning: {
    bottomBar: "#B8956A",
    border: "rgba(30, 41, 59, 0.08)",
    title: "#64748B",
    value: "#1E293B",
    iconBg: "#F2EBE0",
    iconColor: "#8F7349",
  },
  error: {
    bottomBar: "#9A6565",
    border: "rgba(30, 41, 59, 0.08)",
    title: "#64748B",
    value: "#1E293B",
    iconBg: "#F0E6E6",
    iconColor: "#8A5555",
  },
  success: {
    bottomBar: "#6B8E7D",
    border: "rgba(30, 41, 59, 0.08)",
    title: "#64748B",
    value: "#1E293B",
    iconBg: "#E6EEE9",
    iconColor: "#4F6B5C",
  },
};

export const DECISION_COLORS = {
  Approved: { text: "#3D5A48", bg: "#E8F0EA", border: "#A8C4B0" },
  Revoked: { text: "#6B4545", bg: "#F3E9E9", border: "#D4B0B0" },
  Revoking: { text: "#9A3412", bg: "#FFF7ED", border: "#FED7AA" },
  Pending: { text: "#6B5340", bg: "#F5EFE6", border: "#D9C4A8" },
  Delegate: { text: "#3D4F68", bg: "#E8EDF4", border: "#A8B8D4" },
  Exception: { text: "#5C6578", bg: "#EEF1F4", border: "#C5CCD6" },
};

export const STATUS_BADGE_COLORS = {
  Active: { text: "#2F4A5E", bg: "#E4EBF2", border: "#8FA8BC" },
  Staged: { text: "#4A4458", bg: "#ECEAF2", border: "#B8B0C8" },
  Expired: { text: "#5C3D3D", bg: "#F3E8E8", border: "#C9A0A0" },
  Completed: { text: "#3D5346", bg: "#E6F0E9", border: "#9BB8A4" },
  Pending: { text: "#5C4A38", bg: "#F5EFE6", border: "#D4C4A8" },
  EndPhase: { text: "#5C4A38", bg: "#F5EFE6", border: "#D4C4A8" },
  Closed: { text: "#4A5568", bg: "#EEF1F4", border: "#B8C0CC" },
  Draft: { text: "#4A5568", bg: "#EEF1F4", border: "#B8C0CC" },
};

export const sectionBox = {
  background: AC_PALETTE.surface,
  border: `1px solid ${AC_PALETTE.border}`,
  borderRadius: "8px",
  padding: "20px 24px",
  marginBottom: "24px",
};

export const sectionTitle = {
  fontSize: "16px",
  fontWeight: 600,
  color: AC_PALETTE.accent,
  borderLeft: `4px solid ${AC_PALETTE.accent}`,
  paddingLeft: "8px",
  marginBottom: "14px",
};

export const fieldLabel = {
  fontSize: "13px",
  fontWeight: 500,
  color: AC_PALETTE.textMuted,
  marginBottom: "4px",
  display: "block",
};

export const summaryLabel = {
  fontSize: "14px",
  fontWeight: 600,
  marginBottom: "2px",
};

export const summaryValue = {
  fontSize: "14px",
  color: AC_PALETTE.text,
  marginBottom: "10px",
};

export const emailBox = {
  border: `1px solid ${AC_PALETTE.border}`,
  background: AC_PALETTE.cardBg,
  borderRadius: "8px",
  padding: "16px",
  fontSize: "14px",
  color: AC_PALETTE.text,
  lineHeight: 1.6,
};
