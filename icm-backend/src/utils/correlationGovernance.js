/**
 * Post-correlation governance: lifecycle / account policy — MUST NOT affect matching.
 * Matching answers only: "Does this account map to an identity?" (see correlation engines).
 */

/** Lifecycle values treated as "inactive" for governance orphan detection. */
export const INACTIVE_GOVERNANCE_LIFECYCLES = new Set(["TERMINATED", "QUARANTINE", "LEAVER", "INACTIVE"]);

/**
 * @param {string|undefined|null} lifecycleState
 * @returns {boolean}
 */
export function isIdentityLifecycleInactive(lifecycleState) {
  const s = String(lifecycleState ?? "").toUpperCase();
  if (!s) return false;
  return INACTIVE_GOVERNANCE_LIFECYCLES.has(s);
}

/**
 * "Enabled" application account — active enough that keeping it open while identity is inactive is an anomaly.
 * Supports AccountAggregation.status (ACTIVE, DISABLED, …) and common connector shapes.
 * @param {object|null|undefined} account
 */
export function isAccountEnabledForGovernance(account) {
  if (!account || typeof account !== "object") return true;
  const s = String(account.status ?? account.accountStatus ?? "").toUpperCase();
  if (!s) return true;
  if (["DISABLED", "LOCKED", "EXPIRED", "INACTIVE"].includes(s)) return false;
  return true;
}

/**
 * @param {{ lifecycleState?: string|null }} identityCtx
 * @param {object} account — raw app user doc or AccountAggregation lean doc
 * @returns {{ isOrphan: boolean, orphanReason: string|null }}
 */
export function evaluateGovernanceOrphan(identityCtx, account) {
  const inactive = isIdentityLifecycleInactive(identityCtx?.lifecycleState);
  const enabled = isAccountEnabledForGovernance(account);
  if (inactive && enabled) {
    return {
      isOrphan: true,
      orphanReason: "Identity inactive but account active",
    };
  }
  return { isOrphan: false, orphanReason: null };
}
