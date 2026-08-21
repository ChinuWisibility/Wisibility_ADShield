import mongoose from "mongoose";
import { isPlatformPlaneUser } from "../../middleware/auth.js";

import { getDynamicUserModelForTenantId } from '../../models/application/Users.js';
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import IdentityAccountLink from '../../models/identity/IdentityAccountLink.js';
import Application from '../../models/application/Application.js';
import {
  resolveLiveApplicationUser,
  fetchCorrelatedEntitlementsForAccount,
} from '../correlation/identityAccountLinkController.js';
import {
  isPrivilegedEntitlement,
} from '../../services/identity/posture/identityPostureDashboard.js';
import { fetchCorrelatedEntitlementsWithProjectionFallback } from '../../utils/identityEntitlementProjectionRead.js';

function getByPath(obj, path) {
  if (!path || !obj) return undefined;
  const data = obj.toObject ? obj.toObject() : obj;
  return String(path)
    .split('.')
    .reduce((acc, part) => (acc != null && acc[part] !== undefined ? acc[part] : undefined), data);
}

function looksLikeMongoId(s) {
  return typeof s === 'string' && /^[a-f\d]{24}$/i.test(String(s).trim());
}

/**
 * Prefer human-readable correlation labels over internal Mongo _ids stored on links.
 */
function resolveAccountDisplayName(link, appDoc, acc) {
  const matchDisplay = link.correlationMatchDisplay && String(link.correlationMatchDisplay).trim();
  if (matchDisplay) return matchDisplay;

  const corrAttr =
    (link.correlationAccountAttribute && String(link.correlationAccountAttribute).trim()) ||
    (appDoc?.lastManualCorrelation && String(appDoc.lastManualCorrelation.accountAttribute || '').trim()) ||
    '';

  if (acc && corrAttr) {
    const top = getByPath(acc, corrAttr);
    const raw = acc.rawData ? getByPath(acc.rawData, corrAttr) : undefined;
    const v = top ?? raw;
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }

  if (acc) {
    const direct = [
      acc.username,
      acc.email,
      acc.user_id,
      acc.display_name,
      acc.nativeAccountId,
      acc.samAccountName,
      acc.userPrincipalName,
      acc.login,
      acc.gh_login,
    ];
    for (const x of direct) {
      if (x != null && String(x).trim() !== '') return String(x).trim();
    }
    const rd = acc.rawData;
    if (rd && typeof rd === 'object') {
      const rawKeys = [
        'gh_login',
        'github_username',
        'login',
        'username',
        'email',
        'userPrincipalName',
        'samAccountName',
        'oracle_username',
        'employee_id',
      ];
      for (const k of rawKeys) {
        const x = rd[k];
        if (x != null && String(x).trim() !== '') return String(x).trim();
      }
    }
  }

  const named = link.accountName && String(link.accountName).trim();
  if (named) return named;

  const aid = link.accountId != null ? String(link.accountId).trim() : '';
  if (aid && !looksLikeMongoId(aid)) return aid;

  if (acc && (acc.display_name || acc.email || acc.username)) {
    return String(acc.display_name || acc.email || acc.username).trim();
  }

  return 'Linked account';
}

