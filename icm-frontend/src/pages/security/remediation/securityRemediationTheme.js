/**
 * Theme keys for AD Security Remediation cards (category + feature).
 * Reuses Data Hygiene palette conventions without mutating hygiene themes.
 */
export const SECURITY_REMEDIATION_THEME = {
  user_security: {
    main: "#576d85",
    light: "#f4f7fa",
    dark: "#2e3d4d",
    muted: "#dde4ec",
    gradient: "linear-gradient(135deg, #576d85 0%, #455870 100%)",
    icon: "👤",
    description: "User account security posture",
  },
  privileged_access: {
    main: "#916b70",
    light: "#faf6f6",
    dark: "#4a3538",
    muted: "#ebe0e1",
    gradient: "linear-gradient(135deg, #916b70 0%, #735658 100%)",
    icon: "⚠️",
    description: "Privileged access findings",
  },
  group_security: {
    main: "#5a8462",
    light: "#f3f8f4",
    dark: "#2f4a35",
    muted: "#dce8df",
    gradient: "linear-gradient(135deg, #5a8462 0%, #476b4f 100%)",
    icon: "👥",
    description: "Group intelligence findings",
  },
  kerberos_security: {
    main: "#2f6f77",
    light: "#f2fafb",
    dark: "#163b40",
    muted: "#d6eaed",
    gradient: "linear-gradient(135deg, #2f6f77 0%, #24575d 100%)",
    icon: "🔑",
    description: "Kerberos and delegation findings",
  },
  acl_intelligence: {
    main: "#756d8f",
    light: "#f7f6fa",
    dark: "#3d384d",
    muted: "#e6e4eb",
    gradient: "linear-gradient(135deg, #756d8f 0%, #5e5773 100%)",
    icon: "🛡️",
    description: "SID and ACL intelligence",
  },
  computer_security: {
    main: "#9a8858",
    light: "#faf8f2",
    dark: "#4d4530",
    muted: "#ebe6d4",
    gradient: "linear-gradient(135deg, #9a8858 0%, #7d6f47 100%)",
    icon: "💻",
    description: "Computer security findings",
  },
  _application: {
    main: "#4f6b82",
    light: "#f4f7fa",
    dark: "#2d3d4d",
    muted: "#dde5ec",
    gradient: "linear-gradient(135deg, #4f6b82 0%, #3f5668 100%)",
    icon: "🏢",
    description: "Application remediation progress",
  },
  _default: {
    main: "#636d82",
    light: "#f6f7f9",
    dark: "#353a45",
    muted: "#e0e3e8",
    gradient: "linear-gradient(135deg, #636d82 0%, #4f5668 100%)",
    icon: "📊",
    description: "Security remediation metric",
  },
};

/** Feature keys fall back to category theme or _default. */
export function resolveSecurityRemediationTheme(themeKey, categoryId) {
  if (SECURITY_REMEDIATION_THEME[themeKey]) return SECURITY_REMEDIATION_THEME[themeKey];
  if (categoryId && SECURITY_REMEDIATION_THEME[categoryId]) {
    return SECURITY_REMEDIATION_THEME[categoryId];
  }
  return SECURITY_REMEDIATION_THEME._default;
}

/** Registry for DataHygieneWidgetCard themeRegistry prop. */
export function buildSecurityRemediationThemeRegistry(featureKeys = []) {
  const registry = { ...SECURITY_REMEDIATION_THEME };
  for (const key of featureKeys) {
    if (!registry[key]) {
      registry[key] = { ...SECURITY_REMEDIATION_THEME._default, icon: "🔎" };
    }
  }
  return registry;
}
