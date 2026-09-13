#!/usr/bin/env node
/**
 * NON-PRODUCTION live AD harness for Security Posture proof under OU=wisibility.
 *
 * Uses dedicated lab seed objects (WIS-Sd-* / WIS-Seed-*) because create-user
 * rights are insufficient for WIS-ADShield-Test-* in this environment.
 * SETUP restores known-bad anomaly state on those objects; RESET restores
 * documented lab baseline where reversible.
 *
 * Usage (from icm-backend/ADShield):
 *   node scripts/live-posture-harness.mjs setup
 *   node scripts/live-posture-harness.mjs status
 *   node scripts/live-posture-harness.mjs reset
 *   node scripts/live-posture-harness.mjs prove-accounts
 *   node scripts/live-posture-harness.mjs prove-acl
 *   node scripts/live-posture-harness.mjs prove
 *
 * Credentials: .env.local only (never logged).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Attribute, Change } from "ldapts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "../..");
const ENV_FILE = path.join(ROOT, ".env.local");
const MANIFEST_OUT = path.join(REPO_ROOT, "adshield-live-test-manifest.json");
const SCOPE_OU = "OU=wisibility,DC=wisibility,DC=lcl";
const ADSHIELD_URL = process.env.ADSHIELD_API_URL || "http://127.0.0.1:5088";

/** Lab seed targets under OU=wisibility (dedicated test objects). */
const SEEDS = {
  disabled_users: {
    sam: "WIS-Sd-DisUsr",
    dn: "CN=WIS-Seed-Disabled-User,OU=wisibility,DC=wisibility,DC=lcl",
    featureId: "disabled_users",
    action: "enable_account",
    badUac: 514,
    goodUac: 512,
  },
  locked_accounts: {
    sam: "WIS-Sd-LockUsr",
    dn: "CN=WIS Seed Locked User,OU=wisibility,DC=wisibility,DC=lcl",
    featureId: "locked_accounts",
    action: "unlock_account",
  },
  password_never_expires: {
    sam: "WIS-Sd-PwdNx",
    dn: "CN=WIS-Seed-Pwd-Never-Expires,OU=wisibility,DC=wisibility,DC=lcl",
    featureId: "password_never_expires",
    action: "clear_password_never_expires",
    badUac: 66048,
    goodUac: 512,
  },
  password_not_required: {
    sam: "WIS-Sd-PwdNr",
    dn: "CN=WIS-Seed-Pwd-Not-Required,OU=wisibility,DC=wisibility,DC=lcl",
    featureId: "password_not_required",
    action: "clear_password_not_required",
    badUac: 544,
    goodUac: 512,
  },
  reversible_encryption_enabled: {
    sam: "WIS-Sd-RevEnc",
    dn: "CN=WIS-Seed-Reversible-Encryption,OU=wisibility,DC=wisibility,DC=lcl",
    featureId: "reversible_encryption_enabled",
    action: "clear_reversible_encryption",
    badUac: 640,
    goodUac: 512,
  },
  smartcard_not_required: {
    sam: "WIS-Sd-NoSc",
    dn: "CN=WIS-Seed-Smartcard-Not-Required,OU=wisibility,DC=wisibility,DC=lcl",
    featureId: "smartcard_not_required",
    action: "require_smartcard",
    badUac: 512,
    goodUac: 512 | 0x40000,
  },
  service_accounts: {
    sam: "WIS-Sd-SvcAcc",
    dn: "CN=WIS-Seed-Service-Account,OU=wisibility,DC=wisibility,DC=lcl",
    featureId: "service_accounts",
    action: "remove_service_principal_names",
    spn: "HTTP/WIS-Sd-SvcAcc.wisibility.lcl",
  },
};

function loadEnv() {
  const env = { ...process.env };
  if (!fs.existsSync(ENV_FILE)) throw new Error(`Missing ${ENV_FILE}`);
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    env[t.slice(0, i).trim()] = v;
  }
  for (const k of [
    "ADSHIELD_LDAP_URL",
    "ADSHIELD_BIND_DN",
    "ADSHIELD_BIND_PASSWORD",
    "ADSHIELD_BASE_DN",
  ]) {
    if (!env[k]) throw new Error(`Missing ${k}`);
  }
  return env;
}

