import { Router } from "express";
import multer from "multer";
import { csvFileFilter } from "../utils/uploadFilters.js";
import {
  authenticate,
  requirePermission,
  PERMISSIONS,
} from "../middleware/auth.js";
import Application from "../models/application/Application.js";
import ApplicationType from "../models/application/ApplicationType.js";
import UploadHistory from "../models/application/UploadHistory.js";
import { getDynamicIdentityModelForTenantId } from "../models/identity/Identity.js";
import Entitlement from "../models/access/Entitlement.js";
import Account from "../models/access/Account.js";
import ApplicationRiskProfile from "../models/application/ApplicationRiskProfile.js";
import IntegrationLog from "../models/application/IntegrationLog.js";
import { createCrudController } from "../utils/crudFactory.js";
import { AppError } from "../middleware/errorHandler.js";
import { getDB } from "../config/database.js";
import express from "express";
import { getDynamicUserModelForTenantId } from "../models/application/Users.js";
import { getDynamicEntitlementModelForTenantId } from "../models/application/Entitlements.js";
import {
  getApplications,
  getApplicationById,
  createApplication,
  updateApplication,
  deleteApplication,
  uploadApplicationData,
  uploadApplicationUsersCsvStrict,
  saveCsvImportMapping,
  uploadApplicationUsersCsvMapped,
  uploadEntitlementsCsvStrict,
  getApplicationUsers,
  getApplicationEntitlements,
  getApplicationUserStatusCounts,
  getApplicationViewSummary,
  getApplicationSod,
  getModelFields,
  getApplicationsGroupedByTenant,
  getApplicationDeletionImpact,
  deleteApplicationScoped,
  patchAccountsTablePreferences,
  patchSecurityScanSettings,
} from "../controllers/applicationController.js";
import {
  testAdConnection,
  testCreateAdUser,
  syncAdUsersFromAd,
  getAdSyncJobStatus,
} from "../controllers/adConnectorController.js";
import {
  getApplicationPostureScan,
  listApplicationPostureScans,
  listPostureFeatures,
  runApplicationPostureScan,
  validatePostureCustomFeatures,
} from "../controllers/postureController.js";
import reconciliationRoutes from "./reconciliationRoutes.js";
import {
  getConnectorCatalog,
  testUniversalConnection,
  syncUniversalConnector,
} from "../controllers/universalConnectorController.js";
import {
  executeCorrelation,
  getCorrelationResults,
  getCorrelationEntitlementUsers,
  executeManagerCorrelation,
  getManagerCorrelationFacets,
  getManagerCorrelationGroups,
  getManagerCorrelationGroupUsers,
  getManagerCorrelationJobStatus,
} from "../controllers/appCorrelationController.js";
import {
  listApplicationUserDuplicates,
  getApplicationUserDuplicateById,
} from "../controllers/applicationUserDuplicateController.js";
import { getApplicationCertifications } from "../controllers/applicationCatalogController.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: csvFileFilter,
});
/** Map & import only — larger CSVs (50k/100k). Other upload routes keep 10MB. */
const uploadMapped = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: csvFileFilter,
});
const typeCtrl = createCrudController(ApplicationType, {
  searchFields: ["name"],
});
const riskProfileCtrl = createCrudController(ApplicationRiskProfile, {
  searchFields: ["dataClassification"],
});
const integrationLogCtrl = createCrudController(IntegrationLog, {
  searchFields: ["operation", "status"],
});

// --- NEW: Dynamic Schema Route ---
// Put this ABOVE the /:id routes!
router.get("/meta/fields/:type", authenticate, getModelFields);

// Stats/types were previously registered after /:id (line ~311 historically),
// where Express's /:id route silently swallowed them (id="stats"/"types").
// Moved here, before /:id, so they're actually reachable.
router.get("/stats", authenticate, async (req, res, next) => {
  try {
    const [total, active, highRisk, byType] = await Promise.all([
      Application.countDocuments(),
      Application.countDocuments({ status: "active" }),
      Application.countDocuments({ riskLevel: { $in: ["HIGH", "CRITICAL"] } }),
      Application.aggregate([{ $group: { _id: "$type", count: { $sum: 1 } } }]),
    ]);
    res.json({ success: true, data: { total, active, highRisk, byType } });
  } catch (err) {
    next(err);
  }
});
router.get("/types", authenticate, typeCtrl.list);
router.post(
  "/types",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_TYPE_MANAGE),
  typeCtrl.create,
);

