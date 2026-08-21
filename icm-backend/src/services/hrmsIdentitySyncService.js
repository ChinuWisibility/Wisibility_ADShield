import {
  getDynamicIdentityModelForTenantId,
  getLegacyIdentityModel,
} from '../models/identity/Identity.js';
import HrmsIntegration from '../models/integrations/HrmsIntegration.js';
import Application from '../models/application/Application.js';
import { runOrangeHrmIdentityRefresh, enqueueLifecycleTransitionsFromRefresh } from './identityProfileRefreshService.js';
import { recomputeIdentityTenantStats } from './identityTenantStatsService.js';
import env from '../config/env.js';
import { refreshHrmsAccessToken } from './hrmsTokenService.js';
import { safeErrorString } from '../utils/safeString.js';

function normalizeBaseUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

function firstString(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** OrangeHRM often returns `{ value: "a@b.com", label: "..." }` for contact fields. */
function unwrapOrangeField(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v.value != null) return String(v.value).trim();
  return '';
}

/**
 * OrangeHRM v2 list/detail payloads vary: email may be top-level, under contact/contactDetails, or missing.
 */
export function extractHrmsEmail(emp) {
  if (!emp || typeof emp !== 'object') return '';

  const direct = firstString(
    unwrapOrangeField(emp.email),
    unwrapOrangeField(emp.workEmail),
    unwrapOrangeField(emp.contactEmail),
    unwrapOrangeField(emp.work_email),
    unwrapOrangeField(emp.otherEmail),
    unwrapOrangeField(emp.personalEmail)
  );
  if (direct && LOOKS_LIKE_EMAIL.test(direct)) return direct.toLowerCase();

  const nested = emp.employee || {};
  const fromNested = firstString(
    unwrapOrangeField(nested.email),
    unwrapOrangeField(nested.workEmail),
    unwrapOrangeField(nested.contactEmail)
  );
  if (fromNested && LOOKS_LIKE_EMAIL.test(fromNested)) return fromNested.toLowerCase();

  const contact = emp.contact || nested.contact || {};
  const fromContact = firstString(
    unwrapOrangeField(contact.email),
    unwrapOrangeField(contact.workEmail),
    unwrapOrangeField(contact.work_email)
  );
  if (fromContact && LOOKS_LIKE_EMAIL.test(fromContact)) return fromContact.toLowerCase();

  const contactDetails = emp.contactDetails || nested.contactDetails || emp.contact_info || {};
  const fromDetails = firstString(
    unwrapOrangeField(contactDetails.workEmail),
    unwrapOrangeField(contactDetails.email),
    unwrapOrangeField(contactDetails.work_email),
    unwrapOrangeField(contactDetails.otherEmail)
  );
  if (fromDetails && LOOKS_LIKE_EMAIL.test(fromDetails)) return fromDetails.toLowerCase();

  const contactInfo = emp.contactInfo || nested.contactInfo || {};
  const fromInfo = firstString(
    unwrapOrangeField(contactInfo.email),
    unwrapOrangeField(contactInfo.workEmail)
  );
  if (fromInfo && LOOKS_LIKE_EMAIL.test(fromInfo)) return fromInfo.toLowerCase();

  const stack = [emp, nested, contact, contactDetails, contactInfo];
  for (const o of stack) {
    if (!o || typeof o !== 'object') continue;
    for (const [k, v] of Object.entries(o)) {
      const t = unwrapOrangeField(v) || (typeof v === 'string' ? v.trim() : '');
      if (!t) continue;
      if (/email/i.test(k) && LOOKS_LIKE_EMAIL.test(t)) return t.toLowerCase();
    }
  }

  const walk = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 3) return '';
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return '';
    }
    for (const v of Object.values(obj)) {
      if (typeof v === 'string') {
        const t = v.trim();
        if (LOOKS_LIKE_EMAIL.test(t)) return t.toLowerCase();
      } else if (v && typeof v === 'object') {
        const found = walk(v, depth + 1);
        if (found) return found;
      }
    }
    return '';
  };
  return walk(emp, 0);
}

function slugEmailLocalPart(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase()
    .slice(0, 48);
}