function redact(obj) {
  return JSON.stringify(obj)
    .replace(/"bindPassword"\s*:\s*"[^"]*"/gi, '"bindPassword":"[redacted]"')
    .replace(/password[=:]\s*\S+/gi, "password=[redacted]");
}

function log(msg, obj) {
  if (obj !== undefined) console.log(msg, redact(obj));
  else console.log(msg);
}

async function withLdap(env, fn) {
  const client = new Client({
    url: env.ADSHIELD_LDAP_URL,
    timeout: 30000,
    connectTimeout: 15000,
  });
  try {
    await client.bind(env.ADSHIELD_BIND_DN, env.ADSHIELD_BIND_PASSWORD);
    return await fn(client);
  } finally {
    try {
      await client.unbind();
    } catch {
      /* ignore */
    }
  }
}

function replaceAttr(type, values) {
  return new Change({
    operation: "replace",
    modification: new Attribute({
      type,
      values: Array.isArray(values) ? values.map(String) : [String(values)],
    }),
  });
}

function filetimeNow() {
  const FILETIME_EPOCH = 116444736000000000n;
  return (BigInt(Date.now()) * 10000n + FILETIME_EPOCH).toString();
}

async function setup(env) {
  return withLdap(env, async (client) => {
    const report = {};
    for (const [key, s] of Object.entries(SEEDS)) {
      try {
        if (s.badUac != null) {
          await client.modify(s.dn, [replaceAttr("userAccountControl", s.badUac)]);
        }
        if (key === "locked_accounts") {
          await client.modify(s.dn, [replaceAttr("lockoutTime", filetimeNow())]);
        }
        if (key === "service_accounts") {
          await client.modify(s.dn, [replaceAttr("servicePrincipalName", [s.spn])]);
        }
        report[key] = { ok: true, dn: s.dn, sam: s.sam };
      } catch (e) {
        report[key] = { ok: false, error: e.message.slice(0, 160), dn: s.dn };
      }
    }
    log("SETUP complete (seed anomalies restored)", report);
    return report;
  });
}

async function status(env) {
  return withLdap(env, async (client) => {
    const out = [];
    for (const s of Object.values(SEEDS)) {
      try {
        const { searchEntries } = await client.search(s.dn, {
          scope: "base",
          attributes: [
            "sAMAccountName",
            "userAccountControl",
            "lockoutTime",
            "servicePrincipalName",
            "lastLogonTimestamp",
          ],
        });
        const e = searchEntries[0] || {};
        out.push({
          feature: s.featureId,
          sam: e.sAMAccountName || s.sam,
          dn: s.dn,
          uac: e.userAccountControl,
          lockoutTime: e.lockoutTime,
          spn: e.servicePrincipalName,
        });
      } catch (err) {
        out.push({ feature: s.featureId, dn: s.dn, error: err.message });
      }
    }
    console.log(JSON.stringify(out, null, 2));
    return out;
  });
}

async function reset(env) {
  // Restore documented bad seed baselines so lab remains useful for scans.
  return setup(env);
}

