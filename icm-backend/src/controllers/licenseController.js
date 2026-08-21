import fs from "fs/promises";
import path from "path";
import multer from "multer";
import env from "../config/env.js";
import { ensureDirSync } from "../config/productPaths.js";
import {
  getLicenseManager,
  isLicenseRequiredMode,
  isProductLicensed,
  setLicenseRequiredMode,
} from "../licensing/licenseRuntime.js";
import { LicenseException } from "../licensing/exceptions/index.js";
import { AppError } from "../middleware/errorHandler.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || "").toLowerCase();
    if (name.endsWith(".lic.json") || name.endsWith(".json")) {
      return cb(null, true);
    }
    cb(new AppError("License file must be a .lic.json file", 400, "INVALID_LICENSE_FILE"));
  },
});

export const licenseUploadMiddleware = upload.single("license");

function licenseFilePath() {
  return (
    env.license.envFilePath ||
    env.paths?.licenseDefault ||
    path.join(env.paths?.data || "", "license", "license.lic.json")
  );
}

export async function getLicenseStatus(req, res, next) {
  try {
    const manager = getLicenseManager();
    const result = manager?.getValidatedLicense();
    const licensed = isProductLicensed();

    res.json({
      success: true,
      data: {
        licensed,
        licenseRequiredMode: isLicenseRequiredMode(),
        summary: result?.toLogSummary?.() || null,
        path: licenseFilePath(),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function uploadLicense(req, res, next) {
  try {
    const manager = getLicenseManager();
    if (!manager) {
      throw new AppError("License manager not initialized", 500, "LICENSE_MANAGER_MISSING");
    }

    const raw = req.file?.buffer?.toString("utf8") || req.body?.license;
    if (!raw || !String(raw).trim()) {
      throw new AppError("License file is required", 400, "LICENSE_REQUIRED_BODY");
    }

    // Verify before writing
    await manager.reload({ raw: String(raw), filePath: "upload" });

    const target = licenseFilePath();
    ensureDirSync(path.dirname(target));
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, String(raw).trim().endsWith("\n") ? String(raw).trim() : `${String(raw).trim()}\n`, "utf8");
    await fs.rename(tmp, target);

    // Reload from persisted path
    await manager.reload({ filePath: target });
    setLicenseRequiredMode(false);

    res.json({
      success: true,
      message: "License installed and activated (no restart required)",
      data: {
        licensed: true,
        summary: manager.getValidatedLicense()?.toLogSummary?.() || null,
        path: target,
      },
    });
  } catch (err) {
    if (err instanceof LicenseException) {
      return next(new AppError(err.internalReason || "Invalid license", 400, "INVALID_LICENSE"));
    }
    if (err instanceof SyntaxError) {
      return next(new AppError("License JSON is malformed", 400, "INVALID_LICENSE_JSON"));
    }
    next(err);
  }
}

export async function reloadLicense(req, res, next) {
  try {
    const manager = getLicenseManager();
    if (!manager) {
      throw new AppError("License manager not initialized", 500, "LICENSE_MANAGER_MISSING");
    }
    await manager.reload();
    setLicenseRequiredMode(!manager.isLicensed());
    res.json({
      success: true,
      message: "License reloaded",
      data: {
        licensed: manager.isLicensed(),
        summary: manager.getValidatedLicense()?.toLogSummary?.() || null,
      },
    });
  } catch (err) {
    if (err instanceof LicenseException) {
      return next(new AppError(err.internalReason || "License reload failed", 400, "LICENSE_RELOAD_FAILED"));
    }
    next(err);
  }
}
