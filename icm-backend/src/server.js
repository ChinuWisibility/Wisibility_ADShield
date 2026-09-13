import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import mongoSanitize from "express-mongo-sanitize";
import path from "path";
import env from "./config/env.js";
import { connectDB } from "./config/database.js";
import { corsOptions } from "./config/cors.js";
import { mountSpaStatic } from "./config/spaStatic.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { auditTrail } from "./middleware/audit.js";
import { apiLimiter } from "./middleware/rateLimiter.js";
import { maintenanceModeGuard } from "./middleware/maintenanceMode.js";
import { seedDefaultAdmin } from "./services/auth/authService.js";
import { createLicenseManager } from "./licensing/index.js";
import { LicenseException } from "./licensing/exceptions/index.js";
import { MissingLicenseException } from "./licensing/exceptions/MissingLicenseException.js";
import {
  setLicenseManager,
  setLicenseRequiredMode,
  isLicenseRequiredMode,
  isProductLicensed,
  setOnLicenseActivated,
} from "./licensing/licenseRuntime.js";
import { runPendingMigrations } from "./services/migrations/migrationRunner.js";
import licenseRoutes from "./routes/license/licenseRoutes.js";
import systemRoutes from "./routes/system/systemRoutes.js";
import setupRoutes from "./routes/setup/setupRoutes.js";