function connectionBody(env) {
  return {
    url: env.ADSHIELD_LDAP_URL,
    bindDn: env.ADSHIELD_BIND_DN,
    bindPassword: env.ADSHIELD_BIND_PASSWORD,
    baseDn: env.ADSHIELD_BASE_DN,
    timeoutMs: 180000,
    tlsInsecure: false,
  };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON ${url} HTTP ${res.status}`);
  }
  return { ok: res.ok, status: res.status, data };
}

async function accountAnalysis(env, features, { filter } = {}) {
  return postJson(`${ADSHIELD_URL}/api/v1/security/account-analysis`, {
    scanId: `live-proof-${Date.now()}`,
    features,
    connection: connectionBody(env),
    search: {
      baseDn: SCOPE_OU,
      filter:
        filter ||
        "(&(objectCategory=person)(objectClass=user)(|(sAMAccountName=WIS-Sd-*)(sAMAccountName=WIS-Test*)(cn=WIS-Seed*)(cn=WIS Seed*)))",
      scope: "sub",
    },
    options: { maxObjects: 500, inactiveDays: 90 },
  });
}

async function remediate(env, action, dryRun) {
  return postJson(`${ADSHIELD_URL}/api/v1/security/remediate`, {
    connection: connectionBody(env),
    action,
    dryRun,
    verifyAfter: !dryRun,
  });
}

async function proveAccounts(env) {
  await setup(env);
  const results = [];

  // inactive_users: lastLogonTimestamp is not writable → document NOT SAFE
  results.push({
    featureId: "inactive_users",
    testObject: null,
    result: "NOT_SAFE_TO_TEST_LIVE",
    notes: [
      "AD returns WILL_NOT_PERFORM when setting lastLogonTimestamp; cannot create authentic inactive condition without waiting 90+ days of no logon.",
    ],
  });

  for (const s of Object.values(SEEDS)) {
    const row = {
      featureId: s.featureId,
      testObject: s.sam,
      dn: s.dn,
      result: "BLOCKED",
      notes: [],
      apiFlow: {
        discover: "POST /api/v1/security/account-analysis",
        remediate: "POST /api/v1/security/remediate",
      },
    };
    try {
      const discover = await accountAnalysis(env, [s.featureId]);
      if (!discover.data?.success) {
        row.notes.push(`discover failed HTTP ${discover.status}`);
        results.push(row);
        continue;
      }
      const findings = (discover.data.findings || []).filter(
        (f) =>
          f.feature === s.featureId &&
          (String(f.dn).toLowerCase() === s.dn.toLowerCase() ||
            String(f.objectName).toLowerCase() === s.sam.toLowerCase()),
      );
      row.discovery = findings[0]
        ? {
            feature: findings[0].feature,
            dn: findings[0].dn,
            status: findings[0].status,
            findingType: findings[0].findingType,
            findingSignals: findings[0].findingSignals,
            evidence: findings[0].evidence,
            attributes: findings[0].attributes,
          }
        : null;
      if (!findings.length) {
        row.notes.push("seed anomaly not discovered");
        results.push(row);
        continue;
      }

      const targetDn = findings[0].dn;
      const preview = await remediate(
        env,
        { type: s.action, feature: s.featureId, targetDn },
        true,
      );
      row.preview = {
        success: preview.data?.success,
        changes: preview.data?.changes,
        errors: preview.data?.errors,
      };
      if (!preview.data?.success) {
        row.notes.push(`preview failed: ${(preview.data?.errors || []).join("; ")}`);
        results.push(row);
        continue;
      }

      const apply = await remediate(
        env,
        { type: s.action, feature: s.featureId, targetDn },
        false,
      );
      row.apply = {
        success: apply.data?.success,
        changes: apply.data?.changes,
        verification: apply.data?.verification,
        errors: apply.data?.errors,
      };
      if (!apply.data?.success) {
        row.notes.push(`apply failed: ${(apply.data?.errors || []).join("; ")}`);
        results.push(row);
        continue;
      }

      const rescan = await accountAnalysis(env, [s.featureId]);
      const still = (rescan.data?.findings || []).filter(
        (f) =>
          f.feature === s.featureId &&
          String(f.dn || "").toLowerCase() === targetDn.toLowerCase(),
      );
      row.rescanClear = still.length === 0;
      row.result =
        apply.data.success &&
        apply.data.verification?.verified !== false &&
        still.length === 0
          ? "PASS"
          : "BLOCKED";
      if (still.length) row.notes.push("still present after rescan");
    } catch (e) {
      row.notes.push(e.message);
    }
    results.push(row);
    log(`[${row.result}] ${s.featureId}`, {
      notes: row.notes,
      rescanClear: row.rescanClear,
    });
  }

  const outPath = path.join(ROOT, "scripts", "live-proof-accounts-results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  log(`Wrote ${outPath}`);
  return results;
}

async function aclAnalysis(env, features) {
  return postJson(`${ADSHIELD_URL}/api/v1/security/acl-analysis`, {
    scanId: `live-acl-${Date.now()}`,
    features,
    connection: connectionBody(env),
    search: {
      baseDn: SCOPE_OU,
      filter: "(|(objectClass=user)(objectClass=group))",
      scope: "sub",
    },
    options: { maxObjects: 2000 },
  });
}

async function proveAcl(env) {
  const features = [
    "broken_acls",
    "unknown_sid_bindings",
    "orphan_sids",
    "shadow_admins",
    "sid_history_analysis",
    "foreign_security_principals",
  ];
  const discover = await aclAnalysis(env, features);
  const findings = discover.data?.findings || [];
  const results = features.map((featureId) => {
    const hits = findings.filter((f) => f.feature === featureId);
    return {
      featureId,
      result: "NOT_SAFE_TO_TEST_LIVE",
      discoveryCount: hits.length,
      sample: hits[0]
        ? {
            dn: hits[0].dn,
            status: hits[0].status,
            findingType: hits[0].findingType,
            findingSignals: hits[0].findingSignals,
            evidence: hits[0].evidence,
          }
        : null,
      notes: [
        "Controlled reversible ACE/SIDHistory/FSP injection (AddDaclAce) not available in harness yet; refuse to mutate Domain Admins / production ACLs.",
        hits.length
          ? `Opportunistic discovery saw ${hits.length} existing finding(s); no IdentitySphere remediate→clear cycle without owned anomaly.`
          : "No existing finding under OU=wisibility for this feature in this scan.",
      ],
    };
  });
  const outPath = path.join(ROOT, "scripts", "live-proof-acl-results.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify({ discoverOk: discover.ok, success: discover.data?.success, results }, null, 2),
  );
  log(`Wrote ${outPath}`);
  return results;
}

function writeManifest(accountResults, aclResults) {
  const names = {
    disabled_users: "Disabled Users",
    inactive_users: "Inactive Users",
    locked_accounts: "Locked Accounts",
    password_never_expires: "Password Never Expires",
    password_not_required: "Password Not Required",
    reversible_encryption_enabled: "Reversible Encryption",
    smartcard_not_required: "Smartcard Not Required",
    service_accounts: "Service Accounts",
    orphan_sids: "Orphan SIDs",
    shadow_admins: "Shadow Admins",
    sid_history_analysis: "SID History Analysis",
    foreign_security_principals: "Foreign Security Principals",
    unknown_sid_bindings: "Unknown SID Bindings",
    broken_acls: "Broken ACLs",
  };
  const entries = [...(accountResults || []), ...(aclResults || [])].map((r) => ({
    featureId: r.featureId,
    featureName: names[r.featureId] || r.featureId,
    testObject: r.testObject || r.dn || null,
    scope: SCOPE_OU,
    setup:
      r.featureId === "inactive_users"
        ? "NOT POSSIBLE: lastLogonTimestamp not writable"
        : `Restore seed anomaly via harness SETUP for ${r.testObject || r.featureId}`,
    expectedFinding: r.discovery?.status || r.featureId,
    remediation: SEEDS[r.featureId]?.action || "typed ADShield action",
    expectedFinalState: "anomaly cleared per detector",
    verification: "ADShield verifyAfter + account/acl-analysis rescan",
    reset: "node scripts/live-posture-harness.mjs reset",
    liveTestSupported: r.result === "PASS",
    result: r.result,
    notes: r.notes || [],
  }));
  const manifest = {
    generatedAt: new Date().toISOString(),
    scope: SCOPE_OU,
    note: "Create WIS-ADShield-Test-* blocked (Invalid argument / rights). Used dedicated WIS-Sd-* lab seeds under OU=wisibility.",
    adshieldApi: ADSHIELD_URL,
    identitySphereRemediationEndpoint:
      "POST /api/security/applications/:applicationId/remediate",
    adshieldEndpoints: {
      accountAnalysis: "POST /api/v1/security/account-analysis",
      aclAnalysis: "POST /api/v1/security/acl-analysis",
      remediate: "POST /api/v1/security/remediate",
    },
    entries,
  };
  fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2));
  log(`Wrote ${MANIFEST_OUT}`);
}

const cmd = process.argv[2] || "status";
const env = loadEnv();
const runners = {
  setup: () => setup(env),
  status: () => status(env),
  reset: () => reset(env),
  "prove-accounts": async () => {
    const r = await proveAccounts(env);
    writeManifest(r, []);
  },
  "prove-acl": async () => {
    const r = await proveAcl(env);
    writeManifest([], r);
  },
  prove: async () => {
    const a = await proveAccounts(env);
    const c = await proveAcl(env);
    writeManifest(a, c);
  },
};

if (!runners[cmd]) {
  console.error("Unknown command. Use setup|status|reset|prove-accounts|prove-acl|prove");
  process.exit(1);
}

runners[cmd]().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
