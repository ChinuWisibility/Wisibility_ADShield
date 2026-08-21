// Professional light color palette — SailPoint Blue theme
export const palette = {
  // Backgrounds
  bg: {
    primary: "#f8fafc", // Light gray - main background
    secondary: "#FFFFFF", // White - card surfaces
    sidebar: "#FFFFFF", // White - sidebar
    elevated: "#F1F5F9", // Hover states, elevated surfaces
    input: "#F8FAFC", // Input field backgrounds
  },

  // Brand
  brand: {
    primary: "#2563EB", // Professional blue
    primaryHover: "#1D4ED8",
    primaryLight: "#2563EB1A", // 10% opacity
    secondary: "#7C3AED", // Purple accent
  },

  // Status
  status: {
    success: "#16A34A",
    successBg: "#16A34A1A",
    warning: "#D97706",
    warningBg: "#D977061A",
    error: "#DC2626",
    errorBg: "#DC26261A",
    info: "#0891B2",
    infoBg: "#0891B21A",
  },

  // Risk levels
  risk: {
    critical: "#DC2626",
    high: "#DC2626", // Trust HIGH / risk High → red (aligned with status.error)
    medium: "#D97706", // Orange / yellow
    low: "#16A34A", // Green
  },

  // Text
  text: {
    primary: "#0F172A",
    secondary: "#64748B",
    disabled: "#94A3B8",
    link: "#2563EB",
  },

  // Borders
  border: {
    default: "#E2E8F0",
    light: "#E2E8F080",
    focus: "#2563EB",
  },

  // Chart colors
  chart: [
    "#2563EB",
    "#7C3AED",
    "#16A34A",
    "#D97706",
    "#DC2626",
    "#9333EA",
    "#0891B2",
    "#EA580C",
  ],
};
