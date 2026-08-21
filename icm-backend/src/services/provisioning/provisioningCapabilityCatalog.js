/**
 * Family × operation provisioning capability catalog.
 *
 * Classification is driven by connector family (from connectorCatalog), never
 * by application name. The Plan Compiler uses this metadata only — it does not
 * resolve or invoke runtime connectors.
 */

import { getConnectorDefinition } from "../../config/connectorCatalog.js";
import { normalizeProvisioningOperation } from "./connectors/provisioningConnectorContract.js";

export const EXECUTION_CLASS = Object.freeze({
  EXECUTABLE: "EXECUTABLE",
  MANUAL: "MANUAL",
  UNSUPPORTED: "UNSUPPORTED",
  BLOCKED: "BLOCKED",
});

export const REASON_CODE = Object.freeze({
  CAPABLE: "CAPABLE",
  UNSUPPORTED_OPERATION: "UNSUPPORTED_OPERATION",
  MANUAL_FULFILLMENT: "MANUAL_FULFILLMENT",
  MISSING_REQUIRED_ATTRIBUTE: "MISSING_REQUIRED_ATTRIBUTE",
  CONNECTOR_CONFIG_INCOMPLETE: "CONNECTOR_CONFIG_INCOMPLETE",
  APPLICATION_INACTIVE: "APPLICATION_INACTIVE",
  APPLICATION_NOT_FOUND: "APPLICATION_NOT_FOUND",
  TENANT_MISMATCH: "TENANT_MISMATCH",
  INVALID_ENTITLEMENT: "INVALID_ENTITLEMENT",
  ACTUAL_ACCESS_AMBIGUOUS: "ACTUAL_ACCESS_AMBIGUOUS",
  PROJECTION_UNAVAILABLE: "PROJECTION_UNAVAILABLE",
  NO_CONNECTOR_FAMILY: "NO_CONNECTOR_FAMILY",
});

/** Declared write capabilities per integration family (current connector reality). */
export const FAMILY_OPERATION_CAPABILITIES = Object.freeze({
  ldap_ad: Object.freeze({
    ADD_ACCOUNT: EXECUTION_CLASS.EXECUTABLE,
    UPDATE_ACCOUNT: EXECUTION_CLASS.EXECUTABLE,
    DISABLE: EXECUTION_CLASS.EXECUTABLE,
    ENABLE: EXECUTION_CLASS.EXECUTABLE,
    REMOVE_ACCOUNT: EXECUTION_CLASS.UNSUPPORTED,
    ADD_ENTITLEMENT: EXECUTION_CLASS.EXECUTABLE,
    REMOVE_ENTITLEMENT: EXECUTION_CLASS.EXECUTABLE,
  }),
  file_delimited: Object.freeze({
    ADD_ACCOUNT: EXECUTION_CLASS.EXECUTABLE,
    UPDATE_ACCOUNT: EXECUTION_CLASS.EXECUTABLE,
    DISABLE: EXECUTION_CLASS.EXECUTABLE,
    ENABLE: EXECUTION_CLASS.UNSUPPORTED,
    REMOVE_ACCOUNT: EXECUTION_CLASS.UNSUPPORTED,
    ADD_ENTITLEMENT: EXECUTION_CLASS.UNSUPPORTED,
    REMOVE_ENTITLEMENT: EXECUTION_CLASS.UNSUPPORTED,
  }),
  stub: Object.freeze({
    ADD_ACCOUNT: EXECUTION_CLASS.MANUAL,
    UPDATE_ACCOUNT: EXECUTION_CLASS.MANUAL,
    DISABLE: EXECUTION_CLASS.MANUAL,
    ENABLE: EXECUTION_CLASS.MANUAL,
    REMOVE_ACCOUNT: EXECUTION_CLASS.MANUAL,
    ADD_ENTITLEMENT: EXECUTION_CLASS.MANUAL,
    REMOVE_ENTITLEMENT: EXECUTION_CLASS.MANUAL,
  }),
  none: Object.freeze({
    ADD_ACCOUNT: EXECUTION_CLASS.MANUAL,
    UPDATE_ACCOUNT: EXECUTION_CLASS.MANUAL,
    DISABLE: EXECUTION_CLASS.MANUAL,
    ENABLE: EXECUTION_CLASS.UNSUPPORTED,
    REMOVE_ACCOUNT: EXECUTION_CLASS.UNSUPPORTED,
    ADD_ENTITLEMENT: EXECUTION_CLASS.UNSUPPORTED,
    REMOVE_ENTITLEMENT: EXECUTION_CLASS.UNSUPPORTED,
  }),
});

