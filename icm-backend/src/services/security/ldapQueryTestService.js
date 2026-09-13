import { normalizeAdConfig, mapAdEntryToUserDoc } from "../ad/adLdapService.js";
import { fetchPagedSearchEntries } from "../ad/ldapNormalizer.js";
import { Client } from "ldapts";
import { validateLdapFilterDetailed } from "../posture/ldapFilterValidator.js";

const SAMPLE_LIMIT = 10;
const COUNT_LIMIT = 25;

function createClient(cfg) {
  const opts = {
    url: cfg.url,
    timeout: 30000,
    connectTimeout: 10000,
  };
  if (cfg.tlsInsecure) {
    opts.tlsOptions = { rejectUnauthorized: false };
  }
  return new Client(opts);
}

/**
 * Execute a read-only LDAP test search (does not persist results).
 * @param {object} adConfigRaw
 * @param {string} ldapFilter
 * @param {{ searchBase?: string }} [options]
 */
export async function testApplicationLdapQuery(adConfigRaw, ldapFilter, options = {}) {
  const validation = validateLdapFilterDetailed(ldapFilter);
  if (!validation.valid) {
    const err = new Error(validation.errors[0] || "Invalid LDAP filter.");
    err.code = "INVALID_FILTER";
    err.validation = validation;
    throw err;
  }

  const cfg = normalizeAdConfig({
    ...adConfigRaw,
    userSearchFilter: ldapFilter,
    userSearchFilters: [ldapFilter],
  });

  if (!cfg.url || !cfg.bindDn || !cfg.baseDn) {
    throw new Error("Incomplete AD configuration on this application.");
  }
  if (!cfg.bindPassword) {
    throw new Error("Bind password is required to test LDAP queries.");
  }

  const client = createClient(cfg);
  const searchBase = options.searchBase?.trim() || cfg.baseDn;
  try {
    await client.bind(cfg.bindDn, String(cfg.bindPassword));
    const entries = await fetchPagedSearchEntries(
      client,
      searchBase,
      {
        filter: ldapFilter,
        searchScope: options.searchScope,
        attributes: [
          "sAMAccountName",
          "displayName",
          "mail",
          "distinguishedName",
          "objectClass",
        ],
      },
      COUNT_LIMIT,
    );

    const sample = entries.slice(0, SAMPLE_LIMIT).map((entry) => {
      const doc = mapAdEntryToUserDoc(entry);
      return {
        name: doc.display_name || doc.user_id || doc.rawData?.distinguishedName || "",
        samAccountName: doc.user_id || "",
        dn: doc.rawData?.distinguishedName || "",
        mail: doc.email || "",
      };
    });

    return {
      valid: true,
      objectCount: entries.length,
      truncated: entries.length >= COUNT_LIMIT,
      sample,
    };
  } finally {
    try {
      await client.unbind();
    } catch {
      /* ignore */
    }
  }
}