function syntheticDomain() {
  return (env.hrms?.syntheticEmailDomain || 'sync.local').toLowerCase().replace(/^@/, '');
}

export function isSyntheticHrmsEmail(email) {
  if (!email || typeof email !== 'string') return true;
  const d = syntheticDomain();
  return email.toLowerCase().endsWith(`@${d}`);
}

function syntheticHrmsEmail({ firstName, lastName, employeeId, tenantId }) {
  const f = slugEmailLocalPart(firstName) || 'user';
  const l = slugEmailLocalPart(lastName) || 'hrms';
  const id = String(employeeId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 32);
  const tail = id || String(tenantId).replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'id';
  return `${f}.${l}.${tail}@${syntheticDomain()}`.toLowerCase();
}

/**
 * Map OrangeHRM / generic REST employee payloads to Identity fields.
 */
export function mapHrmsEmployeeToIdentityPayload(emp, tenantId, sourceApplicationId) {
  const nested = emp.employee || emp;

  const firstName = firstString(emp.firstName, nested.firstName, emp.first_name);
  const lastName = firstString(emp.lastName, nested.lastName, emp.last_name);
  const displayName = firstString(
    emp.fullName,
    emp.displayName,
    nested.fullName,
    [firstName, lastName].filter(Boolean).join(' ')
  );

  const employeeId = firstString(
    emp.employeeId,
    emp.employee_id,
    emp.empNumber,
    emp.emp_number,
    emp.code,
    nested.employeeId,
    nested.empNumber,
    nested.id,
    emp.id
  );

  const rawEmail = extractHrmsEmail(emp);
  const email =
    rawEmail ||
    syntheticHrmsEmail({ firstName, lastName, employeeId, tenantId });

  const department = firstString(emp.department, nested.department, emp.unit, emp.subunit);
  const title = firstString(emp.jobTitle, emp.title, nested.jobTitle, nested.title);
  const managerEmail = firstString(emp.supervisorEmail, emp.managerEmail, nested.supervisorEmail);
  const statusStr = firstString(emp.status, nested.status);

  return {
    displayName: displayName || email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    email,
    employeeId: employeeId || undefined,
    department: department || undefined,
    title: title || undefined,
    managerEmail: managerEmail || undefined,
    tenantId,
    sourceApplication: sourceApplicationId || undefined,
    sourceApplicationName: 'OrangeHRM',
    attributes: { hrms: emp },
    isActive: !/(terminated|inactive|disabled|suspended)/i.test(statusStr || ''),
    lifecycleState: (() => {
      const raw = statusStr || '';
      if (/terminated|separation|ended|fired/i.test(raw)) return 'TERMINATED';
      if (/inactive|disabled|suspended/i.test(raw)) return 'INACTIVE';
      return 'ACTIVE';
    })(),
  };
}

/**
 * Map API employee JSON to Application account schema row (standardField keys from userMappings).
 * Used when Identity Profile mappings reference application_account_schema.
 */
export function hrmsEmployeeToSchemaRow(emp, tenantId, sourceApplicationId, userMappings) {
  const p = mapHrmsEmployeeToIdentityPayload(emp, tenantId, sourceApplicationId);
  const sup = firstString(
    emp.supervisor?.employeeId,
    emp.supervisorId,
    emp.supervisor_id,
    emp.supervisorEmpNumber,
    emp.supervisor?.empNumber,
  );
  const canonical = {
    email: p.email,
    firstName: p.firstName,
    lastName: p.lastName,
    firstname: p.firstName,
    lastname: p.lastName,
    displayName: p.displayName,
    employeeId: p.employeeId,
    department: p.department,
    title: p.title,
    managerEmail: p.managerEmail,
    managerEmployeeId: sup || undefined,
    phone: p.phoneNumber,
    phoneNumber: p.phoneNumber,
    status:
      p.lifecycleState === 'TERMINATED'
        ? 'TERMINATED'
        : p.lifecycleState === 'INACTIVE'
          ? 'INACTIVE'
          : 'ACTIVE',
  };
  const row = {};
  for (const um of userMappings || []) {
    const sf = String(um.standardField || '').trim();
    if (!sf) continue;
    if (canonical[sf] !== undefined && canonical[sf] !== null && canonical[sf] !== '') {
      row[sf] = canonical[sf];
    } else {
      const lower = sf.toLowerCase();
      if (canonical[lower] !== undefined && canonical[lower] !== null && canonical[lower] !== '') {
        row[sf] = canonical[lower];
      }
    }
  }
  return row;
}

