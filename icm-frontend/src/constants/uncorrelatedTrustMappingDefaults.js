/** Frontend defaults mirroring backend uncorrelatedTrustMappingDefaults.js */

export const TRUST_SCENARIOS = {
  INACTIVE_ACCOUNT: 'INACTIVE_ACCOUNT',
  ACTIVE_WITH_PRIVILEGED: 'ACTIVE_WITH_PRIVILEGED',
  ACTIVE_WITHOUT_PRIVILEGED: 'ACTIVE_WITHOUT_PRIVILEGED',
};

export const TRUST_SCENARIO_KEYS = [
  TRUST_SCENARIOS.INACTIVE_ACCOUNT,
  TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED,
  TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED,
];

export const TRUST_LEVELS = ['LOW', 'MEDIUM', 'HIGH'];

export const TRUST_SCENARIO_LABELS = {
  [TRUST_SCENARIOS.INACTIVE_ACCOUNT]: 'Inactive Account',
  [TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED]: 'Active Account with Privileged Entitlements',
  [TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED]: 'Active Account without Privileged Entitlements',
};

export const DEFAULT_TRUST_MAPPING = {
  [TRUST_SCENARIOS.INACTIVE_ACCOUNT]: 'LOW',
  [TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED]: 'HIGH',
  [TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED]: 'MEDIUM',
};

export function cloneDefaultUncorrelatedTrustMappingConfig() {
  return {
    useDefaultTrustMapping: true,
    mapping: { ...DEFAULT_TRUST_MAPPING },
  };
}

export function mergeUncorrelatedTrustMappingConfig(stored) {
  const base = cloneDefaultUncorrelatedTrustMappingConfig();
  if (!stored || typeof stored !== 'object') return base;
  const useDefaultTrustMapping =
    stored.useDefaultTrustMapping !== undefined
      ? Boolean(stored.useDefaultTrustMapping)
      : true;
  const src = stored.mapping && typeof stored.mapping === 'object' ? stored.mapping : {};
  const mapping = { ...DEFAULT_TRUST_MAPPING };
  for (const key of TRUST_SCENARIO_KEYS) {
    const level = String(src[key] || '').trim().toUpperCase();
    if (TRUST_LEVELS.includes(level)) mapping[key] = level;
  }
  return { useDefaultTrustMapping, mapping };
}