// Routes
import authRoutes from "./routes/auth/authRoutes.js";
import applicationRoutes from "./routes/application/applicationRoutes.js";
import identityProfileRoutes from "./routes/identity/identityProfileRoutes.js";
import identityRoutes from "./routes/identity/identityRoutes.js";
import entitlementRoutes from "./routes/identity/entitlementRoutes.js";
import accountRoutes from "./routes/identity/accountRoutes.js";
import roleRoutes from "./routes/identity/roleRoutes.js";
import sodRoutes from "./routes/sod/sodRoutes.js";
import certificationRoutes from "./routes/access-certification/certificationRoutes.js";
import accessCertificationRoutes from "./routes/access-certification/accessCertificationRoutes.js";
import settingsRoutes from "./routes/org-admin/settingsRoutes.js";
import connectorRoutes from "./routes/connectors/connectorRoutes.js";
import connectionConfigRoutes from "./routes/connectors/connectionConfigRoutes.js";
import lifecycleRoutes from "./routes/lifecycle/lifecycleRoutes.js";
import provisioningRoutes from "./routes/provisioning/provisioningRoutes.js";
import accessIntelligenceRoutes from "./routes/governance/accessIntelligenceRoutes.js";
import complianceRoutes from "./routes/compliance/complianceRoutes.js";
import correlationRoutes from "./routes/correlation/correlationRoutes.js";
import dataHygieneRoutes from "./routes/datahygine/datahygine.js";
import detectionNhiRoutes from "./routes/governance/detectionNhiRoutes.js";
import discoveryRoutes from "./routes/discovery/discoveryRoutes.js";
import emailRoutes from "./routes/email/emailRoutes.js";
import governanceRoutes from "./routes/governance/governanceRoutes.js";
import governanceIntelligenceExportRoutes from "./routes/governance/governanceIntelligenceExportRoutes.js";
import reportRoutes from "./routes/report/reportRoutes.js";
import identityAdvancedRoutes from "./routes/identity/identityAdvancedRoutes.js";
import auditRoutes from "./routes/audit/auditRoutes.js";
import activityRoutes from "./routes/system/activityRoutes.js";
import tenantRoutes from "./routes/tenant/tenantRoutes.js";
import notificationRoutes from "./routes/notification/notificationRoutes.js";
import remediationRoutes from "./routes/remediation/remediationRoutes.js";
import remediationWorkflowRoutes from "./routes/remediation/remediationWorkflowRoutes.js";
import workflowRemediationRoutes from "./routes/workflowRemediation/workflowRemediationRoutes.js";
import workflowTaskQueueRoutes from "./routes/workflowTaskQueue/workflowTaskQueueRoutes.js";
import adRoutes from "./routes/ad/adRoutes.js";
import securityRoutes from "./routes/security/securityRoutes.js";
import adminRoutes from "./routes/org-admin/adminRoutes.js";
import orgAdminRoutes from "./routes/org-admin/orgAdminRoutes.js";
import brandingRoutes from "./routes/branding/brandingRoutes.js";
import logoRoutes from "./routes/branding/logoRoutes.js";
import applicationIconRoutes from "./routes/application/applicationIconRoutes.js";
import preferenceRoutes from "./routes/system/preferenceRoutes.js";
import dashboardWidgetRoutes from "./routes/system/dashboardWidgetRoutes.js";
import jobRoutes from "./routes/jobs/jobRoutes.js";
import hrmsIntegrationRoutes from "./routes/hrms/hrmsIntegrationRoutes.js";
import profileCertificationRoutes from "./routes/access-certification/profileCertificationRoutes.js";
import transformRoutes from "./routes/transform/transformRoutes.js";
import schemaRoutes from "./routes/application/schemaRoutes.js";
import HrmsIntegration from "./models/integrations/HrmsIntegration.js";
import { ensureLegacyHrmsNamesOnce } from "./controllers/hrms/hrmsIntegrationController.js";
import { startCertificationScheduler } from "./jobs/certificationScheduler.js";
import { startRemediationQueueScheduler } from "./jobs/remediationQueueScheduler.js";
import { startWorkflowRemediationEventScheduler } from "./jobs/workflowRemediationEventScheduler.js";
import { startRemediationReminderScheduler } from "./jobs/remediationReminderScheduler.js";
import { startSchedulerJob } from "./jobs/scheduler.job.js";
import { startEmailWorker } from "./services/email/emailWorkerService.js";
import { startHygieneWorker } from "./services/datahygine/hygieneWorker.js";
import { startItsmWaitWorker } from "./services/workflow/itsmWaitWorker.js";
import { startRemediationVerifyScheduler } from "./services/workflow/remediationVerifyScheduler.js";
import { startProvisioningWorker } from "./services/provisioning/provisioningWorker.js";
import { startLifecycleEventWorker } from "./services/lifecycle/lifecycleEventWorker.js";
import { backfillCertificationEmailTenantIds } from "./services/email/campaignReminderLogService.js";
import { seedWorkflowTemplates } from "./services/workflow/seedWorkflowTemplates.js";
import { initializeDeploymentAccess } from "./services/system/deploymentAccessService.js";
import {
  initializePlatformSettings,
  isMaintenanceEnforced,
  isMaintenanceForcedOff,
  startAuditRetentionScheduler,
} from "./services/system/platformSettingsService.js";
import { migratePostureScanResultsFromFilesystemOnce } from "./utils/migratePostureScanResultsFromFilesystem.js";
import PostureScanResult from "./models/security/PostureScanResult.js";
import "./models/sync/IdentitySyncState.js";

const app = express();

/**
 * Never use `trust proxy: true` — express-rate-limit rejects it (ERR_ERL_PERMISSIVE_TRUST_PROXY).
 * Use a hop count (e.g. 1 behind one nginx/ALB) so X-Forwarded-For is trusted only from that proxy.
 *
 * TRUST_PROXY: "false"/"0" → no trust. A number → trust that many hops. Unset: production → 1, else → false.
 */
function resolveTrustProxy() {
  const raw = process.env.TRUST_PROXY;
  if (raw === "false" || raw === "0") return false;
  if (raw !== undefined && raw !== "" && /^\d+$/.test(String(raw).trim())) {
    const n = parseInt(String(raw).trim(), 10);
    return n > 0 ? n : false;
  }
  if (process.env.NODE_ENV === "production") {
    return 1;
  }
  return false;
}

const trustProxy = resolveTrustProxy();
if (trustProxy !== false) {
  app.set("trust proxy", trustProxy);
}

