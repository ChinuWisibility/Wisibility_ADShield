import mongoose from "mongoose";
import Transform from "../../models/governance/Transform.js";
import { AppError } from "../../middleware/errorHandler.js";
import {
  isPlatformPlaneUser,
} from "../../middleware/auth.js";
import { executeTransform } from "../../services/transform/transformEngine.js";
import { validateTransformDocument } from "../../services/transform/validateTransform.js";
import { getAllowedFieldNamesForApplication } from "../../services/transform/schemaService.js";

function enforceTenantWrite(req) {
  if (isPlatformPlaneUser(req.user)) return;
  if (!req.user?.tenantId) {
    throw new AppError("Tenant context required", 403, "TENANT_SCOPE_REQUIRED");
  }
}

function buildListQuery(req) {
  const query = {};
  if (isPlatformPlaneUser(req.user)) {
    if (req.query.tenantId) query.tenantId = req.query.tenantId;
  } else {
    query.tenantId = req.user.tenantId;
  }
  if (req.query.linkedAppId && mongoose.Types.ObjectId.isValid(req.query.linkedAppId)) {
    query.linkedAppId = req.query.linkedAppId;
  }
  return query;
}

export async function listTransforms(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;
    const query = buildListQuery(req);
    if (req.query.search) {
      query.name = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
    const [items, total] = await Promise.all([
      Transform.find(query)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("linkedAppId", "name")
        .populate("createdBy", "name email")
        .lean(),
      Transform.countDocuments(query),
    ]);
    res.json({
      success: true,
      data: items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    next(err);
  }
}

async function findTransformScoped(req, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError("Invalid id", 400, "INVALID_ID");
  }
  const query = { _id: id };
  if (!isPlatformPlaneUser(req.user)) {
    query.tenantId = req.user.tenantId;
  }
  const doc = await Transform.findOne(query)
    .populate("linkedAppId", "name")
    .populate("createdBy", "name email");
  if (!doc) throw new AppError("Transform not found", 404, "NOT_FOUND");
  return doc;
}

export async function getTransformById(req, res, next) {
  try {
    const doc = await findTransformScoped(req, req.params.id);
    res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
}

export async function createTransform(req, res, next) {
  try {
    enforceTenantWrite(req);
    const { name, description, transformJson, linkedAppId } = req.body || {};
    if (!name || transformJson === undefined) {
      throw new AppError("name and transformJson are required", 400, "VALIDATION");
    }
    if (linkedAppId) {
      await getAllowedFieldNamesForApplication(linkedAppId, { user: req.user });
    }
    const tenantId = isPlatformPlaneUser(req.user)
      ? req.body.tenantId || req.user.tenantId
      : req.user.tenantId;
    if (!tenantId) {
      throw new AppError("tenantId is required for this operation", 400, "VALIDATION");
    }
    const doc = await Transform.create({
      name: String(name).trim(),
      description: description != null ? String(description) : "",
      transformJson,
      linkedAppId: linkedAppId || null,
      tenantId,
      createdBy: req.user.id || req.user._id,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    if (err?.code === 11000) {
      next(new AppError("A transform with this name already exists", 409, "DUPLICATE"));
      return;
    }
    next(err);
  }
}

export async function updateTransform(req, res, next) {
  try {
    enforceTenantWrite(req);
    const doc = await findTransformScoped(req, req.params.id);
    const { name, description, transformJson, linkedAppId } = req.body || {};
    if (name !== undefined) doc.name = String(name).trim();
    if (description !== undefined) doc.description = String(description);
    if (transformJson !== undefined) doc.transformJson = transformJson;
    if (linkedAppId !== undefined) {
      if (linkedAppId) {
        await getAllowedFieldNamesForApplication(linkedAppId, { user: req.user });
      }
      doc.linkedAppId = linkedAppId || null;
    }
    doc.updatedBy = req.user.id || req.user._id;
    await doc.save();
    res.json({ success: true, data: doc });
  } catch (err) {
    if (err?.code === 11000) {
      next(new AppError("A transform with this name already exists", 409, "DUPLICATE"));
      return;
    }
    next(err);
  }
}

export async function deleteTransform(req, res, next) {
  try {
    enforceTenantWrite(req);
    const doc = await findTransformScoped(req, req.params.id);
    await doc.deleteOne();
    res.json({ success: true, message: "Deleted" });
  } catch (err) {
    next(err);
  }
}

export async function postValidate(req, res, next) {
  try {
    const { transformJson, appId } = req.body || {};
    let allowedFields = null;
    if (appId) {
      allowedFields = await getAllowedFieldNamesForApplication(appId, { user: req.user });
    }
    const result = validateTransformDocument(transformJson, {
      allowedFields: allowedFields && allowedFields.size ? allowedFields : null,
    });
    res.json({
      success: true,
      data: {
        valid: result.valid,
        errors: result.errors,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function postExecute(req, res, next) {
  try {
    const { transformJson, sampleData } = req.body || {};
    const structural = validateTransformDocument(transformJson, {});
    if (!structural.valid) {
      return res.status(400).json({
        success: false,
        message: "Transform validation failed",
        data: { errors: structural.errors },
      });
    }
    const ctx =
      sampleData && typeof sampleData === "object" && !Array.isArray(sampleData)
        ? sampleData
        : {};
    const result = executeTransform(transformJson, ctx);
    res.json({ success: true, data: { result } });
  } catch (err) {
    next(
      err instanceof Error
        ? new AppError(err.message, 400, "EXECUTE_ERROR")
        : err,
    );
  }
}
