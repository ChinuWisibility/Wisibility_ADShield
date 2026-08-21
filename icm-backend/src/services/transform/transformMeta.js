/** @typedef {'concat'|'lower'|'upper'|'lookup'|'static'|'firstValid'} TransformType */

export const TRANSFORM_TYPES = [
  "concat",
  "lower",
  "upper",
  "lookup",
  "static",
  "firstValid",
];

/**
 * JSON-path style hints for semantic validation (which strings may reference context fields).
 * @type {Record<string, { fieldPaths: string[] }>}
 */
export const transformMeta = {
  concat: { fieldPaths: ["attributes.values"] },
  lower: { fieldPaths: ["attributes.input"] },
  upper: { fieldPaths: ["attributes.input"] },
  lookup: { fieldPaths: ["attributes.input"] },
  static: { fieldPaths: [] },
  firstValid: { fieldPaths: ["attributes.candidates"] },
};

/** @param {string} s */
export function isLikelyFieldName(s) {
  return typeof s === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
}

/**
 * @param {unknown} v
 * @returns {v is { type: string, attributes: object }}
 */
export function isTransformNode(v) {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    typeof v.type === "string" &&
    v.attributes !== null &&
    typeof v.attributes === "object" &&
    !Array.isArray(v.attributes)
  );
}
