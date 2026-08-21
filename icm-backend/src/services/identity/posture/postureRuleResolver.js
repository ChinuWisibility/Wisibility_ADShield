import mongoose from 'mongoose';
import IdentityPostureRuleSet from '../../../models/identity/IdentityPostureRuleSet.js';
import { cloneDefaultRules, DEFAULT_IDENTITY_POSTURE_RULES } from './postureRuleDefaults.js';

const ruleCache = new Map();
const CACHE_TTL_MS = 30_000;

function cacheKey(tenantId) {
  return String(tenantId);
}

export function mergeRulesWithDefaults(stored) {
  if (!stored || typeof stored !== 'object') return cloneDefaultRules();
  const base = cloneDefaultRules();
  return {
    ...base,
    ...stored,
    identityHygiene: {
      ...base.identityHygiene,
      ...(stored.identityHygiene || {}),
      checks: Array.isArray(stored.identityHygiene?.checks)
        ? stored.identityHygiene.checks.map((check) => ({
            ...check,
            // Align with admin UI: missing `enabled` means the check is on.
            enabled: check?.enabled !== false,
          }))
        : base.identityHygiene.checks,
      scoreLevels: Array.isArray(stored.identityHygiene?.scoreLevels)
        ? stored.identityHygiene.scoreLevels
        : base.identityHygiene.scoreLevels,
    },
    accessHygiene: {
      ...base.accessHygiene,
      ...(stored.accessHygiene || {}),
      levels: Array.isArray(stored.accessHygiene?.levels)
        ? stored.accessHygiene.levels
        : base.accessHygiene.levels,
      tiers: Array.isArray(stored.accessHygiene?.tiers)
        ? stored.accessHygiene.tiers
        : base.accessHygiene.tiers,
    },
    complexity: {
      ...base.complexity,
      ...(stored.complexity || {}),
      defaultScore:
        stored.complexity?.defaultScore ?? base.complexity.defaultScore,
      // When tenant has edited levels/tiers, do not re-inject default thresholds
      // (those would otherwise override Global rule set Complexity scoring).
      thresholds: Array.isArray(stored.complexity?.thresholds)
        ? stored.complexity.thresholds
        : Array.isArray(stored.complexity?.levels) && stored.complexity.levels.length > 0
          ? []
          : base.complexity.thresholds,
      scoreLevels: Array.isArray(stored.complexity?.scoreLevels)
        ? stored.complexity.scoreLevels
        : base.complexity.scoreLevels,
      levels: Array.isArray(stored.complexity?.levels)
        ? stored.complexity.levels
        : base.complexity.levels,
      tiers: Array.isArray(stored.complexity?.tiers)
        ? stored.complexity.tiers
        : base.complexity.tiers,
    },
    sodRisk: {
      ...base.sodRisk,
      ...(stored.sodRisk || {}),
      levels: Array.isArray(stored.sodRisk?.levels)
        ? stored.sodRisk.levels
        : base.sodRisk.levels,
      tiers: Array.isArray(stored.sodRisk?.tiers)
        ? stored.sodRisk.tiers
        : base.sodRisk.tiers,
    },
    finalPosture: {
      ...base.finalPosture,
      ...(stored.finalPosture || {}),
      weights: {
        ...base.finalPosture.weights,
        ...(stored.finalPosture?.weights || {}),
      },
    },
    peerComparison: {
      ...base.peerComparison,
      ...(stored.peerComparison || {}),
    },
    labels: {
      ...base.labels,
      ...(stored.labels || {}),
    },
  };
}

/**
 * Load effective posture rules for a tenant (DB doc or system defaults).
 */
export async function resolvePostureRules(tenantId) {
  if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
    return { rules: cloneDefaultRules(), source: 'default' };
  }

  const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId));
  const key = cacheKey(tenantObjectId);
  const cached = ruleCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.payload;
  }

  const doc = await IdentityPostureRuleSet.findOne({
    tenantId: tenantObjectId,
    isActive: true,
  }).lean();

  const payload = doc?.rules
    ? { rules: mergeRulesWithDefaults(doc.rules), source: 'tenant' }
    : { rules: cloneDefaultRules(), source: 'default' };

  ruleCache.set(key, { at: Date.now(), payload });
  return payload;
}

export function invalidatePostureRulesCache(tenantId) {
  if (tenantId && mongoose.Types.ObjectId.isValid(String(tenantId))) {
    ruleCache.delete(cacheKey(new mongoose.Types.ObjectId(String(tenantId))));
  } else {
    ruleCache.clear();
  }
}

export { DEFAULT_IDENTITY_POSTURE_RULES };
