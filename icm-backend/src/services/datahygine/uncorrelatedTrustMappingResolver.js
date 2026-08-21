import mongoose from "mongoose";
import UncorrelatedTrustMappingRuleSet from "../../models/identity/UncorrelatedTrustMappingRuleSet.js";
import {
  cloneDefaultUncorrelatedTrustMappingConfig,
  getEffectiveTrustMapping,
  mergeUncorrelatedTrustMappingWithDefaults,
} from "./uncorrelatedTrustMappingDefaults.js";

const ruleCache = new Map();
const CACHE_TTL_MS = 30_000;

function cacheKey(tenantId) {
  return String(tenantId);
}

/**
 * Load effective Uncorrelated Account Trust Mapping for a tenant.
 * @param {string|import('mongoose').Types.ObjectId} tenantId
 * @returns {Promise<{ config: object, effectiveMapping: object, source: 'tenant'|'default', version?: number|null, updatedAt?: Date|null }>}
 */
export async function resolveUncorrelatedTrustMapping(tenantId) {
  if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
    const config = cloneDefaultUncorrelatedTrustMappingConfig();
    return {
      config,
      effectiveMapping: getEffectiveTrustMapping(config),
      source: "default",
    };
  }

  const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId));
  const key = cacheKey(tenantObjectId);
  const cached = ruleCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.payload;
  }

  const doc = await UncorrelatedTrustMappingRuleSet.findOne({
    tenantId: tenantObjectId,
    isActive: true,
  }).lean();

  const payload = doc?.config
    ? {
        config: mergeUncorrelatedTrustMappingWithDefaults(doc.config),
        effectiveMapping: getEffectiveTrustMapping(doc.config),
        source: "tenant",
        version: doc.version ?? null,
        updatedAt: doc.updatedAt ?? null,
      }
    : (() => {
        const config = cloneDefaultUncorrelatedTrustMappingConfig();
        return {
          config,
          effectiveMapping: getEffectiveTrustMapping(config),
          source: "default",
        };
      })();

  ruleCache.set(key, { at: Date.now(), payload });
  return payload;
}

export function invalidateUncorrelatedTrustMappingCache(tenantId) {
  if (tenantId && mongoose.Types.ObjectId.isValid(String(tenantId))) {
    ruleCache.delete(cacheKey(new mongoose.Types.ObjectId(String(tenantId))));
  } else {
    ruleCache.clear();
  }
}