/**
 * Extract list of employee objects from various OrangeHRM API JSON shapes.
 */
export function extractEmployeeList(json) {
  if (!json || typeof json !== 'object') return [];
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.data?.list)) return json.data.list;
  if (Array.isArray(json.data?.employees)) return json.data.employees;
  if (Array.isArray(json.employees)) return json.employees;
  if (Array.isArray(json.data?.data)) return json.data.data;
  if (Array.isArray(json)) return json;
  if (json.data && typeof json.data === 'object' && !Array.isArray(json.data)) return [json.data];
  return [];
}

/**
 * Flat HRMS doc + save() that persists to Application.hrms (for sync / token refresh).
 */
function buildHrmsDocShimFromApplication(app) {
  const h = app.hrms || {};
  const o = {
    _id: app._id,
    tenantId: app.tenantId,
    baseUrl: h.baseUrl,
    clientId: h.clientId,
    clientSecret: h.clientSecret,
    authorizePath: h.authorizePath,
    tokenPath: h.tokenPath,
    employeesApiPath: h.employeesApiPath,
    accessToken: h.accessToken,
    refreshToken: h.refreshToken,
    tokenExpiresAt: h.tokenExpiresAt,
    connectionStatus: h.connectionStatus,
    lastError: h.lastError,
    directoryTargetApplicationId: h.directoryTargetApplicationId,
    lastIdentitySyncAt: h.lastIdentitySyncAt,
    lastIdentitySyncCount: h.lastIdentitySyncCount,
    lastIdentitySyncError: h.lastIdentitySyncError,
    _applicationId: app._id,
  };
  o.save = async function saveHrmsShim() {
    const keys = [
      'accessToken',
      'refreshToken',
      'tokenExpiresAt',
      'connectionStatus',
      'lastError',
      'lastIdentitySyncAt',
      'lastIdentitySyncCount',
      'lastIdentitySyncError',
      'baseUrl',
      'clientId',
      'clientSecret',
      'authorizePath',
      'tokenPath',
      'employeesApiPath',
      'directoryTargetApplicationId',
    ];
    const $set = {};
    for (const k of keys) {
      if (this[k] !== undefined) $set[`hrms.${k}`] = this[k];
    }
    await Application.updateOne({ _id: this._applicationId }, { $set });
  };
  return o;
}

async function ensureAccessToken(doc) {
  const base = normalizeBaseUrl(doc.baseUrl);
  const tokenUrl = `${base}${doc.tokenPath || '/web/index.php/oauth2/token'}`;
  let accessToken = doc.accessToken;
  const expMs = doc.tokenExpiresAt ? new Date(doc.tokenExpiresAt).getTime() : 0;
  const tokenStillValid = accessToken && expMs && Date.now() < expMs - 30_000;

  if (tokenStillValid) {
    return accessToken;
  }

  if (doc.refreshToken && doc.clientId && doc.clientSecret) {
    const { ok, tr, errText } = await refreshHrmsAccessToken({
      tokenUrl,
      clientId: doc.clientId,
      clientSecret: doc.clientSecret,
      refreshToken: doc.refreshToken,
    });
    if (!ok) {
      throw new Error(errText || 'Failed to refresh HRMS access token');
    }
    accessToken = tr.access_token;
    doc.accessToken = tr.access_token;
    if (tr.refresh_token) doc.refreshToken = tr.refresh_token;
    if (tr.expires_in) {
      doc.tokenExpiresAt = new Date(Date.now() + Number(tr.expires_in) * 1000);
    }
    doc.connectionStatus = 'connected';
    doc.lastError = '';
    await doc.save();
    return accessToken;
  }

  if (accessToken) {
    return accessToken;
  }

  throw new Error('No HRMS access token — complete OAuth authorization first.');
}

