import { identitySchema } from "../models/identity/Identity.js";

/** Helper to safely fetch nested values dynamically (e.g., "attributes.department") */
export function getDynamicValue(obj, path) {
  if (!path || !obj) return undefined;
  const data = obj.toObject ? obj.toObject() : obj;
  return path
    .split(".")
    .reduce(
      (acc, part) =>
        acc && acc[part] !== undefined ? acc[part] : undefined,
      data,
    );
}

/**
 * Dynamically resolves Identity Profile keys to Mongo paths.
 * Uses the actual Mongoose Schema to detect top-level fields dynamically.
 */
export function identityTargetKeyToMongoPath(identityAttribute) {
  const raw = String(identityAttribute || "").trim();
  if (!raw) return "email";
  if (raw.startsWith("attributes.")) return raw;

  const aliases = {
    status: "lifecycleState",
    uid: "attributes.uid",
    phone: "phoneNumber",
    userid: "attributes.userid",
    user_id: "attributes.user_id",
  };

  const lowerRaw = raw.toLowerCase();
  if (aliases[lowerRaw]) return aliases[lowerRaw];

  const schemaPaths = Object.keys(identitySchema.paths);
  if (schemaPaths.includes(raw)) return raw;

  const matchedPath = schemaPaths.find(
    (path) => path.toLowerCase() === lowerRaw,
  );
  if (matchedPath) return matchedPath;

  return `attributes.${raw}`;
}

/**
 * Extract identity field value for manual/automated account correlation.
 * For userid, prefer login-style attributes — never fall back to email (that breaks account_id matching).
 */
export function getIdentityFieldValue(idn, identityAttribute) {
  if (!idn) return undefined;
  const raw = String(identityAttribute || "").trim();
  const norm = raw.toLowerCase().replace(/_/g, "");
  if (norm === "userid") {
    const a =
      idn.attributes && typeof idn.attributes === "object"
        ? idn.attributes
        : {};
    const chain = [
      a.userid,
      a.userId,
      a.user_id,
      a.uid,
      a.username,
      idn.userId,
      getDynamicValue(idn, identityTargetKeyToMongoPath(raw)),
    ];
    for (const c of chain) {
      if (c != null && String(c).trim() !== "") return c;
    }
    return undefined;
  }
  const mongoPath = identityTargetKeyToMongoPath(identityAttribute);
  return getDynamicValue(idn, mongoPath);
}
