import crypto from 'crypto';
import mongoose from 'mongoose';
import env from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import User from '../models/platform/User.js';
import Application from '../models/application/Application.js';
import HrmsIntegration from '../models/integrations/HrmsIntegration.js';
import IdentityProfile from '../models/identity/IdentityProfile.js';
import { migrateHrmsIntegrationsIntoApplicationsOnce } from '../utils/migrateHrmsIntoApplications.js';
import { ensureDelimitedHrmsStubApplicationsOnce } from '../utils/ensureDelimitedHrmsStubs.js';
import { safeErrorString } from '../utils/safeString.js';
import { syncIdentitiesFromHrms, getHrmsEmployeeApiBaseUrls } from '../services/hrmsIdentitySyncService.js';
import { materializeDelimitedImportToApplicationUsers } from '../services/delimitedApplicationUserSync.js';
import { loadPreviewSampleRows } from '../utils/applicationPreviewRows.js';
import { getDynamicUserModelForTenantId } from '../models/application/Users.js';
import csv from 'csv-parser';
import streamifier from 'streamifier';

function normalizeBaseUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

function defaultAuthorizeUrl(base) {
  const b = normalizeBaseUrl(base);
  if (!b) return '';
  return `${b}/web/index.php/oauth2/authorize`;
}

function defaultTokenUrl(base) {
  const b = normalizeBaseUrl(base);
  if (!b) return '';
  return `${b}/web/index.php/oauth2/token`;
}

function signState(payload) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', env.jwt.secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyState(token) {
  if (!token || typeof token !== 'string') throw new Error('Missing state');
  const [data, sig] = token.split('.');
  if (!data || !sig) throw new Error('Invalid state');
  const expected = crypto.createHmac('sha256', env.jwt.secret).update(data).digest('base64url');
  if (sig.length !== expected.length) throw new Error('Invalid state signature');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('Invalid state signature');
  }
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  if (!payload.exp || Date.now() > payload.exp) throw new Error('State expired');
  return payload;
}

async function resolveTenantId(req) {
  const user = await User.findById(req.user.id).select('tenantId role').lean();
  if (!user) throw new AppError('User not found', 404);
  if (user.role === 'superAdmin' && (req.query.tenantId || req.body?.tenantId)) {
    const tid = req.query.tenantId || req.body.tenantId;
    return new mongoose.Types.ObjectId(String(tid));
  }
  if (!user.tenantId) {
    if (user.role === 'superAdmin') {
      throw new AppError(
        'Pass tenantId in the query string or JSON body (super admin has no default tenant).',
        400,
        'TENANT_REQUIRED'
      );
    }
    throw new AppError('Your account has no tenant. Assign a tenant before configuring HRMS.', 400, 'NO_TENANT');
  }
  return user.tenantId;
}

function maskSecret(s) {
  if (!s || s.length < 4) return s ? '****' : '';
  return `${s.slice(0, 2)}…${s.slice(-2)}`;
}

/** One-time per process: backfill `name` for legacy single-document-per-tenant rows. */
let legacyHrmsNamesDone = false;
export async function ensureLegacyHrmsNamesOnce() {
  if (legacyHrmsNamesDone) return;
  await HrmsIntegration.updateMany({ isActive: { $exists: false } }, { $set: { isActive: true } });
  const needs = await HrmsIntegration.find({
    $or: [{ name: { $exists: false } }, { name: null }, { name: '' }],
  });
  for (const doc of needs) {
    const base = doc.displayName || 'OrangeHRM';
    let name = base;
    let n = 0;
    // eslint-disable-next-line no-await-in-loop
    while (await HrmsIntegration.findOne({ tenantId: doc.tenantId, name, _id: { $ne: doc._id } })) {
      n += 1;
      name = `${base} (${n})`;
    }
    doc.name = name;
    // eslint-disable-next-line no-await-in-loop
    await doc.save();
  }
  legacyHrmsNamesDone = true;
  await migrateHrmsIntegrationsIntoApplicationsOnce();
  await ensureDelimitedHrmsStubApplicationsOnce();
}

/**
 * Resolve tenant + HRMS integration document (App Registry application with hrms, or legacy hrms_integrations).
 */