const DEFAULT_FAMILY_CAPS = Object.freeze({
  ADD_ACCOUNT: EXECUTION_CLASS.MANUAL,
  UPDATE_ACCOUNT: EXECUTION_CLASS.MANUAL,
  DISABLE: EXECUTION_CLASS.MANUAL,
  ENABLE: EXECUTION_CLASS.UNSUPPORTED,
  REMOVE_ACCOUNT: EXECUTION_CLASS.UNSUPPORTED,
  ADD_ENTITLEMENT: EXECUTION_CLASS.UNSUPPORTED,
  REMOVE_ENTITLEMENT: EXECUTION_CLASS.UNSUPPORTED,
});

export function resolveConnectorFamily(application = {}) {
  if (application.connectionConfig?.ad) return "ldap_ad";
  if (application.connectionConfig?.provisioningTestMode === "csv") {
    return "file_delimited";
  }
  const def = getConnectorDefinition(
    application.connectorType,
    application.name || "",
  );
  return def?.family || "none";
}

export function getDeclaredCapability(family, operationType) {
  const op = normalizeProvisioningOperation(operationType);
  const caps = FAMILY_OPERATION_CAPABILITIES[family] || DEFAULT_FAMILY_CAPS;
  return caps[op] || EXECUTION_CLASS.UNSUPPORTED;
}

function hasValue(attributes, keys) {
  for (const key of keys) {
    const value = attributes?.[key];
    if (value != null && String(value).trim() !== "") return true;
  }
  return false;
}

/**
 * Required attribute checks for EXECUTABLE classification.
 * Returns missing attribute names (canonical labels).
 */
export function missingRequiredAttributes({
  family,
  operationType,
  attributes = {},
  identity = {},
} = {}) {
  const op = normalizeProvisioningOperation(operationType);
  const merged = {
    ...(identity || {}),
    employeeId: identity?.employeeId,
    email: identity?.email,
    lastName: identity?.lastName,
    firstName: identity?.firstName,
    displayName: identity?.displayName,
    ...(attributes || {}),
  };

  if (op !== "ADD_ACCOUNT") return [];

  if (family === "ldap_ad") {
    const missing = [];
    if (
      !hasValue(merged, ["sAMAccountName", "samAccountName"]) &&
      !hasValue(merged, ["employeeId", "employee_id"])
    ) {
      missing.push("sAMAccountName|employeeId");
    }
    if (!hasValue(merged, ["sn", "lastName"])) {
      missing.push("sn|lastName");
    }
    return missing;
  }

  if (family === "file_delimited") {
    if (
      !hasValue(merged, [
        "employeeId",
        "employee_id",
        "email",
        "user_id",
        "username",
      ])
    ) {
      return ["employeeId|email|user_id"];
    }
  }

  return [];
}

export function isConnectorConfigReady(family, application = {}) {
  if (family === "ldap_ad") {
    const ad = application.connectionConfig?.ad;
    if (!ad || typeof ad !== "object") return false;
    return Boolean(ad.url && ad.bindDn && ad.targetOuDn);
  }
  if (family === "file_delimited") {
    return Boolean(application.name);
  }
  return false;
}

/**
 * Classify a single plan operation for an application without invoking connectors.
 */
