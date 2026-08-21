/**
 * Fuzzy pick from rawData: searches all keys for substring matches.
 * Handles any application schema (Oracle: person_fullname, SAP: FULL_NAME, AD: Display Name, etc.)
 */
export function pickFromRawData(raw, ...patterns) {
  if (!raw || typeof raw !== "object") return "";
  const compiledPatterns = patterns
    .map((pattern) => String(pattern || "").trim())
    .filter(Boolean)
    .map((pattern) => ({
      raw: pattern.toLowerCase(),
      normalized: pattern.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    }));
  for (const key of Object.keys(raw)) {
    const lk = key.toLowerCase();
    const normalizedKey = lk.replace(/[^a-z0-9]+/g, "");
    if (
      compiledPatterns.some(
        ({ raw, normalized }) =>
          lk.includes(raw) || (normalized && normalizedKey.includes(normalized)),
      )
    ) {
      const val = raw[key];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        return String(val).trim();
      }
    }
  }
  return "";
}

export function resolveUserName(user, raw) {
  return (
    user?.name ||
    user?.display_name ||
    raw["Display Name"] ||
    raw.displayName ||
    raw.display_name ||
    raw.FULL_NAME ||
    raw.cn ||
    raw.name ||
    pickFromRawData(
      raw,
      "fullname",
      "full_name",
      "person_full",
      "displayname",
      "person_name",
    ) ||
    user?.username ||
    raw.username ||
    raw.Username ||
    pickFromRawData(
      raw,
      "username",
      "user_name",
      "oracle_user",
      "account_id",
      "account",
      "sAMAccount",
      "samaccount",
      "login",
    ) ||
    user?.user_id ||
    raw.user_id ||
    user?.email ||
    raw.email ||
    raw["Email Address"] ||
    pickFromRawData(raw, "email", "mail") ||
    "Unknown User"
  );
}

export function resolveUserDepartment(raw) {
  return (
    raw.Department ||
    raw.department ||
    pickFromRawData(
      raw,
      "department",
      "dept",
      "division",
      "kostl",
      "org",
      "operating_unit",
      "unit",
      "business_unit",
    ) ||
    ""
  );
}

export function resolveUserTitle(raw) {
  return (
    raw.Title ||
    raw.title ||
    raw["Job Title"] ||
    raw.job_title ||
    raw.Role ||
    raw.role ||
    pickFromRawData(raw, "title", "position", "job", "designation", "role") ||
    ""
  );
}

export function resolveUserManagerEmail(raw) {
  return (
    raw["Manager Email Address"] ||
    raw.managerEmail ||
    raw.manager_email ||
    pickFromRawData(
      raw,
      "manager_email",
      "manager_mail",
      "supervisor_email",
      "mgr_email",
    ) ||
    ""
  );
}
