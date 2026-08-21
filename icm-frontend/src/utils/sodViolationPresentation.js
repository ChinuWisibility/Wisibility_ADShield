/**
 * Consistent Identity column: bold = person name, second line = email.
 */

export function humanizeLocalPart(emailOrLogin) {
  const s = String(emailOrLogin || "").trim();
  if (!s) return "";
  const local = s.includes("@") ? s.split("@")[0] : s;
  if (!local) return "";
  return local
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Primary line: real name when distinct from email; else a readable label from the address/login. */
export function violationPrimaryLabel(row) {
  const email = String(row?.identityEmail || "").trim();
  const name = String(row?.identityName || "").trim();
  const emailLower = email.toLowerCase();
  const nameLower = name.toLowerCase();
  if (name && !name.includes("@") && nameLower !== emailLower) {
    return name;
  }
  if (email && email.includes("@")) {
    return humanizeLocalPart(email);
  }
  if (email) {
    return humanizeLocalPart(email);
  }
  return name || "—";
}

/** Second line: work email when available. */
export function violationEmailLine(row) {
  const email = String(row?.identityEmail || "").trim();
  if (email.includes("@")) return email;
  if (email) return email;
  return "—";
}

export function violationDepartmentLabel(row) {
  const d = String(row?.department || "").trim();
  return d || "—";
}
