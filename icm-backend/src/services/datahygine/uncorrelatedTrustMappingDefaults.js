/**
 * Default Uncorrelated Account Trust Mapping (Global Rule Set).
 *
 * Scenarios are fixed; only the assigned Trust Level is configurable.
 */

export const TRUST_SCENARIOS = Object.freeze({
  INACTIVE_ACCOUNT: "INACTIVE_ACCOUNT",
  ACTIVE_WITH_PRIVILEGED: "ACTIVE_WITH_PRIVILEGED",
  ACTIVE_WITHOUT_PRIVILEGED: "ACTIVE_WITHOUT_PRIVILEGED",
});

export const TRUST_SCENARIO_KEYS = Object.freeze([
  TRUST_SCENARIOS.INACTIVE_ACCOUNT,
  TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED,
  TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED,
]);

export const TRUST_LEVELS = Object.freeze(["LOW", "MEDIUM", "HIGH"]);

export const TRUST_SCENARIO_LABELS = Object.freeze({
  [TRUST_SCENARIOS.INACTIVE_ACCOUNT]: "Inactive Account",
  [TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED]: "Active Account with Privileged Entitlements",
  [TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED]: "Active Account without Privileged Entitlements",
});

/** System defaults — used when no tenant config exists or Use Default is on. */
export const DEFAULT_TRUST_MAPPING = Object.freeze({
  [TRUST_SCENARIOS.INACTIVE_ACCOUNT]: "LOW",
  [TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED]: "HIGH",
  [TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED]: "MEDIUM",
});

export function cloneDefaultTrustMapping() {
  return { ...DEFAULT_TRUST_MAPPING };
}

export function cloneDefaultUncorrelatedTrustMappingConfig() {
  return {
    useDefaultTrustMapping: true,
    mapping: cloneDefaultTrustMapping(),
  };
}

function normalizeTrustLevel(value, fallback) {
  const level = String(value || "").trim().toUpperCase();
  return TRUST_LEVELS.includes(level) ? level : fallback;
}

/**
 * Merge stored tenant config with system defaults.
 * @param {object|null|undefined} stored
 */
export function mergeUncorrelatedTrustMappingWithDefaults(stored) {
  const base = cloneDefaultUncorrelatedTrustMappingConfig();
  if (!stored || typeof stored !== "object") return base;

  const useDefaultTrustMapping =
    stored.useDefaultTrustMapping !== undefined
      ? Boolean(stored.useDefaultTrustMapping)
      : true;

  const srcMapping =
    stored.mapping && typeof stored.mapping === "object" ? stored.mapping : {};
  const mapping = cloneDefaultTrustMapping();
  for (const key of TRUST_SCENARIO_KEYS) {
    mapping[key] = normalizeTrustLevel(srcMapping[key], mapping[key]);
  }

  return { useDefaultTrustMapping, mapping };
}

/**
 * Effective scenario → trust map used at evaluation time.
 * When useDefaultTrustMapping is true, always return system defaults.
 * @param {object|null|undefined} config
 */
export function getEffectiveTrustMapping(config) {
  const merged = mergeUncorrelatedTrustMappingWithDefaults(config);
  if (merged.useDefaultTrustMapping) {
    return cloneDefaultTrustMapping();
  }
  return { ...merged.mapping };
}
