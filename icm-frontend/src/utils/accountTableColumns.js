/**
 * Schema-driven account table columns: reflect real AD / connector data,
 * not empty Wisibility default template fields.
 */

export const HIDDEN_ACCOUNT_TABLE_KEYS = new Set([
  '_id',
  'applicationId',
  'application_id',
  'tenantId',
  'rawData',
  '__v',
  'lastReconRunId',
  'createdAt',
  'updatedAt',
]);

/** LDAP attributes offered in Map AD (source-aware labels). */
export const KNOWN_LDAP_ATTRIBUTE_NAMES = new Set([
  'samaccountname',
  'sAMAccountName',
  'userprincipalname',
  'userPrincipalName',
  'mail',
  'givenname',
  'givenName',
  'sn',
  'displayname',
  'displayName',
  'department',
  'title',
  'manager',
  'memberof',
  'memberOf',
  'telephonenumber',
  'telephoneNumber',
  'employeeid',
  'employeeID',
  'employeenumber',
  'employeeNumber',
  'useraccountcontrol',
  'userAccountControl',
  'distinguishedname',
  'distinguishedName',
  'cn',
  'uid',
]);

/** Wisibility canonical user fields — hidden on AD accounts tab (LDAP attrs shown instead). */
export const CANONICAL_IGA_ACCOUNT_FIELDS = new Set([
  'user_id',
  'employee_id',
  'username',
  'email',
  'display_name',
  'status',
  'manager_id',
  'telephone',
  'member_of_entitlements',
  'first_name',
  'last_name',
  'firstName',
  'lastName',
  'userid',
  'employeeId',
  'managerId',
  'location',
  'user_type',
]);

/** Typical AD user LDAP attribute order (headers use exact attribute names from sync). */
const PREFERRED_LDAP_ATTR_ORDER = [
  'sAMAccountName',
  'userPrincipalName',
  'mail',
  'displayName',
  'givenName',
  'sn',
  'department',
  'title',
  'memberOf',
  'userAccountControl',
  'manager',
  'telephoneNumber',
  'employeeNumber',
  'employeeID',
  'distinguishedName',
  'cn',
  'objectGUID',
  'lastLogonTimestamp',
  'pwdLastSet',
  'ad_memberOf_dns',
];

/** Preferred display order when multiple keys are present (only keys with data are shown). */
const PREFERRED_FIELD_ORDER = [
  'user_id',
  'display_name',
  'email',
  'status',
  'department',
  'title',
  'username',
  'employee_id',
  'manager_id',
  'telephone',
  'member_of_entitlements',
];

export function formatHeaderName(fieldName) {
  if (!fieldName) return '';
  return String(fieldName)
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function hasMeaningfulValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function normKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isKnownLdapAttributeName(name) {
  const raw = String(name || '').trim();
  if (!raw) return false;
  if (KNOWN_LDAP_ATTRIBUTE_NAMES.has(raw)) return true;
  return KNOWN_LDAP_ATTRIBUTE_NAMES.has(normKey(raw));
}

/**
 * Mapping was explicitly tied to a real LDAP/CSV source column (Map AD), not template bootstrap.
 */
export function isExplicitSourceMapping(mapping) {
  if (!mapping || typeof mapping !== 'object') return false;
  if (mapping.isPrimaryKey) return true;

  const sf = String(mapping.standardField || '').trim();
  const csv = String(mapping.csvColumn || '').trim();
  if (!sf) return false;
  if (csv && csv !== sf) return true;
  if (csv && isKnownLdapAttributeName(csv)) return true;
  return false;
}

export function getValueFromUserRow(user, key) {
  if (!user || !key) return undefined;
  if (key.startsWith('rawData.')) {
    const parts = key.slice(8).split('.');
    let cur = user.rawData;
    for (const part of parts) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[part];
    }
    return cur;
  }
  return user[key];
}

/**
 * Sample loaded rows to see if a technical field has any real values.
 */
export function fieldHasDataInUsers(users, key, sampleLimit = 250) {
  if (!Array.isArray(users) || !users.length || !key) return false;
  const limit = Math.min(users.length, sampleLimit);
  for (let i = 0; i < limit; i += 1) {
    if (hasMeaningfulValue(getValueFromUserRow(users[i], key))) return true;
  }
  return false;
}

