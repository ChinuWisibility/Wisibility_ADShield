import { closestMatches } from "../../utils/stringSimilarity.js";
import { transformHandlers } from "./transformEngine.js";
import {
  isLikelyFieldName,
  isTransformNode,
  TRANSFORM_TYPES,
} from "./transformMeta.js";

const KNOWN_TYPES = new Set(TRANSFORM_TYPES);

/**
 * @param {string} jsonText
 * @returns {{ ok: true, value: unknown } | { ok: false, error: { message: string, line?: number, column?: number } }}
 */
export function parseJsonSafe(jsonText) {
  if (typeof jsonText !== "string") {
    return { ok: false, error: { message: "Expected JSON string" } };
  }
  try {
    const value = JSON.parse(jsonText);
    return { ok: true, value };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const m = /position (\d+)/i.exec(msg);
    let line;
    let column;
    if (m) {
      const pos = parseInt(m[1], 10);
      const upTo = jsonText.slice(0, pos);
      line = (upTo.match(/\n/g) || []).length + 1;
      column = pos - (upTo.lastIndexOf("\n") + 1) + 1;
    }
    return { ok: false, error: { message: msg, line, column } };
  }
}

/**
 * @param {unknown} root
 * @param {(field: string, jsonPath: string) => void} onFieldCandidate
 * @param {string} [basePath]
 */
function walkSemanticCandidates(root, onFieldCandidate, basePath = "$") {
  if (!isTransformNode(root)) return;
  const { type, attributes } = root;
  if (!KNOWN_TYPES.has(type)) return;

  if (type === "concat") {
    const values = attributes?.values;
    if (!Array.isArray(values)) return;
    values.forEach((item, i) => {
      const p = `${basePath}.attributes.values[${i}]`;
      if (isTransformNode(item)) walkSemanticCandidates(item, onFieldCandidate, p);
      else if (typeof item === "string" && isLikelyFieldName(item)) {
        onFieldCandidate(item, p);
      }
    });
    return;
  }

  if (type === "lower" || type === "upper") {
    const input = attributes?.input;
    const p = `${basePath}.attributes.input`;
    if (isTransformNode(input)) walkSemanticCandidates(input, onFieldCandidate, p);
    else if (typeof input === "string" && isLikelyFieldName(input)) {
      onFieldCandidate(input, p);
    }
    return;
  }

  if (type === "lookup") {
    const input = attributes?.input;
    const p = `${basePath}.attributes.input`;
    if (isTransformNode(input)) walkSemanticCandidates(input, onFieldCandidate, p);
    else if (typeof input === "string" && isLikelyFieldName(input)) {
      onFieldCandidate(input, p);
    }
    return;
  }

  if (type === "firstValid") {
    const candidates = attributes?.candidates;
    if (!Array.isArray(candidates)) return;
    candidates.forEach((item, i) => {
      const p = `${basePath}.attributes.candidates[${i}]`;
      if (isTransformNode(item)) walkSemanticCandidates(item, onFieldCandidate, p);
      else if (typeof item === "string" && isLikelyFieldName(item)) {
        onFieldCandidate(item, p);
      }
    });
  }
}

/**
 * @param {unknown} root
 * @param {string} [basePath]
 * @returns {{ code: 'STRUCTURE', message: string, path: string }[]}
 */
function walkStructure(root, basePath = "$") {
  /** @type {{ code: 'STRUCTURE', message: string, path: string }[]} */
  const errors = [];
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    errors.push({
      code: "STRUCTURE",
      message: "Transform root must be a JSON object",
      path: basePath,
    });
    return errors;
  }

  if (!Object.prototype.hasOwnProperty.call(root, "type")) {
    errors.push({
      code: "STRUCTURE",
      message: "Missing required field: type",
      path: `${basePath}.type`,
    });
  }
  if (!Object.prototype.hasOwnProperty.call(root, "attributes")) {
    errors.push({
      code: "STRUCTURE",
      message: "Missing required field: attributes",
      path: `${basePath}.attributes`,
    });
  }

  const { type, attributes } = root;
  if (typeof type !== "string") {
    errors.push({
      code: "STRUCTURE",
      message: "Field type must be a string",
      path: `${basePath}.type`,
    });
  } else if (!KNOWN_TYPES.has(type)) {
    errors.push({
      code: "STRUCTURE",
      message: `Unsupported transform type: ${type}`,
      path: `${basePath}.type`,
    });
  }

  if (attributes === null || attributes === undefined || typeof attributes !== "object" || Array.isArray(attributes)) {
    errors.push({
      code: "STRUCTURE",
      message: "Field attributes must be an object",
      path: `${basePath}.attributes`,
    });
    return errors;
  }

  if (typeof type === "string" && KNOWN_TYPES.has(type)) {
    const typeErrors = validateTypeShape(type, attributes, basePath);
    errors.push(...typeErrors);
  }

  if (!isTransformNode(root)) return errors;

  if (type === "concat") {
    const values = attributes.values;
    if (Array.isArray(values)) {
      values.forEach((item, i) => {
        if (isTransformNode(item)) {
          errors.push(...walkStructure(item, `${basePath}.attributes.values[${i}]`));
        }
      });
    }
  } else if (type === "lower" || type === "upper") {
    const input = attributes.input;
    if (isTransformNode(input)) {
      errors.push(...walkStructure(input, `${basePath}.attributes.input`));
    }
  } else if (type === "lookup") {
    const input = attributes.input;
    if (isTransformNode(input)) {
      errors.push(...walkStructure(input, `${basePath}.attributes.input`));
    }
  } else if (type === "firstValid") {
    const candidates = attributes.candidates;
    if (Array.isArray(candidates)) {
      candidates.forEach((item, i) => {
        if (isTransformNode(item)) {
          errors.push(...walkStructure(item, `${basePath}.attributes.candidates[${i}]`));
        }
      });
    }
  }

  return errors;
}

