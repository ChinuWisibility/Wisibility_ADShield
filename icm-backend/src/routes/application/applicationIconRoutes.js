import { Router } from "express";
import multer from "multer";
import {
  authenticate,
  requirePermission,
  PERMISSIONS,
} from "../../middleware/auth.js";
import { AppError } from "../../middleware/errorHandler.js";
import * as iconCtrl from "../../controllers/application/applicationIconController.js";
import { imageFileFilter } from "../../utils/uploadFilters.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

const router = Router();

function uploadSingleIcon(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(
          new AppError("Icon file must be 2 MB or smaller", 400, "FILE_TOO_LARGE"),
        );
      }
      return next(
        new AppError(err.message || "Invalid upload payload", 400, "INVALID_UPLOAD"),
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

router.get("/", authenticate, iconCtrl.listApplicationIcons);
router.post(
  "/seed-builtins",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_WRITE),
  iconCtrl.seedBuiltinApplicationIcons,
);
router.post(
  "/apply-builtins",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_WRITE),
  iconCtrl.applyBuiltinPackIcons,
);
router.post(
  "/",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_WRITE),
  uploadSingleIcon,
  iconCtrl.uploadApplicationIcon,
);
// Image blobs are used by <img> tags without auth headers.
router.get("/:id/image", iconCtrl.getApplicationIconImage);
router.delete(
  "/:id",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_WRITE),
  iconCtrl.deleteApplicationIcon,
);

export default router;