function mappingToColumnDef(mapping) {
  const key = String(mapping.standardField || '').trim();
  if (!key) return null;
  const csvCol = String(mapping.csvColumn || '').trim();
  const label =
    (mapping.displayName && String(mapping.displayName).trim()) ||
    (csvCol && isKnownLdapAttributeName(csvCol) ? csvCol : '') ||
    (csvCol && csvCol !== key ? csvCol : formatHeaderName(key));

  return {
    key,
    label,
    sourceColumn: csvCol || key,
    isPrimaryKey: Boolean(mapping.isPrimaryKey),
    fromMapping: true,
  };
}

function sortColumnDefs(defs) {
  const orderIndex = new Map(PREFERRED_FIELD_ORDER.map((k, i) => [k, i]));
  return [...defs].sort((a, b) => {
    if (a.isPrimaryKey && !b.isPrimaryKey) return -1;
    if (!a.isPrimaryKey && b.isPrimaryKey) return 1;
    const ai = orderIndex.has(a.key) ? orderIndex.get(a.key) : 999;
    const bi = orderIndex.has(b.key) ? orderIndex.get(b.key) : 999;
    if (ai !== bi) return ai - bi;
    return a.label.localeCompare(b.label);
  });
}

function ldapAttrOrderIndex(attr) {
  const lower = normKey(attr);
  const idx = PREFERRED_LDAP_ATTR_ORDER.findIndex((a) => normKey(a) === lower);
  return idx >= 0 ? idx : 999;
}

