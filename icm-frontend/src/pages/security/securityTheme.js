/** Security Center workspace chrome (Defender-style operational UI). */

export const securityWorkspacePaperSx = {
  borderRadius: 2,
  border: "1px solid",
  borderColor: "divider",
  bgcolor: "background.paper",
  overflow: "hidden",
};

export const securityPageHeaderSx = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 2,
  flexWrap: "wrap",
  mb: 2,
};

/** Scan Center secondary text: black ink shades (borders/surfaces stay theme defaults). */
export const SCAN_CENTER_INK = {
  primary: "#0a0a0a",
  secondary: "#1f1f1f",
  muted: "#2e2e2e",
  soft: "#3a3a3a",
};

/** Apply under Scan Center root — secondary text only. */
export const scanCenterRootSx = {
  color: SCAN_CENTER_INK.primary,
  "& .MuiTypography-colorTextSecondary, & .MuiFormHelperText-root": {
    color: `${SCAN_CENTER_INK.muted} !important`,
  },
  "& .MuiInputLabel-root": {
    color: `${SCAN_CENTER_INK.soft} !important`,
  },
};

export const SEVERITY_COLORS = {
  critical: { main: "#b71c1c", bg: "rgba(183, 28, 28, 0.12)" },
  high: { main: "#e65100", bg: "rgba(230, 81, 0, 0.12)" },
  medium: { main: "#f9a825", bg: "rgba(249, 168, 37, 0.14)" },
  low: { main: "#2e7d32", bg: "rgba(46, 125, 50, 0.12)" },
  unknown: { main: "#616161", bg: "rgba(97, 97, 97, 0.1)" },
  "not defined": { main: "#757575", bg: "rgba(117, 117, 117, 0.12)" },
};