// --- NEW: Grouped Applications by Tenant (for certification wizard) ---
// Enterprise-optimized endpoint with aggregation pipeline
router.get("/grouped-by-tenant", authenticate, getApplicationsGroupedByTenant);

// Universal connector catalog + test + sync (before generic `/:id` routes)
router.get("/connectors/catalog", authenticate, getConnectorCatalog);
router.post("/connectors/test", authenticate, testUniversalConnection);
router.post("/:id/connectors/sync", authenticate, syncUniversalConnector);

// Active Directory (LDAP) connector — must be before generic `/:id` routes
router.post("/ad/test-connection", authenticate, testAdConnection);
router.post(
  "/:id/ad/test-create-user",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_WRITE),
  testCreateAdUser,
);
router.post("/:id/ad/sync", authenticate, syncAdUsersFromAd);
router.get("/:id/ad-sync-jobs/:jobId", authenticate, getAdSyncJobStatus);
router.get("/:id/posture/features", authenticate, listPostureFeatures);
router.post("/:id/posture/validate-custom-features", authenticate, validatePostureCustomFeatures);
router.post("/:id/posture/scan", authenticate, runApplicationPostureScan);
router.get("/:id/posture/scans", authenticate, listApplicationPostureScans);
router.get("/:id/posture/scans/:scanId", authenticate, getApplicationPostureScan);

// Scoped delete: dependency map + selective cleanup (before generic /:id CRUD)
router.get(
  "/:id/deletion-impact",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_WRITE),
  getApplicationDeletionImpact,
);
router.post(
  "/:id/delete-scoped",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_WRITE),
  deleteApplicationScoped,
);

//Application Controller Routes Started
// Routes that don't need a specific ID
router
  .route("/")
  .get(authenticate, getApplications) // FR-134: List all
  .post(authenticate, requirePermission(PERMISSIONS.APPLICATION_WRITE), createApplication); // FR-136: Create new

// Static path segments MUST be registered before `/:id` or Express treats them as ObjectIds.
router.get("/risk-profiles", authenticate, riskProfileCtrl.list);
router.get("/risk-profiles/:id", authenticate, riskProfileCtrl.getById);
router.post(
  "/risk-profiles",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_RISK_PROFILE_MANAGE),
  riskProfileCtrl.create,
);
router.put(
  "/risk-profiles/:id",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_RISK_PROFILE_MANAGE),
  riskProfileCtrl.update,
);
router.delete(
  "/risk-profiles/:id",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_RISK_PROFILE_MANAGE),
  riskProfileCtrl.remove,
);

router.get("/integration-logs", authenticate, integrationLogCtrl.list);
router.get("/integration-logs/:id", authenticate, integrationLogCtrl.getById);
router.post(
  "/integration-logs",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_INTEGRATION_LOG_MANAGE),
  integrationLogCtrl.create,
);
router.put(
  "/integration-logs/:id",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_INTEGRATION_LOG_MANAGE),
  integrationLogCtrl.update,
);
router.delete(
  "/integration-logs/:id",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_INTEGRATION_LOG_MANAGE),
  integrationLogCtrl.remove,
);

// Routes that DO need a specific ID
router
  .route("/:id")
  .get(authenticate, getApplicationById) // FR-135: Get details
  .put(authenticate, requirePermission(PERMISSIONS.APPLICATION_WRITE), updateApplication) // FR-137: Update
  .delete(authenticate, requirePermission(PERMISSIONS.APPLICATION_WRITE), deleteApplication); // FR-138: Delete

// --- NEW DATA INGESTION ROUTES ---

// FR-139: Upload CSV File. (upload.single('file') intercepts the incoming file)
router.post(
  "/:id/upload",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_WRITE),
  upload.single("file"),
  uploadApplicationData,
);

