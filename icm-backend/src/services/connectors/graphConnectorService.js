/**
 * Microsoft Graph (Entra ID / Azure AD) — app-only (client credentials) user import.
 * Requires app registration with Application permission: User.Read.All (admin consent).
 */

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';

const DEFAULT_SELECT =
  'id,userPrincipalName,mail,mailNickname,displayName,givenName,surname,jobTitle,department,accountEnabled,officeLocation,mobilePhone,businessPhones';

export function normalizeGraphConfig(input = {}) {
  const tenantId = String(input.tenantId ?? input.graphTenantId ?? '').trim();
  const clientId = String(input.clientId ?? input.graphClientId ?? '').trim();
  const clientSecret = input.clientSecret ?? input.graphClientSecret ?? '';
  const scope = String(
    input.scope ?? input.graphScope ?? 'https://graph.microsoft.com/.default'
  ).trim();
  const authority = String(input.authority ?? input.graphAuthority ?? '').trim().replace(/\/$/, '');
  const userSelect = String(input.userSelect ?? input.graphUserSelect ?? '').trim() || DEFAULT_SELECT;
  return { tenantId, clientId, clientSecret, scope, authority, userSelect };
}

function tokenEndpoint(cfg) {
  if (cfg.authority) {
    return `${cfg.authority}/oauth2/v2.0/token`;
  }
  if (!cfg.tenantId) {
    throw new Error('Directory (tenant) ID is required.');
  }
  return `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;
}

async function fetchAccessToken(cfg) {
  if (!cfg.clientId) throw new Error('Application (client) ID is required.');
  if (cfg.clientSecret === undefined || cfg.clientSecret === '') {
    throw new Error('Client secret is required.');
  }
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: String(cfg.clientSecret),
    scope: cfg.scope,
    grant_type: 'client_credentials',
  });
  const res = await fetch(tokenEndpoint(cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const msg =
      data.error_description ||
      data.error ||
      (typeof data === 'object' && data.error?.message) ||
      text ||
      `HTTP ${res.status}`;
    throw new Error(String(msg).slice(0, 500));
  }
  if (!data.access_token) {
    throw new Error('Token response did not include access_token.');
  }
  return data.access_token;
}

async function graphGetJson(url, accessToken) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      data.error?.message ||
      data.error_description ||
      data.error ||
      text ||
      res.statusText;
    throw new Error(`Microsoft Graph: ${msg}`);
  }
  return data;
}

export function mapGraphUser(u) {
  if (!u || typeof u !== 'object') {
    return {
      user_id: '',
      employee_id: '',
      username: '',
      email: '',
      display_name: '',
      status: 'active',
      department: '',
      title: '',
      manager_id: '',
      telephone: '',
      member_of_entitlements: '',
      rawData: u,
    };
  }
  const upn = u.userPrincipalName || '';
  const mail = u.mail || '';
  const id = u.id || '';
  const nick = u.mailNickname || '';
  const local = upn.includes('@') ? upn.split('@')[0] : '';
  const user_id = nick || local || id;
  const display =
    u.displayName || [u.givenName, u.surname].filter(Boolean).join(' ') || upn || id;
  const phone =
    (Array.isArray(u.businessPhones) && u.businessPhones[0]) || u.mobilePhone || '';

  return {
    user_id: String(user_id || id),
    employee_id: upn,
    username: u.givenName || nick || local || String(id),
    email: String(mail || upn || ''),
    display_name: String(display),
    status: u.accountEnabled === false ? 'disabled' : 'active',
    department: u.department || '',
    title: u.jobTitle || '',
    manager_id: '',
    telephone: phone,
    member_of_entitlements: '',
    rawData: u,
  };
}

/**
 * Verify tenant ID, app credentials, and User.Read.All–equivalent access to /users.
 */
export async function testGraphConnection(raw) {
  const cfg = normalizeGraphConfig(raw);
  if (!cfg.tenantId && !cfg.authority) {
    throw new Error('Directory (tenant) ID or custom authority URL is required.');
  }
  const token = await fetchAccessToken(cfg);
  const select = cfg.userSelect
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',');
  const url = `${GRAPH_ROOT}/users?$top=1&$select=${encodeURIComponent(select)}`;
  const data = await graphGetJson(url, token);
  const n = Array.isArray(data.value) ? data.value.length : 0;
  return {
    ok: true,
    sampleCount: n,
    hint: 'Microsoft Graph /users reachable. Ensure User.Read.All (application) is granted and admin-consented.',
  };
}

export async function fetchGraphUsers(raw, options = {}) {
  const cfg = normalizeGraphConfig(raw);
  if (!cfg.tenantId && !cfg.authority) {
    throw new Error('Directory (tenant) ID or custom authority URL is required.');
  }
  const maxUsers = Math.min(Math.max(parseInt(options.maxUsers, 10) || 10000, 1), 50000);
  const token = await fetchAccessToken(cfg);
  const select = cfg.userSelect
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',');

  const out = [];
  let url = `${GRAPH_ROOT}/users?$select=${encodeURIComponent(select)}&$top=999`;

  while (url && out.length < maxUsers) {
    const data = await graphGetJson(url, token);
    const batch = Array.isArray(data.value) ? data.value : [];
    for (const u of batch) {
      out.push(mapGraphUser(u));
      if (out.length >= maxUsers) break;
    }
    if (out.length >= maxUsers) break;
    const next = data['@odata.nextLink'];
    url = typeof next === 'string' && next.length > 0 ? next : null;
  }

  return out;
}
