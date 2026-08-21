const MAX_FILTER_LENGTH = 4096;
const BLOCKED_SUBSTRINGS = [
  "userpassword",
  "unicodepwd",
  "ntpassword",
  "supplementalcredentials",
];

/**
 * Basic LDAP filter validation (syntax + safety). Does not execute against AD.
 * @param {string} filter
 * @returns {{ ok: boolean, message?: string }}
 */
export function validateLdapFilter(filter) {
  const result = validateLdapFilterDetailed(filter);
  return {
    ok: result.valid,
    message: result.errors[0],
  };
}

/**
 * Human-friendly LDAP filter validation for Security Center query editor.
 * @param {string} filter
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateLdapFilterDetailed(filter) {
  const errors = [];
  const raw = String(filter || "").trim();

  if (!raw) {
    errors.push("An LDAP filter is required.");
    return { valid: false, errors };
  }
  if (raw.length > MAX_FILTER_LENGTH) {
    errors.push(`The LDAP filter is too long (maximum ${MAX_FILTER_LENGTH} characters).`);
    return { valid: false, errors };
  }

  const lower = raw.toLowerCase();
  for (const blocked of BLOCKED_SUBSTRINGS) {
    if (lower.includes(blocked)) {
      errors.push(
        `The filter references a restricted attribute and cannot be used for security queries.`,
      );
      return { valid: false, errors };
    }
  }

  if (!raw.startsWith("(") || !raw.endsWith(")")) {
    errors.push("The LDAP filter must start with ( and end with ).");
    return { valid: false, errors };
  }

  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth < 0) {
        errors.push("The LDAP filter contains an unmatched closing parenthesis.");
        return { valid: false, errors };
      }
    }
  }
  if (depth !== 0) {
    errors.push("The LDAP filter contains an unmatched opening parenthesis.");
    return { valid: false, errors };
  }

  if (/^\(\s*\*\s*\)$/.test(raw) || /^\(&\)$/.test(raw) || /^\(\|\)$/.test(raw)) {
    errors.push("The LDAP filter is too broad. Narrow the search before running it.");
    return { valid: false, errors };
  }

  if (/\(\s*[&|!]?\s*\)/.test(raw)) {
    errors.push("The filter structure is invalid. Check opening and closing brackets.");
    return { valid: false, errors };
  }

  if (/\(\s*[=<>~]/.test(raw) || /\(\s*\w+\s*\)/.test(raw)) {
    /* allow attribute-only clauses like (objectClass=user) */
  }

  const operatorPattern = /\([^()]*(?:[=~<>]|:\d+\.\d+\.\d+\.\d+\.\d+\.\d+\.\d+\.\d+\.\d+\.\d+:=)/;
  if (!operatorPattern.test(raw) && !/^\([^:!&|*][^)]+\)/.test(raw)) {
    errors.push("The filter contains an unsupported or malformed LDAP condition.");
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

const SEARCH_SCOPES = new Set(["Base", "OneLevel", "Subtree"]);

/**
 * Lightweight DN validation for Search Base (not a full LDAP DN parser).
 * Empty is allowed (means use resolved default).
 * @param {string} searchBase
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSearchBaseDn(searchBase) {
  const errors = [];
  const raw = String(searchBase || "").trim();
  if (!raw) return { valid: true, errors: [] };

  if (raw.length > 1024) {
    errors.push("The search base is too long (maximum 1024 characters).");
    return { valid: false, errors };
  }

  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) {
    errors.push("The search base must be a valid distinguished name.");
    return { valid: false, errors };
  }

  const rdnOk = parts.every((part) =>
    /^(OU|CN|DC|O|L|ST|C|UID)=.+/i.test(part),
  );
  if (!rdnOk) {
    errors.push(
      "The search base must look like a DN (e.g. OU=Users,DC=example,DC=com).",
    );
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

/**
 * @param {string} searchScope
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSearchScope(searchScope) {
  const raw = String(searchScope || "").trim();
  if (!raw) return { valid: true, errors: [] };
  if (!SEARCH_SCOPES.has(raw)) {
    return {
      valid: false,
      errors: ["Search scope must be Base, OneLevel, or Subtree."],
    };
  }
  return { valid: true, errors: [] };
}

/**
 * Validate LDAP query editor fields together.
 * @param {{ ldapFilter?: string, searchBase?: string, searchScope?: string, requireFilter?: boolean }} fields
 */
export function validateLdapQueryFields(fields = {}) {
  const errors = [];
  const requireFilter = fields.requireFilter !== false;
  if (requireFilter || String(fields.ldapFilter || "").trim()) {
    const filterResult = validateLdapFilterDetailed(fields.ldapFilter);
    if (!filterResult.valid) errors.push(...filterResult.errors);
  }
  const baseResult = validateSearchBaseDn(fields.searchBase);
  if (!baseResult.valid) errors.push(...baseResult.errors);
  const scopeResult = validateSearchScope(fields.searchScope);
  if (!scopeResult.valid) errors.push(...scopeResult.errors);
  return { valid: errors.length === 0, errors };
}

const OBJECT_TYPES = new Set(["user", "group", "computer", "other"]);
const RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);

/**
 * Validate custom feature definitions (stored only — not executed against AD).
 * @param {object[]} customFeatures
 */
export function validateCustomFeatureDefinitions(customFeatures) {
  if (!Array.isArray(customFeatures) || !customFeatures.length) {
    return { ok: true, valid: [], errors: [] };
  }

  const errors = [];
  const valid = [];

  customFeatures.forEach((raw, index) => {
    const name = String(raw?.name || raw?.featureName || "").trim();
    const objectType = String(raw?.objectType || "user").trim().toLowerCase();
    const ldapFilter = String(raw?.ldapFilter || "").trim();
    const riskLevel = String(raw?.riskLevel || "medium").trim().toLowerCase();
    const recommendation = String(raw?.recommendation || "").trim();
    const attributes = String(raw?.attributes || raw?.requiredAttributes || "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    if (!name) {
      errors.push({ index, message: "Feature name is required." });
      return;
    }
    if (!OBJECT_TYPES.has(objectType)) {
      errors.push({ index, message: `Invalid object type: ${objectType}` });
      return;
    }
    if (!RISK_LEVELS.has(riskLevel)) {
      errors.push({ index, message: `Invalid risk level: ${riskLevel}` });
      return;
    }

    const filterCheck = validateLdapFilter(ldapFilter);
    if (!filterCheck.ok) {
      errors.push({ index, message: filterCheck.message });
      return;
    }

    valid.push({
      id: `custom_${index}_${Date.now()}`,
      name,
      objectType,
      ldapFilter,
      requiredAttributes: attributes,
      riskLevel,
      recommendation,
      executionMode: "LDAP",
      custom: true,
      executed: false,
    });
  });

  return {
    ok: errors.length === 0,
    valid,
    errors,
  };
}