/** User CSV: headers must match userMappings technical names exactly (Application schema tab). */
router.post(
  "/:id/users/upload-strict",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_WRITE),
  upload.single("file"),
  uploadApplicationUsersCsvStrict,
);

/** Save Map & import mapping; also ensures userMappings from complete detected schema when provided. */
router.put(
  "/:id/csv-import-mapping",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_WRITE),
  saveCsvImportMapping,
);

/** UI-only Current accounts table column layout (order + visibility). */
router.patch(
  "/:id/accounts-table-preferences",
  authenticate,
  patchAccountsTablePreferences,
);

/** Per-application security scan thresholds (Security Center). */
router.patch(
  "/:id/security-scan-settings",
  authenticate,
  patchSecurityScanSettings,
);

/** User CSV using saved csvImportMapping (column aliases allowed). */
router.post(
  "/:id/users/upload-mapped",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_WRITE),
  uploadMapped.single("file"),
  uploadApplicationUsersCsvMapped,
);

/** Entitlement CSV: headers must match entitlementMappings technical names exactly. */
router.post(
  "/:id/entitlements/upload-strict",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_WRITE),
  upload.single("file"),
  uploadEntitlementsCsvStrict,
);

// Reconciliation history & delta audit
router.use("/:id/reconciliation", reconciliationRoutes);

// FR-140: Get App Users
router.get("/:id/users", authenticate, getApplicationUsers);

// FR-140b: Get App User Status Counts
router.get("/:id/users/status-counts", authenticate, getApplicationUserStatusCounts);

/** Application View catalog: overview tile counts */
router.get("/:id/view-summary", authenticate, getApplicationViewSummary);

/** Application View catalog: SoD policies + violations for this app */
router.get("/:id/sod", authenticate, getApplicationSod);

/** Application View catalog: certification campaigns + review items for this app */
router.get("/:id/certifications", authenticate, getApplicationCertifications);

/** Duplicate application-user PK groups (ingest sidecar). */
router.get(
  "/:id/user-duplicates",
  authenticate,
  listApplicationUserDuplicates,
);
router.get(
  "/:id/user-duplicates/:groupId",
  authenticate,
  getApplicationUserDuplicateById,
);

// FR-141: Get App Entitlements
router.get("/:id/entitlements", authenticate, getApplicationEntitlements);

// --- NEW: Dynamic Correlation Engine Routes ---
// --- NEW: Dynamic Correlation Engine Routes ---
router.post("/:id/execute-correlation", authenticate, executeCorrelation);
router.get(
  "/:id/correlations/entitlement-users",
  authenticate,
  getCorrelationEntitlementUsers,
);
router.get("/:id/correlations", authenticate, getCorrelationResults);
router.get(
  "/:id/correlations/manager-facets",
  authenticate,
  getManagerCorrelationFacets,
);
router.get(
  "/:id/correlations/manager-groups",
  authenticate,
  getManagerCorrelationGroups,
);
router.get(
  "/:id/correlations/manager-group-users",
  authenticate,
  getManagerCorrelationGroupUsers,
);
// --- Manager correlation: async job status (poll after 202 from execute-manager-correlation) ---
router.get(
  "/:id/manager-correlation-jobs/:jobId",
  authenticate,
  getManagerCorrelationJobStatus,
);
// --- NEW: Manager Correlation Engine ---
router.post(
  "/:id/execute-manager-correlation",
  authenticate,
  executeManagerCorrelation,
);
//Application Controller Routes Ended.

