import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import { AppError } from "../../middleware/errorHandler.js";
import { isPlatformPlaneUser } from "../../middleware/auth.js";

/**
 * @param {string} dataType
 */
function normalizeDataType(dataType) {
  if (!dataType || typeof dataType !== "string") return "string";
  const t = dataType.trim();
  const lower = t.toLowerCase();
  if (lower === "string") return "string";
  if (lower === "number" || lower === "integer" || lower === "int") return "number";
  if (lower === "boolean" || lower === "bool") return "boolean";
  if (lower === "date" || lower === "datetime") return "date";
  return lower;
}

/**
 * @param {import("mongoose").Document|null} application
 * @returns {{ name: string, type: string }[]}
 */
export function mapUserMappingsToAttributes(application) {
  const mappings = application?.userMappings;
  if (!Array.isArray(mappings)) return [];
  return mappings
    .map((m) => ({
      name: m.standardField,
      type: normalizeDataType(m.dataType),
    }))
    .filter((a) => a.name && typeof a.name === "string");
}

/**
 * Load application schema fields for transform validation / GET /schemas/:appId.
 *
 * @param {string} appId
 * @param {{ user: object }} ctx
 * @returns {Promise<{ attributes: { name: string, type: string }[] }>}
 */
export async function getSchemaForApplication(appId, ctx) {
  if (!mongoose.Types.ObjectId.isValid(appId)) {
    throw new AppError("Invalid application id", 400, "INVALID_ID");
  }
  const application = await Application.findById(appId).lean();
  if (!application) {
    throw new AppError("Application not found", 404, "NOT_FOUND");
  }

  const user = ctx.user;
  if (!isPlatformPlaneUser(user)) {
    const appTenant = application.tenantId?.toString();
    const userTenant = user?.tenantId?.toString();
    if (!userTenant || !appTenant || appTenant !== userTenant) {
      throw new AppError("Application not found", 404, "NOT_FOUND");
    }
  }

  const attributes = mapUserMappingsToAttributes(application);
  return { attributes };
}

/**
 * @param {string} appId
 * @param {{ user: object }} ctx
 * @returns {Promise<Set<string>>}
 */
export async function getAllowedFieldNamesForApplication(appId, ctx) {
  const { attributes } = await getSchemaForApplication(appId, ctx);
  return new Set(attributes.map((a) => a.name));
}
