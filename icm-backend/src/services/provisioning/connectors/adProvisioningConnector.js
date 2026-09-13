/**
 * Active Directory provisioning connector — account and group membership writes.
 * CREATE delegates to existing createAdUser (unchanged).
 */

import Application from "../../../models/application/Application.js";
import { getDynamicIdentityModelForTenantId } from "../../../models/identity/Identity.js";
import {
  createAdUser,
  updateAdUser,
  disableAdUser,
  enableAdUser,
  addAdGroupMember,
  removeAdGroupMember,
} from "../../ad/adLdapService.js";
import { resolveAdEntitlementTarget } from "./adEntitlementTargetResolver.js";
import {
  provisioningResult,
  normalizeProvisioningOperation,
} from "./provisioningConnectorContract.js";

function identityToAdUserSpec(identity, attributes = {}) {
  const attrs = attributes && typeof attributes === "object" ? attributes : {};
  return {
    sAMAccountName: attrs.sAMAccountName || attrs.samAccountName || undefined,
    userPrincipalName: attrs.userPrincipalName || attrs.upn || undefined,
    givenName: attrs.givenName || identity.firstName || undefined,
    sn: attrs.sn || identity.lastName || undefined,
    displayName: attrs.displayName || identity.displayName || undefined,
    mail: attrs.mail || identity.email || undefined,
    employeeId: attrs.employeeId || identity.employeeId || undefined,
    department: attrs.department || identity.department || undefined,
    title: attrs.title || identity.title || undefined,
    ...attrs,
  };
}

/**
 * @param {{ application: object }} ctx
 */