function sortLdapColumnDefs(defs) {
  return [...defs].sort((a, b) => {
    if (a.isPrimaryKey && !b.isPrimaryKey) return -1;
    if (!a.isPrimaryKey && b.isPrimaryKey) return 1;
    const ai = ldapAttrOrderIndex(a.key);
    const bi = ldapAttrOrderIndex(b.key);
    if (ai !== bi) return ai - bi;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Collect LDAP attribute names present on synced users (API merges rawData to top level).
 */
export function discoverAdLdapAttributeNames(users, sampleLimit = 250) {
  if (!Array.isArray(users) || !users.length) return [];

  const seenLower = new Map();
  const limit = Math.min(users.length, sampleLimit);

  for (let i = 0; i < limit; i += 1) {
    const user = users[i];
    if (!user || typeof user !== 'object') continue;

    const raw = user.rawData;
    if (raw && typeof raw === 'object') {
      for (const key of Object.keys(raw)) {
        if (!key) continue;
        const lower = normKey(key);
        if (!seenLower.has(lower)) seenLower.set(lower, key);
      }
    }

    for (const key of Object.keys(user)) {
      if (!key || HIDDEN_ACCOUNT_TABLE_KEYS.has(key) || key.startsWith('$')) continue;
      if (CANONICAL_IGA_ACCOUNT_FIELDS.has(key)) continue;
      const lower = normKey(key);
      if (!seenLower.has(lower)) seenLower.set(lower, key);
    }
  }

  return [...seenLower.values()];
}

/**
 * AD connector accounts: columns = LDAP attribute names with data (not Wisibility standardField labels).
 */
/** Default AD columns when no user rows are loaded yet (e.g. right after sync). */
const DEFAULT_AD_LDAP_ATTRS = [
  'samAccountName',
  'displayName',
  'mail',
  'userPrincipalName',
  'distinguishedName',
  'userAccountControl',
  'memberOf',
];

export function buildAdLdapColumnDefs(users = []) {
  const discovered = discoverAdLdapAttributeNames(users);
  const attrs = discovered.length ? discovered : DEFAULT_AD_LDAP_ATTRS;
  const useFallback = !discovered.length;
  const defs = [];

  for (const attr of attrs) {
    const key = attr.includes('.') ? `rawData.${attr}` : attr;
    if (!useFallback && !fieldHasDataInUsers(users, key)) continue;
    const lower = normKey(attr);
    defs.push({
      key,
      label: attr,
      sourceColumn: attr,
      isPrimaryKey: lower === 'samaccountname' || lower === 'distinguishedname',
      fromMapping: false,
      isLdapAttribute: true,
    });
  }

  return sortLdapColumnDefs(defs);
}

export function isLdapStatusAttribute(attrOrKey) {
  const name = String(attrOrKey || '').replace(/^rawData\./i, '');
  return normKey(name) === 'useraccountcontrol';
}

export function isLdapMemberOfAttribute(attrOrKey) {
  const name = String(attrOrKey || '').replace(/^rawData\./i, '');
  const n = normKey(name);
  return n === 'memberof' || n === 'ad_memberof_dns' || n === 'members';
}

export function isAccountStatusColumnKey(key) {
  if (!key) return false;
  if (key === 'status') return true;
  return isLdapStatusAttribute(key);
}

export function isMemberOfEntitlementsColumnKey(key) {
  if (!key) return false;
  if (key === 'member_of_entitlements') return true;
  return isLdapMemberOfAttribute(key);
}

/** Format a cell value for display (arrays → semicolon-separated). */
export function formatAccountCellValue(value) {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) {
    const parts = value.map((v) => String(v ?? '').trim()).filter(Boolean);
    return parts.length ? parts.join('; ') : null;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function shouldIncludeMappedColumn(mapping, users) {
  if (!mapping) return false;
  const key = String(mapping.standardField || '').trim();
  if (!key || HIDDEN_ACCOUNT_TABLE_KEYS.has(key)) return false;
  if (mapping.isPrimaryKey) return true;
  if (isExplicitSourceMapping(mapping)) return true;
  return fieldHasDataInUsers(users, key);
}

function discoverColumnsFromUserRows(users) {
  if (!Array.isArray(users) || !users.length) return [];

  const keysWithData = new Set();
  const sample = users.slice(0, Math.min(users.length, 250));

  for (const user of sample) {
    if (!user || typeof user !== 'object') continue;
    for (const key of Object.keys(user)) {
      if (!key || HIDDEN_ACCOUNT_TABLE_KEYS.has(key) || key.startsWith('$')) continue;
      if (hasMeaningfulValue(user[key])) keysWithData.add(key);
    }
  }

  const ordered = [
    ...PREFERRED_FIELD_ORDER.filter((k) => keysWithData.has(k)),
    ...[...keysWithData].filter((k) => !PREFERRED_FIELD_ORDER.includes(k)).sort(),
  ];

  return ordered.map((key) => ({
    key,
    label: formatHeaderName(key),
    sourceColumn: key,
    isPrimaryKey: key === 'user_id',
    fromMapping: false,
  }));
}

function resolveMappingList(userMappings, csvImportMappings) {
  if (Array.isArray(userMappings) && userMappings.length > 0) {
    return userMappings;
  }
  if (Array.isArray(csvImportMappings) && csvImportMappings.length > 0) {
    return csvImportMappings;
  }
  return [];
}

/**
 * Build account table columns: mappings + data-aware filtering (no empty template columns).
 */
export function buildAccountTableColumnDefs({
  userMappings = null,
  csvImportMappings = null,
  users = [],
  /** When true, ignore schema mappings and show LDAP attributes from synced AD directory. */
  isAdConnector = false,
} = {}) {
  if (isAdConnector) {
    const ldapDefs = buildAdLdapColumnDefs(users);
    if (ldapDefs.length) return ldapDefs;
    return discoverColumnsFromUserRows(users).filter(
      (d) => !CANONICAL_IGA_ACCOUNT_FIELDS.has(d.key),
    );
  }

  const mappings = resolveMappingList(userMappings, csvImportMappings);
  const seen = new Set();
  const defs = [];

  if (mappings.length) {
    for (const mapping of mappings) {
      if (!shouldIncludeMappedColumn(mapping, users)) continue;
      const def = mappingToColumnDef(mapping);
      if (!def || seen.has(def.key)) continue;
      seen.add(def.key);
      defs.push(def);
    }
  }

  if (!defs.length) {
    return discoverColumnsFromUserRows(users);
  }

  return sortColumnDefs(defs);
}

export function initialVisibleColumnKeys(columnDefs, count = 6, showAll = false) {
  const keys = columnDefs.map((d) => d.key);
  if (!keys.length) return [];
  if (showAll) return keys;
  const pk = columnDefs.find((d) => d.isPrimaryKey)?.key;
  const picked = [];
  if (pk) picked.push(pk);
  for (const key of keys) {
    if (picked.length >= count) break;
    if (!picked.includes(key)) picked.push(key);
  }
  return picked;
}

/** Merge saved column order with current schema keys (new attrs append at end). */
export function mergeColumnOrderKeys(savedOrder, defKeys) {
  const valid = new Set(defKeys);
  const order = (Array.isArray(savedOrder) ? savedOrder : [])
    .map((k) => String(k || '').trim())
    .filter((k) => valid.has(k));
  for (const k of defKeys) {
    if (!order.includes(k)) order.push(k);
  }
  return order;
}

/** Merge saved visibility with current keys; falls back to defaults when empty. */
export function mergeVisibleColumnKeys(savedVisible, columnDefs, { showAll = false, defaultCount = 6 } = {}) {
  const defKeys = columnDefs.map((d) => d.key);
  if (!defKeys.length) return [];
  const saved = (Array.isArray(savedVisible) ? savedVisible : [])
    .map((k) => String(k || '').trim())
    .filter((k) => defKeys.includes(k));
  if (saved.length) return saved;
  return initialVisibleColumnKeys(columnDefs, defaultCount, showAll);
}

/** Apply left→right order to column definitions. */
export function applyColumnOrder(columnDefs, orderKeys) {
  if (!Array.isArray(columnDefs) || !columnDefs.length) return [];
  if (!Array.isArray(orderKeys) || !orderKeys.length) return columnDefs;
  const byKey = new Map(columnDefs.map((d) => [d.key, d]));
  const ordered = [];
  for (const key of orderKeys) {
    if (byKey.has(key)) {
      ordered.push(byKey.get(key));
      byKey.delete(key);
    }
  }
  for (const def of columnDefs) {
    if (byKey.has(def.key)) ordered.push(def);
  }
  return ordered;
}

/** Swap one column key up/down in the ordered key list (up = left, down = right on table). */
export function moveColumnKeyInOrder(orderKeys, key, direction) {
  if (!Array.isArray(orderKeys) || !key || direction === 0) return orderKeys;
  const idx = orderKeys.indexOf(key);
  if (idx < 0) return orderKeys;
  const target = idx + direction;
  if (target < 0 || target >= orderKeys.length) return orderKeys;
  const next = [...orderKeys];
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}

/**
 * Normalize AD userAccountControl / status for display only (storage unchanged).
 */
export function formatAccountStatusDisplay(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { label: '—', tone: 'default', raw };

  const lower = raw.toLowerCase();
  if (lower === 'active') return { label: 'Active', tone: 'success', raw };
  if (lower === 'disabled' || lower === 'inactive') {
    return { label: 'Disabled', tone: 'default', raw };
  }
  if (lower === 'locked') return { label: 'Locked', tone: 'warning', raw };

  const uac = parseInt(raw, 10);
  if (Number.isFinite(uac)) {
    if (uac & 2) return { label: 'Disabled', tone: 'default', raw };
    if (uac & 16) return { label: 'Locked', tone: 'warning', raw };
    if (uac & 512) return { label: 'Active', tone: 'success', raw };
    return { label: `Account (${uac})`, tone: 'default', raw };
  }

  return { label: raw, tone: 'default', raw };
}

function parseMembershipToken(token) {
  const t = String(token || '').trim();
  if (!t) return '';
  const cnMatch = t.match(/^CN=([^,]+)/i);
  if (cnMatch) return cnMatch[1].trim();
  if (t.includes('=') && t.includes(',')) {
    return t.split(',')[0].replace(/^[^=]+=/, '').trim();
  }
  return t;
}

/**
 * Parse member_of_entitlements for UI (semicolon-separated storage format preserved in DB).
 */
export function parseMemberOfEntitlements(value) {
  if (value == null || value === '') {
    return { items: [], displayItems: [], fullText: '', isDnList: false };
  }

  if (Array.isArray(value)) {
    const items = value.map((v) => String(v || '').trim()).filter(Boolean);
    const displayItems = items.map(parseMembershipToken);
    return {
      items,
      displayItems,
      fullText: items.join('; '),
      isDnList: items.some((t) => /^CN=/i.test(t)),
    };
  }

  const text = String(value).trim();
  const items = text
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  const displayItems = items.map(parseMembershipToken);
  const isDnList = items.some((t) => /^CN=/i.test(t) || /,OU=/i.test(t));

  return {
    items,
    displayItems: displayItems.length ? displayItems : items,
    fullText: text,
    isDnList,
  };
}

export function formatMemberOfSummary(parsed, maxNames = 3) {
  if (!parsed.displayItems.length) return { short: '—', full: '', count: 0 };
  const names = parsed.displayItems;
  const count = names.length;
  if (count <= maxNames) {
    return { short: names.join(', '), full: parsed.fullText, count };
  }
  const short = `${names.slice(0, maxNames).join(', ')} +${count - maxNames} more`;
  return { short, full: parsed.fullText, count };
}

const ACCOUNT_DETAIL_HIDDEN_KEYS = new Set(['_id', 'applicationId', 'application_id']);

function isPlainDetailKey(key) {
  if (!key || key === '__v') return false;
  if (key.startsWith('$')) return false;
  return true;
}

function showFieldInAccountDetail(key) {
  return key && !ACCOUNT_DETAIL_HIDDEN_KEYS.has(key);
}

/** One group per line with trailing semicolon (account detail / correlation modal). */
export function memberOfDetailLines(value) {
  const parsed = parseMemberOfEntitlements(value);
  if (!parsed.displayItems.length) return null;
  return parsed.displayItems.map((name) => `${name};`);
}

export function formatAccountDetailFieldValue(key, value) {
  if (isAccountStatusColumnKey(key)) {
    return formatAccountStatusDisplay(value).label;
  }
  if (isMemberOfEntitlementsColumnKey(key)) {
    const lines = memberOfDetailLines(value);
    if (!lines) return '\u2014';
    return lines.join('\n');
  }
  const formatted = formatAccountCellValue(value);
  return formatted != null ? formatted : '\u2014';
}

/** Dialog title from synced account row (LDAP or canonical fields). */
export function accountDialogTitleFromUser(row) {
  if (!row || typeof row !== 'object') return 'Account details';
  const displayName =
    getValueFromUserRow(row, 'displayName') ??
    getValueFromUserRow(row, 'display_name');
  if (displayName != null && String(displayName).trim()) return String(displayName).trim();
  const sam =
    getValueFromUserRow(row, 'sAMAccountName') ??
    getValueFromUserRow(row, 'samaccountname');
  if (sam != null && String(sam).trim()) return String(sam).trim();
  const dn =
    getValueFromUserRow(row, 'distinguishedName') ??
    getValueFromUserRow(row, 'user_id');
  if (dn != null && String(dn).trim()) return String(dn).trim();
  const fn = row.first_name ?? row.firstName ?? getValueFromUserRow(row, 'givenName');
  const ln = row.last_name ?? row.lastName ?? getValueFromUserRow(row, 'sn');
  const parts = [fn, ln].filter((x) => x != null && String(x).trim()).map((x) => String(x).trim());
  if (parts.length) return parts.join(' ');
  const uid =
    row.user_id ??
    row.userid ??
    row.username ??
    row.employee_id ??
    row.employeeId;
  if (uid != null && String(uid).trim()) return String(uid).trim();
  return 'Account details';
}

/**
 * Fields to show in account detail / correlation assigned-users modal.
 * @param {object} user
 * @param {{ isAdConnector?: boolean, userMappings?: object[], csvImportMappings?: object[], usersSample?: object[] }} [options]
 * @returns {{ key: string, label: string, value: unknown }[]}
 */
export function buildAccountDetailFieldRows(
  user,
  {
    isAdConnector = false,
    userMappings = null,
    csvImportMappings = null,
    usersSample = [],
  } = {},
) {
  if (!user || typeof user !== 'object') return [];

  const sample = Array.isArray(usersSample) && usersSample.length ? usersSample : [user];
  const columnDefs = buildAccountTableColumnDefs({
    userMappings,
    csvImportMappings,
    users: sample,
    isAdConnector,
  });

  const seen = new Set();
  const rowsOut = [];

  for (const def of columnDefs) {
    if (!def.key || seen.has(def.key) || !showFieldInAccountDetail(def.key)) continue;
    seen.add(def.key);
    rowsOut.push({
      key: def.key,
      label: def.label,
      value: getValueFromUserRow(user, def.key),
    });
  }

  const extras = Object.keys(user)
    .filter((k) => {
      if (!isPlainDetailKey(k) || seen.has(k) || !showFieldInAccountDetail(k)) return false;
      if (isAdConnector && CANONICAL_IGA_ACCOUNT_FIELDS.has(k)) return false;
      return hasMeaningfulValue(user[k]);
    })
    .sort();

  for (const key of extras) {
    rowsOut.push({ key, label: formatHeaderName(key), value: user[key] });
  }

  if (user.rawData && typeof user.rawData === 'object' && isAdConnector) {
    for (const key of Object.keys(user.rawData)) {
      if (!key || seen.has(key) || CANONICAL_IGA_ACCOUNT_FIELDS.has(key)) continue;
      const fullKey = key.includes('.') ? `rawData.${key}` : key;
      if (seen.has(fullKey)) continue;
      const val = user.rawData[key];
      if (!hasMeaningfulValue(val)) continue;
      seen.add(fullKey);
      rowsOut.push({
        key: fullKey,
        label: key,
        value: val,
      });
    }
  }

  return rowsOut;
}