// Core middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // allow frontend on different port to load images
    // Explicit CSP (was previously left at helmet's un-reviewed defaults —
    // WIS-026). Same effective policy as the default, plus worker-src for
    // Monaco Editor's web workers (TransformStudio) and img-src blob: for
    // client-generated previews. Deliberately keeps style-src 'unsafe-inline'
    // — MUI/emotion inject inline <style> tags at runtime; removing it would
    // require a nonce-based styling refactor across the whole frontend,
    // out of scope for this fix.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", "https:", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "https:", "'unsafe-inline'"],
        workerSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
  }),
);
app.use(cors(corsOptions));
app.use(compression());
// 100mb was excessive for JSON bodies — actual file uploads go through
// multer/multipart (with their own per-route limits), not this parser.
// 5mb comfortably covers any legitimate JSON payload (bulk ID arrays,
// schema mappings, etc.) while cutting the DoS-relevant ceiling 20x.
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
// Strips any $-prefixed or dot-containing keys from body/query/params so
// Mongo operators can't be smuggled in (defense-in-depth alongside the
// explicit scalar-type checks in crudFactory.js).
app.use(mongoSanitize({ replaceWith: "_" }));
app.use(morgan(env.isDev ? "dev" : "combined"));
app.use(apiLimiter);
app.use(auditTrail);

let databaseReady = false;
let serverReady = false;

function isLicenseExemptPath(reqPath) {
  if (reqPath === "/api/health" || reqPath === "/api/system/info") return true;
  if (reqPath.startsWith("/api/auth")) return true;
  if (reqPath.startsWith("/api/license")) return true;
  if (reqPath.startsWith("/api/setup")) return true;
  if (reqPath.startsWith("/api/system/diagnostics")) return true;
  if (reqPath.startsWith("/api/system/about")) return true;
  return false;
}

app.use((req, res, next) => {
  if (databaseReady || req.path === "/api/health") {
    return next();
  }
  if (req.path.startsWith("/api")) {
    return res.status(503).json({
      success: false,
      message: "API is connecting to the database, please retry shortly",
    });
  }
  next();
});

/** License-required minimal mode — block product APIs until a valid license is loaded. */
app.use((req, res, next) => {
  if (!isLicenseRequiredMode()) return next();
  if (!req.path.startsWith("/api")) return next();
  if (isLicenseExemptPath(req.path)) return next();
  return res.status(403).json({
    success: false,
    code: "LICENSE_REQUIRED",
    message: "A valid product license is required. Upload a license to unlock the product.",
  });
});

app.use(maintenanceModeGuard);

// Health check
app.get("/api/health", (req, res) => {
  if (!databaseReady) {
    return res.status(503).json({
      success: false,
      data: {
        status: "starting",
        timestamp: new Date().toISOString(),
        version: "2.0.0",
        environment: env.nodeEnv,
        databaseReady: false,
        backgroundInitComplete: false,
      },
    });
  }
  if (!serverReady) {
    return res.json({
      success: true,
      data: {
        status: "initializing",
        timestamp: new Date().toISOString(),
        version: "2.0.0",
        environment: env.nodeEnv,
        databaseReady: true,
        backgroundInitComplete: false,
      },
    });
  }
  res.json({
    success: true,
    data: {
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: env.version?.productVersion || "2.0.0",
      environment: env.nodeEnv,
      databaseReady: true,
      backgroundInitComplete: true,
      licensed: isProductLicensed(),
      licenseRequiredMode: isLicenseRequiredMode(),
    },
  });
});

