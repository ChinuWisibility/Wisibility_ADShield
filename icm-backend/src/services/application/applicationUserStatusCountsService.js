import mongoose from "mongoose";
import { applicationIdInClause } from "./applicationUserIngestService.js";

const UAC_ATTRS = new Set([
  "useraccountcontrol",
  "user_account_control",
]);

function isPrimaryAdConnectorApplication(app) {
  if (!app) return false;
  if (app.sourceApplicationId && app.connectionConfig?.derivedAd) return false;
  return (
    app.connectorType === "ACTIVE_DIRECTORY" || Boolean(app.connectionConfig?.ad)
  );
}

/**
 * Resolve how to read account active/inactive for an application (schema mapping aware).
 */
export function resolveApplicationStatusFieldSpec(application) {
  const mapping = findStatusMapping(application);
  const csvColumn = String(mapping?.csvColumn || "").trim();
  const csvLower = csvColumn.toLowerCase();

  let isUacMapping =
    UAC_ATTRS.has(csvLower) ||
    csvLower.includes("useraccountcontrol") ||
    csvLower.includes("user_account_control");

  if (!isUacMapping && isPrimaryAdConnectorApplication(application)) {
    isUacMapping = true;
  }

  const ldapAttr =
    isUacMapping && (!csvColumn || csvColumn === "status")
      ? "userAccountControl"
      : csvColumn || (isUacMapping ? "userAccountControl" : "");

  return {
    mapping,
    ldapAttribute: ldapAttr,
    // Only AD UAC mappings use bit-flag classification. A CSV column literally named
    // "status" must stay string/canonical (ACTIVE / INACTIVE / disabled), not UAC.
    kind: isUacMapping ? "uac" : "string",
  };
}

function findStatusMapping(application) {
  const lists = [
    application?.userMappings,
    application?.csvImportMapping?.mappings,
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const hit = list.find(
      (m) => String(m?.standardField || "").trim().toLowerCase() === "status",
    );
    if (hit) return hit;
  }
  return null;
}

/** AD userAccountControl: bit 2 (0x2) = ACCOUNTDISABLE */
export function classifyAccountStatusRaw(rawValue) {
  if (rawValue == null || rawValue === "") return "unknown";

  if (typeof rawValue === "boolean") {
    return rawValue ? "active" : "inactive";
  }

  const text = String(rawValue).trim();
  if (!text) return "unknown";

  const lower = text.toLowerCase();
  if (lower === "active" || lower === "enabled") return "active";
  if (lower === "disabled" || lower === "inactive" || lower === "locked") {
    return "inactive";
  }

  const uac = parseInt(text, 10);
  if (Number.isFinite(uac)) {
    if (uac & 2) return "inactive";
    return "active";
  }

  return "unknown";
}

function buildApplicationIdMatch(applicationId) {
  return { applicationId: applicationIdInClause(applicationId) };
}

/**
 * Mongo $expr: read UAC as long from rawData / top-level (AD sync stores LDAP attrs on rawData).
 */
function buildUacLongExpr() {
  const uacInput = {
    $ifNull: [
      "$rawData.userAccountControl",
      {
        $ifNull: [
          "$rawData.useraccountcontrol",
          {
            $ifNull: [
              "$userAccountControl",
              {
                $ifNull: ["$status", ""],
              },
            ],
          },
        ],
      },
    ],
  };

  return {
    $convert: {
      input: uacInput,
      to: "long",
      onError: -1,
      onNull: -1,
    },
  };
}

function buildUacActiveExpr(uacValueExpr) {
  return {
    $and: [
      { $gte: [uacValueExpr, 0] },
      {
        $eq: [
          { $mod: [{ $floor: { $divide: [uacValueExpr, 2] } }, 2] },
          0,
        ],
      },
    ],
  };
}

