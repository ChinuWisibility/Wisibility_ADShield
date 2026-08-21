import { resolveApplicationUserIdentity } from "../applicationUserIdentityResolve.js";

const SNAPSHOT_SKIP_TOP = new Set([
  "_id",
  "__v",
  "rawData",
  "applicationId",
  "tenantId",
  "createdAt",
  "updatedAt",
  "lastReconRunId",
]);

const DISPLAY_NAME_KEYS = [
  "display_name",
  "displayName",
  "full_name",
  "fullName",
  "person_fullname",
  "employee_name",
  "user_display_name",
  "name",
];

const FIRST_NAME_KEYS = [
  "first_name",
  "firstName",
  "given_name",
  "givenName",
  "firstname",
];
const LAST_NAME_KEYS = [
  "last_name",
  "lastName",
  "family_name",
  "familyName",
  "surname",
  "lastname",
];

const EMAIL_KEYS = [
  "email",
  "primary_email",
  "mail",
  "user_email",
  "Email",
  "e_mail",
];
const DEPARTMENT_KEYS = [
  "department",
  "dept",
  "department_name",
  "departmentName",
];
const JOB_TITLE_KEYS = [
  "job_title",
  "jobTitle",
  "title",
  "position",
];
const MANAGER_NAME_KEYS = [
  "manager_name",
  "managerName",
  "manager_display_name",
  "managerDisplayName",
];
const ORGANIZATION_ROLE_KEYS = [
  "organization_role",
  "organizationRole",
  "org_role",
  "role",
];
const SUSPENDED_KEYS = ["suspended", "is_suspended", "isSuspended"];
const USERNAME_KEYS = [
  "username",
  "user_id",
  "userId",
  "login",
  "samAccountName",
  "userPrincipalName",
  "account",
];
const EMPLOYEE_ID_KEYS = [
  "employee_id",
  "employeeId",
  "emp_id",
  "personnel_number",
  "personnelNumber",
];
const STATUS_KEYS = [
  "status",
  "user_status",
  "account_status",
  "profile_status",
  "lifecycleState",
  "lifecycle_state",
  "employment_status",
  "employmentStatus",
];

/**
 * Flatten one stored snapshot row: CSV `rawData` plus top-level mapped fields.
 * @param {Record<string, unknown> | null | undefined} doc
 */
export function flattenSnapshotRow(doc) {
  if (!doc || typeof doc !== "object") return {};
  const raw =
    doc.rawData && typeof doc.rawData === "object" && !Array.isArray(doc.rawData)
      ? { ...doc.rawData }
      : {};
  const out = { ...raw };
  for (const [k, v] of Object.entries(doc)) {
    if (SNAPSHOT_SKIP_TOP.has(k)) continue;
    if (v == null) continue;
    if (typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) continue;
    if (out[k] === undefined || out[k] === null || String(out[k]).trim() === "") {
      out[k] = v;
    }
  }
  return out;
}

function str(val) {
  if (val == null) return "";
  const s = String(val).trim();
  return s;
}

/**
 * @param {Record<string, string>} flat
 * @param {string[]} keys
 */
function pickFirst(flat, keys) {
  for (const key of keys) {
    const val = str(flat[key]);
    if (val) return val;
  }
  return "";
}

/**
 * @param {Record<string, unknown>[]} flats
 * @param {string[]} keys
 */
function pickAcrossRows(flats, keys) {
  for (const flat of flats) {
    const val = pickFirst(flat, keys);
    if (val) return val;
  }
  return "";
}

/** Prefer stored duplicate row(s), then canonical snapshot. */
function duplicateRowFlats(doc) {
  return (doc?.rows || []).map((r) => flattenSnapshotRow(r)).filter((f) => Object.keys(f).length > 0);
}

/**
 * @param {Record<string, unknown>} doc
 * @param {string[]} keys
 */
function pickFromDuplicateRows(doc, keys) {
  const dupFlats = duplicateRowFlats(doc);
  const fromDup = pickAcrossRows(dupFlats, keys);
  if (fromDup) return fromDup;
  return pickFirst(flattenSnapshotRow(doc?.canonicalRow), keys);
}

/**
 * @param {Record<string, unknown>[]} flats
 * @param {string[]} keys
 */
function collectStatuses(flats, keys) {
  const seen = new Set();
  const out = [];
  for (const flat of flats) {
    const val = pickFirst(flat, keys);
    if (!val) continue;
    const norm = val.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(val);
  }
  return out;
}

