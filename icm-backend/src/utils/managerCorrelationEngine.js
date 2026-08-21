import mongoose from "mongoose";
import { mirrorIdentityBulkWriteToLegacy } from "../models/identity/Identity.js";

/**
 * Same normalization as identityProfileMappingUtils.canonicalIdentityMappingTargetKey (duplicated to avoid circular imports).
 */
function canonicalMappingTargetKey(key) {
  const raw = String(key || "").trim();
  if (!raw) return raw;
  const n = raw.replace(/_/g, "").toLowerCase();
  const aliases = {
    workemail: "email",
    useremail: "email",
    primaryemail: "email",
    givenname: "firstname",
    familyname: "lastname",
    surname: "lastname",
    firstname: "firstname",
    lastname: "lastname",
    email: "email",
    uid: "uid",
    employeeid: "employeeId",
    department: "department",
    title: "title",
    phone: "phone",
    displayname: "displayName",
    manageremail: "managerEmail",
    manageremployeeid: "managerEmployeeId",
    managerid: "managerReferenceId",
    "manager id": "managerReferenceId",
    startdate: "startDate",
    status: "status",
  };
  return Object.prototype.hasOwnProperty.call(aliases, n) ? aliases[n] : raw;
}

/**
 * Deterministic manager correlation (pure logic, no I/O).
 * Lookup: managerAttribute value → identity where referenceAttribute matches (trim-normalized; email lowercased).
 * Duplicate reference values: omitted from index → unresolved (no arbitrary winner).
 */

/** @param {string} referenceTargetKey */
export function normalizeReferenceLookupKey(referenceTargetKey, raw) {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const tk = canonicalMappingTargetKey(String(referenceTargetKey || "").trim());
  if (tk === "email") return s.toLowerCase();
  return s;
}

/**
 * Read a mapped attribute value from a persisted Identity document (aligned with csvRowToIdentityPayload storage).
 * @param {object} identity - lean Identity doc
 * @param {string} targetKey - mapping targetKey (may be custom)
 */
export function getRawMappedValueFromIdentity(identity, targetKey) {
  if (!identity) return "";
  const rawTk = String(targetKey || "").trim();
  const tk = canonicalMappingTargetKey(rawTk);
  switch (tk) {
    case "email":
      return identity.email != null ? String(identity.email).trim() : "";
    case "employeeId":
      return identity.employeeId != null ? String(identity.employeeId).trim() : "";
    case "firstname":
      return identity.firstName != null ? String(identity.firstName).trim() : "";
    case "lastname":
      return identity.lastName != null ? String(identity.lastName).trim() : "";
    case "displayName":
      return identity.displayName != null ? String(identity.displayName).trim() : "";
    case "uid":
      return identity.attributes?.uid != null ? String(identity.attributes.uid).trim() : "";
    case "department":
      return identity.department != null ? String(identity.department).trim() : "";
    case "title":
      return identity.title != null ? String(identity.title).trim() : "";
    case "phone":
      return identity.phoneNumber != null ? String(identity.phoneNumber).trim() : "";
    case "managerEmail":
      return identity.managerEmail != null ? String(identity.managerEmail).trim() : "";
    case "managerEmployeeId":
      return identity.managerEmployeeId != null ? String(identity.managerEmployeeId).trim() : "";
    /** HR-style "who is my manager" id stored on identity (profile label often "Manager ID"). */
    case "managerReferenceId": {
      const fromTop = String(identity.managerEmployeeId ?? "").trim();
      if (fromTop) return fromTop;
      const fromEmail = String(identity.managerEmail ?? "").trim();
      if (fromEmail) return fromEmail;
      const loose = pickLooseAttribute(identity, rawTk);
      if (loose) return loose;
      if (
        identity[rawTk] !== undefined &&
        identity[rawTk] !== null &&
        String(identity[rawTk]).trim() !== ""
      ) {
        return String(identity[rawTk]).trim();
      }
      const av = identity.attributes?.[rawTk];
      if (av !== undefined && av !== null && String(av).trim() !== "") {
        return String(av).trim();
      }
      return pickAttributesManagerId(identity) || "";
    }
    default: {
      if (identity[rawTk] !== undefined && identity[rawTk] !== null && String(identity[rawTk]).trim() !== "") {
        return String(identity[rawTk]).trim();
      }
      const av = identity.attributes?.[rawTk];
      if (av !== undefined && av !== null) return String(av).trim();
      /** Profile CSV / UI labels with spaces or different casing (e.g. "Manager ID", manager_id). */
      const loose = pickLooseAttribute(identity, rawTk);
      if (loose) return loose;
      return "";
    }
  }
}

