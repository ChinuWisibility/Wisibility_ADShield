import { Router } from "express";
import { authenticate, authorize, ROLES } from "../middleware/auth.js";
import { collectDiagnostics } from "../services/system/diagnosticsService.js";
import { getProductAbout } from "../services/system/productAboutService.js";
import { isLicenseRequiredMode, isProductLicensed } from "../licensing/licenseRuntime.js";
import { getMaintenanceState } from "../services/system/platformSettingsService.js";

const router = Router();

router.get("/diagnostics", authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    // Allowed even in license-required mode for supportability
    const data = await collectDiagnostics();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

/** Any authenticated user may read the About datasheet for their tenant. */
router.get("/about", authenticate, async (req, res, next) => {
  try {
    const data = await getProductAbout(req);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get("/info", (_req, res) => {
  const maintenance = getMaintenanceState();
  res.json({
    success: true,
    data: {
      licensed: isProductLicensed(),
      licenseRequiredMode: isLicenseRequiredMode(),
      product: "Wisibility Identity Sphere",
      company: "Wisibility",
      version: "1.0.0",
      buildNumber: "2026.08.001",
      maintenance,
    },
  });
});

export default router;
