/**
 * Generic provisioning connector contract (application-agnostic).
 *
 * Implementations expose:
 *   async createAccount(accountRequest) => ProvisioningConnectorResult
 *   async executeTask(task)            => ProvisioningConnectorResult  (worker entry)
 *
 * Optional family methods:
 *   updateAccount | disableAccount | enableAccount
 *   addEntitlement | removeEntitlement
 *   deleteAccount (unsupported by AD)
 *
 * accountRequest shape (IDs only + attribute map — no target-native syntax here):
 *   {
 *     tenantId, identityId, applicationId,
 *     operation: "ADD_ACCOUNT",
 *     attributes: { ...identity-derived attrs },
 *     policySnapshot?: object,
 *     taskId?, requestId?,
 *   }
 *
 * Entitlement operations additionally carry:
 *   entitlement: { entitlementId?, nativeId?, name? }
 * Connectors must resolve target-native identifiers from a tenant/application-
 * scoped catalog; caller-supplied display names are not write targets.
 *
 * Result:
 *   { status: "COMPLETED"|"FAILED"|"SKIPPED", message?, nativeIdentifier?, detail? }
 *
 * NEVER put AD/LDAP/SAP/Oracle branching in the provisioning worker — only here per family.
 */

export const PROVISIONING_OPERATION = Object.freeze({
  /** CREATE_ACCOUNT (product) */
  ADD_ACCOUNT: "ADD_ACCOUNT",
  CREATE_ACCOUNT: "ADD_ACCOUNT",
  UPDATE_ACCOUNT: "UPDATE_ACCOUNT",
  REMOVE_ACCOUNT: "REMOVE_ACCOUNT",
  ADD_ENTITLEMENT: "ADD_ENTITLEMENT",
  REMOVE_ENTITLEMENT: "REMOVE_ENTITLEMENT",
  /** DISABLE_ACCOUNT (product) */
  DISABLE: "DISABLE",
  DISABLE_ACCOUNT: "DISABLE",
  ENABLE: "ENABLE",
  ENABLE_ACCOUNT: "ENABLE",
});

/** Normalize product aliases to stored task operationType values. */
export function normalizeProvisioningOperation(op) {
  const raw = String(op || "").toUpperCase();
  if (raw === "CREATE_ACCOUNT" || raw === "CREATE") return "ADD_ACCOUNT";
  if (raw === "DISABLE_ACCOUNT") return "DISABLE";
  if (raw === "ENABLE_ACCOUNT") return "ENABLE";
  if (raw === "UPDATE") return "UPDATE_ACCOUNT";
  return raw;
}

/**
 * @param {object} partial
 * @returns {{ status: string, message?: string, nativeIdentifier?: string, detail?: object }}
 */
export function provisioningResult(partial = {}) {
  const status = String(partial.status || "FAILED").toUpperCase();
  const out = {
    status: ["COMPLETED", "FAILED", "SKIPPED"].includes(status) ? status : "FAILED",
  };
  if (partial.message) {
    out.message = String(partial.message)
      .replace(/bindPassword[=:]\s*\S+/gi, "bindPassword=[redacted]")
      .replace(/\bpassword[=:]\s*\S+/gi, "password=[redacted]")
      .replace(/\bsecret[=:]\s*\S+/gi, "secret=[redacted]")
      .slice(0, 2000);
  }
  if (partial.nativeIdentifier) out.nativeIdentifier = String(partial.nativeIdentifier);
  if (partial.detail && typeof partial.detail === "object") {
    out.detail = sanitizeConnectorDetail(partial.detail);
  }
  return out;
}

/** Strip secrets from connector detail before persistence. */
export function sanitizeConnectorDetail(detail) {
  if (!detail || typeof detail !== "object") return undefined;
  const blocked = /password|passwd|secret|unicodepwd|credential|bindPassword/i;
  const out = {};
  for (const [k, v] of Object.entries(detail)) {
    if (blocked.test(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = sanitizeConnectorDetail(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
