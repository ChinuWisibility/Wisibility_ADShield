import mongoose from "mongoose";
import { isPlatformPlaneUser } from "../../middleware/auth.js";

/**
 * Resolve tenant ObjectId from scoped user or platform-admin query param.
 * @param {import("express").Request} req
 * @returns {import("mongoose").Types.ObjectId | null}
 */
export function resolveDataHygieneTenantId(req) {
  const fromScoped = req.scopedTenantId ?? req.user?.tenantId;
  if (fromScoped && mongoose.Types.ObjectId.isValid(String(fromScoped))) {
    return new mongoose.Types.ObjectId(String(fromScoped));
  }
  const q = req.query?.tenantId;
  if (q && mongoose.Types.ObjectId.isValid(String(q)) && isPlatformPlaneUser(req.user)) {
    return new mongoose.Types.ObjectId(String(q));
  }
  return null;
}
