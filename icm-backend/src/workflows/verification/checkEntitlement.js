import {
  VERIFICATION_STATUS,
  validateVerificationContext,
} from "./verificationStatus.js";

/**
 * Demo/test entitlement check — models access from the trigger payload.
 * Never returns REMOVED when context is missing or identity is unknown.
 */
export function checkDemoEntitlement(identities, identityId, { entitlementId, entitlementName } = {}) {
  const validation = validateVerificationContext({ identityId, entitlementId, entitlementName });
  if (!validation.ok) {
    return {
      verificationStatus: VERIFICATION_STATUS.VERIFICATION_FAILED,
      stillPresent: null,
      reason: validation.reason,
    };
  }

  const identity = identities[identityId];
  if (!identity) {
    return {
      verificationStatus: VERIFICATION_STATUS.VERIFICATION_FAILED,
      stillPresent: null,
      reason: "identity_not_found_in_test_context",
    };
  }

  const stillPresent = identity.access.some(
    (a) =>
      (isPresent(entitlementId) && a.entitlementId === entitlementId) ||
      (isPresent(entitlementName) && a.entitlementName === entitlementName),
  );

  return {
    verificationStatus: stillPresent
      ? VERIFICATION_STATUS.STILL_PRESENT
      : VERIFICATION_STATUS.REMOVED,
    stillPresent,
    reason: null,
  };
}

function isPresent(value) {
  return value != null && String(value).trim() !== "";
}
