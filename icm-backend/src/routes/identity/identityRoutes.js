import { Router } from "express";
import multer from "multer";
import { authenticate, authorize, ROLES } from "../../middleware/auth.js";
import { AppError } from "../../middleware/errorHandler.js";
import {
  getIdentities,
  getIdentityById,
  createIdentity,
  updateIdentity,
  deleteIdentity,
  bulkImportIdentities,
  getIdentityAccounts,
  autoMapIdentity,
  getIdentitySchemaFields,
  getIdentityDepartments,
  deleteAllIdentities,
} from "../../controllers/identity/identityController.js";
import {
  getLinksForIdentity,
  manuallyLinkAccount,
  unlinkAccount,
  setIdentityAccountLinkActive,
} from "../../controllers/correlation/identityAccountLinkController.js";
// --- NEW IMPORT: Identity Mindmap Controller ---
import { getIdentityGraph } from "../../controllers/identity/identityMindmapController.js";
// --- Peer Access Comparison ---
import { peerComparison } from "../../controllers/identity/peerComparisonController.js";
// --- Identity Posture Dashboard
import { getIdentityPosture } from "../../controllers/identity/identityPostureController.js";
import {
  getIdentitySod,
  getIdentityCertifications,
  getIdentityHygiene,
  getIdentityPrivileges,
} from "../../controllers/identity/identityCatalogInsightsController.js";
import {
  getProfilePhotoImage,
  removeProfilePhoto,
  uploadProfilePhoto,
} from "../../controllers/identity/identityProfilePhotoController.js";
import { imageFileFilter } from "../../utils/uploadFilters.js";

const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

function uploadSingleProfilePhoto(req, res, next) {
  profilePhotoUpload.single("file")(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(
          new AppError(
            "Profile photo must be 2 MB or smaller",
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

const router = Router();

// Bulk & Mapping Routes (Must go above /:id)
router.post(
  "/bulk",
  authenticate,
  authorize(ROLES.ADMIN),
  bulkImportIdentities,
);
router.post("/auto-map", authenticate, authorize(ROLES.ADMIN), autoMapIdentity);
router.get("/meta/fields", authenticate, getIdentitySchemaFields);
router.get("/meta/departments", authenticate, getIdentityDepartments);
router.delete("/clear-all", authenticate, deleteAllIdentities);

// Core CRUD
router
  .route("/")
  .get(authenticate, getIdentities)
  .post(authenticate, authorize(ROLES.ADMIN), createIdentity);

// --- SPECIFIC ROUTES (Must come before generic /:id route) ---
// Identity Graph Explorer
router.get("/:id/graph", authenticate, getIdentityGraph);

// Peer Access Comparison
router.post("/:id/peer-comparison", authenticate, peerComparison);

// Identity Posture Dashboard
router.get("/:id/posture", authenticate, getIdentityPosture);

// Identity catalog insight tabs (SoD / Certifications / Data Hygiene)
router.get("/:id/sod", authenticate, getIdentitySod);
router.get("/:id/certifications", authenticate, getIdentityCertifications);
router.get("/:id/hygiene", authenticate, getIdentityHygiene);
router.get("/:id/privileges", authenticate, getIdentityPrivileges);

// Identity profile photo (stored in DB, shown on posture card)
router.get("/:id/profile-photo/image", authenticate, getProfilePhotoImage);
router.post(
  "/:id/profile-photo",
  authenticate,
  uploadSingleProfilePhoto,
  uploadProfilePhoto,
);
router.delete("/:id/profile-photo", authenticate, removeProfilePhoto);

// Dynamic Accounts Fetching
router
  .route("/:id/accounts")
  .get(authenticate, getLinksForIdentity) // Reads from the new Link table!
  .post(authenticate, authorize(ROLES.ADMIN), manuallyLinkAccount);

// Generic CRUD for /:id (Must come AFTER specific routes)
router
  .route("/:id")
  .get(authenticate, getIdentityById)
  .put(authenticate, authorize(ROLES.ADMIN), updateIdentity)
  .delete(authenticate, authorize(ROLES.ADMIN), deleteIdentity);

router.patch(
  "/accounts/links/:linkId",
  authenticate,
  authorize(ROLES.ADMIN),
  setIdentityAccountLinkActive,
);
router.delete(
  "/accounts/links/:linkId",
  authenticate,
  authorize(ROLES.ADMIN),
  unlinkAccount,
);

export default router;
