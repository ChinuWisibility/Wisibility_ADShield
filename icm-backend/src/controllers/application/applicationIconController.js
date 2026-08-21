import * as applicationIconService from "../../services/application/applicationIconService.js";
import { AppError } from "../../middleware/errorHandler.js";

function resolveTenantId(req) {
  return (
    req.scopedTenantId
    || req.query?.tenantId
    || req.body?.tenantId
    || null
  );
}

export async function listApplicationIcons(req, res, next) {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw new AppError("tenantId is required", 400, "TENANT_REQUIRED");
    }
    const data = await applicationIconService.listApplicationIcons(tenantId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function seedBuiltinApplicationIcons(req, res, next) {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw new AppError("tenantId is required", 400, "TENANT_REQUIRED");
    }
    const force = req.body?.force === true || req.query?.force === "1";
    const apply = req.body?.apply !== false && req.query?.apply !== "0";
    const onlyMissing = req.body?.onlyMissing !== false && req.query?.onlyMissing !== "0";

    const seed = await applicationIconService.seedBuiltinIcons(tenantId, { force });
    let applied = null;
    if (apply) {
      applied = await applicationIconService.applyBuiltinPackIconsToApplications(tenantId, {
        onlyMissing,
      });
    }
    res.json({ success: true, data: { seed, applied } });
  } catch (err) {
    next(err);
  }
}

export async function applyBuiltinPackIcons(req, res, next) {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw new AppError("tenantId is required", 400, "TENANT_REQUIRED");
    }
    const onlyMissing = req.body?.onlyMissing !== false && req.query?.onlyMissing !== "0";
    const data = await applicationIconService.applyBuiltinPackIconsToApplications(tenantId, {
      onlyMissing,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function uploadApplicationIcon(req, res, next) {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw new AppError("tenantId is required", 400, "TENANT_REQUIRED");
    }
    const data = await applicationIconService.uploadApplicationIcon(
      tenantId,
      req.file,
      { name: req.body?.name, color: req.body?.color },
    );
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getApplicationIconImage(req, res, next) {
  try {
    const { mimeType, data } = await applicationIconService.getApplicationIconImage(
      req.params.id,
    );
    res.set("Content-Type", mimeType);
    res.set("Cache-Control", "no-cache, max-age=0, must-revalidate");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(data);
  } catch (err) {
    next(err);
  }
}

export async function deleteApplicationIcon(req, res, next) {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      throw new AppError("tenantId is required", 400, "TENANT_REQUIRED");
    }
    const data = await applicationIconService.deleteApplicationIcon(
      tenantId,
      req.params.id,
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
