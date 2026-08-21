/**
 * Resolves identity display fields from any DTO shape returned by various
 * backend APIs (scope rows, review items, portal items, email templates).
 *
 * Different endpoints return user data under different keys:
 *   - Scope API:    { name, email, manager, department, ... }
 *   - Portal API:   { identityName, identityEmail, appName, ... }
 *   - ReviewItem:   { itemName, userId, reviewerEmail, ... }
 *   - Nested DTO:   { identity: { displayName, email } }
 *
 * This utility normalizes all shapes to a consistent set of display fields.
 */

/**
 * Coerce arbitrary API values (including nested BSON-ish objects) to a plain string
 * without throwing (avoids "Cannot convert object to primitive value" in UI).
 */
export function coerceReadableText(value) {
  if (value == null) return "";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    try {
      return String(value).trim();
    } catch {
      return "";
    }
  }
  if (t === "object") {
    if (value.$oid != null) {
      try {
        return String(value.$oid).trim();
      } catch {
        return "";
      }
    }
    if (typeof value.toHexString === "function") {
      try {
        return String(value.toHexString()).trim();
      } catch {
        /* continue */
      }
    }
    for (const k of ["displayName", "name", "label", "value", "email"]) {
      if (typeof value[k] === "string" && value[k].trim()) return value[k].trim();
    }
    try {
      const s = String(value);
      if (s && s !== "[object Object]") return s.trim();
    } catch {
      return "";
    }
    return "";
  }
  try {
    return String(value).trim();
  } catch {
    return "";
  }
}

function pick(item, ...keys) {
  for (const key of keys) {
    if (!key) continue;
    const parts = key.split(".");
    let val = item;
    for (const p of parts) {
      val = val?.[p];
      if (val == null) break;
    }
    if (val != null) {
      const s = coerceReadableText(val);
      if (s && s !== "—" && s !== "-") return s;
    }
  }
  return "";
}

export function resolveDisplayName(item) {
  if (!item) return "Unknown User";
  return (
    pick(
      item,
      "displayName",
      "name",
      "userName",
      "identityName",
      "itemName",
      "identity.displayName",
      "identity.name",
      "display_name",
      "fullName",
    ) || "Unknown User"
  );
}

export function resolveEmail(item) {
  if (!item) return "";
  return pick(
    item,
    "email",
    "identityEmail",
    "itemEmail",
    "identity.email",
    "userEmail",
    "mail",
  );
}

export function resolveManager(item) {
  if (!item) return "";
  return pick(
    item,
    "manager",
    "managerName",
    "itemManager",
    "identity.manager",
    "identity.managerName",
  );
}

export function resolveManagerEmail(item) {
  if (!item) return "";
  return pick(
    item,
    "managerEmail",
    "itemManagerEmail",
    "identity.managerEmail",
  );
}

export function resolveDepartment(item) {
  if (!item) return "";
  return pick(
    item,
    "department",
    "itemDepartment",
    "identity.department",
  );
}

export function resolveTitle(item) {
  if (!item) return "";
  return pick(
    item,
    "title",
    "role",
    "itemTitle",
    "identity.title",
    "identity.role",
    "jobTitle",
  );
}

export function resolveAppName(item) {
  if (!item) return "";
  return pick(
    item,
    "applicationName",
    "appName",
    "itemApplicationName",
    "identity.applicationName",
  );
}

/**
 * Normalize any identity DTO shape into a flat, consistent object
 * safe for display across all screens and CSV export.
 */
export function normalizeIdentityDTO(item) {
  if (!item) {
    return {
      name: "Unknown User",
      email: "",
      manager: "",
      managerEmail: "",
      department: "",
      title: "",
      applicationName: "",
    };
  }
  return {
    ...item,
    name: resolveDisplayName(item),
    email: resolveEmail(item) || item.email || "",
    manager: resolveManager(item) || item.manager || "",
    managerEmail: resolveManagerEmail(item) || item.managerEmail || "",
    department: resolveDepartment(item) || item.department || "",
    title: resolveTitle(item) || item.title || "",
    applicationName: resolveAppName(item) || item.applicationName || "",
  };
}
