/**
 * REST (Bearer) and SCIM 2.0 connectors — uses native fetch (Node 18+).
 */

function getNested(obj, path) {
  if (!path || !obj) return obj;
  const parts = path.split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function normalizeRestConfig(input = {}) {
  const baseUrl = String(input.baseUrl ?? input.restBaseUrl ?? '').replace(/\/$/, '');
  const bearerToken = String(input.bearerToken ?? input.restToken ?? input.token ?? '').trim();
  const usersPath = String(input.usersPath ?? input.restUsersPath ?? '/users').trim() || '/users';
  const method = String(input.method ?? 'GET').toUpperCase();
  const jsonPath = String(input.jsonPath ?? input.restJsonPath ?? '').trim();
  const extraHeaders = input.headers && typeof input.headers === 'object' ? input.headers : {};
  return { baseUrl, bearerToken, usersPath, method, jsonPath, extraHeaders };
}

export function normalizeScimConfig(input = {}) {
  const baseUrl = String(input.baseUrl ?? input.scimBaseUrl ?? '').replace(/\/$/, '');
  const token = String(input.token ?? input.scimToken ?? input.bearerToken ?? '').trim();
  const usersPath = String(input.usersPath ?? '/Users').trim() || '/Users';
  return { baseUrl, token, usersPath };
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Accept: 'application/json',
      ...opts.headers,
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = typeof data === 'object' && data?.message ? data.message : text || res.statusText;
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return data;
}

export async function testRestBearer(raw) {
  const cfg = normalizeRestConfig(raw);
  if (!cfg.baseUrl) throw new Error('REST base URL is required.');
  if (!cfg.bearerToken) throw new Error('Bearer token is required.');
  const url = `${cfg.baseUrl}${cfg.usersPath.startsWith('/') ? cfg.usersPath : `/${cfg.usersPath}`}`;
  const data = await fetchJson(url, {
    method: cfg.method,
    headers: {
      Authorization: `Bearer ${cfg.bearerToken}`,
      ...cfg.extraHeaders,
    },
  });
  const list = extractUserArray(data, cfg.jsonPath);
  return { ok: true, sampleCount: Array.isArray(list) ? list.length : 0, hint: 'Parsed user array from JSON response.' };
}

function extractUserArray(data, jsonPath) {
  if (jsonPath) {
    const nested = getNested(data, jsonPath);
    if (Array.isArray(nested)) return nested;
  }
  if (Array.isArray(data)) return data;
  if (data?.users && Array.isArray(data.users)) return data.users;
  if (data?.data && Array.isArray(data.data)) return data.data;
  if (data?.records && Array.isArray(data.records)) return data.records;
  return [];
}

export async function fetchRestUsers(raw, options = {}) {
  const cfg = normalizeRestConfig(raw);
  if (!cfg.baseUrl) throw new Error('REST base URL is required.');
  if (!cfg.bearerToken) throw new Error('Bearer token is required.');
  const maxUsers = Math.min(Math.max(parseInt(options.maxUsers, 10) || 10000, 1), 50000);
  const url = `${cfg.baseUrl}${cfg.usersPath.startsWith('/') ? cfg.usersPath : `/${cfg.usersPath}`}`;
  const data = await fetchJson(url, {
    method: cfg.method,
    headers: {
      Authorization: `Bearer ${cfg.bearerToken}`,
      ...cfg.extraHeaders,
    },
  });
  let list = extractUserArray(data, cfg.jsonPath);
  if (!Array.isArray(list)) list = [];
  list = list.slice(0, maxUsers);
  return list.map((row, i) => mapLooseJsonUser(row, i));
}

function mapLooseJsonUser(row, index) {
  if (!row || typeof row !== 'object') {
    return {
      user_id: String(index),
      email: '',
      display_name: String(row),
      rawData: { value: row },
    };
  }
  const id =
    row.id ??
    row.user_id ??
    row.userId ??
    row.username ??
    row.login ??
    row.email ??
    `row_${index}`;
  const email = row.email ?? row.mail ?? row.userPrincipalName ?? '';
  const nameJoin = [row.firstName, row.lastName].filter(Boolean).join(' ');
  const display =
    row.display_name ??
    row.displayName ??
    row.name ??
    (nameJoin || String(id));
  return {
    user_id: String(id),
    employee_id: row.employee_id ?? row.employeeId ?? '',
    username: row.username ?? row.userName ?? String(id),
    email: String(email),
    display_name: String(display),
    status: row.status ?? row.active ?? 'active',
    department: row.department ?? '',
    title: row.title ?? '',
    manager_id: row.manager_id ?? row.manager ?? '',
    telephone: row.phone ?? row.telephone ?? '',
    member_of_entitlements: '',
    rawData: row,
  };
}

export async function testScimConnection(raw) {
  const cfg = normalizeScimConfig(raw);
  if (!cfg.baseUrl) throw new Error('SCIM base URL is required.');
  if (!cfg.token) throw new Error('SCIM access token is required.');
  const path = cfg.usersPath.startsWith('/') ? cfg.usersPath : `/${cfg.usersPath}`;
  const url = `${cfg.baseUrl}${path}${path.includes('?') ? '&' : '?'}count=1`;
  const data = await fetchJson(url, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/scim+json, application/json',
    },
  });
  const n = Array.isArray(data?.Resources) ? data.Resources.length : data?.totalResults ?? 0;
  return { ok: true, sampleCount: n, hint: 'SCIM /Users endpoint reachable.' };
}

export async function fetchScimUsers(raw, options = {}) {
  const cfg = normalizeScimConfig(raw);
  if (!cfg.baseUrl) throw new Error('SCIM base URL is required.');
  if (!cfg.token) throw new Error('SCIM access token is required.');
  const maxUsers = Math.min(Math.max(parseInt(options.maxUsers, 10) || 10000, 1), 50000);
  const path = cfg.usersPath.startsWith('/') ? cfg.usersPath : `/${cfg.usersPath}`;
  const base = `${cfg.baseUrl}${path}`;
  const out = [];
  let startIndex = 1;
  const pageSize = 100;
  while (out.length < maxUsers) {
    const sep = base.includes('?') ? '&' : '?';
    const url = `${base}${sep}startIndex=${startIndex}&count=${pageSize}`;
    const data = await fetchJson(url, {
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/scim+json, application/json',
      },
    });
    const resources = data?.Resources;
    if (!Array.isArray(resources) || resources.length === 0) break;
    for (const r of resources) {
      out.push(mapScimUser(r));
      if (out.length >= maxUsers) break;
    }
    if (resources.length < pageSize) break;
    startIndex += pageSize;
  }
  return out;
}

function mapScimUser(r) {
  const emails = r.emails || [];
  const primary = emails.find((e) => e.primary) || emails[0];
  const name = r.name || {};
  return {
    user_id: r.userName || r.id || '',
    employee_id: r.externalId || '',
    username: r.userName || '',
    email: primary?.value || '',
    display_name: r.displayName || [name.givenName, name.familyName].filter(Boolean).join(' ') || '',
    status: r.active === false ? 'disabled' : 'active',
    department: r['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User']?.department || '',
    title: r.title || '',
    manager_id: '',
    telephone: (r.phoneNumbers && r.phoneNumbers[0]?.value) || '',
    member_of_entitlements: (r.groups || []).map((g) => g.display || g.value).filter(Boolean).join('; '),
    rawData: r,
  };
}
