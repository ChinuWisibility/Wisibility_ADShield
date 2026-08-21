import Application from '../models/application/Application.js';
import {
  normalizeAdConfig,
  testAdConnection as ldapTest,
  fetchAdDirectory,
  createAdUser,
} from '../services/adLdapService.js';
import {
  syncSourceApplicationAndDerivedFromDirectory,
} from '../services/adDirectorySyncService.js';
import {
  createAdSyncJob,
  findActiveAdSyncJobForApplication,
  getAdSyncJobForApplication,
} from '../services/adSyncJobService.js';
import { scheduleAdSyncJobRun } from '../services/adSyncPipelineService.js';
import {
  resolveUserSearchFilterForSyncScope,
  normalizeAdSyncScope,
} from '../utils/adSyncScope.js';

export async function testAdConnection(req, res) {
  try {
    const result = await ldapTest(req.body);
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message || 'LDAP connection test failed.' });
  }
}

function resolveAdConfig(application, req) {
  const fromDb = application.connectionConfig?.ad || {};
  const fromBody = req.body?.ad || {};
  const pwd = fromBody.bindPassword || req.body.bindPassword || fromDb.bindPassword;
  return normalizeAdConfig({
    ...fromDb,
    ...fromBody,
    bindPassword: pwd,
  });
}

/** Allowed keys for controlled test-create identity payload (no arbitrary LDAP attrs). */
const TEST_CREATE_USER_SPEC_KEYS = [
  'sAMAccountName',
  'samAccountName',
  'userPrincipalName',
  'upn',
  'cn',
  'displayName',
  'givenName',
  'firstName',
  'sn',
  'lastName',
  'mail',
  'email',
  'department',
  'title',
  'employeeID',
  'employeeId',
  'employeeNumber',
  'telephoneNumber',
  'phoneNumber',
  'phone',
];

function pickTestCreateUserSpec(body = {}) {
  const raw = body.user || body.userSpec || {};
  const spec = {};
  for (const key of TEST_CREATE_USER_SPEC_KEYS) {
    if (raw[key] !== undefined && raw[key] !== null && String(raw[key]).trim() !== '') {
      spec[key] = raw[key];
    }
  }
  return spec;
}

function wantsBlockingSync(req) {
  const q = req.query?.wait ?? req.query?.sync;
  if (q === '1' || q === 'true') return true;
  if (req.body?.wait === true || req.body?.sync === true) return true;
  return false;
}

function buildSyncConfig(req, cfg) {
  const maxUsers = Math.min(
    Math.max(parseInt(req.body.maxUsers, 10) || cfg.maxUsers, 1),
    50000,
  );
  const maxGroups = Math.min(
    Math.max(parseInt(req.body.maxGroups, 10) || cfg.maxGroups, 1),
    50000,
  );
  const syncGroups =
    req.body.syncGroups !== false && req.body.syncGroups !== 'false';
  const syncScope = normalizeAdSyncScope(req.body.syncScope);
  return {
    maxUsers,
    maxGroups,
    syncGroups,
    syncScope,
    bindPassword: cfg.bindPassword,
  };
}

/**
 * POST /applications/:id/ad/sync
 * Default: async job (202 + jobId). Use ?wait=1 or body.wait for legacy blocking sync.
 */
export async function syncAdUsersFromAd(req, res) {
  try {
    const application = await Application.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const isAd =
      application.connectorType === 'ACTIVE_DIRECTORY' ||
      application.connectionConfig?.ad ||
      req.body?.ad;

    if (!isAd) {
      return res.status(400).json({
        success: false,
        message: 'Application is not configured for Active Directory (connector or connection config missing).',
      });
    }

    const cfg = resolveAdConfig(application, req);
    if (!cfg.url || !cfg.bindDn || !cfg.baseDn) {
      return res.status(400).json({
        success: false,
        message: 'Incomplete AD configuration. Save LDAP URL, base DN, and bind DN on the application first.',
      });
    }

    const syncConfig = buildSyncConfig(req, cfg);
    const userSearchFilter = resolveUserSearchFilterForSyncScope(syncConfig.syncScope);
    const ldapCfg = { ...cfg, userSearchFilter, userSearchFilters: [userSearchFilter] };

    if (!wantsBlockingSync(req)) {
      const active = await findActiveAdSyncJobForApplication(application._id);
      if (active) {
        return res.status(409).json({
          success: false,
          message: 'An AD sync is already in progress for this application.',
          jobId: active.jobId,
          status: active.status,
          phase: active.phase,
          percent: active.percent,
        });
      }

      const job = await createAdSyncJob({
        applicationId: application._id,
        syncConfig,
        requestedBy: req.user?._id,
      });
      scheduleAdSyncJobRun(job.jobId);

      return res.status(202).json({
        success: true,
        jobId: job.jobId,
        status: 'queued',
        message: 'AD sync started. Poll job status for progress.',
      });
    }

    const directory = await fetchAdDirectory(ldapCfg, syncConfig);

    const { source, derived } = await syncSourceApplicationAndDerivedFromDirectory(
      application,
      directory,
      { syncGroups: syncConfig.syncGroups },
    );

    res.json({
      success: true,
      message: `Imported ${source.summary.liveRows} user(s) and ${source.entitlementsSynced} AD group(s) from Active Directory; ${source.accountAggregationsUpserted} account(s) in identity cube. Refreshed ${derived.filter((d) => !d.skipped && !d.error).length} derived application(s).`,
      count: source.summary.liveRows,
      directoryCounts: source.directoryCounts,
      entitlementsSynced: source.entitlementsSynced,
      summary: { ...source.summary, reconciliation: source.reconciliation, runId: source.runId },
      reconciliation: source.reconciliation,
      runId: source.runId,
      accountAggregationsUpserted: source.accountAggregationsUpserted,
      derivedApplicationsRefreshed: derived,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'AD sync failed.' });
  }
}