async function resolveHrmsDoc(req, sourceId) {
  const tenantId = await resolveTenantId(req);
  const sid = sourceId != null && String(sourceId).trim() !== '' ? String(sourceId).trim() : '';
  if (sid) {
    if (!mongoose.Types.ObjectId.isValid(sid)) {
      throw new AppError('Invalid HRMS source id.', 400);
    }
      const app = await Application.findOne({
        _id: sid,
        tenantId,
        $or: [
          { 'hrms.connector': { $exists: true } },
          { connectorType: { $regex: /delimited.?file/i } }
        ]
      });
    if (app) return { tenantId, doc: app };
    const appLegacy = await Application.findOne({ tenantId, 'hrms.migratedFromHrmsId': sid });
    if (appLegacy) return { tenantId, doc: appLegacy };
    const doc = await HrmsIntegration.findOne({ _id: sid, tenantId });
    if (!doc) throw new AppError('HRMS source not found.', 404);
    return { tenantId, doc };
  }
  const app = await Application.findOne({ 
    tenantId, 
    $or: [
      { 'hrms.connector': { $exists: true } },
      { connectorType: { $regex: /delimited.?file/i } }
    ]
  }).sort({ createdAt: 1 });
  if (app) return { tenantId, doc: app };
  const doc = await HrmsIntegration.findOne({ tenantId }).sort({ createdAt: 1 });
  return { tenantId, doc };
}

/** HRMS fields live on `doc` (legacy) or `doc.hrms` (App Registry). */
function getHrmsNested(doc) {
  if (!doc) return null;
  if (doc.constructor?.modelName === 'Application') {
    if (!doc.hrms) doc.hrms = {};
    const isDelimited = doc.connectorType && /delimited.?file/i.test(doc.connectorType);
    if (!doc.hrms.connector && isDelimited) {
      doc.hrms.connector = 'delimited_file';
    }
    return doc.hrms;
  }
  return doc;
}

/** OrangeHRM Starter requires PKCE (RFC 7636) on authorize + token requests. */
function generatePkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

/**
 * OrangeHRM / PHP OAuth2 servers vary: some expect client_id+secret in body, others HTTP Basic.
 * OrangeHRM Starter also requires `code_verifier` when PKCE was used at authorize.
 */
async function exchangeAuthorizationCode({ tokenUrl, clientId, clientSecret, code, redirectUri, codeVerifier }) {
  const parseJson = async (res) => {
    const text = await res.text();
    let tr = {};
    try {
      tr = text ? JSON.parse(text) : {};
    } catch {
      tr = { raw: text };
    }
    const raw = tr.error_description ?? tr.error ?? tr.message ?? text ?? res.statusText;
    const errText = safeErrorString(raw);
    return { res, tr, errText };
  };

  const formWithSecret = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code),
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  if (codeVerifier) formWithSecret.set('code_verifier', codeVerifier);

  const formNoSecret = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code),
    client_id: clientId,
    redirect_uri: redirectUri,
  });
  if (codeVerifier) formNoSecret.set('code_verifier', codeVerifier);

  const basic = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');

  const attempts = [
    {
      name: 'form',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: formWithSecret,
      },
    },
    {
      name: 'basic',
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Authorization: `Basic ${basic}`,
        },
        body: formNoSecret,
      },
    },
  ];

  let lastErr = 'Token exchange failed';
  for (const { init } of attempts) {
    const r = await fetch(tokenUrl, init);
    const { tr, errText } = await parseJson(r);
    if (r.ok && tr.access_token) {
      return { ok: true, tr, errText: '' };
    }
    lastErr = errText || lastErr;
  }

  return { ok: false, tr: {}, errText: safeErrorString(lastErr) };
}

