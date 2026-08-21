/**
 * Canonical identity attributes that can be mapped from HRMS sources (SailPoint-style keys).
 */
export const IDENTITY_PROFILE_TARGET_KEYS = [
  { key: "uid", label: "Username (uid)", required: true },
  { key: "email", label: "Work Email (email)", required: true },
  { key: "lastname", label: "Family Name (lastname)", required: true },
  { key: "firstname", label: "Given Name (firstname)", required: false },
  { key: "displayName", label: "Display Name", required: false },
  { key: "employeeId", label: "Employee ID", required: false },
  { key: "department", label: "Department", required: false },
  { key: "title", label: "Job Title", required: false },
  { key: "phone", label: "Phone", required: false },
  { key: "managerEmail", label: "Manager Email", required: false },
  { key: "managerEmployeeId", label: "Manager Employee ID", required: false },
  { key: "startDate", label: "Start Date", required: false },
  { key: "status", label: "Status", required: false },
];

export const TRANSFORM_OPTIONS = ["none", "toLower", "toUpper", "trim", "concatFirstLast", "defaultIfEmpty"];

/** Allowed correlation keys for CSV → Identity upserts (must match a mapping row targetKey). */
export const IDENTITY_CORRELATION_TARGET_KEYS = [
  { key: "email", label: "Work Email (email)" },
  { key: "employeeId", label: "Employee ID" },
  { key: "uid", label: "Username (uid)" },
];

export const MAPPING_SOURCE_MODES = [
  { key: "delimited_csv", label: "CSV columns (direct)" },
  { key: "application_account_schema", label: "Application account schema (Schema Management)" },
];

export const CORRELATION_KEY_SET = new Set(IDENTITY_CORRELATION_TARGET_KEYS.map((x) => x.key));

export function isAllowedTargetKey(key) {
  return IDENTITY_PROFILE_TARGET_KEYS.some((t) => t.key === key);
}

/** Mapping targetKey: built-in keys or custom (e.g. camelCase) for extended attributes. */
export function isValidTargetKey(key) {
  const k = String(key || "").trim();
  if (!k || k.length > 128) return false;
  return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(k);
}
