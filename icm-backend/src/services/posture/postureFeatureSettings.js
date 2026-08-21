export const DEFAULT_INACTIVE_USERS_DAYS = 90;
export const INACTIVE_USERS_DAYS_MIN = 1;
export const INACTIVE_USERS_DAYS_MAX = 3650;

/**
 * @param {unknown} value
 * @param {number} [fallback]
 */
export function normalizeInactiveUsersDays(
  value,
  fallback = DEFAULT_INACTIVE_USERS_DAYS,
) {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(INACTIVE_USERS_DAYS_MAX, Math.max(INACTIVE_USERS_DAYS_MIN, n));
}

/**
 * @param {object} [application]
 * @param {{ featureSettings?: object, inactiveDays?: number }} [options]
 */
export function resolveInactiveUsersDays(application, options = {}) {
  const fromRequest =
    options?.featureSettings?.inactive_users?.inactiveDays ??
    options?.inactiveDays;
  if (fromRequest != null && fromRequest !== "") {
    return normalizeInactiveUsersDays(fromRequest);
  }
  const fromApp = application?.securityScanSettings?.inactiveUsersDays;
  if (fromApp != null && fromApp !== "") {
    return normalizeInactiveUsersDays(fromApp);
  }
  return DEFAULT_INACTIVE_USERS_DAYS;
}

/**
 * @param {unknown} input
 */
export const DEFAULT_INACTIVE_COMPUTERS_DAYS = 90;

export const DEFAULT_UNSUPPORTED_OS_TOKENS = [
  "windows xp",
  "windows 7",
  "windows server 2003",
  "windows server 2008",
];

/** Generic mid-path OU name hints — never hardcode customer/lab DNs. */
export const DEFAULT_WORKSTATION_OU_PATTERNS = [
  "ou=workstations",
  "ou=desktop",
  "ou=desktops",
  "ou=laptops",
  "ou=clients",
];

export function normalizeInactiveComputersDays(
  value,
  fallback = DEFAULT_INACTIVE_COMPUTERS_DAYS,
) {
  return normalizeInactiveUsersDays(value, fallback);
}

export function resolveInactiveComputersDays(application, options = {}) {
  const fromRequest =
    options?.featureSettings?.inactive_computers?.inactiveDays ??
    options?.inactiveComputerDays;
  if (fromRequest != null && fromRequest !== "") {
    return normalizeInactiveComputersDays(fromRequest);
  }
  const fromApp = application?.securityScanSettings?.inactiveComputersDays;
  if (fromApp != null && fromApp !== "") {
    return normalizeInactiveComputersDays(fromApp);
  }
  return DEFAULT_INACTIVE_COMPUTERS_DAYS;
}

export function resolveUnsupportedOsTokens(application, options = {}) {
  const fromRequest = options?.featureSettings?.unsupported_os_versions?.osTokens;
  if (Array.isArray(fromRequest) && fromRequest.length) {
    return fromRequest.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  }
  const fromApp = application?.securityScanSettings?.unsupportedOsTokens;
  if (Array.isArray(fromApp) && fromApp.length) {
    return fromApp.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  }
  return [...DEFAULT_UNSUPPORTED_OS_TOKENS];
}

export function resolveWorkstationOuPatterns(application, options = {}) {
  /** @type {Set<string>} */
  const merged = new Set();
  const add = (list) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const value = String(item || "").trim().toLowerCase();
      if (value) merged.add(value);
    }
  };

  add(options?.featureSettings?.servers_in_wrong_ou?.ouPatterns);
  add(application?.securityScanSettings?.workstationOuPatterns);
  add(DEFAULT_WORKSTATION_OU_PATTERNS);

  return [...merged];
}

export function normalizeSecurityScanSettingsInput(input) {
  if (!input || typeof input !== "object") {
    return {
      inactiveUsersDays: DEFAULT_INACTIVE_USERS_DAYS,
      inactiveComputersDays: DEFAULT_INACTIVE_COMPUTERS_DAYS,
      unsupportedOsTokens: [...DEFAULT_UNSUPPORTED_OS_TOKENS],
      workstationOuPatterns: [...DEFAULT_WORKSTATION_OU_PATTERNS],
    };
  }
  return {
    inactiveUsersDays: normalizeInactiveUsersDays(
      input.inactiveUsersDays,
      DEFAULT_INACTIVE_USERS_DAYS,
    ),
    inactiveComputersDays: normalizeInactiveComputersDays(
      input.inactiveComputersDays,
      DEFAULT_INACTIVE_COMPUTERS_DAYS,
    ),
    unsupportedOsTokens: Array.isArray(input.unsupportedOsTokens)
      ? input.unsupportedOsTokens.map((t) => String(t).trim()).filter(Boolean)
      : [...DEFAULT_UNSUPPORTED_OS_TOKENS],
    workstationOuPatterns: Array.isArray(input.workstationOuPatterns)
      ? input.workstationOuPatterns.map((t) => String(t).trim()).filter(Boolean)
      : [...DEFAULT_WORKSTATION_OU_PATTERNS],
  };
}

export function mergeFeatureSettingsForScan(application, options = {}) {
  const inactiveDays = resolveInactiveUsersDays(application, options);
  const inactiveComputerDays = resolveInactiveComputersDays(application, options);
  const unsupportedOsTokens = resolveUnsupportedOsTokens(application, options);
  const workstationOuPatterns = resolveWorkstationOuPatterns(application, options);
  return {
    ...(options.featureSettings || {}),
    inactive_users: {
      ...(options.featureSettings?.inactive_users || {}),
      inactiveDays,
    },
    inactive_computers: {
      ...(options.featureSettings?.inactive_computers || {}),
      inactiveDays: inactiveComputerDays,
    },
    unsupported_os_versions: {
      ...(options.featureSettings?.unsupported_os_versions || {}),
      osTokens: unsupportedOsTokens,
    },
    servers_in_wrong_ou: {
      ...(options.featureSettings?.servers_in_wrong_ou || {}),
      ouPatterns: workstationOuPatterns,
    },
  };
}
