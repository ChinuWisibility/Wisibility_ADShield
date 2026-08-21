/**
 * Temporary CSV / file_delimited provisioning connector for Joiner E2E tests
 * while AD is offline.
 *
 * createAccount() inserts a row into the application's dynamic user collection
 * (same dataset used by aggregation/UI). This is NOT production SAP/Oracle —
 * only a test implementation of the generic provisioning contract.
 */

import mongoose from "mongoose";
import Application from "../../../models/application/Application.js";
import { getDynamicIdentityModelForTenantId } from "../../../models/identity/Identity.js";
import { getDynamicUserModelForTenantId } from "../../../models/application/Users.js";
import {
  getPrimaryKeyMappingOrThrow,
  normalizePrimaryKeyValue,
  applicationIdInClause,
} from "../../applicationUserIngestService.js";
import { provisioningResult } from "./provisioningConnectorContract.js";

function toStr(v) {
  return v == null ? "" : String(v).trim();
}

function buildUserDocFromIdentity(identity, application, attributes = {}) {
  const mappings = application.userMappings || [];
  const doc = {
    applicationId: application._id,
    tenantId: identity.tenantId || application.tenantId,
    status: "ACTIVE",
    rawData: {
      provisionedBy: "joiner_csv_test_connector",
      provisionedAt: new Date().toISOString(),
      identityId: String(identity._id),
    },
  };

  const canonical = {
    email: identity.email,
    firstName: identity.firstName,
    lastName: identity.lastName,
    displayName: identity.displayName,
    employeeId: identity.employeeId,
    department: identity.department,
    title: identity.title,
    location: identity.location,
    phone: identity.phoneNumber,
    phoneNumber: identity.phoneNumber,
    username: identity.employeeId || (identity.email || "").split("@")[0],
    user_id: identity.employeeId || identity.email,
    employee_id: identity.employeeId,
    display_name: identity.displayName,
    ...attributes,
  };

  if (mappings.length) {
    for (const um of mappings) {
      const sf = toStr(um.standardField);
      if (!sf) continue;
      if (canonical[sf] != null && canonical[sf] !== "") {
        doc[sf] = canonical[sf];
      } else {
        const lower = sf.toLowerCase();
        if (canonical[lower] != null && canonical[lower] !== "") {
          doc[sf] = canonical[lower];
        }
      }
    }
  } else {
    Object.assign(doc, {
      email: canonical.email,
      display_name: canonical.displayName,
      employee_id: canonical.employeeId,
      department: canonical.department,
      location: canonical.location,
      username: canonical.username,
      user_id: canonical.user_id,
    });
  }

  // Apply explicit attribute overrides last.
  for (const [k, v] of Object.entries(attributes)) {
    if (v == null || k === "attributes") continue;
    doc[k] = v;
  }

  return doc;
}

function resolvePrimaryKeyValue(doc, application) {
  try {
    const { standardField } = getPrimaryKeyMappingOrThrow(application.userMappings);
    const v = doc[standardField];
    if (v != null && String(v).trim()) return { field: standardField, value: String(v).trim() };
  } catch {
    /* fall through */
  }
  if (doc.employee_id) return { field: "employee_id", value: String(doc.employee_id).trim() };
  if (doc.employeeId) return { field: "employeeId", value: String(doc.employeeId).trim() };
  if (doc.email) return { field: "email", value: String(doc.email).trim() };
  if (doc.user_id) return { field: "user_id", value: String(doc.user_id).trim() };
  return null;
}

/**
 * @param {{ application: object }} ctx
 */
