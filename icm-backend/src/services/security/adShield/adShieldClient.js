/**
 * ADShield outbound client — reads ADSHIELD_* from process.env so unit tests
 * do not need to boot the full env.js secret bootstrap.
 */

const ACL_ANALYSIS_PATH = "/api/v1/security/acl-analysis";
const ACCOUNT_ANALYSIS_PATH = "/api/v1/security/account-analysis";
const POSTURE_ANALYSIS_PATH = "/api/v1/security/posture-analysis";
const REMEDIATE_PATH = "/api/v1/security/remediate";

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

/**
 * @returns {boolean}
 */
export function isAdShieldEnabled() {
  return parseBool(process.env.ADSHIELD_ENABLED, false);
}

/**
 * @returns {{ enabled: boolean, baseUrl: string, timeoutMs: number, apiKey: string }}
 */
export function getAdShieldConfig() {
  const timeoutRaw = parseInt(process.env.ADSHIELD_TIMEOUT_MS, 10);
  return {
    enabled: isAdShieldEnabled(),
    baseUrl: String(process.env.ADSHIELD_BASE_URL || "http://127.0.0.1:5088")
      .trim()
      .replace(/\/+$/, ""),
    timeoutMs: Math.min(Math.max(Number.isFinite(timeoutRaw) ? timeoutRaw : 180000, 5000), 540000),
    apiKey: String(process.env.ADSHIELD_API_KEY || "").trim(),
  };
}

/**
 * Strip credential-like substrings from error text (never log bind passwords).
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeAdShieldErrorMessage(value) {
  let msg = String(value?.message || value || "ADShield request failed");
  msg = msg
    .replace(/bindPassword[=:]\s*\S+/gi, "bindPassword=[redacted]")
    .replace(/\bpassword[=:]\s*\S+/gi, "password=[redacted]")
    .replace(/\bpwd[=:]\s*\S+/gi, "pwd=[redacted]")
    .replace(/\bsecret[=:]\s*\S+/gi, "secret=[redacted]")
    .replace(/"bindPassword"\s*:\s*"[^"]*"/gi, '"bindPassword":"[redacted]"');
  return msg;
}

/**
 * @param {string} path
 * @param {object} body
 * @param {{ timeoutMs?: number, signal?: AbortSignal, label?: string }} [opts]
 * @returns {Promise<object>}
 */
async function postAdShieldJson(path, body, opts = {}) {
  const cfg = getAdShieldConfig();
  const label = opts.label || "ADShield request";
  if (!cfg.enabled) {
    const err = new Error("ADShield is disabled.");
    err.code = "ADSHIELD_DISABLED";
    throw err;
  }
  if (!cfg.baseUrl) {
    const err = new Error("ADSHIELD_BASE_URL is not configured.");
    err.code = "ADSHIELD_MISCONFIGURED";
    throw err;
  }

  const url = `${cfg.baseUrl}${path}`;
  const timeoutMs = opts.timeoutMs ?? cfg.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (cfg.apiKey) {
    headers["X-ADShield-Key"] = cfg.apiKey;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      const err = new Error(
        `ADShield returned non-JSON response (HTTP ${res.status}).`,
      );
      err.code = "ADSHIELD_BAD_RESPONSE";
      err.status = res.status;
      throw err;
    }

    if (!res.ok) {
      const detail =
        (data && typeof data === "object" && (data.message || data.errors?.[0])) ||
        `HTTP ${res.status}`;
      const err = new Error(
        sanitizeAdShieldErrorMessage(`${label} failed: ${detail}`),
      );
      err.code = "ADSHIELD_HTTP_ERROR";
      err.status = res.status;
      err.payload = data;
      throw err;
    }

    if (!data || typeof data !== "object") {
      const err = new Error(`ADShield returned an empty ${label} payload.`);
      err.code = "ADSHIELD_BAD_RESPONSE";
      throw err;
    }

    return data;
  } catch (err) {
    if (err?.code?.startsWith?.("ADSHIELD_")) throw err;
    if (err?.name === "AbortError") {
      const timeoutErr = new Error(`${label} timed out after ${timeoutMs} ms.`);
      timeoutErr.code = "ADSHIELD_TIMEOUT";
      throw timeoutErr;
    }
    const wrapped = new Error(
      sanitizeAdShieldErrorMessage(
        err?.cause?.message || err?.message || "ADShield connection failed",
      ),
    );
    wrapped.code =
      /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|fetch failed/i.test(String(err?.message))
        ? "ADSHIELD_UNAVAILABLE"
        : "ADSHIELD_ERROR";
    throw wrapped;
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
  }
}

/**
 * POST ACL analysis to ADShield.
 * @param {object} body
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [opts]
 */
export async function postAclAnalysis(body, opts = {}) {
  return postAdShieldJson(ACL_ANALYSIS_PATH, body, {
    ...opts,
    label: "ADShield ACL analysis",
  });
}

/**
 * POST account analysis to ADShield.
 * @param {object} body
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [opts]
 */
export async function postAccountAnalysis(body, opts = {}) {
  return postAdShieldJson(ACCOUNT_ANALYSIS_PATH, body, {
    ...opts,
    label: "ADShield account analysis",
  });
}

/**
 * POST posture analysis (groups / privileged / computers / kerberos / delegation).
 * @param {object} body
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [opts]
 */
export async function postPostureAnalysis(body, opts = {}) {
  return postAdShieldJson(POSTURE_ANALYSIS_PATH, body, {
    ...opts,
    label: "ADShield posture analysis",
  });
}

/**
 * POST remediation (preview via dryRun=true, or apply).
 * @param {object} body
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [opts]
 */
export async function postRemediate(body, opts = {}) {
  return postAdShieldJson(REMEDIATE_PATH, body, {
    ...opts,
    label: "ADShield remediation",
  });
}
