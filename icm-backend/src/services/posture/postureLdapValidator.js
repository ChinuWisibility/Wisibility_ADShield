import { normalizeAdConfig, createLdapClient } from "../ad/adLdapService.js";
import { DEFAULT_USER_FILTER } from "../ad/ldapNormalizer.js";
import { LDAP_SEARCH_SCOPE_SUBTREE } from "../../utils/ldapEntryAttributes.js";

/**
 * Map raw LDAP errors to operator-friendly messages.
 * @param {Error} err
 * @returns {string}
 */
export function friendlyLdapErrorMessage(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = err?.code;

  if (
    code === 49 ||
    /invalid credentials|invalid credential|data 52e|data 775|logon failure/i.test(msg)
  ) {
    return "The LDAP credentials are invalid.";
  }
  if (/no such object|nosuchobject|error code 32|code=32/i.test(msg)) {
    return "The configured search base does not exist.";
  }
  if (/connect|econnrefused|enotfound|etimedout|timeout|network/i.test(msg)) {
    return "Unable to bind to Active Directory.";
  }
  if (!msg || msg === "undefined") {
    return "Unable to bind to Active Directory.";
  }
  return "Unable to bind to Active Directory.";
}

/**
 * Validate LDAP connectivity before posture scan execution.
 * @param {object} rawAdConfig
 * @throws {Error} with user-friendly message
 */
export async function validatePostureLdapConnection(rawAdConfig) {
  const cfg = normalizeAdConfig(rawAdConfig);
  const urls = cfg.urls?.length ? cfg.urls : cfg.url ? [cfg.url] : [];
  const baseDns = cfg.baseDns?.length
    ? cfg.baseDns
    : cfg.baseDn
      ? [cfg.baseDn]
      : [];

  if (!urls.length) {
    const err = new Error("Active Directory server URL is not configured.");
    err.code = "LDAP_CONFIG";
    throw err;
  }
  if (!cfg.bindDn) {
    const err = new Error("LDAP bind username is not configured.");
    err.code = "LDAP_CONFIG";
    throw err;
  }
  if (cfg.bindPassword === undefined || cfg.bindPassword === "") {
    const err = new Error("Bind password is required for LDAP-based scan features.");
    err.code = "LDAP_CONFIG";
    throw err;
  }
  if (!baseDns.length) {
    const err = new Error("The configured search base does not exist.");
    err.code = "LDAP_CONFIG";
    throw err;
  }

  const failures = [];
  for (const url of urls) {
    for (const baseDn of baseDns) {
      const client = createLdapClient({ ...cfg, url });
      try {
        await client.bind(cfg.bindDn, String(cfg.bindPassword));
        await client.search(baseDn, {
          filter: DEFAULT_USER_FILTER,
          scope: LDAP_SEARCH_SCOPE_SUBTREE,
          attributes: ["distinguishedName"],
          sizeLimit: 1,
          timeLimit: 15,
        });
        try {
          await client.unbind();
        } catch {
          /* ignore */
        }
        return { ok: true, url, baseDn };
      } catch (err) {
        failures.push({ url, baseDn, err });
        try {
          await client.unbind();
        } catch {
          /* ignore */
        }
      }
    }
  }

  const first = failures[0]?.err;
  const message = friendlyLdapErrorMessage(first || new Error("LDAP validation failed"));
  const err = new Error(message);
  err.code = "LDAP_VALIDATION";
  throw err;
}
