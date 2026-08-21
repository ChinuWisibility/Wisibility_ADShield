/**
 * Human-readable labels for finding type tokens.
 */
export const FINDING_TYPE_LABELS = {
  DISABLED_USER: "Disabled User",
  DISABLED_COMPUTER: "Disabled Computer",
  INACTIVE_USER: "Inactive User",
  INACTIVE_COMPUTER: "Inactive Computer",
  INACTIVE_OVER_90_DAYS: "Inactive > 90 Days",
  INACTIVE_OVER_180_DAYS: "Inactive > 180 Days",
  LOCKED_ACCOUNT: "Locked Account",
  PASSWORD_NEVER_EXPIRES: "Password Never Expires",
  PASSWORD_NOT_REQUIRED: "Password Not Required",
  PRIVILEGED_USER: "Privileged User",
  SERVICE_ACCOUNT: "Service Account",
  KERBEROASTABLE_ACCOUNT: "Kerberoastable Account",
  SHADOW_ADMIN: "Shadow Admin",
  PRIVILEGE_ESCALATION_PATH: "Privilege Escalation Path",
  UNCONSTRAINED_DELEGATION: "Unconstrained Delegation",
  EMPTY_GROUP: "Empty Group",
  UNKNOWN: "Unknown",
};

export function findingTypeLabel(type) {
  if (!type) return "—";
  return FINDING_TYPE_LABELS[type] || type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