/**
 * GET /applications/:id/ad-sync-jobs/:jobId
 */
export async function getAdSyncJobStatus(req, res) {
  try {
    const job = await getAdSyncJobForApplication(req.params.jobId, req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'AD sync job not found.' });
    }
    res.json({
      success: true,
      data: {
        jobId: job.jobId,
        applicationId: String(job.applicationId),
        status: job.status,
        phase: job.phase,
        percent: job.percent,
        message: job.message,
        error: job.error,
        result: job.result,
        stageTimings: job.stageTimings,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message || 'Failed to load AD sync job.' });
  }
}

/**
 * POST /applications/:id/ad/test-create-user
 *
 * Controlled Step-1 provisioning test — creates a DISABLED AD user via the existing
 * LDAP connector. Does not accept arbitrary DN/attribute maps from the client.
 *
 * Body:
 *   { user: { sAMAccountName, sn, givenName?, ... }, ad?: { targetOuDn?, upnSuffix?, ... } }
 * Requires confirm: true to avoid accidental creates.
 */
export async function testCreateAdUser(req, res) {
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({
        success: false,
        message:
          'Refusing to create AD user without explicit body.confirm === true (safety gate for test-create-user).',
      });
    }

    const application = await Application.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const isAd =
      application.connectorType === 'ACTIVE_DIRECTORY' ||
      application.connectionConfig?.ad;

    if (!isAd) {
      return res.status(400).json({
        success: false,
        message:
          'Application is not configured for Active Directory (connector or connection config missing).',
      });
    }

    const cfg = resolveAdConfig(application, req);
    if (!cfg.url || !cfg.bindDn || !cfg.baseDn) {
      return res.status(400).json({
        success: false,
        message:
          'Incomplete AD configuration. Save LDAP URL, base DN, and bind DN on the application first.',
      });
    }
    if (!cfg.targetOuDn) {
      return res.status(400).json({
        success: false,
        message:
          'targetOuDn is required for user creation. Set connectionConfig.ad.targetOuDn (search baseDn is not used as the create OU).',
        code: 'CONFIG_TARGET_OU_REQUIRED',
      });
    }
    if (!cfg.upnSuffix && !(req.body?.user?.userPrincipalName || req.body?.userSpec?.userPrincipalName)) {
      return res.status(400).json({
        success: false,
        message:
          'upnSuffix is required in connectionConfig.ad (or pass an explicit user.userPrincipalName).',
        code: 'CONFIG_UPN_SUFFIX_REQUIRED',
      });
    }

    const userSpec = pickTestCreateUserSpec(req.body);
    if (!userSpec.sAMAccountName && !userSpec.samAccountName && !userSpec.employeeId) {
      return res.status(400).json({
        success: false,
        message: 'user.sAMAccountName is required for test create (or employeeId when samAccountNameSource=employeeId).',
      });
    }

    const result = await createAdUser(cfg, userSpec);

    res.status(201).json({
      success: true,
      message:
        'AD user created as DISABLED (no password set). Run AD Sync to verify Identity Sphere visibility.',
      data: {
        applicationId: String(application._id),
        created: result.created,
        dn: result.dn,
        sAMAccountName: result.sAMAccountName,
        userPrincipalName: result.userPrincipalName,
        objectGUID: result.objectGUID,
        accountEnabled: result.accountEnabled,
        passwordSet: result.passwordSet,
        verified: result.verified,
      },
    });
  } catch (e) {
    const status =
      e.code === 'DUPLICATE_ACCOUNT' || e.code === 'LDAP_ALREADY_EXISTS'
        ? 409
        : e.code === 'TARGET_OU_NOT_FOUND' ||
            e.code === 'CONFIG_TARGET_OU_REQUIRED' ||
            e.code === 'CONFIG_INCOMPLETE' ||
            e.code === 'INVALID_SAM' ||
            e.code === 'INVALID_UPN' ||
            e.code === 'MISSING_SN'
          ? 400
          : e.code === 'LDAP_INSUFFICIENT_ACCESS'
            ? 403
            : 500;
    res.status(status).json({
      success: false,
      message: e.message || 'AD test create user failed.',
      code: e.code || undefined,
      existing: e.existing || undefined,
    });
  }
}
