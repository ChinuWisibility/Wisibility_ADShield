import mongoose from "mongoose";

export function escapeMongoRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveApplicationName(app) {
  if (!app) return "";
  return app.applicationName || app.name || app.displayName || "";
}

export function sanitizeName(name = "") {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_");
}

export function normalizeEntitlementForBuilder(raw, fallbackAppName = "") {
  const rawId = raw?._id?.toString?.() || raw?.id || raw?.entitlementId || "";
  const rawName =
    raw?.displayName ||
    raw?.display_name ||
    raw?.entitlementName ||
    raw?.entitlement_name ||
    raw?.displayName ||
    raw?.name ||
    raw?.resource_name ||
    raw?.roleName ||
    raw?.role ||
    raw?.groupName ||
    raw?.group ||
    raw?.cn ||
    raw?.sourceValue ||
    raw?.value ||
    "";
  const id = String(rawId || rawName).trim();
  const name = String(rawName || rawId).trim();
  if (!id || !name) return null;
  const applicationName = String(raw?.applicationName || fallbackAppName || "").trim();
  return {
    _id: id,
    id,
    entitlementId: id,
    entitlementName: name,
    name,
    sourceValue: String(raw?.sourceValue || raw?.value || "").trim(),
    applicationName,
    isPrivileged: Boolean(raw?.isPrivileged || raw?.privileged),
  };
}

export function normalizeRuleEntitlement(entry) {
  const id = String(entry?.id || "").trim();
  const name = String(entry?.name || "").trim();
  const applicationName = String(entry?.applicationName || "").trim();
  if (!id && !name) return null;
  return { id, name: name || id, applicationName };
}

export function normalizePolicyRules(rawRules) {
  if (!Array.isArray(rawRules)) return [];
  return rawRules
    .map((rawRule, index) => {
      const leftEntitlements = Array.isArray(rawRule?.leftEntitlements)
        ? rawRule.leftEntitlements.map(normalizeRuleEntitlement).filter(Boolean)
        : [];
      const rightEntitlements = Array.isArray(rawRule?.rightEntitlements)
        ? rawRule.rightEntitlements.map(normalizeRuleEntitlement).filter(Boolean)
        : [];
      const rule = {
        name: String(rawRule?.name || `Rule ${index + 1}`).trim(),
        description: String(rawRule?.description || "").trim(),
        operator: rawRule?.operator === "OR" ? "OR" : "AND",
        isActive: rawRule?.isActive !== false,
        leftEntitlements,
        rightEntitlements,
      };
      return rule;
    })
    .filter((rule) => rule.leftEntitlements.length || rule.rightEntitlements.length);
}

export function sanitizePolicyPayload(payload, { requireName = false, requireApplication = false } = {}) {
  const next = { ...(payload || {}) };
  if ("name" in next) {
    const n = String(next.name || "").trim();
    if (n) next.name = n;
    else delete next.name;
  }
  if ("description" in next) next.description = String(next.description || "").trim();
  if ("rules" in next) next.rules = normalizePolicyRules(next.rules);
  if ("applications" in next) {
    const ids = Array.isArray(next.applications)
      ? next.applications.filter((id) => mongoose.isValidObjectId(id))
      : [];
    next.applications = ids.length ? [ids[0]] : [];
  }
  if ("applicationNames" in next) {
    const names = Array.isArray(next.applicationNames)
      ? next.applicationNames.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    next.applicationNames = names.length ? [names[0]] : [];
  }
  if ("policyId" in next) delete next.policyId;
  if (requireName && !next.name) {
    return { ok: false, message: "Display name is required" };
  }
  if (requireApplication && !(next.applications && next.applications.length)) {
    return { ok: false, message: "Application is required" };
  }
  const invalidRule = Array.isArray(next.rules)
    ? next.rules.find(
        (rule) =>
          rule.isActive &&
          (!Array.isArray(rule.leftEntitlements) ||
            !Array.isArray(rule.rightEntitlements) ||
            !rule.leftEntitlements.length ||
            !rule.rightEntitlements.length),
      )
    : null;
  if (invalidRule) {
    return {
      ok: false,
      message: "Each active rule must have at least one left and one right entitlement.",
    };
  }
  return { ok: true, value: next };
}