/**
 * @param {object} identity
 */
function pickAttributesManagerId(identity) {
  if (!identity?.attributes || typeof identity.attributes !== "object") return "";
  const a = identity.attributes;
  const keys = [
    "Manager ID",
    "manager_id",
    "managerId",
    "managerID",
    "MANAGER_ID",
    "managerid",
  ];
  for (const k of keys) {
    const v = a[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/**
 * @param {object} identity
 * @param {string} rawTk
 */
function pickLooseAttribute(identity, rawTk) {
  const raw = String(rawTk || "").trim();
  if (!raw || !identity.attributes || typeof identity.attributes !== "object") return "";
  const compact = raw.replace(/\s+/g, "").toLowerCase();
  for (const [key, val] of Object.entries(identity.attributes)) {
    if (val === undefined || val === null || String(val).trim() === "") continue;
    const kc = String(key).replace(/\s+/g, "").toLowerCase();
    if (kc === compact) return String(val).trim();
  }
  return "";
}

/**
 * @param {object[]} identities - lean docs for one profile/tenant
 * @param {string} referenceTargetKey
 * @returns {{ index: Map<string, import('mongoose').Types.ObjectId>, ambiguousKeys: Set<string> }}
 */
export function buildReferenceIndex(identities, referenceTargetKey) {
  const index = new Map();
  const ambiguousKeys = new Set();
  const counts = new Map();

  for (const ident of identities) {
    const raw = getRawMappedValueFromIdentity(ident, referenceTargetKey);
    const k = normalizeReferenceLookupKey(referenceTargetKey, raw);
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  for (const ident of identities) {
    const raw = getRawMappedValueFromIdentity(ident, referenceTargetKey);
    const k = normalizeReferenceLookupKey(referenceTargetKey, raw);
    if (!k) continue;
    if (counts.get(k) !== 1) {
      ambiguousKeys.add(k);
      continue;
    }
    index.set(k, ident._id);
  }

  return { index, ambiguousKeys };
}

/**
 * @param {object} identity
 * @param {string} managerTargetKey
 * @param {string} referenceTargetKey
 * @param {Map<string, import('mongoose').Types.ObjectId>} referenceIndex
 */
export function resolveManagerCorrelation(identity, managerTargetKey, referenceTargetKey, referenceIndex) {
  const rawMgr = getRawMappedValueFromIdentity(identity, managerTargetKey);
  return resolveManagerCorrelationWithReference(identity, rawMgr, referenceTargetKey, referenceIndex);
}

/**
 * @param {object} identity
 * @param {string} rawManagerValue - raw manager field (may differ from stored identity if passed from payload)
 * @param {string} referenceTargetKey - for normalization
 * @param {Map<string, import('mongoose').Types.ObjectId>} referenceIndex
 */
export function resolveManagerCorrelationWithReference(identity, rawManagerValue, referenceTargetKey, referenceIndex) {
  const raw = String(rawManagerValue ?? "").trim();
  if (!raw) {
    return {
      managerId: null,
      managerKeyRaw: null,
      managerResolutionStatus: "root",
      isRoot: true,
    };
  }

  const k = normalizeReferenceLookupKey(referenceTargetKey, raw);
  const selfKey = normalizeReferenceLookupKey(
    referenceTargetKey,
    getRawMappedValueFromIdentity(identity, referenceTargetKey),
  );
  if (k && selfKey && k === selfKey) {
    return {
      managerId: null,
      managerKeyRaw: raw,
      managerResolutionStatus: "unresolved",
      isRoot: false,
    };
  }

  const matched = k ? referenceIndex.get(k) : null;

  if (matched && String(matched) !== String(identity._id)) {
    return {
      managerId: matched,
      managerKeyRaw: null,
      managerResolutionStatus: "resolved",
      isRoot: false,
    };
  }

  return {
    managerId: null,
    managerKeyRaw: raw,
    managerResolutionStatus: "unresolved",
    isRoot: false,
  };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} tenantId
 * @param {import('mongoose').Types.ObjectId | string} profileId
 * @param {object} profile - Identity profile (needs managerAttribute + referenceAttribute)
 */
export async function applyManagerCorrelationForProfile(tenantId, profileId, profile, IdentityModel) {
  const cfg = profile.managerCorrelation;
  const managerAttr = cfg && String(cfg.managerAttribute || "").trim();
  const referenceAttr = cfg && String(cfg.referenceAttribute || "").trim();
  if (!managerAttr || !referenceAttr) {
    return { managersLinked: 0, processed: 0, mode: "disabled" };
  }

  const profileOid =
    profileId instanceof mongoose.Types.ObjectId ? profileId : new mongoose.Types.ObjectId(String(profileId));

  const identities = await IdentityModel.find({
    tenantId,
    identityProfileId: profileOid,
  }).lean();

  const { index } = buildReferenceIndex(identities, referenceAttr);

  // Build a quick id → email lookup from the same identity dataset.
  // Managers are typically co-located in the same profile, so this covers
  // the common case without an extra round-trip to the database.
  const emailById = new Map();
  for (const i of identities) {
    if (i._id && i.email) {
      emailById.set(String(i._id), i.email.toLowerCase().trim());
    }
  }

  const idEq = (a, b) => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return String(a) === String(b);
  };

  const ops = [];
  let linked = 0;

  for (const ident of identities) {
    const rawMgr = getRawMappedValueFromIdentity(ident, managerAttr);
    const res = resolveManagerCorrelationWithReference(ident, rawMgr, referenceAttr, index);

    const set = {
      managerId: res.managerId != null ? res.managerId : null,
      managerKeyRaw: res.managerKeyRaw,
      managerResolutionStatus: res.managerResolutionStatus,
      isRoot: res.isRoot,
    };

    // Denormalize the manager's email so certification routing works without
    // a runtime join. If the manager is resolved and has an email in this
    // profile's identity set, store it directly on the identity.
    if (res.managerId) {
      const mgrEmail = emailById.get(String(res.managerId)) || null;
      if (mgrEmail) set.managerEmail = mgrEmail;
    }

    if (res.managerResolutionStatus === "resolved" && res.managerId) linked += 1;

    if (
      idEq(ident.managerId, set.managerId) &&
      (ident.managerKeyRaw ?? null) == (res.managerKeyRaw ?? null) &&
      ident.managerResolutionStatus === res.managerResolutionStatus &&
      Boolean(ident.isRoot) === Boolean(res.isRoot) &&
      (ident.managerEmail || "") === (set.managerEmail || "")
    ) {
      continue;
    }

    ops.push({
      updateOne: {
        filter: { _id: ident._id },
        update: { $set: set },
      },
    });
  }

  const CHUNK = 250;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const chunk = ops.slice(i, i + CHUNK);
    await IdentityModel.bulkWrite(chunk, { ordered: false });
    await mirrorIdentityBulkWriteToLegacy(chunk);
  }

  return { managersLinked: linked, processed: identities.length, mode: "managerCorrelation" };
}