function buildUacInactiveExpr(uacValueExpr) {
  return {
    $and: [
      { $gte: [uacValueExpr, 0] },
      {
        $eq: [
          { $mod: [{ $floor: { $divide: [uacValueExpr, 2] } }, 2] },
          1,
        ],
      },
    ],
  };
}

/**
 * Fast path: normalized strings on `status` (active / disabled / inactive).
 */
async function countByCanonicalStatusField(UsersModel, appMatch) {
  const [active, inactive, total] = await Promise.all([
    UsersModel.countDocuments({
      ...appMatch,
      status: { $regex: /^active$/i },
    }),
    UsersModel.countDocuments({
      ...appMatch,
      status: { $regex: /^(disabled|inactive|locked)$/i },
    }),
    UsersModel.countDocuments(appMatch),
  ]);
  return {
    active,
    inactive,
    unknown: Math.max(0, total - active - inactive),
    total,
  };
}

/**
 * Count using userAccountControl (LDAP) in rawData and numeric/string status fallback.
 */
async function countByUserAccountControlExpr(UsersModel, appMatch) {
  const uacValueExpr = buildUacLongExpr();
  const activeExpr = buildUacActiveExpr(uacValueExpr);
  const inactiveExpr = buildUacInactiveExpr(uacValueExpr);

  const [active, inactive, total] = await Promise.all([
    UsersModel.countDocuments({ ...appMatch, $expr: activeExpr }),
    UsersModel.countDocuments({ ...appMatch, $expr: inactiveExpr }),
    UsersModel.countDocuments(appMatch),
  ]);

  return {
    active,
    inactive,
    unknown: Math.max(0, total - active - inactive),
    total,
  };
}

/**
 * Mongo filter clause for listing users by active/inactive (matches count logic).
 * @param {object} application
 * @param {'active' | 'inactive'} accountStatus
 * @returns {object | null}
 */
export function buildAccountStatusFilterClause(application, accountStatus) {
  const normalized = String(accountStatus || "").trim().toLowerCase();
  if (normalized !== "active" && normalized !== "inactive") return null;

  const isAd = isPrimaryAdConnectorApplication(application);
  const spec = resolveApplicationStatusFieldSpec(application);

  if (spec.kind === "uac" || isAd) {
    const uacValueExpr = buildUacLongExpr();
    return {
      $expr:
        normalized === "active"
          ? buildUacActiveExpr(uacValueExpr)
          : buildUacInactiveExpr(uacValueExpr),
    };
  }

  if (normalized === "active") {
    return { status: { $regex: /^active$/i } };
  }
  return { status: { $regex: /^(disabled|inactive|locked)$/i } };
}

/**
 * Active/inactive counts — schema mapping aware, optimized for AD (userAccountControl).
 */
export async function countApplicationUserStatuses(
  UsersModel,
  applicationId,
  application,
) {
  const spec = resolveApplicationStatusFieldSpec(application);
  const appMatch = buildApplicationIdMatch(applicationId);
  const isAd = isPrimaryAdConnectorApplication(application);

  const total = await UsersModel.countDocuments(appMatch);
  if (total === 0) {
    return {
      active: 0,
      inactive: 0,
      unknown: 0,
      total: 0,
      statusField: spec.ldapAttribute || "status",
      resolution: spec.kind,
    };
  }

  const canonical = await countByCanonicalStatusField(UsersModel, appMatch);
  if (canonical.active + canonical.inactive > 0) {
    return {
      ...canonical,
      statusField: spec.ldapAttribute || "status",
      resolution: "canonical_status",
    };
  }

  if (spec.kind === "uac" || isAd) {
    const uac = await countByUserAccountControlExpr(UsersModel, appMatch);
    if (uac.active + uac.inactive > 0) {
      return {
        ...uac,
        statusField: spec.ldapAttribute || "userAccountControl",
        resolution: "userAccountControl",
      };
    }
  }

  return {
    active: 0,
    inactive: 0,
    unknown: total,
    total,
    statusField: spec.ldapAttribute || "status",
    resolution: "unknown",
  };
}