/**
 * GET JSON from HRMS API with Bearer token.
 */
async function hrmsFetchJson(url, accessToken) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const text = await r.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _parseError: text?.slice?.(0, 500) };
  }
  if (!r.ok) {
    const isHtml = /^\s*</.test(text || '') || /<!DOCTYPE/i.test(text || '');
    const msg = isHtml
      ? `Not Found (server returned HTML — wrong URL or OrangeHRM base path).`
      : json?.error?.message || json.message || text?.slice(0, 300) || r.statusText;
    throw new Error(`HRMS API ${r.status}: ${safeErrorString(msg)}`);
  }
  return json;
}

function normalizeEmployeeApiPath(p) {
  if (!p || !String(p).trim()) return '';
  let s = String(p).trim();
  if (!s.startsWith('/')) s = `/${s}`;
  return s.replace(/\/+$/, '');
}

/**
 * OrangeHRM 5.x documents REST under /web/index.php/api/v2/pim/employees (see public demo).
 * Older docs used /api/v1/employees — try v2 first, then v1.
 */
export function getHrmsEmployeeApiBaseUrls(baseUrl, employeesApiPath) {
  const b = normalizeBaseUrl(baseUrl);
  const custom = normalizeEmployeeApiPath(employeesApiPath);
  const out = [];
  if (custom) out.push(`${b}${custom}`);
  out.push(
    `${b}/web/index.php/api/v2/pim/employees`,
    `${b}/index.php/api/v2/pim/employees`,
    `${b}/api/v2/pim/employees`,
    `${b}/web/index.php/api/v1/employees`,
    `${b}/index.php/api/v1/employees`,
    `${b}/api/v1/employees`
  );
  return [...new Set(out)];
}

