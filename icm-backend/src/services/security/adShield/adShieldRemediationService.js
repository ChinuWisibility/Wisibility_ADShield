import { normalizeAdConfig } from "../../adLdapService.js";
import {
  isAdShieldEnabled,
  postRemediate,
  sanitizeAdShieldErrorMessage,
} from "./adShieldClient.js";
import {
  buildAdShieldConnection,
} from "./adShieldAclAdapter.js";
import { resolveAdShieldRemediationAction } from "./adShieldFeatures.js";

/**
 * Build typed ADShield remediation action from a Security Posture finding.
 * @param {object} finding
 * @param {object} [overrides]
 */
export function buildRemediationActionFromFinding(finding, overrides = {}) {
  const feature = String(overrides.feature || finding?.feature || "").trim();
  const targetDn = String(overrides.targetDn || finding?.dn || "").trim();
  const type =
    overrides.actionType ||
    resolveAdShieldRemediationAction(feature, finding);

  if (!type) {
    const err = new Error(
      `No ADShield remediation action is defined for feature '${feature || "unknown"}'.`,
    );
    err.code = "REMEDIATION_UNSUPPORTED";
    throw err;
  }
  if (!targetDn) {
    const err = new Error("Finding DN (targetDn) is required for remediation.");
    err.code = "REMEDIATION_MISSING_TARGET";
    throw err;
  }

  const action = {
    type,
    feature,
    targetDn,
  };

  const trusteeSid =
    overrides.trusteeSid ||
    finding?.evidence?.trusteeSid ||
    finding?.attributes?.trusteeSid ||
    null;
  if (trusteeSid) action.trusteeSid = String(trusteeSid);

  const accessMask =
    overrides.accessMask ||
    finding?.evidence?.accessMask ||
    finding?.attributes?.accessMask ||
    null;
  if (accessMask != null && accessMask !== "") {
    action.accessMask = String(accessMask);
  }

  if (overrides.aceType != null) action.aceType = overrides.aceType;
  else if (finding?.evidence?.aceType != null) action.aceType = finding.evidence.aceType;

  const spnValues =
    overrides.spnValues ||
    finding?.evidence?.servicePrincipalNames ||
    null;
  if (Array.isArray(spnValues) && spnValues.length) {
    action.spnValues = spnValues.map(String);
  }

  const memberDn =
    overrides.memberDn ||
    finding?.evidence?.memberDn ||
    finding?.evidence?.childDn ||
    finding?.attributes?.memberDn ||
    finding?.attributes?.childDn ||
    null;
  if (memberDn) action.memberDn = String(memberDn);

  // nested_groups: remove child from parent — target is parent, member is child
  if (action.type === "remove_group_member") {
    const parentDn =
      overrides.targetDn ||
      finding?.evidence?.parentDn ||
      finding?.attributes?.parentDn ||
      null;
    if (parentDn) action.targetDn = String(parentDn);
    const childDn =
      overrides.memberDn ||
      finding?.evidence?.childDn ||
      finding?.dn ||
      null;
    if (childDn) action.memberDn = String(childDn);
  }

  const managedByDn =
    overrides.managedByDn ||
    finding?.evidence?.managedByDn ||
    finding?.attributes?.managedByDn ||
    null;
  if (managedByDn) action.managedByDn = String(managedByDn);

  const newParentDn =
    overrides.newParentDn ||
    finding?.evidence?.newParentDn ||
    finding?.attributes?.newParentDn ||
    null;
  if (newParentDn) action.newParentDn = String(newParentDn);

  return action;
}

/**
 * Preview or apply ADShield remediation for an application finding.
 * @param {object} params
 * @param {object} params.application
 * @param {object} params.finding
 * @param {boolean} params.dryRun
 * @param {string} [params.bindPassword]
 * @param {object} [params.overrides]
 * @param {string} [params.correlationId]
 * @param {object} [params.requester]
 */
export async function remediateSecurityFinding({
  application,
  finding,
  dryRun = true,
  bindPassword,
  overrides = {},
  correlationId,
  requester = null,
}) {
  if (!isAdShieldEnabled()) {
    const err = new Error(
      "ADShield is disabled. Enable ADSHIELD_ENABLED to remediate AD Security findings.",
    );
    err.code = "ADSHIELD_DISABLED";
    throw err;
  }

  const fromDb = application?.connectionConfig?.ad || {};
  const pwd = bindPassword || fromDb.bindPassword;
  const adConfig = normalizeAdConfig({ ...fromDb, bindPassword: pwd });
  if (!adConfig.bindPassword || !adConfig.url || !adConfig.baseDn || !adConfig.bindDn) {
    const err = new Error(
      "AD connection settings (url, baseDn, bindDn, bindPassword) are required for remediation.",
    );
    err.code = "AD_CONFIG_REQUIRED";
    throw err;
  }

  const action = buildRemediationActionFromFinding(finding, overrides);
  const body = {
    correlationId: correlationId || undefined,
    connection: buildAdShieldConnection(adConfig),
    action,
    dryRun: Boolean(dryRun),
    verifyAfter: dryRun ? false : true,
  };

  const result = await postRemediate(body);

  return {
    success: Boolean(result?.success),
    dryRun: Boolean(dryRun),
    actionType: result?.actionType || action.type,
    targetDn: result?.targetDn || action.targetDn,
    feature: result?.feature || action.feature,
    changes: Array.isArray(result?.changes) ? result.changes : [],
    errors: Array.isArray(result?.errors)
      ? result.errors.map((e) => sanitizeAdShieldErrorMessage(e))
      : [],
    verification: result?.verification || {},
    correlationId: result?.correlationId || correlationId || null,
    audit: {
      timestamp: new Date().toISOString(),
      applicationId: String(application?._id || ""),
      feature: action.feature,
      targetDn: action.targetDn,
      action: action.type,
      dryRun: Boolean(dryRun),
      requesterId: requester?.id || requester?._id || null,
      result: result?.success ? "ok" : "failed",
      verification: result?.verification?.verified ?? null,
    },
  };
}
