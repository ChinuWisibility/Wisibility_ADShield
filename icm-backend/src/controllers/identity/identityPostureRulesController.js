import mongoose from 'mongoose';
import Tenant from '../../models/platform/Tenant.js';
import User from '../../models/platform/User.js';
import IdentityPostureRuleSet from '../../models/identity/IdentityPostureRuleSet.js';
import {
  invalidatePostureRulesCache,
  mergeRulesWithDefaults,
  resolvePostureRules,
} from '../../services/identity/posture/postureRuleResolver.js';
import { cloneDefaultRules } from '../../services/identity/posture/postureRuleDefaults.js';
import {
  normalizeIncomingRules,
  validatePostureRules,
} from '../../services/identity/posture/postureRulesValidation.js';
import { computePostureFromInputs } from '../../services/identity/posture/identityPostureDashboard.js';
import { AppError } from '../../middleware/errorHandler.js';

async function resolveUserDisplayName(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return 'Unknown';
  const u = await User.findById(userId).select('email firstName lastName').lean();
  if (!u) return 'Unknown';
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email || 'Unknown';
}

function requireTenantId(req) {
  const tenantId = req.scopedTenantId;
  if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
    throw new AppError('Tenant context required', 403, 'TENANT_REQUIRED');
  }
  return tenantId;
}

export async function getIdentityPostureRules(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const { rules, source } = await resolvePostureRules(tenantId);
    const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId));
    const doc = await IdentityPostureRuleSet.findOne({ tenantId: tenantObjectId, isActive: true }).lean();

    return res.json({
      success: true,
      data: {
        source,
        rules,
        tenantId: String(tenantId),
        tenantName: doc?.tenantName || null,
        version: doc?.version ?? null,
        createdBy: doc?.createdBy ? String(doc.createdBy) : null,
        createdByName: doc?.createdByName || null,
        updatedBy: doc?.updatedBy ? String(doc.updatedBy) : null,
        updatedByName: doc?.updatedByName || null,
        createdAt: doc?.createdAt || null,
        updatedAt: doc?.updatedAt || null,
      },
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
}

export async function putIdentityPostureRules(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const incoming = normalizeIncomingRules(req.body);
    const { valid, errors } = validatePostureRules(incoming);
    if (!valid) {
      return res.status(400).json({ success: false, message: errors.join('; ') });
    }

    const rules = mergeRulesWithDefaults(incoming);
    const tenant = await Tenant.findById(tenantId).select('name').lean();
    const userId = req.user?.id || req.user?._id;
    const userName = await resolveUserDisplayName(userId);

    const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId));
    const existing = await IdentityPostureRuleSet.findOne({ tenantId: tenantObjectId });
    const nextVersion = (existing?.version || 0) + 1;

    const update = {
      tenantId: tenantObjectId,
      tenantName: tenant?.name || '',
      rules,
      isActive: true,
      version: nextVersion,
      updatedBy: userId,
      updatedByName: userName,
    };

    let doc;
    if (existing) {
      doc = await IdentityPostureRuleSet.findOneAndUpdate(
        { tenantId: tenantObjectId },
        { $set: update },
        { new: true },
      ).lean();
    } else {
      doc = await IdentityPostureRuleSet.create({
        ...update,
        createdBy: userId,
        createdByName: userName,
      });
      doc = doc.toObject ? doc.toObject() : doc;
    }

    invalidatePostureRulesCache(tenantId);

    return res.json({
      success: true,
      data: {
        source: 'tenant',
        rules: doc.rules,
        tenantId: String(tenantId),
        tenantName: doc.tenantName,
        version: doc.version,
        createdBy: doc.createdBy ? String(doc.createdBy) : null,
        createdByName: doc.createdByName,
        updatedBy: doc.updatedBy ? String(doc.updatedBy) : null,
        updatedByName: doc.updatedByName,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
}

export async function deleteIdentityPostureRules(req, res) {
  try {
    const tenantId = requireTenantId(req);
    await IdentityPostureRuleSet.deleteOne({ tenantId: new mongoose.Types.ObjectId(String(tenantId)) });
    invalidatePostureRulesCache(tenantId);

    return res.json({
      success: true,
      data: { source: 'default', rules: cloneDefaultRules() },
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
}

export async function previewIdentityPostureRules(req, res) {
  try {
    requireTenantId(req);
    const incoming = normalizeIncomingRules(req.body);
    const draftRules = req.body?.rules ? mergeRulesWithDefaults(incoming) : (await resolvePostureRules(req.scopedTenantId)).rules;

    const {
      accountCount = 0,
      groupCount = 0,
      sodViolationCount = 0,
      privilegedCount = 0,
      privilegedEntitlementCount = privilegedCount,
      identity = {},
    } = req.body?.sample || {};

    const posture = computePostureFromInputs(
      identity,
      accountCount,
      groupCount,
      sodViolationCount,
      privilegedEntitlementCount,
      draftRules,
    );

    return res.json({ success: true, data: posture });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message });
  }
}