// Risk & Compliance
router.put(
  "/:id/risk",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_RISK_WRITE),
  async (req, res, next) => {
    try {
      const { riskLevel, riskJustification } = req.body;
      const app = await Application.findByIdAndUpdate(
        req.params.id,
        { riskLevel, riskJustification, updatedBy: req.user.id },
        { new: true },
      );
      if (!app) throw new AppError("Application not found", 404);
      res.json({ success: true, data: app });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/:id/compliance",
  authenticate,
  requirePermission(PERMISSIONS.APPLICATION_COMPLIANCE_WRITE),
  async (req, res, next) => {
    try {
      const { complianceFrameworks } = req.body;
      const app = await Application.findByIdAndUpdate(
        req.params.id,
        { complianceFrameworks, updatedBy: req.user.id },
        { new: true },
      );
      if (!app) throw new AppError("Application not found", 404);
      res.json({ success: true, data: app });
    } catch (err) {
      next(err);
    }
  },
);

// Get application dashboard (users, entitlements, accounts counts)
router.get("/:id/dashboard", authenticate, async (req, res, next) => {
  try {
    const appId = req.params.id;
    const app = await Application.findById(appId);
    if (!app) throw new AppError("Application not found", 404);
    const Identity = await getDynamicIdentityModelForTenantId(app.tenantId);
    const [users, entitlements, accounts, uploads] = await Promise.all([
      Identity.countDocuments({ sourceApplication: appId }),
      Entitlement.countDocuments({ application: appId }),
      Account.countDocuments({ application: appId }),
      UploadHistory.find({ applicationId: appId })
        .sort({ createdAt: -1 })
        .limit(5),
    ]);
    res.json({
      success: true,
      data: {
        application: app,
        stats: { users, entitlements, accounts },
        recentUploads: uploads,
      },
    });
  } catch (err) {
    next(err);
  }
});

// CSV Upload (legacy route — kept for backward compatibility; now uses proper app_iga_<tenant>_<app>_* naming)
router.post(
  "/:id/upload",
  authenticate,
  upload.single("file"),
  async (req, res, next) => {
    try {
      const Papa = await import("papaparse");
      const appId = req.params.id;
      const app = await Application.findById(appId);
      if (!app) throw new AppError("Application not found", 404);

      const csvText = req.file.buffer.toString("utf-8");
      const parsed = Papa.default.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
      });

      const uploadType = req.body.uploadType || "users";
      const history = await UploadHistory.create({
        applicationId: appId,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        uploadType,
        status: "processing",
        totalRows: parsed.data.length,
        uploadedBy: req.user.id,
        columnMappings: req.body.columnMappings
          ? JSON.parse(req.body.columnMappings)
          : null,
      });

      // Resolve proper app_iga_<tenant>_<app>_* collection via the same helper used everywhere else.
      let DynamicModel;
      if (uploadType === "entitlements") {
        DynamicModel = await getDynamicEntitlementModelForTenantId(app.name, app.tenantId);
      } else {
        DynamicModel = await getDynamicUserModelForTenantId(app.name, app.tenantId);
      }
      const collectionName = DynamicModel.collection.name;

      // Process rows
      let processedRows = 0;
      const errors = [];
      const db = getDB();

      for (let i = 0; i < parsed.data.length; i++) {
        try {
          const row = parsed.data[i];
          // Mask sensitive fields
          Object.keys(row).forEach((k) => {
            if (/password|secret|token/i.test(k)) row[k] = "[PROTECTED]";
          });
          row._uploadId = history._id;
          row._applicationId = appId;
          row._uploadedAt = new Date();
          await db.collection(collectionName).insertOne(row);
          processedRows++;
        } catch (err) {
          errors.push({ row: i + 1, message: err.message });
        }
      }

      // Update stats
      history.processedRows = processedRows;
      history.failedRows = errors.length;
      history.errors = errors.slice(0, 100);
      history.status =
        errors.length === parsed.data.length
          ? "failed"
          : errors.length > 0
            ? "partial"
            : "completed";
      history.completedAt = new Date();
      await history.save();

      // Update app stats
      app.lastUpload = new Date();
      app.totalUsers = await db.collection(collectionName).countDocuments();
      await app.save();

      res.json({
        success: true,
        data: { upload: history, collection: collectionName },
      });
    } catch (err) {
      next(err);
    }
  },
);


// Upload history
router.get("/:id/uploads", authenticate, async (req, res, next) => {
  try {
    const uploads = await UploadHistory.find({ applicationId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("uploadedBy", "firstName lastName email");
    res.json({ success: true, data: uploads });
  } catch (err) {
    next(err);
  }
});

export default router;