export function createCsvTestProvisioningConnector(ctx = {}) {
  const application = ctx.application;

  return {
    family: "file_delimited",
    applicationId: application?._id ? String(application._id) : null,

    async createAccount(accountRequest = {}) {
      const tenantId = accountRequest.tenantId;
      const identityId = accountRequest.identityId;
      if (!application?.name) {
        return provisioningResult({
          status: "FAILED",
          message: "Application name is required for CSV test connector",
        });
      }
      if (!tenantId || !identityId) {
        return provisioningResult({
          status: "FAILED",
          message: "tenantId and identityId are required",
        });
      }

      const Identity = await getDynamicIdentityModelForTenantId(tenantId);
      const identity = await Identity.findOne({ _id: identityId, tenantId }).lean();
      if (!identity) {
        return provisioningResult({
          status: "FAILED",
          message: "Identity not found for tenant",
        });
      }

      // Tenant ownership: application must belong to same tenant.
      if (
        application.tenantId &&
        String(application.tenantId) !== String(tenantId)
      ) {
        return provisioningResult({
          status: "FAILED",
          message: "Application does not belong to identity tenant",
        });
      }

      const Users = await getDynamicUserModelForTenantId(application.name, tenantId);
      const doc = buildUserDocFromIdentity(identity, application, accountRequest.attributes);
      const pk = resolvePrimaryKeyValue(doc, application);
      if (!pk) {
        return provisioningResult({
          status: "FAILED",
          message: "Cannot determine primary key for CSV account create",
        });
      }

      const existing = await Users.findOne({
        applicationId: applicationIdInClause(application._id).applicationId
          ? applicationIdInClause(application._id)
          : { $in: [application._id, String(application._id)] },
        [pk.field]: pk.value,
      }).lean();

      // Fix query — applicationIdInClause returns clause object for use as field value
      const appIdClause = applicationIdInClause(application._id);
      const existingFixed = await Users.findOne({
        applicationId: appIdClause,
        [pk.field]: pk.value,
      }).lean();

      if (existingFixed) {
        return provisioningResult({
          status: "COMPLETED",
          message: "CSV account already exists (ENSURE satisfied)",
          nativeIdentifier: String(existingFixed._id),
          detail: { duplicate: true, primaryKey: pk },
        });
      }

      // Also match case-insensitive PK when possible
      const allForApp = await Users.find({
        applicationId: appIdClause,
      })
        .select(`${pk.field} _id`)
        .limit(5000)
        .lean();
      const norm = normalizePrimaryKeyValue(pk.value);
      const dup = allForApp.find(
        (r) => normalizePrimaryKeyValue(r[pk.field]) === norm,
      );
      if (dup) {
        return provisioningResult({
          status: "COMPLETED",
          message: "CSV account already exists (ENSURE satisfied)",
          nativeIdentifier: String(dup._id),
          detail: { duplicate: true, primaryKey: pk },
        });
      }

      const created = await Users.create(doc);
      return provisioningResult({
        status: "COMPLETED",
        message: "CSV test account created",
        nativeIdentifier: String(created._id),
        detail: { primaryKey: pk, collection: Users.collection?.name },
      });
    },

    async executeTask(task) {
      const attrs = task?.targetAttributes || {};
      const op = String(task.operationType || "").toUpperCase();
      if (op === "ADD_ACCOUNT" || op === "CREATE_ACCOUNT") {
        return this.createAccount({
          tenantId: attrs.tenantId,
          identityId: attrs.identityId,
          applicationId: String(task.applicationId),
          operation: "ADD_ACCOUNT",
          attributes: attrs.attributes || attrs.accountAttributes || {},
          taskId: task._id ? String(task._id) : undefined,
          requestId: task.requestId ? String(task.requestId) : undefined,
        });
      }

      if (op === "UPDATE_ACCOUNT") {
        return this.updateAccount({
          tenantId: attrs.tenantId,
          identityId: attrs.identityId,
          applicationId: String(task.applicationId),
          attributes: attrs.attributes || attrs.accountAttributes || {},
          nativeIdentifier: attrs.nativeIdentifier,
        });
      }

      if (op === "DISABLE" || op === "DISABLE_ACCOUNT") {
        return this.disableAccount({
          tenantId: attrs.tenantId,
          identityId: attrs.identityId,
          applicationId: String(task.applicationId),
          nativeIdentifier: attrs.nativeIdentifier,
        });
      }

      return provisioningResult({
        status: "FAILED",
        message: `CSV test connector does not support operation ${task.operationType}`,
      });
    },

    async updateAccount(accountRequest = {}) {
      const tenantId = accountRequest.tenantId;
      const identityId = accountRequest.identityId;
      if (!tenantId || !identityId) {
        return provisioningResult({
          status: "FAILED",
          message: "tenantId and identityId are required",
        });
      }
      const Identity = await getDynamicIdentityModelForTenantId(tenantId);
      const identity = await Identity.findOne({ _id: identityId, tenantId }).lean();
      if (!identity) {
        return provisioningResult({
          status: "FAILED",
          message: "Identity not found for tenant",
        });
      }
      const Users = await getDynamicUserModelForTenantId(application.name, tenantId);
      const appIdClause = applicationIdInClause(application._id);
      const or = [];
      if (accountRequest.nativeIdentifier && mongoose.isValidObjectId(accountRequest.nativeIdentifier)) {
        or.push({ _id: accountRequest.nativeIdentifier });
      }
      if (identity.email) {
        or.push({ email: new RegExp(`^${String(identity.email).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
      }
      if (identity.employeeId) {
        or.push({ employee_id: String(identity.employeeId).trim() });
        or.push({ employeeId: String(identity.employeeId).trim() });
      }
      if (!or.length) {
        return provisioningResult({
          status: "FAILED",
          message: "Cannot locate CSV account for update",
        });
      }
      const existing = await Users.findOne({ applicationId: appIdClause, $or: or });
      if (!existing) {
        return provisioningResult({
          status: "FAILED",
          message: "CSV account not found for update",
        });
      }
      const patch = {
        ...(accountRequest.attributes || {}),
        department: accountRequest.attributes?.department ?? identity.department,
        title: accountRequest.attributes?.title ?? identity.title,
        display_name: accountRequest.attributes?.displayName ?? identity.displayName,
        email: accountRequest.attributes?.mail ?? identity.email,
        "rawData.lastLifecycleUpdate": new Date().toISOString(),
        "rawData.jmlOperation": "UPDATE_ACCOUNT",
      };
      await Users.updateOne({ _id: existing._id }, { $set: patch });
      return provisioningResult({
        status: "COMPLETED",
        message: "CSV test account updated",
        nativeIdentifier: String(existing._id),
        detail: { operation: "UPDATE_ACCOUNT" },
      });
    },

    async disableAccount(accountRequest = {}) {
      const tenantId = accountRequest.tenantId;
      const identityId = accountRequest.identityId;
      if (!tenantId || !identityId) {
        return provisioningResult({
          status: "FAILED",
          message: "tenantId and identityId are required",
        });
      }
      const Identity = await getDynamicIdentityModelForTenantId(tenantId);
      const identity = await Identity.findOne({ _id: identityId, tenantId }).lean();
      if (!identity) {
        return provisioningResult({
          status: "FAILED",
          message: "Identity not found for tenant",
        });
      }
      const Users = await getDynamicUserModelForTenantId(application.name, tenantId);
      const appIdClause = applicationIdInClause(application._id);
      const or = [];
      if (accountRequest.nativeIdentifier && mongoose.isValidObjectId(accountRequest.nativeIdentifier)) {
        or.push({ _id: accountRequest.nativeIdentifier });
      }
      if (identity.email) {
        or.push({ email: new RegExp(`^${String(identity.email).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
      }
      if (identity.employeeId) {
        or.push({ employee_id: String(identity.employeeId).trim() });
        or.push({ employeeId: String(identity.employeeId).trim() });
      }
      if (!or.length) {
        return provisioningResult({
          status: "FAILED",
          message: "Cannot locate CSV account for disable",
        });
      }
      const existing = await Users.findOne({ applicationId: appIdClause, $or: or });
      if (!existing) {
        return provisioningResult({
          status: "FAILED",
          message: "CSV account not found for disable",
        });
      }
      if (String(existing.status || "").toUpperCase() === "DISABLED") {
        return provisioningResult({
          status: "COMPLETED",
          message: "CSV account already disabled",
          nativeIdentifier: String(existing._id),
          detail: { noop: true, operation: "DISABLE" },
        });
      }
      await Users.updateOne(
        { _id: existing._id },
        {
          $set: {
            status: "DISABLED",
            "rawData.disabledAt": new Date().toISOString(),
            "rawData.jmlOperation": "DISABLE_ACCOUNT",
          },
        },
      );
      return provisioningResult({
        status: "COMPLETED",
        message: "CSV test account disabled",
        nativeIdentifier: String(existing._id),
        detail: { operation: "DISABLE" },
      });
    },
  };
}

export async function resolveCsvTestConnectorForApplication(application) {
  if (!application) return null;
  return createCsvTestProvisioningConnector({ application });
}