// License + system + first-run setup (available in license-required minimal mode)
app.use("/api/license", licenseRoutes);
app.use("/api/system", systemRoutes);
app.use("/api/setup", setupRoutes);

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/identities", identityRoutes);
app.use("/api/identity-profiles", identityProfileRoutes);
app.use("/api/entitlements", entitlementRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/sod", sodRoutes);
app.use("/api/certifications", certificationRoutes);
app.use("/api/access-certification", accessCertificationRoutes);
app.use("/api/profile-certification", profileCertificationRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/connectors", connectorRoutes);
app.use("/api/connection-configs", connectionConfigRoutes);
app.use("/api/lifecycle", lifecycleRoutes);
app.use("/api/provisioning", provisioningRoutes);
app.use("/api/access-intelligence", accessIntelligenceRoutes);
app.use("/api/compliance", complianceRoutes);
app.use("/api/correlation", correlationRoutes);
app.use("/api/data-hygiene", dataHygieneRoutes);
app.use("/api/detection-nhi", detectionNhiRoutes);
app.use("/api/discovery", discoveryRoutes);
app.use("/api/ad", adRoutes);
app.use("/api/security", securityRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/governance", governanceRoutes);
app.use(
  "/api/reports/governance-intelligence",
  governanceIntelligenceExportRoutes,
);
app.use("/api/reports", reportRoutes);
app.use("/api/transforms", transformRoutes);
app.use("/api/schemas", schemaRoutes);
app.use("/api/identity", identityAdvancedRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/tenant", tenantRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/remediation", remediationRoutes);
app.use("/api/remediation-workflows", remediationWorkflowRoutes);
app.use("/api/workflow-remediation", workflowRemediationRoutes);
app.use("/api/workflow-task-queue", workflowTaskQueueRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/org-admin", orgAdminRoutes);
// Absolute uploads path (ProgramData in production)
const uploadsAbs = path.isAbsolute(env.upload.path)
  ? env.upload.path
  : path.resolve(env.paths?.packageRoot || process.cwd(), env.upload.path);
app.use(
  "/uploads",
  (req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(uploadsAbs),
);
app.use("/api/branding", brandingRoutes);
app.use("/api/logos", logoRoutes);
app.use("/api/application-icons", applicationIconRoutes);
app.use("/api/preferences", preferenceRoutes);
app.use("/api/dashboard", dashboardWidgetRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/integrations/hrms", hrmsIntegrationRoutes);

// Production SPA (after API routes). Dev keeps Vite proxy unless SERVE_SPA=true.
mountSpaStatic(app);

// Error handling
app.use(notFound);
app.use(errorHandler);

function listen() {
  return new Promise((resolve, reject) => {
    const server = app.listen(env.port, env.host, () => resolve(server));
    server.on("error", reject);
  });
}

async function start() {
  const licenseManager = createLicenseManager(env.license);
  setLicenseManager(licenseManager);

  try {
    await licenseManager.validate();
    setLicenseRequiredMode(false);
  } catch (err) {
    if (err instanceof MissingLicenseException || err instanceof LicenseException) {
      console.warn("[License] No valid license at boot — entering license-required minimal mode");
      console.warn(`[License] Reason: ${err.internalReason || err.message}`);
      setLicenseRequiredMode(true);
    } else {
      throw err;
    }
  }

  console.log("Connecting to MongoDB…");
  await connectDB();
  databaseReady = true;
  await initializeDeploymentAccess();
  const platformSettings = await initializePlatformSettings();
  if (platformSettings.maintenanceMode && isMaintenanceForcedOff()) {
    console.warn(
      "[maintenance] BREAK-GLASS OVERRIDE ACTIVE: maintenance is ON but MAINTENANCE_MODE_FORCE_OFF=true disables enforcement.",
    );
  } else if (platformSettings.maintenanceMode && !isMaintenanceEnforced()) {
    console.warn(
      "[maintenance] Maintenance mode is ON but not enforced outside production. Set MAINTENANCE_MODE_ENFORCE=true to test it.",
    );
  }
  startAuditRetentionScheduler();

  try {
    const mig = await runPendingMigrations();
    if (mig.applied?.length) {
      console.log(`[migrations] Applied: ${mig.applied.join(", ")}`);
    }
  } catch (e) {
    console.error("[migrations] Failed — refusing to become ready:", e?.message || e);
    throw e;
  }

  await listen();
  console.log(`IGA API listening on http://${env.host}:${env.port}`);
  console.log(`Config source: ${env.configSource}`);

  try {
    await ensureLegacyHrmsNamesOnce();
    await HrmsIntegration.syncIndexes();
  } catch (e) {
    console.warn("HrmsIntegration migration/indexes:", e?.message || e);
  }
  try {
    await migratePostureScanResultsFromFilesystemOnce();
    await PostureScanResult.syncIndexes();
  } catch (e) {
    console.warn("PostureScanResult migration/indexes:", e?.message || e);
  }
  try {
    const { ensureBuiltInSecurityPolicies } = await import(
      "./services/security/securityPolicyService.js"
    );
    await ensureBuiltInSecurityPolicies();
  } catch (e) {
    console.warn("Security policy seed:", e?.message || e);
  }
  if (env.setupMode) {
    console.log("[auth] setupMode enabled — skipping seedDefaultAdmin (installer bootstrap)");
  } else {
    await seedDefaultAdmin();
  }

  serverReady = true;
  console.log(`IGA API ready on http://${env.host}:${env.port}`);
  console.log(`Environment: ${env.nodeEnv}`);
  console.log(
    isProductLicensed()
      ? "[License] Product licensed"
      : "[License] LICENSE_REQUIRED mode — upload a license to unlock APIs",
  );

  if (isLicenseRequiredMode()) {
    console.log("[server] Skipping background workers until license is activated");
    setOnLicenseActivated(async () => {
      console.log("[server] License activated — starting background workers");
      await seedWorkflowTemplates();
      startCertificationScheduler();
      if (env.legacyRemediationEnabled) {
        startRemediationQueueScheduler();
        startWorkflowRemediationEventScheduler();
        startRemediationReminderScheduler();
        startRemediationVerifyScheduler();
        const { startOrphanIamReminderScheduler } = await import(
          "./services/workflow/orphanIamReminderScheduler.js"
        );
        startOrphanIamReminderScheduler();
        const { startWorkflowRemediationItsmPoller } = await import(
          "./services/workflowRemediation/workflowRemediationItsmPoller.js"
        );
        startWorkflowRemediationItsmPoller();
        startItsmWaitWorker();
        startProvisioningWorker();
      }
      // JML lifecycle durable worker — independent of remediation feature flag
      startLifecycleEventWorker();
      if (!env.legacyRemediationEnabled) {
        startProvisioningWorker();
      }
      startSchedulerJob();
      startEmailWorker();
      startHygieneWorker();
    });
    return;
  }

  await seedWorkflowTemplates();
  startCertificationScheduler();
  if (env.legacyRemediationEnabled) {
    startRemediationQueueScheduler();
    startWorkflowRemediationEventScheduler();
    startRemediationReminderScheduler();
    startRemediationVerifyScheduler();
    const { startOrphanIamReminderScheduler } = await import(
      "./services/workflow/orphanIamReminderScheduler.js"
    );
    startOrphanIamReminderScheduler();
    const { startWorkflowRemediationItsmPoller } = await import(
      "./services/workflowRemediation/workflowRemediationItsmPoller.js"
    );
    startWorkflowRemediationItsmPoller();
    startItsmWaitWorker();
    startProvisioningWorker();
  } else {
    console.log("[server] Legacy remediation schedulers disabled (LEGACY_REMEDIATION_ENABLED=false)");
  }
  // JML lifecycle durable worker — independent of remediation feature flag
  startLifecycleEventWorker();
  // Provisioning worker self-gates on PROVISIONING_WORKER_ENABLED
  if (!env.legacyRemediationEnabled) {
    startProvisioningWorker();
  }
  startSchedulerJob();
  backfillCertificationEmailTenantIds().catch((err) =>
    console.warn("[CertEmail] tenantId backfill skipped:", err.message),
  );
  startEmailWorker();
  startHygieneWorker();
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

export default app;