function normKeyPart(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

/**
 * Collapse duplicate IdentityAccountLinks that point at the same logical account
 * (same application + correlation attribute + resolved display / match value).
 * Falls back to row-strict keys when we cannot build a reliable logical key.
 */
function accountLogicalMergeKey(appDoc, accountDisplayName, corrAttr) {
  const appId = appDoc?._id != null ? String(appDoc._id) : String(appDoc?.name || 'app');
  const name = normKeyPart(accountDisplayName);
  const corr = normKeyPart(corrAttr);
  if (!name || name === normKeyPart('Linked account')) return null;
  if (!corr) return null;
  return `${appId}\0logical:${corr}:${name}`;
}

/**
 * Prefer one node per logical in-app account; otherwise key by warehouse row / link
 * (distinct Mongo user rows or distinct links when resolution is ambiguous).
 */
function accountMergeKey(appDoc, link, acc, accountDisplayName, corrAttr) {
  const logical = accountLogicalMergeKey(appDoc, accountDisplayName, corrAttr);
  if (logical) return logical;

  const appId = appDoc?._id != null ? String(appDoc._id) : String(appDoc?.name || 'app');

  if (acc && acc._id) {
    return `${appId}\0mongo:${String(acc._id)}`;
  }

  const aid = link.accountId != null ? String(link.accountId).trim() : '';
  if (aid && looksLikeMongoId(aid)) {
    return `${appId}\0acct:${normKeyPart(aid)}`;
  }

  return `${appId}\0link:${String(link._id)}`;
}

function mergeEntitlementChildren(targetNode, sourceNode) {
  const children = targetNode.children || (targetNode.children = []);
  const seen = new Set(
    children.map((c) => `${String(c.name)}\0${c.attributes?.sourceField || ''}`),
  );
  for (const ch of sourceNode.children || []) {
    const k = `${String(ch.name)}\0${ch.attributes?.sourceField || ''}`;
    if (!seen.has(k)) {
      seen.add(k);
      children.push(ch);
    }
  }
}

/**
 * Resolve the Application document for a link the same way Accounts tab does:
 * prefer populate, then fall back to a direct Application.findById so a failed
 * populate never drops the whole application from the mindmap.
 */
async function resolveApplicationForLink(link) {
  const populated =
    link.applicationId && typeof link.applicationId === 'object' && link.applicationId.name
      ? link.applicationId
      : null;
  if (populated) return populated;

  const rawId =
    link.applicationId && typeof link.applicationId === 'object'
      ? link.applicationId._id
      : link.applicationId;
  if (!rawId || !mongoose.Types.ObjectId.isValid(String(rawId))) return null;

  try {
    return await Application.findById(rawId)
      .select('name lastManualCorrelation _id tenantId icon color type')
      .lean();
  } catch (err) {
    console.warn(`[getIdentityGraph] Application fallback failed for ${rawId}:`, err?.message || err);
    return null;
  }
}

/**
 * Match Accounts tab link lookup: include active + inactive, and accept either
 * string or ObjectId identityId storage.
 */
function identityLinkQuery(identityId) {
  const idStr = String(identityId);
  if (mongoose.Types.ObjectId.isValid(idStr)) {
    return {
      $or: [
        { identityId: idStr },
        { identityId: new mongoose.Types.ObjectId(idStr) },
      ],
    };
  }
  return { identityId: idStr };
}

/**
 * Fallback when Account/Entitlement correlation rows are absent — same keys/delimiters as
 * IdentityDetail.jsx `extractEntitlements` (Connected Application Accounts).
 */
function extractGraphEntitlementsFromAccountRow(accountData) {
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

/**
 * Match IdentityDetail `getAccountDisplayEntitlements`: correlation catalog first, else raw row fields.
 */
async function buildMindmapEntitlementChildren(appDoc, acc, identityId) {
  const db = mongoose.connection.db;
  const appOid = appDoc?._id;
  const uid = acc?._id;

  if (db && appOid && uid && identityId) {
    try {
      const correlated = await fetchCorrelatedEntitlementsWithProjectionFallback({
        identityId,
        applicationId: appOid,
        accountId: uid,
        tenantId: appDoc.tenantId,
        legacyFetch: () =>
          fetchCorrelatedEntitlementsForAccount(db, appDoc.name, appOid, uid, appDoc.tenantId),
      });
      if (correlated?.length) {
        return correlated
          .map((c) => {
            const label = c.displayName || c.entitlementName || String(c.entitlementId || '');
            const name = String(label).trim();
            if (!name) return null;
            const privileged = isPrivilegedEntitlement({
              entitlement_name: name,
              entitlement_id: c.entitlementId,
              name,
              displayName: name,
              isPrivileged: c.isPrivileged,
              is_privilege: c.is_privilege ?? c.isPrivilege,
              classification: c.classification,
              rawData: c.rawData,
            });
            return {
              name,
              attributes: {
                type: 'Entitlement',
                sourceField: 'correlation',
                ...(privileged ? { isPrivileged: true, privileged: true } : {}),
              },
            };
          })
          .filter(Boolean);
      }
    } catch (e) {
      console.warn(`[getIdentityGraph] correlated entitlements skipped: ${e.message}`);
    }
  }

  return extractGraphEntitlementsFromAccountRow(acc || {}).map((ent) => {
    const name = ent.value;
    const privileged = isPrivilegedEntitlement({
      entitlement_name: name,
      name,
      displayName: name,
    });
    return {
      name,
      attributes: {
        type: 'Entitlement',
        sourceField: ent.type,
        ...(privileged ? { isPrivileged: true, privileged: true } : {}),
      },
    };
  });
}

const toObjectId = (value) => {
  if (!value) return null;
  const raw = typeof value === "object" && value?._id ? value._id : value;
  const stringValue = String(raw);
  if (!mongoose.Types.ObjectId.isValid(stringValue)) return null;
  return new mongoose.Types.ObjectId(stringValue);
};

const resolveTenantObjectId = (req) => {
  const scoped = req.scopedTenantId ?? req.user?.tenantId ?? req.user?.tenant;
  const scopedTenant = toObjectId(scoped);
  if (scopedTenant) return scopedTenant;

  if (isPlatformPlaneUser(req.user)) {
    return toObjectId(req.query?.tenantId);
  }

  return null;
};

/**
 * Walk managerId from the subject upward; returns [topManager, …, directManager] (root → leaf of chain).
 * Stops on missing manager, cycle, invalid id, or maxDepth.
 */
async function fetchManagerAncestorsFromSubject(subjectIdentity, tenantId, IdentityModel, { maxDepth = 32 } = {}) {
  const chainUp = [];
  const visited = new Set();
  if (subjectIdentity?._id) visited.add(String(subjectIdentity._id));
  let cursor = subjectIdentity;

  for (let d = 0; d < maxDepth; d += 1) {
    const rawMid = cursor.managerId;
    if (!rawMid) break;
    const mid = typeof rawMid === 'object' && rawMid._id ? rawMid._id : rawMid;
    const idStr = String(mid);
    if (!mongoose.Types.ObjectId.isValid(idStr)) break;
    if (visited.has(idStr)) break;
    visited.add(idStr);

    const mgr = await IdentityModel.findOne({ _id: mid, tenantId }).lean();
    if (!mgr) break;

    chainUp.push(mgr);
    cursor = mgr;
  }

  return chainUp.reverse();
}

export const getIdentityGraph = async (req, res) => {
  try {
    const { id } = req.params;
    let tenantId = req.user?.tenantId || req.user?.tenant;

    if (!tenantId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Tenant context missing.' });
    }

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message:
          "Valid tenant context is required. Pass tenantId when using a platform-scoped account.",
      });
    }

    const Identity = await getDynamicIdentityModelForTenantId(tenantId);
    const identity = await Identity.findOne({ _id: id, tenantId }).lean();

    if (!identity) {
      return res.status(404).json({ success: false, message: 'Identity not found.' });
    }

    const subjectNode = {
      name: identity.displayName || identity.email || 'Unknown User',
      attributes: {
        type: 'User',
        relation: 'subject',
        identityId: String(identity._id),
        ...(identity.email ? { email: identity.email } : {}),
        ...(identity.employeeId ? { employeeId: identity.employeeId } : {}),
        ...(identity.title || identity.jobTitle
          ? { jobTitle: identity.title || identity.jobTitle }
          : {}),
        ...(identity.department ? { department: identity.department } : {}),
        ...(identity.riskScore != null ? { riskScore: identity.riskScore } : {}),
        ...(identity.riskLevel ? { riskLevel: identity.riskLevel } : {}),
        ...(identity.lifecycleState ? { lifecycleState: identity.lifecycleState } : {}),
        ...(identity.isActive != null ? { isActive: identity.isActive } : {}),
        ...(identity.lastLogin ? { lastLogin: identity.lastLogin } : {}),
        ...(identity.lastSyncedAt ? { lastSyncedAt: identity.lastSyncedAt } : {}),
      },
      children: [],
    };

    const managerDocs = await fetchManagerAncestorsFromSubject(identity, tenantId, Identity);
    const managerNodeTemplates = managerDocs.map((mgr) => ({
      name: mgr.displayName || mgr.email || mgr.manager || 'Manager',
      attributes: {
        type: 'User',
        relation: 'manager',
        identityId: String(mgr._id),
        ...(mgr.email ? { email: mgr.email } : {}),
      },
      children: [],
    }));

    // Same universe as Accounts tab: every link for this identity (active + inactive).
    const links = await IdentityAccountLink.find(identityLinkQuery(id))
      .populate({
        path: 'applicationId',
        select: 'name lastManualCorrelation _id tenantId icon color type',
      })
      .sort({ createdAt: -1 })
      .lean();

    const applicationBranches = {};

    const rows = await Promise.all(
      links.map(async (link) => {
        const appDoc = await resolveApplicationForLink(link);
        // Skip only when we truly cannot identify an application (deleted / broken id).
        if (!appDoc?._id && !appDoc?.name) {
          console.warn(
            `[getIdentityGraph] skipping link ${link._id}: application could not be resolved`,
          );
          return null;
        }

        const appName = appDoc.name || 'Unknown Application';
        const appKey =
          appDoc._id != null
            ? String(appDoc._id)
            : `name:${String(appName).trim().toLowerCase()}`;

        let acc = null;
        if (appName && appName !== 'Unknown Application') {
          try {
            const DynamicUserModel = await getDynamicUserModelForTenantId(appName, appDoc.tenantId);
            acc = await resolveLiveApplicationUser(DynamicUserModel, link, appDoc);
          } catch (err) {
            console.warn(`[getIdentityGraph] dynamic user load failed for ${appName}:`, err?.message || err);
          }
        }

        const corrAttr =
          (link.correlationAccountAttribute && String(link.correlationAccountAttribute).trim()) ||
          (appDoc?.lastManualCorrelation && String(appDoc.lastManualCorrelation.accountAttribute || '').trim()) ||
          '';

        const accountName = resolveAccountDisplayName(link, appDoc, acc);
        const linkActive = link.isActive !== false;

        const accountNode = {
          name: accountName,
          attributes: {
            type: 'Account',
            status: (acc && acc.status) || (linkActive ? 'Active' : 'Inactive'),
            ...(corrAttr ? { correlationField: corrAttr } : {}),
            ...(!acc ? { unresolved: true } : {}),
            ...(linkActive ? {} : { linkInactive: true }),
            ...(link._id ? { linkId: String(link._id) } : {}),
          },
          children: [],
        };

        const entChildren = await buildMindmapEntitlementChildren(appDoc, acc, id);
        entChildren.forEach((ch) => accountNode.children.push(ch));

        const mergeKey = accountMergeKey(appDoc, link, acc, accountName, corrAttr);
        return { appName, appKey, appDoc, mergeKey, accountNode, linkActive };
      }),
    );

    const mergedByKey = new Map();
    for (const row of rows) {
      if (!row) continue;
      const { appName, appKey, appDoc, mergeKey, accountNode } = row;
      const prev = mergedByKey.get(mergeKey);
      if (prev) {
        mergeEntitlementChildren(prev.accountNode, accountNode);
        if (prev.accountNode.attributes?.unresolved && !accountNode.attributes?.unresolved) {
          prev.accountNode.name = accountNode.name;
          prev.accountNode.attributes = { ...accountNode.attributes };
        }
      } else {
        mergedByKey.set(mergeKey, { appName, appKey, appDoc, accountNode });
      }
    }

    for (const { appName, appKey, appDoc, accountNode } of mergedByKey.values()) {
      if (!applicationBranches[appKey]) {
        applicationBranches[appKey] = {
          name: appName,
          attributes: {
            type: 'Application',
            ...(appDoc?._id ? { applicationId: String(appDoc._id) } : {}),
            ...(appDoc?.icon ? { icon: appDoc.icon } : {}),
            ...(appDoc?.color ? { color: appDoc.color } : {}),
            ...(appDoc?.type ? { applicationType: appDoc.type } : {}),
          },
          children: [],
        };
        subjectNode.children.push(applicationBranches[appKey]);
      }
      applicationBranches[appKey].children.push(accountNode);
    }

    // Roll-up counts so the graph can show badges without expanding branches.
    let totalAccounts = 0;
    let totalEntitlements = 0;
    let totalPrivileged = 0;
    for (const appNode of subjectNode.children) {
      let appEntitlements = 0;
      let appPrivileged = 0;
      for (const accNode of appNode.children) {
        const ents = Array.isArray(accNode.children) ? accNode.children : [];
        const priv = ents.filter((e) => e.attributes?.isPrivileged === true).length;
        accNode.attributes = {
          ...accNode.attributes,
          entitlementCount: ents.length,
          privilegedCount: priv,
        };
        appEntitlements += ents.length;
        appPrivileged += priv;
      }
      appNode.attributes = {
        ...appNode.attributes,
        accountCount: appNode.children.length,
        entitlementCount: appEntitlements,
        privilegedCount: appPrivileged,
      };
      totalAccounts += appNode.children.length;
      totalEntitlements += appEntitlements;
      totalPrivileged += appPrivileged;
    }
    subjectNode.attributes = {
      ...subjectNode.attributes,
      applicationCount: subjectNode.children.length,
      accountCount: totalAccounts,
      entitlementCount: totalEntitlements,
      privilegedCount: totalPrivileged,
    };

    return res.status(200).json({
      success: true,
      data: {
        subject: subjectNode,
        managerChain: managerNodeTemplates,
      },
    });
  } catch (error) {
    console.error('[getIdentityGraph]', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate identity graph.',
      error: error.message,
    });
  }
};
