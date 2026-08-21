import { isLikelyFieldName, isTransformNode } from "./transformMeta.js";

/**
 * @param {unknown} v
 * @param {Record<string, unknown>} context
 */
function resolveCell(v, context) {
  if (v === null || v === undefined) return "";
  if (isTransformNode(v)) return executeTransform(v, context);
  if (typeof v === "string") {
    if (isLikelyFieldName(v)) {
      const raw = context[v];
      if (raw === null || raw === undefined) return "";
      return String(raw);
    }
    return v;
  }
  return String(v);
}

/**
 * @param {unknown} input
 * @param {Record<string, unknown>} context
 */
function resolveInputSlot(input, context) {
  if (input === null || input === undefined) return "";
  if (isTransformNode(input)) return executeTransform(input, context);
  if (typeof input === "string") {
    if (isLikelyFieldName(input)) {
      const raw = context[input];
      if (raw === null || raw === undefined) return "";
      return String(raw);
    }
    return input;
  }
  return String(input);
}

function isEmptyResolved(s) {
  if (s === null || s === undefined) return true;
  if (typeof s === "string") return s.trim() === "";
  return false;
}

/** @type {Record<string, (attributes: object, context: Record<string, unknown>) => unknown>} */
export const transformHandlers = {
  concat(attributes, context) {
    const values = attributes?.values;
    if (!Array.isArray(values)) return "";
    const parts = values.map((v) => resolveCell(v, context));
    return parts.join("");
  },

  lower(attributes, context) {
    const s = resolveInputSlot(attributes?.input, context);
    return String(s).toLowerCase();
  },

  upper(attributes, context) {
    const s = resolveInputSlot(attributes?.input, context);
    return String(s).toUpperCase();
  },

  lookup(attributes, context) {
    const key = resolveInputSlot(attributes?.input, context);
    const map = attributes?.map;
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      return attributes?.default ?? "";
    }
    const k = String(key);
    if (Object.prototype.hasOwnProperty.call(map, k)) return map[k];
    return attributes?.default ?? "";
  },

  static(attributes, context) {
    if (!attributes || !Object.prototype.hasOwnProperty.call(attributes, "value"))
      return "";
    const v = attributes.value;
    if (v === null || v === undefined) return "";
    let s = String(v);
    const ctx = context && typeof context === "object" ? context : null;
    if (!ctx) return s;
    // Identity profile / sample rows: substitute $fieldName from context (e.g. $firstname.$lastname@corp.com).
    return s.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, rawKey) => {
      if (Object.prototype.hasOwnProperty.call(ctx, rawKey) && ctx[rawKey] != null) {
        return String(ctx[rawKey]);
      }
      const lower = String(rawKey).toLowerCase();
      for (const k of Object.keys(ctx)) {
        if (String(k).toLowerCase() === lower && ctx[k] != null) return String(ctx[k]);
      }
      return "";
    });
  },

  firstValid(attributes, context) {
    const candidates = attributes?.candidates;
    if (!Array.isArray(candidates)) return "";
    for (const c of candidates) {
      const out = resolveCell(c, context);
      if (!isEmptyResolved(out)) return out;
    }
    return "";
  },
};

/**
 * Pure transform execution (no I/O). Safe for null/undefined intermediate values.
 *
 * @param {unknown} transform
 * @param {Record<string, unknown>} context
 * @returns {unknown}
 */
export function executeTransform(transform, context) {
  const ctx = context && typeof context === "object" ? context : {};
  if (transform === null || transform === undefined) return "";
  if (!isTransformNode(transform)) {
    return transform;
  }
  const { type, attributes } = transform;
  const handler = transformHandlers[type];
  if (!handler) {
    throw new Error(`Unsupported transform: ${type}`);
  }
  return handler(attributes, ctx);
}