async function paginateEmployees(root, accessToken, maxEmployees) {
  const collected = [];
  const pageSize = 100;
  let offset = 0;
  for (let i = 0; i < 500; i += 1) {
    const u = new URL(root);
    u.searchParams.set('limit', String(pageSize));
    u.searchParams.set('offset', String(offset));
    const json = await hrmsFetchJson(u.toString(), accessToken);
    const batch = extractEmployeeList(json);
    if (batch.length === 0) break;
    for (const emp of batch) {
      collected.push(emp);
      if (collected.length >= maxEmployees) return collected;
    }
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return collected;
}

/**
 * Try each candidate URL until one returns HTTP 200 pages (empty or not).
 * Does not throw the first path's 404 if a later path succeeds with an empty list.
 */
async function fetchAllEmployees(base, accessToken, hrmsDoc, { maxEmployees = 20000 } = {}) {
  const roots = getHrmsEmployeeApiBaseUrls(base, hrmsDoc?.employeesApiPath);
  let lastErr = null;
  let gotSuccessfulRead = false;

  for (const root of roots) {
    try {
      const list = await paginateEmployees(root, accessToken, maxEmployees);
      if (list.length > 0) return list;
      gotSuccessfulRead = true;
    } catch (e) {
      lastErr = e;
    }
  }

  if (gotSuccessfulRead) return [];

  if (lastErr) {
    const hint =
      String(lastErr.message || '').includes('404')
        ? ' Use base URL = the folder where OrangeHRM loads in the browser (e.g. http://localhost/orangehrm). Default list path is /web/index.php/api/v2/pim/employees — set "Employees API path" if your install differs.'
        : '';
    throw new Error(`${lastErr.message || 'HRMS employee API failed'}.${hint}`);
  }

  throw new Error(
    'No employees returned from HRMS (verify REST API, token scopes, and OrangeHRM version).'
  );
}

async function hrmsFetchJsonOptional(url, accessToken) {
  try {
    return await hrmsFetchJson(url, accessToken);
  } catch {
    return null;
  }
}

function getEmpNumberForApi(emp) {
  return firstString(
    emp.empNumber,
    emp.emp_number,
    emp.employeeId,
    emp.employee_id,
    emp.code,
    emp.employee?.empNumber,
    emp.id
  );
}

/**
 * List endpoint often omits work email; OrangeHRM exposes it on GET .../employee/{empNumber}/contact-details.
 */
async function tryPersonalDetailsEmail(base, accessToken, encoded) {
  const urls = [
    `${base}/web/index.php/api/v2/pim/employee/${encoded}/personal-details`,
    `${base}/index.php/api/v2/pim/employee/${encoded}/personal-details`,
    `${base}/api/v2/pim/employee/${encoded}/personal-details`,
  ];
  for (const url of urls) {
    const json = await hrmsFetchJsonOptional(url, accessToken);
    if (!json) continue;
    const payload = json.data !== undefined ? json.data : json;
    const email = extractHrmsEmail(payload) || extractHrmsEmail(json);
    if (email && LOOKS_LIKE_EMAIL.test(email) && !isSyntheticHrmsEmail(email)) return email;
  }
  return '';
}

async function enrichEmployeeWithContactDetails(base, accessToken, emp) {
  const current = extractHrmsEmail(emp);
  if (current && !isSyntheticHrmsEmail(current)) {
    return emp;
  }
  const empNum = getEmpNumberForApi(emp);
  if (!empNum) return emp;

  const encoded = encodeURIComponent(String(empNum).trim());
  const contactUrls = [
    `${base}/web/index.php/api/v2/pim/employee/${encoded}/contact-details`,
    `${base}/index.php/api/v2/pim/employee/${encoded}/contact-details`,
    `${base}/api/v2/pim/employee/${encoded}/contact-details`,
  ];

  for (const url of contactUrls) {
    const json = await hrmsFetchJsonOptional(url, accessToken);
    if (!json) continue;
    const payload = json.data !== undefined ? json.data : json;
    const email = extractHrmsEmail(payload) || extractHrmsEmail(json);
    if (email && LOOKS_LIKE_EMAIL.test(email) && !isSyntheticHrmsEmail(email)) {
      return {
        ...emp,
        email,
        contactEmail: email,
        _contactDetailsEnriched: true,
      };
    }
  }

  const fromPersonal = await tryPersonalDetailsEmail(base, accessToken, encoded);
  if (fromPersonal) {
    return {
      ...emp,
      email: fromPersonal,
      contactEmail: fromPersonal,
      _contactDetailsEnriched: true,
    };
  }

  return emp;
}

async function enrichEmployeesWithContactDetails(base, accessToken, employees, concurrency = 5) {
  const result = [];
  for (let i = 0; i < employees.length; i += concurrency) {
    const batch = employees.slice(i, i + concurrency);
    const merged = await Promise.all(
      batch.map((emp) => enrichEmployeeWithContactDetails(base, accessToken, emp))
    );
    result.push(...merged);
  }
  return result;
}

/**
 * Upsert identities from HRMS for a tenant. Returns counts and errors sample.
 */
export async function syncIdentitiesFromHrms(tenantId, hrmsIntegrationId = null) {
  let doc;
  if (hrmsIntegrationId) {
    const app = await Application.findOne({
      _id: hrmsIntegrationId,
      tenantId,
      'hrms.connector': { $exists: true },
    });
    if (app?.hrms) {
      doc = buildHrmsDocShimFromApplication(app);
    } else {
      const appByLegacy = await Application.findOne({ tenantId, 'hrms.migratedFromHrmsId': hrmsIntegrationId });
      if (appByLegacy?.hrms) {
        doc = buildHrmsDocShimFromApplication(appByLegacy);
      } else {
        doc = await HrmsIntegration.findOne({ _id: hrmsIntegrationId, tenantId });
      }
    }
  } else {
    const app = await Application.findOne({ tenantId, 'hrms.connector': { $exists: true } }).sort({
      createdAt: 1,
    });
    if (app?.hrms) {
      doc = buildHrmsDocShimFromApplication(app);
    } else {
      doc = await HrmsIntegration.findOne({ tenantId }).sort({ createdAt: 1 });
    }
  }
  if (!doc) {
    throw new Error('HRMS integration is not configured for this tenant.');
  }
  if (!doc.baseUrl) {
    throw new Error('HRMS base URL is missing.');
  }

  const syncStartedAt = new Date();

  const accessToken = await ensureAccessToken(doc);
  const base = normalizeBaseUrl(doc.baseUrl);
  const targetAppId = doc.directoryTargetApplicationId || null;

  let employees = await fetchAllEmployees(base, accessToken, doc);
  employees = await enrichEmployeesWithContactDetails(base, accessToken, employees);

  const applicationId = doc._applicationId;
  if (applicationId) {
    const refreshed = await runOrangeHrmIdentityRefresh(tenantId, applicationId, employees);
    if (refreshed) {
      doc.lastIdentitySyncAt = new Date();
      doc.lastIdentitySyncCount = refreshed.identitiesUpserted;
      doc.lastIdentitySyncError = refreshed.errorCount ? safeErrorString(refreshed.errors) : '';
      await doc.save();
      try {
        await recomputeIdentityTenantStats(tenantId);
      } catch (e) {
        console.error('[hrms-sync] tenant stats recompute failed', e?.message || e);
      }

      // Lifecycle events are enqueued by identity profile refresh (authoritative boundary).
      return {
        totalEmployeesFetched: employees.length,
        identitiesUpserted: refreshed.identitiesUpserted,
        skippedNoEmailOrName: refreshed.skippedNoEmailOrName,
        managersLinked: refreshed.managersLinked,
        contactDetailsEnriched: employees.filter((e) => e._contactDetailsEnriched).length,
        mode: 'identity_profile',
        errors: refreshed.errors,
        errorCount: refreshed.errorCount,
      };
    }
  }

  let upserted = 0;
  const errors = [];
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const LegacyIdentity = getLegacyIdentityModel();
  const lifecycleSnapshots = [];

  for (const emp of employees) {
    try {
      const { _contactDetailsEnriched: _enr, ...empClean } = emp;
      const payload = mapHrmsEmployeeToIdentityPayload(empClean, tenantId, targetAppId);
      const emailKey = payload.email?.toLowerCase().trim();
      const q = payload.employeeId
        ? { tenantId, employeeId: String(payload.employeeId).trim() }
        : { tenantId, email: emailKey };
      const before = await Identity.findOne(q).lean();
      const update = { $set: { ...payload, email: emailKey } };
      const [updated] = await Promise.all([
        Identity.findOneAndUpdate(q, update, { upsert: true, new: true, runValidators: true }),
        LegacyIdentity.findOneAndUpdate(q, update, { upsert: true, new: true, runValidators: true }),
      ]);
      upserted += 1;
      const after =
        updated && typeof updated.toObject === "function" ? updated.toObject() : updated;
      if (after?._id) {
        lifecycleSnapshots.push({ identityId: after._id, before, after });
      }
    } catch (err) {
      errors.push({ id: emp?.id ?? emp?.employeeId, error: err.message });
    }
  }

  doc.lastIdentitySyncAt = new Date();
  doc.lastIdentitySyncCount = upserted;
  doc.lastIdentitySyncError = errors.length ? safeErrorString(errors.slice(0, 3)) : '';
  await doc.save();

  try {
    await recomputeIdentityTenantStats(tenantId);
  } catch (e) {
    console.error('[hrms-sync] tenant stats recompute failed', e?.message || e);
  }

  try {
    const syncJobId = `hrms-legacy:${syncStartedAt.toISOString()}`;
    console.log(
      '[lifecycle] HRMS_LEGACY_DELTAS',
      JSON.stringify({ tenantId: String(tenantId), count: lifecycleSnapshots.length, syncJobId }),
    );
    await enqueueLifecycleTransitionsFromRefresh({
      transitions: lifecycleSnapshots.map((snap) => ({
        tenantId,
        identityId: snap.identityId,
        before: snap.before,
        after: snap.after,
      })),
      syncJobId,
      triggeredBy: 'HRMS',
      sourceApplicationId: targetAppId || applicationId,
    });
  } catch (e) {
    console.warn('[lifecycle] post-sync schedule failed:', e?.message || e);
  }

  return {
    totalEmployeesFetched: employees.length,
    identitiesUpserted: upserted,
    contactDetailsEnriched: employees.filter((e) => e._contactDetailsEnriched).length,
    errors: errors.slice(0, 20),
    errorCount: errors.length,
  };
}
