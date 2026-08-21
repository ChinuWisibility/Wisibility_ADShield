/** AD userAccountControl flag bits (Microsoft docs). */
export const UAC_ACCOUNT_DISABLED = 0x2;
export const UAC_LOCKOUT = 0x10;
export const UAC_PASSWD_NOTREQD = 0x20;
export const UAC_ENCRYPTED_TEXT_PASSWORD_ALLOWED = 0x80;
export const UAC_DONT_EXPIRE_PASSWD = 0x10000;
export const UAC_SMARTCARD_REQUIRED = 0x40000;
export const UAC_TRUSTED_FOR_DELEGATION = 0x80000;
export const UAC_TRUSTED_TO_AUTH_FOR_DELEGATION = 0x1000000;
export const UAC_DONT_REQUIRE_PREAUTH = 0x400000;

/** 100-ns intervals between 1601-01-01 UTC and 1970-01-01 UTC. */
const FILETIME_UNIX_EPOCH_OFFSET = BigInt("116444736000000000");
const BIGINT_ZERO = BigInt(0);
const BIGINT_32 = BigInt(32);

/**
 * @param {string|number|bigint|null|undefined} uac
 * @returns {number}
 */
export function parseUac(uac) {
  const n = parseInt(String(uac ?? "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {string|number|bigint|null|undefined} uac
 * @param {number} flag
 */
export function hasUacFlag(uac, flag) {
  return (parseUac(uac) & flag) === flag;
}

export function isDisabled(uac) {
  return hasUacFlag(uac, UAC_ACCOUNT_DISABLED);
}

export function isLocked(uac) {
  return hasUacFlag(uac, UAC_LOCKOUT);
}

export function passwordNeverExpires(uac) {
  return hasUacFlag(uac, UAC_DONT_EXPIRE_PASSWD);
}

export function passwordNotRequired(uac) {
  return hasUacFlag(uac, UAC_PASSWD_NOTREQD);
}

export function reversibleEncryptionEnabled(uac) {
  return hasUacFlag(uac, UAC_ENCRYPTED_TEXT_PASSWORD_ALLOWED);
}

/** Risk when SMARTCARD_REQUIRED (0x40000) is not set on the account. */
export function smartcardNotRequired(uac) {
  return !hasUacFlag(uac, UAC_SMARTCARD_REQUIRED);
}

/**
 * Convert AD FILETIME (100-ns since 1601-01-01 UTC) to Date.
 * @param {string|number|bigint|Buffer|null|undefined} filetime
 * @returns {Date|null}
 */
export function filetimeToDate(filetime) {
  if (filetime == null || filetime === "" || filetime === "0") return null;
  if (Buffer.isBuffer(filetime)) {
    if (filetime.length < 8) return null;
    const lo = filetime.readUInt32LE(0);
    const hi = filetime.readUInt32LE(4);
    const combined = (BigInt(hi) << BIGINT_32) + BigInt(lo);
    return filetimeToDate(String(combined));
  }
  let ft;
  try {
    ft = BigInt(String(filetime).trim());
  } catch {
    return null;
  }
  if (ft <= BIGINT_ZERO) return null;
  const ms = Number((ft - FILETIME_UNIX_EPOCH_OFFSET) / BigInt(10000));
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {Date} date
 * @returns {string} FILETIME as decimal string
 */
export function dateToFiletime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "0";
  const ms = BigInt(d.getTime());
  const ft = ms * BigInt(10000) + FILETIME_UNIX_EPOCH_OFFSET;
  return ft.toString();
}

/**
 * @param {string|number|bigint|Date|null|undefined} filetimeOrDate
 * @param {number} days
 * @returns {boolean}
 */
export function isOlderThanDays(filetimeOrDate, days) {
  const thresholdMs = days * 86400000;
  let d = null;
  if (filetimeOrDate instanceof Date) {
    d = filetimeOrDate;
  } else {
    d = filetimeToDate(filetimeOrDate);
  }
  if (!d) return false;
  return Date.now() - d.getTime() >= thresholdMs;
}

/**
 * test.ps1 inactive computer rule: skip disabled; null/0 lastLogonTimestamp counts
 * as never authenticated; otherwise compare FILETIME age to threshold.
 * @param {string|number|bigint|null|undefined} lastLogonTimestamp
 * @param {number} days
 * @param {string|number|null|undefined} [userAccountControl]
 */
export function isInactiveComputer(lastLogonTimestamp, days, userAccountControl) {
  if (isDisabled(userAccountControl)) return false;
  const raw = lastLogonTimestamp;
  if (raw == null || raw === "" || raw === 0 || raw === "0") return true;
  const d = filetimeToDate(raw);
  if (!d) return true;
  return Date.now() - d.getTime() >= days * 86400000;
}

/** test.ps1 unsupported OS regex (OperatingSystem attribute only). */
export const UNSUPPORTED_COMPUTER_OS_REGEX =
  /Windows\s+(XP|Vista|7|8(\.1)?|Server\s+2003(\s+R2)?|Server\s+2008(\s+R2)?|Server\s+2012(\s+R2)?)/i;

/**
 * @param {string|null|undefined} operatingSystem
 */
export function isUnsupportedComputerOperatingSystem(operatingSystem) {
  const os = String(operatingSystem || "").trim();
  if (!os) return false;
  return UNSUPPORTED_COMPUTER_OS_REGEX.test(os);
}

/**
 * AD lockoutTime > 0 indicates the account is locked.
 * @param {string|number|bigint|null|undefined} lockoutTime
 */
export function isAccountLockedByLockoutTime(lockoutTime) {
  try {
    return BigInt(String(lockoutTime ?? "").trim() || "0") > BIGINT_ZERO;
  } catch {
    return false;
  }
}

/**
 * @param {object} params
 * @param {string} params.scanId
 * @param {string} params.feature
 * @param {string} params.riskLevel
 * @param {object} params.user
 * @param {string} [params.status]
 * @param {string} [params.recommendation]
 */
export function trustedForDelegation(uac) {
  return hasUacFlag(uac, UAC_TRUSTED_FOR_DELEGATION);
}

export function trustedToAuthForDelegation(uac) {
  return hasUacFlag(uac, UAC_TRUSTED_TO_AUTH_FOR_DELEGATION);
}

export function dontRequirePreauth(uac) {
  return hasUacFlag(uac, UAC_DONT_REQUIRE_PREAUTH);
}

/**
 * @param {string|string[]} spnValue
 * @returns {string[]}
 */
export function normalizeSpnList(spnValue) {
  if (Array.isArray(spnValue)) {
    return spnValue.map((s) => String(s || "").trim()).filter(Boolean);
  }
  const s = String(spnValue || "").trim();
  return s ? [s] : [];
}

/** SPN shape validation aligned with test.ps1 Test-SPNFormat. */
export function isMalformedSpn(spn) {
  const s = String(spn || "").trim();
  if (!s) return true;
  if (!s.includes("/")) return true;
  if (s.startsWith("/")) return true;
  if (s.endsWith("/")) return true;
  if (s.includes("//")) return true;
  if (s.endsWith(":")) return true;
  if (s.startsWith(":")) return true;
  if (/\s/.test(s)) return true;
  if (/[<>%'"]/.test(s)) return true;
  const slash = s.indexOf("/");
  const service = s.slice(0, slash);
  const hostPart = s.slice(slash + 1);
  if (!service || !hostPart) return true;
  return false;
}

import {
  deriveFindingSignals,
  resolvePrimaryFindingType,
} from "../../../constants/findingSignals.js";

/**
 * Build a discovery-only finding (no risk level — assigned by policy engine).
 */
export function buildDiscoveryFinding({
  scanId,
  feature,
  objectType = "user",
  objectName,
  dn = "",
  status = "",
  attributes = {},
  evidence = {},
  metadata = {},
  relationships = [],
  findingSignals: explicitSignals,
}) {
  const mergedEvidence =
    evidence && Object.keys(evidence).length
      ? evidence
      : metadata && typeof metadata === "object"
        ? metadata
        : {};

  const draft = {
    scanId,
    feature,
    objectType,
    objectName: objectName || "—",
    dn: dn || "",
    status,
    attributes: attributes && typeof attributes === "object" ? attributes : {},
    evidence: mergedEvidence,
    relationships: Array.isArray(relationships) ? relationships : [],
  };

  const findingSignals =
    Array.isArray(explicitSignals) && explicitSignals.length > 0
      ? [...new Set(explicitSignals.map(String))]
      : deriveFindingSignals(draft);
  const findingType = resolvePrimaryFindingType({ ...draft, findingSignals });

  return {
    ...draft,
    findingType,
    findingSignals,
  };
}

/**
 * @deprecated Use buildDiscoveryFinding — riskLevel/recommendation are ignored.
 */
export function buildPostureRiskFinding(params) {
  const {
    riskLevel: _riskLevel,
    recommendation: _recommendation,
    metadata = {},
    findingSignals,
    ...rest
  } = params;
  return buildDiscoveryFinding({ ...rest, evidence: metadata, findingSignals });
}

export function buildUserRiskFinding({
  scanId,
  feature,
  riskLevel: _riskLevel,
  recommendation: _recommendation,
  user,
  status,
  metadata = {},
  findingSignals,
}) {
  const objectName =
    user?.displayName ||
    user?.objectName ||
    user?.userId ||
    user?.email ||
    "—";
  return buildDiscoveryFinding({
    scanId,
    feature,
    objectType: "user",
    objectName,
    dn: user?.distinguishedName || user?.dn || "",
    status: status ?? user?.status ?? "",
    attributes: {
      userAccountControl: user?.userAccountControl,
      lastLogonTimestamp: user?.lastLogonTimestamp,
    },
    evidence: metadata,
    findingSignals,
  });
}

export function buildComputerRiskFinding({
  scanId,
  feature,
  riskLevel: _riskLevel,
  recommendation: _recommendation,
  computer,
  status,
  metadata = {},
  findingSignals,
}) {
  return buildDiscoveryFinding({
    scanId,
    feature,
    objectType: "computer",
    objectName:
      computer?.displayName ||
      computer?.computerName ||
      computer?.name ||
      "—",
    dn: computer?.distinguishedName || computer?.dn || "",
    status: status ?? "",
    attributes: {
      operatingSystem: computer?.operatingSystem,
      lastLogonTimestamp: computer?.lastLogonTimestamp,
    },
    evidence: metadata,
    findingSignals,
  });
}

export function buildGroupRiskFinding({
  scanId,
  feature,
  riskLevel: _riskLevel,
  recommendation: _recommendation,
  group,
  status,
  metadata = {},
  findingSignals,
}) {
  return buildDiscoveryFinding({
    scanId,
    feature,
    objectType: "group",
    objectName:
      group?.displayName ||
      group?.groupName ||
      group?.objectName ||
      "—",
    dn: group?.distinguishedName || group?.dn || group?.groupDN || "",
    status: status ?? "",
    attributes: {
      objectSid: group?.objectSid,
      memberCount: Array.isArray(group?.members) ? group.members.length : 0,
    },
    evidence: metadata,
    findingSignals,
  });
}
