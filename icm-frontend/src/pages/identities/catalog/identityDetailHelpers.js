import { getIdentityValueByTargetKey, getManagerIdentifierDisplayValue } from '../../../utils/identityMappedValues';

/** Hide raw manager correlation identifiers from HR profile; manager name is shown separately with a link when managerId is set. */
export function shouldHideManagerCorrelationField(key, label) {
  const k = String(key || '')
    .toLowerCase()
    .replace(/\s+/g, '');
  const lbl = String(label || '').toLowerCase();
  if (k === 'managerkeyraw' || k === 'managerresolutionstatus' || k === 'isroot') return true;
  if (k === 'managerid' || k === 'manageremployeeid' || k === 'manageremail') return true;
  if (/^manager.*id$/.test(k) || k.includes('manageremployeeid')) return true;
  if (/\bmanager\s*id\b/.test(lbl) || lbl.includes('manager id')) return true;
  if (/\bmanager\s*employee\s*id\b/.test(lbl)) return true;
  if (/\bmanager\s*email\b/.test(lbl) || lbl === 'manager email') return true;
  return false;
}

export function isManagerNameDisplayField(item) {
  const k = String(item.key || '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  const lbl = String(item.label || '').toLowerCase();
  if (k.includes('managername') || /\bmanager\s*name\b/.test(lbl)) return true;
  return false;
}

export function resolveManagerProfileId(identity) {
  if (!identity?.managerId) return null;
  const raw = identity.managerId;
  const id = typeof raw === 'object' && raw !== null && raw._id != null ? raw._id : raw;
  const s = String(id || '').trim();
  return /^[a-f0-9]{24}$/i.test(s) ? s : null;
}

/** Correlation often sets `displayName` to employee id (EMP…); banner should show a person label when HR fields exist. */
export function looksLikeEmployeeIdOnlyLabel(s) {
  const t = String(s || '').trim();
  return /^EMP\d+$/i.test(t) || (/^[A-Z]{2,4}\d{4,}$/i.test(t) && !/\s/.test(t) && t.length <= 24);
}

export function resolveIdentityBannerTitle(identity) {
  if (!identity) return '';
  const dn = String(identity.displayName || '').trim();
  if (dn && !looksLikeEmployeeIdOnlyLabel(dn)) return dn;
  const attr = identity.attributes || {};
  const fromAttr = [
    attr.userName,
    attr.user_name,
    attr.display_name,
    attr.displayName,
  ]
    .map((x) => String(x || '').trim())
    .find((x) => x && !looksLikeEmployeeIdOnlyLabel(x));
  if (fromAttr) return fromAttr;
  const fl = [identity.firstName, identity.lastName].filter(Boolean).join(' ').trim();
  if (fl) return fl;
  const local = identity.email ? String(identity.email).split('@')[0].trim() : '';
  if (local && !looksLikeEmployeeIdOnlyLabel(local)) return local;
  return dn || identity.email || identity.employeeId || 'Identity';
}

/** Manager link label: prefer mapped HR manager name, not the linked identity’s `displayName` when that is still an EMP id. */
export function resolveManagerLinkLabel(identity) {
  if (!identity) return 'Manager';
  const tries = [
    () => getIdentityValueByTargetKey(identity, 'managerName'),
    () => getIdentityValueByTargetKey(identity, 'manager_display_name'),
    () => identity.attributes?.managerName,
    () => identity.attributes?.manager_name,
  ];
  for (const fn of tries) {
    const v = String(fn() ?? '').trim();
    if (v) return v;
  }
  const m = identity.managerId;
  if (m && typeof m === 'object' && m.displayName != null) {
    const t = String(m.displayName).trim();
    if (t) return t;
  }
  const idish = getManagerIdentifierDisplayValue(identity);
  return idish || 'Open manager';
}

/** Merge connector `rawData` with normalized app user fields (normalized wins on duplicate keys). */
export function mergeAccountRowForCsvView(data) {
  if (!data || typeof data !== 'object') return {};
  const raw = data.rawData && typeof data.rawData === 'object' ? { ...data.rawData } : {};
  const { rawData: _, ...rest } = data;
  return { ...raw, ...rest };
}

export function flattenValueForCsv(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) {
    return v
      .map((x) => (x != null && typeof x === 'object' ? JSON.stringify(x) : String(x)))
      .join('; ');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function accountToSortedKeyValues(data) {
  const merged = mergeAccountRowForCsvView(data);
  return Object.entries(merged)
    .filter(([k]) => k !== '__v')
    .map(([k, v]) => [k, flattenValueForCsv(v)])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

/** System / connector plumbing — hide from the account detail dialog. */
const ACCOUNT_DETAIL_EXCLUDE = new Set([
  '_id',
  'id',
  '__v',
  'applicationId',
  'application_id',
  'tenantId',
  'tenant_id',
  'createdAt',
  'updatedAt',
  'created_at',
  'updated_at',
  'lastReconRunId',
  'last_recon_run_id',
  'rawData',
  'raw_data',
  'accountData',
  'source',
]);

/** Preferred user-facing fields, in display order when present. */
const ACCOUNT_DETAIL_PRIORITY = [
  'full_name',
  'worker_name',
  'displayName',
  'display_name',
  'person_fullname',
  'name',
  'accountName',
  'account_name',
  'email',
  'work_email',
  'mail',
  'email_address',
  'emailAddress',
  'userPrincipalName',
  'user_principal_name',
  'username',
  'userName',
  'user_name',
  'oracle_username',
  'login',
  'sAMAccountName',
  'samaccountname',
  'is_active',
  'employment_status',
  'status',
  'active',
  'account_enabled',
  'accountEnabled',
  'department',
  'operating_unit',
  'cost_center',
  'position_title',
  'title',
  'position',
  'job_title',
  'jobTitle',
  'manager_name',
  'manager',
  'manager_email',
  'manager_worker_id',
  'phone',
  'mobile',
  'location',
  'office',
  'workday_worker_id',
  'employee_id',
  'employeeId',
  'workday_security_groups',
  'member_of_entitlements',
  'responsibilities',
  'data_access',
  'groups',
  'roles',
  'profiles',
  'entitlements',
  'permissions',
];

/**
 * Keys that mean the same identity fact. First match in ACCOUNT_DETAIL_PRIORITY wins;
 * later aliases (e.g. person_fullname after displayName) are dropped even if present.
 */
const ACCOUNT_DETAIL_SEMANTIC_GROUPS = [
  [
    'displayName',
    'display_name',
    'full_name',
    'worker_name',
    'person_fullname',
    'person_full_name',
    'name',
    'accountName',
    'account_name',
  ],
  [
    'email',
    'work_email',
    'mail',
    'email_address',
    'emailAddress',
    'userPrincipalName',
    'user_principal_name',
  ],
  [
    'username',
    'userName',
    'user_name',
    'oracle_username',
    'login',
    'sAMAccountName',
    'samaccountname',
    'account_login',
  ],
  [
    'status',
    'employment_status',
    'is_active',
    'active',
    'account_enabled',
    'accountEnabled',
    'enabled',
  ],
  ['department', 'operating_unit', 'org_unit', 'ou', 'business_unit'],
  ['title', 'position_title', 'position', 'job_title', 'jobTitle'],
  ['manager_name', 'manager', 'manager_display_name'],
  ['cost_center', 'costCenter'],
  [
    'workday_security_groups',
    'member_of_entitlements',
    'responsibilities',
    'data_access',
    'groups',
    'roles',
    'profiles',
    'entitlements',
    'permissions',
    'sap_roles',
  ],
];

const ACCOUNT_DETAIL_SEMANTIC_BY_KEY = (() => {
  const map = new Map();
  ACCOUNT_DETAIL_SEMANTIC_GROUPS.forEach((group, index) => {
    for (const key of group) map.set(String(key).toLowerCase(), index);
  });
  return map;
})();

function normalizeAccountDetailValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[|;]+/g, ',')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ');
}

function semanticGroupForKey(key) {
  const idx = ACCOUNT_DETAIL_SEMANTIC_BY_KEY.get(String(key || '').toLowerCase());
  return idx == null ? null : idx;
}

/**
 * Compact account row for the identity Accounts tab dialog:
 * priority identity fields only, with semantic + value dedupe so apps like
 * Oracle do not repeat Display Name / Email / entitlements under CSV aliases.
 */
export function accountToPriorityKeyValues(data) {
  const merged = mergeAccountRowForCsvView(data);
  const entries = Object.entries(merged)
    .filter(([k]) => !ACCOUNT_DETAIL_EXCLUDE.has(k) && k !== '__v')
    .map(([k, v]) => [k, flattenValueForCsv(v)])
    .filter(([, v]) => v !== '' && v != null);

  const byKey = new Map(entries);
  const ordered = [];
  const usedKeys = new Set();
  const usedGroups = new Set();
  const usedValues = new Set();

  const tryPush = (key, value) => {
    if (usedKeys.has(key)) return false;
    const group = semanticGroupForKey(key);
    if (group != null && usedGroups.has(group)) return false;
    const norm = normalizeAccountDetailValue(value);
    if (norm && usedValues.has(norm)) return false;
    ordered.push([key, value]);
    usedKeys.add(key);
    if (group != null) usedGroups.add(group);
    if (norm) usedValues.add(norm);
    return true;
  };

  for (const key of ACCOUNT_DETAIL_PRIORITY) {
    if (!byKey.has(key)) continue;
    tryPush(key, byKey.get(key));
  }

  // Keep a few extra business fields if the app uses uncommon names.
  for (const [k, v] of entries) {
    if (usedKeys.has(k)) continue;
    if (/id$/i.test(k) && !/worker|employee|account/i.test(k)) continue;
    tryPush(k, v);
    if (ordered.length >= 14) break;
  }
  return ordered;
}

export function csvEscapeCell(cell) {
  const s = String(cell);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildSingleRowCsv(entries) {
  if (!entries.length) return '';
  const keys = entries.map(([k]) => k);
  const vals = entries.map(([, v]) => v);
  return `${keys.map(csvEscapeCell).join(',')}\n${vals.map(csvEscapeCell).join(',')}`;
}

const FIELD_LABEL_OVERRIDES = {
  displayName: 'Display Name',
  display_name: 'Display Name',
  worker_name: 'Worker Name',
  person_fullname: 'Full Name',
  work_email: 'Work Email',
  email_address: 'Email',
  employment_status: 'Employment Status',
  account_enabled: 'Status',
  oracle_username: 'Oracle Username',
  operating_unit: 'Department',
  position_title: 'Position Title',
  manager_name: 'Manager Name',
  manager_worker_id: 'Manager Worker Id',
  cost_center: 'Cost Center',
  workday_worker_id: 'Workday Worker Id',
  workday_security_groups: 'Security Groups',
  member_of_entitlements: 'Entitlements',
  responsibilities: 'Entitlements',
  data_access: 'Entitlements',
  sap_roles: 'Roles',
};

export function humanizeFieldKey(key) {
  const k = String(key || '');
  if (FIELD_LABEL_OVERRIDES[k]) return FIELD_LABEL_OVERRIDES[k];
  return k
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Pipe- or semicolon-delimited access lists → chips for readability. */
export function shouldRenderAsTokenList(fieldKey, value) {
  const k = String(fieldKey || '').toLowerCase();
  if (!value || !String(value).trim()) return false;
  const parts = String(value)
    .split(/[|;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return false;
  return /role|entitlement|group|member|permission|profile|access|responsibilit|sap_|data_access/i.test(k);
}

/** Entitlement extractor aligned with accountEntitlementCorrelation smartDataParser delimiters. */
export function extractEntitlements(accountData) {
  if (!accountData) return [];

  const accessKeys = [
    'member_of_entitlements',
    'sap_roles',
    'groups',
    'roles',
    'entitlements',
    'profiles',
    'permissions',
    'data_access',
    'responsibilities',
  ];
  const found = [];
  const seenValues = new Set();

  accessKeys.forEach((key) => {
    const val = accountData[key] || (accountData.rawData && accountData.rawData[key]);

    if (Array.isArray(val)) {
      val.forEach((v) => {
        const s = String(v).trim();
        if (s && !seenValues.has(s)) {
          seenValues.add(s);
          found.push({ type: key, value: s });
        }
      });
    } else if (typeof val === 'string' && val.trim() !== '') {
      val.split(/[;,|]/).forEach((part) => {
        const s = part.trim();
        if (s && !seenValues.has(s)) {
          seenValues.add(s);
          found.push({ type: key, value: s });
        }
      });
    }
  });
  return found;
}

/** Prefer server-side Account/Entitlement correlation when present. */
export function getAccountDisplayEntitlements(acc) {
  if (acc?.correlatedEntitlements?.length) {
    return acc.correlatedEntitlements.map((c) => ({
      type: 'correlation',
      value: c.displayName || c.entitlementName || String(c.entitlementId || ''),
    }));
  }
  return extractEntitlements(acc?.accountData);
}

export function buildIdentityHrFieldList(identity, mappedProfileFields) {
  if (!identity) return [];

  const dataSet = [];
  const usedKeys = new Set();

  const addField = (key, label, value) => {
    if (usedKeys.has(key) || value === undefined || value === null || value === '') return;
    if (shouldHideManagerCorrelationField(key, label)) return;
    if (typeof value === 'string' && value.includes('@unmapped.local')) return;
    dataSet.push({ key, label, value });
    usedKeys.add(key);
  };

  (mappedProfileFields || []).forEach((f) => {
    addField(f.targetKey, f.label, getIdentityValueByTargetKey(identity, f.targetKey));
  });

  const topLevelKeys = [
    'email',
    'firstname',
    'lastname',
    'department',
    'title',
    'employeeId',
    'phone',
    'location',
    'country',
    'city',
  ];
  topLevelKeys.forEach((key) => {
    addField(key, key, identity[key]);
  });

  if (identity.attributes) {
    Object.entries(identity.attributes).forEach(([key, val]) => {
      addField(key, key, val);
    });
  }

  return dataSet;
}

export function countDynamicEntitlements(accounts) {
  return (accounts || [])
    .filter((acc) => acc.isActive !== false)
    .reduce((total, acc) => total + getAccountDisplayEntitlements(acc).length, 0);
}