export function classifyProvisioningOperation({
  application,
  tenantId,
  operationType,
  attributes,
  identity,
  entitlement,
  actualAccessMeta,
} = {}) {
  const op = normalizeProvisioningOperation(operationType);

  if (!application) {
    return {
      executionClass: EXECUTION_CLASS.BLOCKED,
      reasonCode: REASON_CODE.APPLICATION_NOT_FOUND,
      connectorFamily: "none",
      capability: op,
    };
  }

  if (
    tenantId &&
    application.tenantId &&
    String(application.tenantId) !== String(tenantId)
  ) {
    return {
      executionClass: EXECUTION_CLASS.BLOCKED,
      reasonCode: REASON_CODE.TENANT_MISMATCH,
      connectorFamily: resolveConnectorFamily(application),
      capability: op,
    };
  }

  if (application.status && application.status !== "active") {
    return {
      executionClass: EXECUTION_CLASS.BLOCKED,
      reasonCode: REASON_CODE.APPLICATION_INACTIVE,
      connectorFamily: resolveConnectorFamily(application),
      capability: op,
    };
  }

  if (
    (op === "ADD_ENTITLEMENT" || op === "REMOVE_ENTITLEMENT") &&
    (!entitlement ||
      (entitlement.entitlementId == null && !entitlement.nativeId))
  ) {
    return {
      executionClass: EXECUTION_CLASS.BLOCKED,
      reasonCode: REASON_CODE.INVALID_ENTITLEMENT,
      connectorFamily: resolveConnectorFamily(application),
      capability: op,
    };
  }

  if (
    (op === "REMOVE_ACCOUNT" || op === "DISABLE" || op === "REMOVE_ENTITLEMENT") &&
    (actualAccessMeta?.ambiguousAccounts ||
      (Array.isArray(actualAccessMeta?.ambiguousApplicationIds) &&
        actualAccessMeta.ambiguousApplicationIds.map(String).includes(String(application?._id || application?.applicationId || ""))))
  ) {
    return {
      executionClass: EXECUTION_CLASS.BLOCKED,
      reasonCode: REASON_CODE.ACTUAL_ACCESS_AMBIGUOUS,
      connectorFamily: resolveConnectorFamily(application),
      capability: op,
    };
  }

  if (
    (op === "ADD_ENTITLEMENT" || op === "REMOVE_ENTITLEMENT") &&
    actualAccessMeta?.projectionEntitlementsAvailable === false &&
    op === "REMOVE_ENTITLEMENT"
  ) {
    return {
      executionClass: EXECUTION_CLASS.BLOCKED,
      reasonCode: REASON_CODE.PROJECTION_UNAVAILABLE,
      connectorFamily: resolveConnectorFamily(application),
      capability: op,
    };
  }

  const family = resolveConnectorFamily(application);
  if (family === "none" && !application.connectionConfig?.ad) {
    const declared = getDeclaredCapability(family, op);
    return {
      executionClass: declared,
      reasonCode:
        declared === EXECUTION_CLASS.MANUAL
          ? REASON_CODE.MANUAL_FULFILLMENT
          : REASON_CODE.NO_CONNECTOR_FAMILY,
      connectorFamily: family,
      capability: op,
    };
  }

  const declared = getDeclaredCapability(family, op);
  if (declared === EXECUTION_CLASS.UNSUPPORTED) {
    return {
      executionClass: EXECUTION_CLASS.UNSUPPORTED,
      reasonCode: REASON_CODE.UNSUPPORTED_OPERATION,
      connectorFamily: family,
      capability: op,
    };
  }
  if (declared === EXECUTION_CLASS.MANUAL) {
    return {
      executionClass: EXECUTION_CLASS.MANUAL,
      reasonCode: REASON_CODE.MANUAL_FULFILLMENT,
      connectorFamily: family,
      capability: op,
    };
  }

  if (application.integrationType === "manual") {
    return {
      executionClass: EXECUTION_CLASS.MANUAL,
      reasonCode: REASON_CODE.MANUAL_FULFILLMENT,
      connectorFamily: family,
      capability: op,
    };
  }

  if (!isConnectorConfigReady(family, application)) {
    return {
      executionClass: EXECUTION_CLASS.BLOCKED,
      reasonCode: REASON_CODE.CONNECTOR_CONFIG_INCOMPLETE,
      connectorFamily: family,
      capability: op,
    };
  }

  const missing = missingRequiredAttributes({
    family,
    operationType: op,
    attributes,
    identity,
  });
  if (missing.length) {
    return {
      executionClass: EXECUTION_CLASS.BLOCKED,
      reasonCode: REASON_CODE.MISSING_REQUIRED_ATTRIBUTE,
      connectorFamily: family,
      capability: op,
      missingAttributes: missing,
    };
  }

  return {
    executionClass: EXECUTION_CLASS.EXECUTABLE,
    reasonCode: REASON_CODE.CAPABLE,
    connectorFamily: family,
    capability: op,
  };
}
