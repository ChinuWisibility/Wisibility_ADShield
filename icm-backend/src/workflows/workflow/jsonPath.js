/**
 * Minimal JSONPath resolver for workflow expressions.
 * Supports dot paths and bracket access used by step configs, e.g.
 *   $.trigger.decision
 *   $.steps.verify.stillPresent
 *   $.config.iamTeamEmail
 *   $.steps['my-step'].field
 * Returns the real typed value (boolean / string / object) at the path.
 */
function tokenizePath(pathStr) {
  const tokens = [];
  const re = /\[(?:'([^']*)'|"([^"]*)"|(\d+))\]|([^.[\]]+)/g;
  let m;
  while ((m = re.exec(pathStr)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] !== undefined) tokens.push(m[2]);
    else if (m[3] !== undefined) tokens.push(m[3]);
    else if (m[4] !== undefined) tokens.push(m[4]);
  }
  return tokens;
}

export function resolveValue(expr, context) {
  if (expr == null || expr === "") return expr;
  if (typeof expr !== "string") return expr;
  const trimmed = expr.trim();
  if (!trimmed.startsWith("$")) return expr;

  const pathStr = trimmed.replace(/^\$\.?/, "");
  if (!pathStr) return context;

  let cur = context;
  for (const key of tokenizePath(pathStr)) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

export function resolveObject(obj, context) {
  if (obj == null) return obj;
  if (typeof obj === "string") return resolveValue(obj, context);
  if (Array.isArray(obj)) return obj.map((v) => resolveObject(v, context));
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = resolveObject(v, context);
    }
    return out;
  }
  return obj;
}

const INLINE_RE = /\{\{([^}]+)\}\}/g;

export function renderTemplate(template, context) {
  if (!template || typeof template !== "string") return template;
  return template.replace(INLINE_RE, (_, path) => {
    const val = resolveValue(path.trim(), context);
    return val == null ? "" : String(val);
  });
}

export function buildContext(trigger, steps = {}, config = {}) {
  return {
    trigger,
    steps,
    config: {
      portalBaseUrl: config.portalBaseUrl || "",
      iamTeamEmail: config.iamTeamEmail || "",
      workflowFromEmail: config.workflowFromEmail || "",
      ...config,
    },
  };
}
