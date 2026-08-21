/** Explicit outcomes for VerifyAccessRemoved — never infer REMOVED from missing context. */
export const VERIFICATION_STATUS = {
  REMOVED: "REMOVED",
  STILL_PRESENT: "STILL_PRESENT",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
};

export function isPresent(value) {
  return value != null && String(value).trim() !== "";
}

/**
 * Required context for a meaningful entitlement verification.
 * applicationId is recommended but not strictly required when entitlementName is set.
 */
export function validateVerificationContext({
  identityId,
  entitlementId,
  entitlementName,
} = {}) {
  if (!isPresent(identityId)) {
    return { ok: false, reason: "missing_identityId" };
  }
  if (!isPresent(entitlementId) && !isPresent(entitlementName)) {
    return { ok: false, reason: "missing_entitlement_identifier" };
  }
  return { ok: true };
}

export function buildVerificationOutput({
  identityId,
  entitlementId,
  entitlementName,
  verificationStatus,
  stillPresent,
  portalBaseUrl,
  reason = null,
}) {
  const verified = verificationStatus === VERIFICATION_STATUS.REMOVED;
  return {
    identityId,
    entitlementId,
    entitlementName,
    verificationStatus,
    stillPresent,
    verified,
    verificationReason: reason,
    portalLink: isPresent(identityId)
      ? `${portalBaseUrl || ""}/identities/${identityId}`
      : null,
  };
}

export function branchForVerificationStatus(verificationStatus) {
  switch (verificationStatus) {
    case VERIFICATION_STATUS.STILL_PRESENT:
      return "true";
    case VERIFICATION_STATUS.REMOVED:
      return "false";
    case VERIFICATION_STATUS.VERIFICATION_FAILED:
      return "verification_failed";
    default:
      return "verification_failed";
  }
}
