import { parseSID } from "../../../utils/sidParser.js";
import { PRIVILEGED_NAME_TOKENS } from "../../graph/graphConstants.js";
import {
  extractSecurityDescriptorRaw,
  listDescriptorAces,
  parseSecurityDescriptor,
} from "./securityDescriptorParser.js";

function normalizeSidString(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (/^s-\d/i.test(s)) return s.toUpperCase();
  const parsed = parseSID(value);
  return parsed ? parsed.toUpperCase() : s.toUpperCase();
}

function sidListFromRaw(raw = {}) {
  const out = [];
  const primary = normalizeSidString(raw.objectSid || raw.object_sid);
  if (primary) out.push(primary);
  const history = raw.sIDHistory || raw.sidHistory || raw.sid_history;
  if (Array.isArray(history)) {
    for (const h of history) {
      const norm = normalizeSidString(h);
      if (norm) out.push(norm);
    }
  } else if (history) {
    const norm = normalizeSidString(history);
    if (norm) out.push(norm);
  }
  return out;
}

function isPrivilegedName(name) {
  const n = String(name || "").toLowerCase();
  return PRIVILEGED_NAME_TOKENS.some((t) => n.includes(t.replace(/\s/g, "")));
}

function isForeignSid(sid) {
  const s = String(sid || "").toUpperCase();
  if (!/^S-1-5-21-\d+-\d+-\d+-\d+$/.test(s)) return false;
  // Well-known / built-in domains are not "foreign" in this detector.
  if (s.startsWith("S-1-5-32-")) return false;
  return true;
}

function extractTrustDomainFromDn(dn) {
  const match = String(dn || "").match(/CN=([^,]+),CN=ForeignSecurityPrincipals/i);
  return match ? match[1] : "";
}

/**
 * Build resolvable SID catalog from synced directory objects.
 * @param {object[]} users
 * @param {object[]} entitlements
 */
export function buildSidRegistry(users = [], entitlements = []) {
  /** @type {Map<string, { sid: string, objectType: string, objectName: string, dn: string, privileged: boolean }>} */
  const bySid = new Map();
  /** @type {Map<string, string>} dn lower -> sid */
  const sidByDn = new Map();

  const register = (sid, meta) => {
    const norm = normalizeSidString(sid);
    if (!norm) return;
    if (!bySid.has(norm)) {
      bySid.set(norm, { sid: norm, ...meta });
    }
    if (meta.dn) sidByDn.set(String(meta.dn).trim().toLowerCase(), norm);
  };

  for (const user of users) {
    const raw = user.rawData || {};
    const dn = raw.distinguishedName || "";
    const name = user.display_name || user.user_id || raw.sAMAccountName || "user";
    for (const sid of sidListFromRaw(raw)) {
      register(sid, {
        objectType: "user",
        objectName: name,
        dn,
        privileged: isPrivilegedName(name) || String(raw.is_privileged || user.is_privileged) === "true",
      });
    }
  }

  for (const ent of entitlements) {
    const raw = ent.rawData || {};
    const dn = raw.distinguishedName || raw.groupDN || "";
    const name =
      ent.entitlement_name ||
      ent.entitlement_id ||
      raw.sAMAccountName ||
      raw.cn ||
      "group";
    const privileged = isPrivilegedName(name);
    for (const sid of sidListFromRaw(raw)) {
      register(sid, {
        objectType: "group",
        objectName: name,
        dn,
        privileged,
      });
    }
    if (/foreignsecurityprincipals/i.test(dn)) {
      const sid = normalizeSidString(raw.objectSid || raw.cn);
      register(sid, {
        objectType: "foreign_security_principal",
        objectName: name,
        dn,
        privileged: false,
        foreign: true,
        sourceDomain: extractTrustDomainFromDn(dn),
      });
    }
  }

  const privilegedSids = new Set(
    [...bySid.values()].filter((e) => e.privileged).map((e) => e.sid),
  );

  return {
    bySid,
    sidByDn,
    privilegedSids,
    normalizeSidString,
    isKnown(sid) {
      return bySid.has(normalizeSidString(sid));
    },
    resolve(sid) {
      return bySid.get(normalizeSidString(sid)) || null;
    },
    isPrivilegedSid(sid) {
      return privilegedSids.has(normalizeSidString(sid));
    },
    isForeignSid,
  };
}

/**
 * Collect securable AD objects with optional parsed ACL from synced rawData.
 * @param {object[]} users
 * @param {object[]} entitlements
 */
export function buildSecurableObjectIndex(users = [], entitlements = []) {
  /** @type {Map<string, object>} */
  const byKey = new Map();

  const add = (key, obj) => {
    if (!key) return;
    byKey.set(key, obj);
  };

  for (const user of users) {
    const raw = user.rawData || {};
    const sid = normalizeSidString(raw.objectSid);
    const key = sid || `user:${user.user_id || user._id}`;
    const sdRaw = extractSecurityDescriptorRaw(raw);
    add(key, {
      key,
      objectType: "user",
      objectName: user.display_name || user.user_id || raw.sAMAccountName || key,
      dn: raw.distinguishedName || "",
      sid,
      raw,
      userDoc: user,
      parsedSd: sdRaw ? parseSecurityDescriptor(sdRaw) : null,
      aces: sdRaw ? listDescriptorAces(parseSecurityDescriptor(sdRaw)) : [],
    });
  }

  for (const ent of entitlements) {
    const raw = ent.rawData || {};
    const sid = normalizeSidString(raw.objectSid);
    const key = sid || `group:${ent.entitlement_id || ent._id}`;
    const sdRaw = extractSecurityDescriptorRaw(raw);
    add(key, {
      key,
      objectType: /foreignsecurityprincipals/i.test(raw.distinguishedName || "")
        ? "foreign_security_principal"
        : "group",
      objectName:
        ent.entitlement_name ||
        ent.entitlement_id ||
        raw.sAMAccountName ||
        raw.cn ||
        key,
      dn: raw.distinguishedName || raw.groupDN || "",
      sid,
      raw,
      entitlementDoc: ent,
      parsedSd: sdRaw ? parseSecurityDescriptor(sdRaw) : null,
      aces: sdRaw ? listDescriptorAces(parseSecurityDescriptor(sdRaw)) : [],
    });
  }

  return byKey;
}

/**
 * Shared ACL intelligence context for v2 detectors.
 * @param {object} ctx scan context with analysisCtx
 */
export function buildAclIntelligenceContext(ctx) {
  const analysis = ctx.analysisCtx || {};
  const users = analysis.users || [];
  const entitlements = analysis.entitlements || [];
  const registry = buildSidRegistry(users, entitlements);
  const securableObjects = buildSecurableObjectIndex(users, entitlements);
  return {
    ...ctx,
    registry,
    securableObjects,
    users,
    entitlements,
  };
}