/**
 * @param {string} type
 * @param {object} attributes
 * @param {string} basePath
 */
function validateTypeShape(type, attributes, basePath) {
  /** @type {{ code: 'STRUCTURE', message: string, path: string }[]} */
  const errors = [];
  const ap = `${basePath}.attributes`;

  if (type === "concat") {
    if (!Array.isArray(attributes.values)) {
      errors.push({
        code: "STRUCTURE",
        message: "concat requires attributes.values to be an array",
        path: `${ap}.values`,
      });
    }
  } else if (type === "lower" || type === "upper") {
    if (!Object.prototype.hasOwnProperty.call(attributes, "input")) {
      errors.push({
        code: "STRUCTURE",
        message: `${type} requires attributes.input`,
        path: `${ap}.input`,
      });
    }
  } else if (type === "lookup") {
    if (!Object.prototype.hasOwnProperty.call(attributes, "input")) {
      errors.push({
        code: "STRUCTURE",
        message: "lookup requires attributes.input",
        path: `${ap}.input`,
      });
    }
    if (!attributes.map || typeof attributes.map !== "object" || Array.isArray(attributes.map)) {
      errors.push({
        code: "STRUCTURE",
        message: "lookup requires attributes.map to be an object",
        path: `${ap}.map`,
      });
    }
  } else if (type === "static") {
    if (!Object.prototype.hasOwnProperty.call(attributes, "value")) {
      errors.push({
        code: "STRUCTURE",
        message: "static requires attributes.value",
        path: `${ap}.value`,
      });
    }
  } else if (type === "firstValid") {
    if (!Array.isArray(attributes.candidates)) {
      errors.push({
        code: "STRUCTURE",
        message: "firstValid requires attributes.candidates to be an array",
        path: `${ap}.candidates`,
      });
    }
  }

  return errors;
}

/**
 * @param {unknown} transformJson — object or parse externally
 * @param {{ appId?: string|null, allowedFields?: Set<string>|null }} [opts]
 * @returns {{ valid: boolean, errors: { code: string, message: string, path?: string, suggestions?: string[], line?: number, column?: number }[] }}
 */
export function validateTransformDocument(transformJson, opts = {}) {
  /** @type {{ code: string, message: string, path?: string, suggestions?: string[], line?: number, column?: number }[]} */
  const errors = [];

  let doc = transformJson;
  if (typeof transformJson === "string") {
    const parsed = parseJsonSafe(transformJson);
    if (!parsed.ok) {
      return {
        valid: false,
        errors: [
          {
            code: "SYNTAX",
            message: parsed.error.message,
            line: parsed.error.line,
            column: parsed.error.column,
          },
        ],
      };
    }
    doc = parsed.value;
  }

  const structural = walkStructure(doc, "$");
  structural.forEach((e) =>
    errors.push({ code: e.code, message: e.message, path: e.path }),
  );

  const allowed = opts.allowedFields;
  if (allowed && allowed.size > 0 && structural.length === 0 && isTransformNode(doc)) {
    walkSemanticCandidates(doc, (field, path) => {
      if (!allowed.has(field)) {
        const suggestions = closestMatches(field, [...allowed], { limit: 5 });
        errors.push({
          code: "SEMANTIC",
          message: `Unknown field "${field}"`,
          path,
          suggestions,
        });
      }
    });
  }

  const valid = errors.length === 0;
  return { valid, errors };
}

/** Export for tests */
export { walkStructure, walkSemanticCandidates };
