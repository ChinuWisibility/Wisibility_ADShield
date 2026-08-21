import { createTheme, alpha } from "@mui/material/styles";
import { palette } from "./palette";

const sailpointTheme = createTheme({
  palette: {
    mode: "light",
    primary: { main: palette.brand.primary, light: "#60A5FA", dark: "#1D4ED8" },
    secondary: { main: palette.brand.secondary },
    error: { main: palette.status.error },
    warning: { main: palette.status.warning },
    success: { main: palette.status.success },
    info: { main: palette.status.info },
    background: {
      default: palette.bg.primary,
      paper: palette.bg.secondary,
    },
    text: {
      primary: palette.text.primary,
      secondary: palette.text.secondary,
      disabled: palette.text.disabled,
    },
    divider: palette.border.default,
  },

  typography: {
    /* ═══════════════════════════════════════════════════════════════════
       CENTRALIZED FONT — change ONLY this fontFamily to restyle the app.
       Plus Jakarta Sans: geometric, sharp, modern — used by leading
       SaaS / IAM / cybersecurity platforms (SailPoint-style).
       Fallback chain: Inter → Roboto → system sans-serif.
    ═══════════════════════════════════════════════════════════════════ */
    fontFamily: '"Plus Jakarta Sans", "Inter", "Roboto", "Helvetica Neue", sans-serif',

    h1: { fontSize: "2rem",     fontWeight: 800, letterSpacing: "-0.025em" },
    h2: { fontSize: "1.5rem",   fontWeight: 800, letterSpacing: "-0.02em"  },
    h3: { fontSize: "1.25rem",  fontWeight: 700, letterSpacing: "-0.015em" },
    h4: { fontSize: "1.125rem", fontWeight: 700, letterSpacing: "-0.01em"  },
    h5: { fontSize: "1rem",     fontWeight: 700, letterSpacing: "-0.01em"  },
    h6: { fontSize: "0.875rem", fontWeight: 700, letterSpacing: "-0.005em" },
    body1:    { fontSize: "0.875rem",  lineHeight: 1.65, fontWeight: 400 },
    body2:    { fontSize: "0.8125rem", lineHeight: 1.55, fontWeight: 400 },
    subtitle1:{ fontSize: "0.875rem",  fontWeight: 500, color: palette.text.secondary },
    subtitle2:{
      fontSize: "0.75rem", fontWeight: 700,
      color: palette.text.secondary,
      textTransform: "uppercase", letterSpacing: "0.09em",
    },
    caption: { fontSize: "0.75rem", fontWeight: 500, letterSpacing: "0.01em" },
    button:  { fontWeight: 700, textTransform: "none", letterSpacing: "0.01em" },
  },

  shape: { borderRadius: 8 },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: palette.bg.primary,
          scrollbarWidth: "thin",
          scrollbarColor: `${palette.border.default} transparent`,
          "&::-webkit-scrollbar": { width: 6 },
          "&::-webkit-scrollbar-track": { background: "transparent" },
          "&::-webkit-scrollbar-thumb": {
            background: palette.border.default,
            borderRadius: 3,
          },
        },
      },
    },

    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: "none",
          border: `1px solid ${palette.border.default}`,
        },
      },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          background: palette.bg.secondary,
          border: `1px solid ${palette.border.default}`,
          borderRadius: 12,
          boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
          transition: "border-color 0.2s ease, box-shadow 0.2s ease",
          "&:hover": {
            borderColor: alpha(palette.brand.primary, 0.4),
            boxShadow: "0 4px 16px rgba(15,23,42,0.10)",
          },
        },
      },
    },

    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 8, padding: "8px 20px", fontWeight: 700 },
        contained: {
          boxShadow: "none",
          "&:hover": {
            boxShadow: `0 4px 12px ${alpha(palette.brand.primary, 0.4)}`,
          },
        },
        outlined: {
          borderColor: palette.border.default,
          "&:hover": {
            borderColor: palette.brand.primary,
            background: alpha(palette.brand.primary, 0.08),
          },
        },
      },
    },

    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            backgroundColor: palette.bg.input,
            "& fieldset": { borderColor: palette.border.default },
            "&:hover fieldset": { borderColor: palette.border.focus },
            "&.Mui-focused fieldset": { borderColor: palette.brand.primary },
          },
        },
      },
    },

    MuiTableHead: {
      styleOverrides: {
        root: {
          "& .MuiTableCell-head": {
            backgroundColor: palette.bg.primary,
            color: palette.text.secondary,
            fontWeight: 700,
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            borderBottom: `2px solid ${palette.border.default}`,
          },
        },
      },
    },

    MuiTableRow: {
      styleOverrides: {
        root: {
          "&:hover": {
            backgroundColor: `${alpha(palette.brand.primary, 0.04)} !important`,
          },
          "& .MuiTableCell-root": {
            borderBottom: `1px solid ${palette.border.light}`,
          },
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 700, fontSize: "0.75rem" },
        colorSuccess: {
          backgroundColor: palette.status.successBg,
          color: palette.status.success,
        },
        colorWarning: {
          backgroundColor: palette.status.warningBg,
          color: palette.status.warning,
        },
        colorError: {
          backgroundColor: palette.status.errorBg,
          color: palette.status.error,
        },
        colorInfo: {
          backgroundColor: palette.status.infoBg,
          color: palette.status.info,
        },
      },
    },

    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: palette.bg.sidebar,
          borderRight: `1px solid ${palette.border.default}`,
        },
      },
    },

    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: palette.bg.secondary,
          borderBottom: `1px solid ${palette.border.default}`,
          boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
          color: palette.text.primary,
        },
      },
    },

    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          margin: "2px 8px",
          "&.Mui-selected": {
            backgroundColor: alpha(palette.brand.primary, 0.12),
            color: palette.brand.primary,
            "&:hover": { backgroundColor: alpha(palette.brand.primary, 0.16) },
            "& .MuiListItemIcon-root": { color: palette.brand.primary },
          },
          "&:hover": { backgroundColor: alpha(palette.brand.primary, 0.06) },
        },
      },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: palette.bg.secondary,
          border: `1px solid ${palette.border.default}`,
          boxShadow: "0 4px 12px rgba(15,23,42,0.12)",
          color: palette.text.primary,
          fontSize: "0.75rem",
          fontFamily: '"Plus Jakarta Sans", "Inter", sans-serif',
        },
        arrow: {
          color: palette.bg.secondary,
        },
      },
    },

    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: palette.bg.secondary,
          border: `1px solid ${palette.border.default}`,
          boxShadow: "0 20px 60px rgba(15,23,42,0.15)",
        },
      },
    },

    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: palette.bg.secondary,
          border: `1px solid ${palette.border.default}`,
          boxShadow: "0 4px 16px rgba(15,23,42,0.12)",
        },
      },
    },
  },
});

export default sailpointTheme;