/**
 * Prefer canonical (live) row, then duplicate snapshots — list UIs show the live account identity.
 * @param {Record<string, unknown>} doc
 */
function identityFlatsForDisplay(doc) {
  const canon = flattenSnapshotRow(doc?.canonicalRow);
  const flats = [];
  if (Object.keys(canon).length > 0) flats.push(canon);
  for (const f of duplicateRowFlats(doc)) flats.push(f);
  return flats;
}

/**
 * @param {Record<string, string>[]} flats
 */
function composeNameFromParts(flats) {
  for (const flat of flats) {
    const first = pickFirst(flat, FIRST_NAME_KEYS);
    const last = pickFirst(flat, LAST_NAME_KEYS);
    const composed = [first, last].filter(Boolean).join(" ").trim();
    if (composed) return composed;
  }
  return "";
}

/**
 * Summary fields for duplicate-account list UIs (data hygiene detail, etc.).
 * Prefer application onboarded mappings when provided; otherwise thin generic keys.
 * @param {Record<string, unknown> | null | undefined} doc - ApplicationUserDuplicate lean doc
 * @param {{ userMappings?: object[], csvImportMapping?: object }|null} [appSchema]
 */
export function summarizeDuplicateAccountForDisplay(doc, appSchema = null) {
  if (!doc || typeof doc !== "object") {
    return {
      displayName: "",
      email: "",
      username: "",
      employeeId: "",
      department: "",
      jobTitle: "",
      managerName: "",
      organizationRole: "",
      status: "",
      suspended: "",
    };
  }

  const identityFlats = identityFlatsForDisplay(doc);

  let displayName = "";
  let email = "";
  let department = "";
  let username = "";

  const hasMappings =
    (Array.isArray(appSchema?.userMappings) && appSchema.userMappings.length > 0) ||
    (Array.isArray(appSchema?.csvImportMapping?.mappings) &&
      appSchema.csvImportMapping.mappings.length > 0);

  if (hasMappings) {
    const rowsToTry = [
      doc.canonicalRow,
      ...(Array.isArray(doc.rows) ? doc.rows : []),
    ].filter((r) => r && typeof r === "object");
    for (const row of rowsToTry) {
      const id = resolveApplicationUserIdentity(row, appSchema);
      if (!displayName && id.displayName) displayName = id.displayName;
      if (!email && id.email.includes("@")) email = id.email;
      if (!department && id.department) department = id.department;
      if (!username && id.primaryKey) username = id.primaryKey;
      if (displayName && email) break;
    }
  }

  displayName =
    displayName ||
    pickAcrossRows(identityFlats, DISPLAY_NAME_KEYS) ||
    composeNameFromParts(identityFlats);
  email =
    email ||
    pickFromDuplicateRows(doc, EMAIL_KEYS) ||
    pickAcrossRows(identityFlats, EMAIL_KEYS);
  username =
    username ||
    pickFromDuplicateRows(doc, USERNAME_KEYS) ||
    pickAcrossRows(identityFlats, USERNAME_KEYS);
  const employeeId =
    pickFromDuplicateRows(doc, EMPLOYEE_ID_KEYS) ||
    pickAcrossRows(identityFlats, EMPLOYEE_ID_KEYS);
  department =
    department ||
    pickFromDuplicateRows(doc, DEPARTMENT_KEYS) ||
    pickAcrossRows(identityFlats, DEPARTMENT_KEYS);
  const jobTitle =
    pickFromDuplicateRows(doc, JOB_TITLE_KEYS) ||
    pickAcrossRows(identityFlats, JOB_TITLE_KEYS);
  const managerName =
    pickFromDuplicateRows(doc, MANAGER_NAME_KEYS) ||
    pickAcrossRows(identityFlats, MANAGER_NAME_KEYS);
  const organizationRole =
    pickFromDuplicateRows(doc, ORGANIZATION_ROLE_KEYS) ||
    pickAcrossRows(identityFlats, ORGANIZATION_ROLE_KEYS);
  const suspended =
    pickFromDuplicateRows(doc, SUSPENDED_KEYS) ||
    pickAcrossRows(identityFlats, SUSPENDED_KEYS);
  const statuses = collectStatuses(identityFlats, STATUS_KEYS);
  const status = statuses[0] || "";

  return {
    displayName,
    email,
    username,
    employeeId,
    department,
    jobTitle,
    managerName,
    organizationRole,
    status,
    suspended,
  };
}
