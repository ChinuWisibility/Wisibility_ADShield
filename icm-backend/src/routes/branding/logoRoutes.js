import { Router } from "express";
import multer from "multer";
import { authenticate, authorize, ROLES } from "../../middleware/auth.js";
import { AppError } from "../../middleware/errorHandler.js";
import * as logoCtrl from "../../controllers/branding/logoController.js";
import { imageFileFilter } from "../../utils/uploadFilters.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});
const router = Router();

function uploadSingleLogo(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(
          new AppError(
            "Logo file must be 5 MB or smaller",
            400,
            "FILE_TOO_LARGE",
          ),
        );
      }
      return next(
        new AppError(
          err.message || "Invalid upload payload",
          400,
          "INVALID_UPLOAD",
        ),
      );
    }

    return next(
      new AppError(
        err.message || "Failed to process upload payload",
        400,
        "UPLOAD_PROCESSING_FAILED",
      ),
    );
  });
}

router.get("/", authenticate, logoCtrl.listLogos);
router.get("/:id", authenticate, logoCtrl.getLogo);
// Image blobs are used by <img> tags, which cannot easily attach auth headers,
// so this endpoint is intentionally left unauthenticated.
router.get("/:id/image", logoCtrl.getLogoImage);
router.post(
  "/",
  authenticate,
  authorize(ROLES.ADMIN),
  uploadSingleLogo,
  logoCtrl.uploadLogo,
);
router.delete(
  "/:id",
  authenticate,
  authorize(ROLES.ADMIN),
  logoCtrl.deleteLogo,
);
router.put(
  "/:id/default",
  authenticate,
  authorize(ROLES.ADMIN),
  logoCtrl.setDefaultLogo,
);

export default router;