export function createAdProvisioningConnector(ctx = {}) {
  const application = ctx.application;
  const ldapService = ctx.ldapService || {
    createAdUser,
    updateAdUser,
    disableAdUser,
    enableAdUser,
    addAdGroupMember,
    removeAdGroupMember,
  };
  const entitlementTargetResolver =
    ctx.entitlementTargetResolver || resolveAdEntitlementTarget;

  function contextError(accountRequest = {}) {
    if (!application?.connectionConfig?.ad) {
      return "Application has no AD connectionConfig.ad";
    }
    if (!accountRequest.tenantId) return "tenantId is required";
    if (
      application.tenantId &&
      String(application.tenantId) !== String(accountRequest.tenantId)
    ) {
      return "Application does not belong to the task tenant";
    }
    if (
      accountRequest.applicationId &&
      application._id &&
      String(application._id) !== String(accountRequest.applicationId)
    ) {
      return "Task application does not match the AD connector application";
    }
    return null;
  }

  function failedContext(message) {
    return provisioningResult({
      status: "FAILED",
      message,
      detail: {
        blocked: true,
        code: /tenant/i.test(message)
          ? "TENANT_MISMATCH"
          : "APPLICATION_MISMATCH",
      },
    });
  }

  function accountLocator(accountRequest = {}, identity = null) {
    const attrs = accountRequest.attributes || {};
    return {
      dn: attrs.dn || attrs.distinguishedName || undefined,
      objectGUID:
        attrs.objectGUID ||
        attrs.objectGuid ||
        accountRequest.objectGUID ||
        undefined,
      nativeIdentifier: accountRequest.nativeIdentifier,
      sAMAccountName:
        attrs.sAMAccountName || attrs.samAccountName || attrs.sam || undefined,
      userPrincipalName:
        attrs.userPrincipalName || attrs.upn || identity?.email || undefined,
      employeeId:
        identity?.employeeId ||
        attrs.employeeId ||
        attrs.employeeID ||
        attrs.employee_id ||
        undefined,
    };
  }

  function failedWrite(err, fallback) {
    return provisioningResult({
      status: "FAILED",
      message: err?.message || fallback,
      detail: {
        blocked: [
          "ACCOUNT_AMBIGUOUS",
          "AD_SCOPE_VIOLATION",
          "TENANT_MISMATCH",
          "APPLICATION_MISMATCH",
          "MALFORMED_TARGET",
          "ENTITLEMENT_AMBIGUOUS",
        ].includes(err?.code),
        code: err?.code,
      },
    });
  }

  return {
    family: "ldap_ad",
    applicationId: application?._id ? String(application._id) : null,

    async createAccount(accountRequest = {}) {
      const tenantId = accountRequest.tenantId;
      const identityId = accountRequest.identityId;
      if (!tenantId || !identityId) {
        return provisioningResult({
          status: "FAILED",
          message: "tenantId and identityId are required",
        });
      }
      const invalid = contextError(accountRequest);
      if (invalid) return failedContext(invalid);

      const Identity = await getDynamicIdentityModelForTenantId(tenantId);
      const identity = await Identity.findOne({ _id: identityId, tenantId }).lean();
      if (!identity) {
        return provisioningResult({
          status: "FAILED",
          message: "Identity not found for tenant",
        });
      }

      const userSpec = identityToAdUserSpec(identity, accountRequest.attributes);
      try {
        const created = await ldapService.createAdUser(
          application.connectionConfig.ad,
          userSpec,
        );
        return provisioningResult({
          status: "COMPLETED",
          message: "AD account created",
          nativeIdentifier: created?.dn || created?.distinguishedName || created?.sAMAccountName,
          detail: {
            dn: created?.dn,
            sAMAccountName: created?.sAMAccountName || created?.meta?.sAMAccountName,
            objectGUID: created?.objectGUID,
            verified: created?.verified || null,
            // Live AD success only when createAdUser returned — still not sync/correlation.
            adLiveWrite: true,
          },
        });
      } catch (err) {
        if (err?.code === "DUPLICATE_ACCOUNT") {
          return provisioningResult({
            status: "COMPLETED",
            message: err.message || "AD account already exists",
            nativeIdentifier: err.existing?.dn,
            detail: { duplicate: true, existing: err.existing },
          });
        }
        return provisioningResult({
          status: "FAILED",
          message: err?.message || "AD createAccount failed",
          detail: { code: err?.code },
        });
      }
    },

    async updateAccount(accountRequest = {}) {
      const tenantId = accountRequest.tenantId;
      const identityId = accountRequest.identityId;
      const invalid = contextError(accountRequest);
      if (invalid) return failedContext(invalid);

      let identity = null;
      if (tenantId && identityId) {
        const Identity = await getDynamicIdentityModelForTenantId(tenantId);
        identity = await Identity.findOne({ _id: identityId, tenantId }).lean();
      }

      const attributes = {
        ...(identity
          ? {
              givenName: identity.firstName,
              sn: identity.lastName,
              displayName: identity.displayName,
              mail: identity.email,
              department: identity.department,
              title: identity.title,
              employeeID: identity.employeeId,
              telephoneNumber: identity.phoneNumber,
            }
          : {}),
        ...(accountRequest.attributes || {}),
      };

      try {
        const updated = await ldapService.updateAdUser(
          application.connectionConfig.ad,
          {
            ...accountLocator(accountRequest, identity),
            attributes,
          },
        );
        return provisioningResult({
          status: "COMPLETED",
          message: updated.noop ? "AD update no-op" : "AD account updated",
          nativeIdentifier: updated.dn || accountRequest.nativeIdentifier,
          detail: { ...updated, adLiveWrite: true },
        });
      } catch (err) {
        return failedWrite(err, "AD updateAccount failed");
      }
    },

    async disableAccount(accountRequest = {}) {
      const invalid = contextError(accountRequest);
      if (invalid) return failedContext(invalid);

      const tenantId = accountRequest.tenantId;
      const identityId = accountRequest.identityId;
      let identity = null;
      if (tenantId && identityId) {
        const Identity = await getDynamicIdentityModelForTenantId(tenantId);
        identity = await Identity.findOne({ _id: identityId, tenantId }).lean();
      }

      try {
        const disabled = await ldapService.disableAdUser(
          application.connectionConfig.ad,
          accountLocator(accountRequest, identity),
        );
        return provisioningResult({
          status: "COMPLETED",
          message: disabled.noop
            ? "AD account already disabled"
            : "AD account disabled",
          nativeIdentifier: disabled.dn || accountRequest.nativeIdentifier,
          detail: { ...disabled, adLiveWrite: true },
        });
      } catch (err) {
        return failedWrite(err, "AD disableAccount failed");
      }
    },

    async enableAccount(accountRequest = {}) {
      const invalid = contextError(accountRequest);
      if (invalid) return failedContext(invalid);
      try {
        const enabled = await ldapService.enableAdUser(
          application.connectionConfig.ad,
          accountLocator(accountRequest),
        );
        return provisioningResult({
          status: "COMPLETED",
          message: enabled.noop
            ? "AD account already enabled"
            : "AD account enabled",
          nativeIdentifier: enabled.dn || accountRequest.nativeIdentifier,
          detail: { ...enabled, adLiveWrite: true },
        });
      } catch (err) {
        return failedWrite(err, "AD enableAccount failed");
      }
    },

    async changeEntitlement(accountRequest = {}, operation) {
      const invalid = contextError(accountRequest);
      if (invalid) return failedContext(invalid);
      try {
        // Resolve immediately before the LDAP service revalidates the DN and writes.
        const target = await entitlementTargetResolver({
          tenantId: accountRequest.tenantId,
          application,
          entitlement: accountRequest.entitlement,
        });
        const writer =
          operation === "add"
            ? ldapService.addAdGroupMember
            : ldapService.removeAdGroupMember;
        const changed = await writer(application.connectionConfig.ad, {
          groupDn: target.groupDn,
          userLocator: accountLocator(accountRequest),
        });
        return provisioningResult({
          status: "COMPLETED",
          message: changed.noop
            ? `AD group membership already ${operation === "add" ? "present" : "absent"}`
            : `AD group membership ${operation === "add" ? "added" : "removed"}`,
          nativeIdentifier: changed.userDn || accountRequest.nativeIdentifier,
          detail: {
            ...changed,
            entitlementTarget: target,
            adLiveWrite: true,
          },
        });
      } catch (err) {
        return failedWrite(err, "AD entitlement operation failed");
      }
    },

    async addEntitlement(accountRequest = {}) {
      return this.changeEntitlement(accountRequest, "add");
    },

    async removeEntitlement(accountRequest = {}) {
      return this.changeEntitlement(accountRequest, "remove");
    },

    async executeTask(task) {
      const attrs = task?.targetAttributes || {};
      const op = normalizeProvisioningOperation(task.operationType);
      const base = {
        tenantId: attrs.tenantId,
        identityId: attrs.identityId,
        applicationId: String(task.applicationId),
        attributes: attrs.attributes || attrs.accountAttributes || {},
        nativeIdentifier: attrs.nativeIdentifier,
        objectGUID: attrs.objectGUID,
        entitlement: attrs.entitlement,
        taskId: task._id ? String(task._id) : undefined,
        requestId: task.requestId ? String(task.requestId) : undefined,
        jmlCorrelationId: attrs.jmlCorrelationId || task.jmlCorrelationId,
      };

      if (op === "ADD_ACCOUNT") return this.createAccount({ ...base, operation: op });
      if (op === "UPDATE_ACCOUNT") return this.updateAccount({ ...base, operation: op });
      if (op === "DISABLE") return this.disableAccount({ ...base, operation: op });
      if (op === "ENABLE") return this.enableAccount({ ...base, operation: op });
      if (op === "ADD_ENTITLEMENT") {
        return this.addEntitlement({ ...base, operation: op });
      }
      if (op === "REMOVE_ENTITLEMENT") {
        return this.removeEntitlement({ ...base, operation: op });
      }

      return provisioningResult({
        status: "FAILED",
        message: `AD connector does not support operation ${task.operationType}`,
      });
    },
  };
}

export async function resolveAdConnectorForApplication(application) {
  if (!application) return null;
  return createAdProvisioningConnector({ application });
}

export async function loadApplicationForTenant(applicationId, tenantId) {
  if (!applicationId) return null;
  const q = { _id: applicationId };
  if (tenantId) q.tenantId = tenantId;
  return Application.findOne(q).lean();
}