export async function getHrmsConfig(req, res, next) {
  try {
    await ensureLegacyHrmsNamesOnce();
    const sourceId = req.query.sourceId;
    const { tenantId, doc: found } = await resolveHrmsDoc(req, sourceId);
    let doc;
    if (!found) {
      doc = {
        _id: null,
        tenantId,
        provider: 'orangehrm',
        connector: 'orangehrm',
        name: '',
        description: '',
        baseUrl: '',
        clientId: '',
        connectionStatus: 'disconnected',
        authoritativeIdentitySource: false,
        directoryTargetApplicationId: null,
        hasClientSecret: false,
        lastIdentitySyncAt: null,
        lastIdentitySyncCount: null,
        lastIdentitySyncError: null,
        employeesApiPath: '',
      };
    } else {
      const raw =
        found.constructor?.modelName === 'Application'
          ? (() => {
              const a = found.toObject ? found.toObject() : found;
              const h = a.hrms || {};
              return {
                ...h,
                _id: a._id,
                tenantId: a.tenantId,
                name: a.name,
                description: a.description,
              };
            })()
          : found.toObject
            ? found.toObject()
            : { ...found };
      const hadSecret = Boolean(raw.clientSecret && String(raw.clientSecret).length > 0);
      doc = {
        ...raw,
        clientSecret: raw.clientSecret ? maskSecret(raw.clientSecret) : '',
        accessToken: raw.accessToken ? '********' : '',
        refreshToken: raw.refreshToken ? '********' : '',
        hasClientSecret: hadSecret,
      };
    }
    const callbackUrl = `${env.backendUrl.replace(/\/+$/, '')}/api/integrations/hrms/oauth/callback`;
    res.json({
      success: true,
      data: {
        ...doc,
        lastIdentitySyncAt: doc.lastIdentitySyncAt,
        lastIdentitySyncCount: doc.lastIdentitySyncCount,
        lastIdentitySyncError: doc.lastIdentitySyncError,
        callbackUrl,
        defaultAuthorizeUrl: defaultAuthorizeUrl(doc.baseUrl),
        defaultTokenUrl: defaultTokenUrl(doc.baseUrl),
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function putHrmsConfig(req, res, next) {
  try {
    await ensureLegacyHrmsNamesOnce();
    const {
      baseUrl,
      clientId,
      clientSecret,
      authorizePath,
      tokenPath,
      employeesApiPath,
      authoritativeIdentitySource,
      directoryTargetApplicationId,
      sourceId,
    } = req.body || {};

    let { tenantId, doc } = await resolveHrmsDoc(req, sourceId);
    if (!doc) {
      let name = 'OrangeHRM';
      let n = 0;
      // eslint-disable-next-line no-await-in-loop
      while (await Application.findOne({ tenantId, name })) {
        n += 1;
        name = `OrangeHRM (${n})`;
      }
      doc = new Application({
        tenantId,
        name,
        description: '',
        type: 'erp',
        integrationType: 'connector',
        connectorType: 'HRMS_ORANGEHRM',
        hrms: { connector: 'orangehrm' },
        createdBy: req.user.id,
        updatedBy: req.user.id,
      });
    }

    const h = getHrmsNested(doc);
    if (baseUrl !== undefined) h.baseUrl = normalizeBaseUrl(baseUrl);
    if (clientId !== undefined) h.clientId = String(clientId).trim();
    if (clientSecret !== undefined && clientSecret !== '' && !String(clientSecret).includes('…')) {
      h.clientSecret = clientSecret;
    }
    if (authorizePath !== undefined) h.authorizePath = String(authorizePath || '').trim() || h.authorizePath;
    if (tokenPath !== undefined) h.tokenPath = String(tokenPath || '').trim() || h.tokenPath;
    if (employeesApiPath !== undefined) {
      h.employeesApiPath = String(employeesApiPath || '').trim();
    }
    if (typeof authoritativeIdentitySource === 'boolean') {
      h.authoritativeIdentitySource = authoritativeIdentitySource;
    }

    if (directoryTargetApplicationId !== undefined && directoryTargetApplicationId !== null) {
      const targetApp = await Application.findOne({
        _id: directoryTargetApplicationId,
        tenantId,
      });
      if (!targetApp) {
        throw new AppError('Application not found for this tenant.', 404);
      }
      h.directoryTargetApplicationId = targetApp._id;
    } else if (directoryTargetApplicationId === null) {
      h.directoryTargetApplicationId = null;
    }

    doc.updatedBy = req.user.id;
    await doc.save();

    await syncDirectoryTargetFlags(tenantId, h.directoryTargetApplicationId);

    const callbackUrl = `${env.backendUrl.replace(/\/+$/, '')}/api/integrations/hrms/oauth/callback`;
    res.json({
      success: true,
      data: {
        _id: doc._id,
        tenantId: doc.tenantId,
        baseUrl: h.baseUrl,
        clientId: h.clientId,
        clientSecret: h.clientSecret ? maskSecret(h.clientSecret) : '',
        hasClientSecret: Boolean(h.clientSecret && String(h.clientSecret).length > 0),
        connectionStatus: h.connectionStatus,
        authoritativeIdentitySource: h.authoritativeIdentitySource,
        directoryTargetApplicationId: h.directoryTargetApplicationId,
        employeesApiPath: h.employeesApiPath || '',
        callbackUrl,
      },
    });
  } catch (e) {
    next(e);
  }
}

async function syncDirectoryTargetFlags(tenantId, targetId) {
  await Application.updateMany({ tenantId }, { $set: { hrmsDirectoryTarget: false } });
  if (targetId) {
    await Application.updateOne({ _id: targetId, tenantId }, { $set: { hrmsDirectoryTarget: true } });
  }
}

async function recomputeHrmsDirectoryTargetForTenant(tenantId) {
  const app = await Application.findOne({
    tenantId,
    'hrms.directoryTargetApplicationId': { $ne: null },
  }).sort({ createdAt: 1 });
  if (app?.hrms?.directoryTargetApplicationId) {
    await syncDirectoryTargetFlags(tenantId, app.hrms.directoryTargetApplicationId);
    return;
  }
  const legacy = await HrmsIntegration.findOne({
    tenantId,
    directoryTargetApplicationId: { $ne: null },
  }).sort({ createdAt: 1 });
  await syncDirectoryTargetFlags(tenantId, legacy?.directoryTargetApplicationId || null);
}

/**
 * Build OrangeHRM authorize URL (client uses POST + Bearer, then window.location).
 */
export async function startHrmsOAuth(req, res, next) {
  try {
    await ensureLegacyHrmsNamesOnce();
    const body = req.body || {};
    const { tenantId, doc } = await resolveHrmsDoc(req, body.sourceId);
    if (!doc) {
      throw new AppError('Save HRMS settings first (or create an HRMS source).', 400);
    }
    const h = getHrmsNested(doc);
    if (h.connector === 'delimited_file') {
      throw new AppError('OAuth is not used for Delimited File sources.', 400);
    }
    const baseUrl = normalizeBaseUrl(body.baseUrl) || normalizeBaseUrl(h?.baseUrl);
    const clientId = String(body.clientId || h?.clientId || '').trim();
    let authorizePath = String(body.authorizePath || h?.authorizePath || '').trim() || '/web/index.php/oauth2/authorize';
    if (!authorizePath.startsWith('/')) authorizePath = `/${authorizePath}`;
    if (!baseUrl || !clientId) {
      throw new AppError(
        'Base URL and client ID are required (enter them in the form, or save settings first).',
        400
      );
    }
    const redirectUri = `${env.backendUrl.replace(/\/+$/, '')}/api/integrations/hrms/oauth/callback`;
    const authBase = `${baseUrl}${authorizePath}`;
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const state = signState({
      tid: String(tenantId),
      sid: String(doc._id),
      uid: String(req.user.id),
      exp: Date.now() + 15 * 60 * 1000,
      cv: codeVerifier,
    });
    let authorizeUrl;
    try {
      const url = new URL(authBase);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl = url.toString();
    } catch {
      throw new AppError('Invalid authorize URL — check base URL and authorize path.', 400);
    }
    res.json({ success: true, data: { authorizeUrl, redirectUri } });
  } catch (e) {
    next(e);
  }
}

/**
 * OAuth callback (public — validated via signed state).
 */
export async function hrmsOAuthCallback(req, res, next) {
  try {
    const { code, state, error, error_description: errDesc } = req.query;
    const frontend = env.frontendUrl.replace(/\/+$/, '');
    const redirectFail = (msg) => {
      res.redirect(`${frontend}/applications/hrms-sources?hrms_error=${encodeURIComponent(msg)}`);
    };
    if (error) {
      return redirectFail(String(errDesc || error));
    }
    if (!code || !state) {
      return redirectFail('Missing code or state');
    }

    let payload;
    try {
      payload = verifyState(state);
    } catch (e) {
      return redirectFail(e.message || 'Invalid state');
    }

    const tenantId = new mongoose.Types.ObjectId(payload.tid);
    if (!payload.cv || typeof payload.cv !== 'string') {
      return redirectFail(
        'OAuth session is missing PKCE data (complete Authorize again from the HRMS integration page).'
      );
    }
    let doc;
    if (payload.sid && mongoose.Types.ObjectId.isValid(String(payload.sid))) {
      const sid = payload.sid;
      doc = await Application.findOne({ 
        _id: sid, 
        tenantId, 
        $or: [
          { 'hrms.connector': { $exists: true } },
          { connectorType: { $regex: /delimited.?file/i } }
        ]
      });
      if (!doc) {
        doc = await Application.findOne({ tenantId, 'hrms.migratedFromHrmsId': sid });
      }
      if (!doc) {
        doc = await HrmsIntegration.findOne({ _id: sid, tenantId });
      }
    } else {
      doc = await Application.findOne({ 
        tenantId, 
        $or: [
          { 'hrms.connector': { $exists: true } },
          { connectorType: { $regex: /delimited.?file/i } }
        ]
      }).sort({ createdAt: 1 });
      if (!doc) {
        doc = await HrmsIntegration.findOne({ tenantId }).sort({ createdAt: 1 });
      }
    }
    const h = getHrmsNested(doc);
    if (!h?.clientId || !h?.clientSecret) {
      return redirectFail(
        'Client secret is missing in IGA. Open OrangeHRM → Admin → OAuth Clients, copy the client secret for this app, paste it in IGA (HRMS source page), click Save, then run Authorize again.'
      );
    }

    const redirectUri = `${env.backendUrl.replace(/\/+$/, '')}/api/integrations/hrms/oauth/callback`;
    const tokenBase = `${normalizeBaseUrl(h.baseUrl)}${h.tokenPath || '/web/index.php/oauth2/token'}`;

    const { tr, errText, ok } = await exchangeAuthorizationCode({
      tokenUrl: tokenBase,
      clientId: h.clientId,
      clientSecret: h.clientSecret,
      code: String(code),
      redirectUri,
      codeVerifier: payload.cv,
    });

    if (!ok) {
      h.connectionStatus = 'error';
      h.lastError = safeErrorString(errText || 'Token exchange failed');
      await doc.save();
      const hint =
        /client authentication|invalid_client/i.test(errText || '')
          ? ' OrangeHRM rejected the client id/secret — confirm the secret matches your OAuth client (re-copy from OrangeHRM) and that the redirect URI in OrangeHRM is exactly: ' +
            redirectUri
          : '';
      return redirectFail((errText || 'Token exchange failed') + hint);
    }

    h.accessToken = tr.access_token || '';
    h.refreshToken = tr.refresh_token || '';
    if (tr.expires_in) {
      h.tokenExpiresAt = new Date(Date.now() + Number(tr.expires_in) * 1000);
    }
    h.connectionStatus = 'connected';
    h.lastError = '';
    h.lastAuthorizedAt = new Date();
    await doc.save();

    res.redirect(`${frontend}/applications/hrms-integration/${doc._id}?hrms_connected=1`);
  } catch (e) {
    next(e);
  }
}

export async function testHrmsConnection(req, res, next) {
  try {
    await ensureLegacyHrmsNamesOnce();
    const sourceId = req.query.sourceId || req.body?.sourceId;
    const { doc } = await resolveHrmsDoc(req, sourceId);
    if (!doc) {
      throw new AppError('No HRMS source configured.', 404);
    }
    const hn = getHrmsNested(doc);
    if (hn.connector === 'delimited_file') {
      throw new AppError('Test connection is not available for Delimited File sources.', 400);
    }
    if (!hn?.accessToken) {
      throw new AppError('Not connected — complete OAuth first.', 400);
    }
    const base = normalizeBaseUrl(hn.baseUrl);
    const candidates = [
      ...getHrmsEmployeeApiBaseUrls(base, hn.employeesApiPath),
      `${base}/web/index.php/api/v1/users`,
      `${base}/api/v1/users`,
    ];
    let lastErr = '';
    for (const u of candidates) {
      try {
        const r = await fetch(u, {
          headers: { Authorization: `Bearer ${hn.accessToken}`, Accept: 'application/json' },
        });
        const txt = await r.text();
        if (r.ok) {
          return res.json({
            success: true,
            data: {
              ok: true,
              url: u,
              sample: txt.slice(0, 500),
              hint: 'If the sample is HTML, adjust API base path for your OrangeHRM version.',
            },
          });
        }
        lastErr = `${r.status} ${txt.slice(0, 200)}`;
      } catch (e) {
        lastErr = e.message;
      }
    }
    res.json({
      success: true,
      data: {
        ok: false,
        message: lastErr || 'Could not reach a known OrangeHRM API path.',
        hint: 'Token is stored; configure REST API plugin / path in OrangeHRM or use scheduled CSV export until API paths are confirmed.',
      },
    });
  } catch (e) {
    next(e);
  }
}

/**
 * Phase 1: pull employees from OrangeHRM (OAuth) and upsert tenant Identities.
 */
export async function syncHrmsIdentities(req, res, next) {
  try {
    await ensureLegacyHrmsNamesOnce();
    const sourceId = req.body?.sourceId || req.query?.sourceId;
    const { tenantId, doc } = await resolveHrmsDoc(req, sourceId);
    if (!doc) {
      throw new AppError('HRMS integration is not configured for this tenant.', 400);
    }
    if (getHrmsNested(doc)?.connector === 'delimited_file') {
      throw new AppError('Identity sync is not available for Delimited File sources yet.', 400);
    }
    const result = await syncIdentitiesFromHrms(tenantId, doc._id);
    res.json({ success: true, data: result });
  } catch (e) {
    next(
      e instanceof AppError
        ? e
        : new AppError(e.message || 'HRMS identity sync failed', 400, 'HRMS_SYNC')
    );
  }
}

function sanitizeSourceRow(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  const isAppDoc = o.type !== undefined || o.riskLevel !== undefined;

  if (isAppDoc) {
    const hr = o.hrms || {};
    const isDelimited = (o.connectorType && /delimited.?file/i.test(o.connectorType)) || hr.connector === 'delimited_file';
    return {
      _id: o._id,
      tenantId: o.tenantId,
      name: o.name,
      description: o.description || '',
      connector: hr.connector || (isDelimited ? 'delimited_file' : 'orangehrm'),
      connectionStatus: hr.connectionStatus,
      isActive: hr.isActive !== false && o.status !== 'inactive' && o.status !== 'decommissioned',
      delimitedCsvHeaders: hr.delimitedCsvHeaders || [],
      delimitedPreviewRows: hr.delimitedPreviewRows || [],
      delimitedRowCount: hr.delimitedRowCount,
      delimitedLastUploadAt: hr.delimitedLastUploadAt || o.lastUpload,
      delimitedLastFileName: hr.delimitedLastFileName || '',
      updatedAt: o.updatedAt,
      createdAt: o.createdAt,
    };
  }

  return {
    _id: o._id,
    tenantId: o.tenantId,
    name: o.name,
    description: o.description || '',
    connector: o.connector || 'orangehrm',
    connectionStatus: o.connectionStatus,
    isActive: o.isActive !== false,
    delimitedCsvHeaders: o.delimitedCsvHeaders || [],
    delimitedPreviewRows: o.delimitedPreviewRows || [],
    delimitedRowCount: o.delimitedRowCount,
    delimitedLastUploadAt: o.delimitedLastUploadAt,
    delimitedLastFileName: o.delimitedLastFileName || '',
    updatedAt: o.updatedAt,
    createdAt: o.createdAt,
  };
}

export async function listHrmsSources(req, res, next) {
  try {
    await ensureLegacyHrmsNamesOnce();
    const tenantId = await resolveTenantId(req);
    const profileSourcesOnly =
      req.query.profileSourcesOnly === 'true' ||
      req.query.profileSourcesOnly === '1' ||
      req.query.profileSourcesOnly === 'yes';

    let allowedIds = null;
    if (profileSourcesOnly) {
      const profiles = await IdentityProfile.find({ tenantId })
        .select('sourceApplicationId hrmsSourceId')
        .lean();
      allowedIds = new Set();
      for (const p of profiles) {
        const raw = p.sourceApplicationId || p.hrmsSourceId;
        if (raw) allowedIds.add(String(raw));
      }
    }

    const apps = await Application.find({ 
      tenantId, 
      $or: [
        { 'hrms.connector': { $exists: true } },
        { connectorType: { $regex: /delimited.?file/i } }
      ]
    })
      .sort({ name: 1 })
      .lean();
    const migratedIds = new Set(
      apps.map((a) => a.hrms?.migratedFromHrmsId?.toString()).filter(Boolean)
    );
    const legacyRows = await HrmsIntegration.find({ tenantId }).sort({ name: 1 }).lean();
    const legacyFiltered = legacyRows.filter((r) => !migratedIds.has(String(r._id)));
    let combined = [
      ...apps.map((r) => sanitizeSourceRow(r)),
      ...legacyFiltered.map((r) => sanitizeSourceRow(r)),
    ].sort((a, b) => String(a.name).localeCompare(String(b.name)));

    if (profileSourcesOnly && allowedIds) {
      combined = combined.filter((r) => allowedIds.has(String(r._id)));
    }

    res.json({ success: true, data: combined });
  } catch (e) {
    next(e);
  }
}

export async function createHrmsSource(req, res, next) {
  try {
    await ensureLegacyHrmsNamesOnce();
    const tenantId = await resolveTenantId(req);
    const { name, description, connector } = req.body || {};
    const n = String(name || '').trim();
    if (!n) throw new AppError('Name is required.', 400);
    const conn = connector === 'delimited_file' ? 'delimited_file' : 'orangehrm';
    const dupApp = await Application.findOne({ tenantId, name: n });
    const dupLegacy = await HrmsIntegration.findOne({ tenantId, name: n });
    if (dupApp || dupLegacy) throw new AppError('A source with this name already exists.', 409);
    const doc = new Application({
      tenantId,
      name: n,
      description: String(description || '').trim(),
      type: 'erp',
      integrationType: 'connector',
      connectorType: conn === 'delimited_file' ? 'HRMS_DELIMITED_FILE' : 'HRMS_ORANGEHRM',
      hrms: { connector: conn, isActive: true },
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });
    await doc.save();
    res.status(201).json({ success: true, data: sanitizeSourceRow(doc) });
  } catch (e) {
    next(e);
  }
}

export async function updateHrmsSource(req, res, next) {
  try {
    await ensureLegacyHrmsNamesOnce();
    const tenantId = await resolveTenantId(req);
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      throw new AppError('Invalid id.', 400);
    }
    let doc = await Application.findOne({ 
      _id: id, 
      tenantId, 
      $or: [
        { 'hrms.connector': { $exists: true } },
        { connectorType: { $regex: /delimited.?file/i } }
      ]
    });
    if (!doc) {
      doc = await Application.findOne({ tenantId, 'hrms.migratedFromHrmsId': id });
    }
    if (!doc) {
      doc = await HrmsIntegration.findOne({ _id: id, tenantId });
    }
    if (!doc) throw new AppError('HRMS source not found.', 404);
    const { name, description, isActive } = req.body || {};
    if (name !== undefined) {
      const nn = String(name).trim();
      if (!nn) throw new AppError('Name cannot be empty.', 400);
      const dupApp = await Application.findOne({
        tenantId,
        name: nn,
        _id: { $ne: doc._id },
        ...(doc.constructor?.modelName !== 'Application' && {
          'hrms.migratedFromHrmsId': { $ne: doc._id },
        }),
      });
      const legacyExcludeId =
        doc.constructor?.modelName === 'Application' && doc.hrms?.migratedFromHrmsId
          ? doc.hrms.migratedFromHrmsId
          : doc._id;
      const dupLegacy = await HrmsIntegration.findOne({
        tenantId,
        name: nn,
        _id: { $ne: legacyExcludeId },
      });
      if (dupApp || dupLegacy) throw new AppError('A source with this name already exists.', 409);
      doc.name = nn;
    }
    if (description !== undefined) doc.description = String(description).trim();
    if (isActive !== undefined) {
      const h = getHrmsNested(doc);
      h.isActive = Boolean(isActive);
    }
    doc.updatedBy = req.user.id;
    await doc.save();
    res.json({ success: true, data: sanitizeSourceRow(doc) });
  } catch (e) {
    next(e);
  }
}

/**
 * Upload a CSV for a delimited-file HRMS source; stores headers and preview rows for identity profile mapping.
 */
export async function uploadHrmsDelimitedCsv(req, res, next) {
  try {
    await ensureLegacyHrmsNamesOnce();
    if (!req.file?.buffer) {
      throw new AppError('No file uploaded', 400);
    }
    const tenantId = await resolveTenantId(req);
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      throw new AppError('Invalid id.', 400);
    }
    let doc = await Application.findOne({ 
      _id: id, 
      tenantId, 
      $or: [
        { 'hrms.connector': { $exists: true } },
        { connectorType: { $regex: /delimited.?file/i } }
      ]
    });
    if (!doc) {
      doc = await Application.findOne({ tenantId, 'hrms.migratedFromHrmsId': id });
    }
    if (!doc) {
      doc = await HrmsIntegration.findOne({ _id: id, tenantId });
    }
    if (!doc) throw new AppError('HRMS source not found.', 404);
    const h = getHrmsNested(doc);
    const isDelimited = h.connector === 'delimited_file' || String(doc.connectorType || '').trim().toLowerCase().includes('delimited');
    if (!isDelimited) {
      throw new AppError('CSV upload is only available for Delimited File HRMS sources.', 400);
    }
    if (h.isActive === false) {
      throw new AppError('This HRMS source is inactive. Enable it before uploading.', 400);
    }

    const rows = await new Promise((resolve, reject) => {
      const acc = [];
      streamifier
        .createReadStream(req.file.buffer)
        .pipe(csv())
        .on('data', (row) => acc.push(row))
        .on('end', () => resolve(acc))
        .on('error', reject);
    });

    if (!rows.length) {
      throw new AppError('CSV has no data rows.', 400);
    }

    const headers = Object.keys(rows[0]);
    if (!headers.length) {
      throw new AppError('CSV has no columns.', 400);
    }

    const maxImport = 5000;
    h.delimitedCsvHeaders = headers;
    h.delimitedPreviewRows = rows.slice(0, 5);
    h.delimitedImportRows = rows.slice(0, maxImport);
    h.delimitedRowCount = rows.length;
    h.delimitedLastUploadAt = new Date();
    h.delimitedLastFileName = req.file.originalname || 'upload.csv';
    doc.updatedBy = req.user.id;
    await doc.save();

    const { liveRows, summary } = await materializeDelimitedImportToApplicationUsers(doc);
    doc.totalUsers = liveRows;
    doc.lastUpload = new Date();
    await doc.save();

    res.json({
      success: true,
      data: {
        rowCount: rows.length,
        headers,
        previewRowCount: Math.min(5, rows.length),
        fileName: h.delimitedLastFileName,
        applicationUsersMaterialized: liveRows,
        ingestSummary: summary,
      },
    });
  } catch (e) {
    next(e);
  }
}

/** Headers + preview from last delimited upload (for identity profile mapping UI). */
export async function getHrmsDelimitedSchema(req, res, next) {
  try {
    await ensureLegacyHrmsNamesOnce();
    const tenantId = await resolveTenantId(req);
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      throw new AppError('Invalid id.', 400);
    }
    let doc = await Application.findOne({ _id: id, tenantId }).lean();
    if (!doc) {
      doc = await Application.findOne({ tenantId, 'hrms.migratedFromHrmsId': id }).lean();
    }
    if (!doc) {
      doc = await HrmsIntegration.findOne({ _id: id, tenantId }).lean();
    }
    if (!doc) throw new AppError('Source application not found.', 404);
    const hr = doc.hrms || {};
    /** Legacy hrms_integrations rows store delimited* on the document root; App Registry stores under hrms. */
    const legacyHeaders = Array.isArray(doc.delimitedCsvHeaders) ? doc.delimitedCsvHeaders : [];
    const legacyPreview = Array.isArray(doc.delimitedPreviewRows) ? doc.delimitedPreviewRows : [];
    const headers =
      hr.delimitedCsvHeaders && hr.delimitedCsvHeaders.length ? hr.delimitedCsvHeaders : legacyHeaders;
    const previewRows =
      hr.delimitedPreviewRows && hr.delimitedPreviewRows.length ? hr.delimitedPreviewRows : legacyPreview;
      
    let finalHeaders = headers;
    let finalPreviewRows = previewRows;
    let finalRowCount = hr.delimitedRowCount ?? doc.delimitedRowCount ?? doc.totalUsers ?? 0;

    if (doc.userMappings && doc.userMappings.length > 0 && doc.name) {
      try {
        finalHeaders = doc.userMappings.map((m) => m.standardField);
        const UsersModel = await getDynamicUserModelForTenantId(doc.name, doc.tenantId);
        const actualCount = await UsersModel.countDocuments({ applicationId: doc._id });
        if (actualCount > 0) finalRowCount = actualCount;
        const { pr } = await loadPreviewSampleRows(tenantId, doc._id, doc, { limit: 5 });
        if (pr.length > 0) finalPreviewRows = pr;
      } catch (err) {
        console.error('Failed to load application schema users for preview', err);
      }
    }

    const isDelimitedApp = doc.connectorType && /delimited.?file/i.test(doc.connectorType);
    if (!isDelimitedApp && hr.connector !== 'delimited_file' && doc.connector !== 'delimited_file' && !(doc.userMappings?.length > 0)) {
      throw new AppError('Schema is only defined for Delimited File sources or mapped Applications.', 400);
    }
    res.json({
      success: true,
      data: {
        headers: finalHeaders,
        previewRows: finalPreviewRows,
        rowCount: finalRowCount,
        lastUploadAt: hr.delimitedLastUploadAt || doc.delimitedLastUploadAt || doc.lastUpload,
        lastFileName: hr.delimitedLastFileName || doc.delimitedLastFileName || '',
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function deleteHrmsSource(req, res, next) {
  try {
    await ensureLegacyHrmsNamesOnce();
    const tenantId = await resolveTenantId(req);
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      throw new AppError('Invalid id.', 400);
    }
    let doc = await Application.findOne({ 
      _id: id, 
      tenantId, 
      $or: [
        { 'hrms.connector': { $exists: true } },
        { connectorType: { $regex: /delimited.?file/i } }
      ]
    });
    if (!doc) {
      doc = await Application.findOne({ tenantId, 'hrms.migratedFromHrmsId': id });
    }
    if (doc) {
      await Application.deleteOne({ _id: doc._id });
      const migratedLegacyId = doc.hrms?.migratedFromHrmsId;
      if (migratedLegacyId) {
        await HrmsIntegration.deleteOne({ _id: migratedLegacyId, tenantId });
      }
      await recomputeHrmsDirectoryTargetForTenant(tenantId);
      res.json({ success: true, data: { deleted: true } });
      return;
    }
    const legacy = await HrmsIntegration.findOne({ _id: id, tenantId });
    if (!legacy) throw new AppError('HRMS source not found.', 404);
    await HrmsIntegration.deleteOne({ _id: legacy._id });
    await recomputeHrmsDirectoryTargetForTenant(tenantId);
    res.json({ success: true, data: { deleted: true } });
  } catch (e) {
    next(e);
  }
}
