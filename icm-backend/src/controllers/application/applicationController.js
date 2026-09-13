import mongoose from "mongoose";
import Application from "../models/application/Application.js";
import { normalizeSecurityScanSettingsInput } from "../services/posture/postureFeatureSettings.js";
import { ensureDelimitedHrmsStubApplicationsOnce } from "../utils/ensureDelimitedHrmsStubs.js";
import User from "../models/platform/User.js";
import csv from "csv-parser";
import streamifier from "streamifier";
import { getDynamicUserModel, getDynamicUserModelForTenantId } from "../models/application/Users.js";
import { getDynamicEntitlementModel, getDynamicEntitlementModelForTenantId } from "../models/application/Entitlements.js";
import {
  getDeletionImpactSummary,
  executeScopedApplicationDeletion,
} from "../services/applicationDeletionService.js";
import {
  buildUserDocsFromMappedRowsWithStats,
} from "../services/delimitedApplicationUserSync.js";
import { ingestApplicationUsersWithReconciliation } from "../services/reconciliation/ingestWithReconciliation.js";
import { runCsvMappedReconciliation } from "../services/reconciliation/strategies/index.js";
import { runCsvImportEngine } from "../services/csvImport/csvImportEngine.js";
import { replaceApplicationEntitlementsFromRows } from "../services/applicationEntitlementIngestService.js";
import {
  validateUserMappings,
  validateEntitlementMappings,
  validateRequiredUserSchemaFields,
  validateUserCsvHeadersAgainstSchema,
  validateMappedUserCsvHeaders,
  validateEntitlementCsvHeadersAgainstSchema,
  buildUserMappingsFromDetectedHeaders,
  ensureUserMappingsFromCompleteSchema,
} from "../utils/applicationMappingValidation.js";
import {
  buildAccountStatusFilterClause,
  countApplicationUserStatuses,
} from "../services/applicationUserStatusCountsService.js";
import {
  parseIsPrivilegedQuery,
  buildPrivilegeOrClause,
  buildPrivilegeLevelClause,
  matchPrivilegedForApplication,
  mergeFilterAnd,
} from "../utils/privilegeMatchFilter.js";
import SodPolicy from "../models/sod/SodPolicy.js";
import SodViolation from "../models/sod/SodViolation.js";
import IdentityAccountLink from "../models/identity/IdentityAccountLink.js";
import Identity from "../models/identity/Identity.js";
import OrphanAccount from "../models/identity/OrphanAccount.js";
import ApplicationUserDuplicate from "../models/application/ApplicationUserDuplicate.js";
import DiscoveryResult from "../models/discovery/DiscoveryResult.js";
import { applicationIdInClause } from "../services/applicationUserIngestService.js";
import { countStaleApplicationUsers } from "../utils/applicationViewStaleAccounts.js";
import { countHighRiskAccountsForApplication } from "../utils/countHighRiskAccounts.js";
import { getAppCorrelationCollectionName } from "../utils/applicationDynamicCollections.js";
import { extractEntitlementTokensFromAppUser } from "../utils/sod/sodAppUserEntitlements.js";
import { isDerivedAdApplication } from "../services/adDerivedApplicationService.js";
import {
  resolveApplicationIconAssignment,
  applyAuthoritativeDefaultIcon,
  ensureApplicationAuthoritativeIcon,
  ensureAuthoritativeIconsForApplications,
  ensureBuiltinPackIconsForApplications,
} from "../services/application/applicationIconService.js";
import Papa from "papaparse";
import { DEFAULT_MAX_CSV_ROWS } from "../utils/csvUploadPerformance.js";
import Tenant from "../models/platform/Tenant.js";
import {
  getAppSchemaCollectionName,
  resolveTenantSlugFromTenantId,
  slugIgaSegment,
} from "../utils/applicationDynamicCollections.js";

/**
 * One flattened document: `primaryKey` + each `standardField` → mapped CSV header string.
 * Collection: `app_iga_<tenant>_<app>_schema` (see `getAppSchemaCollectionName`).
 */
export async function persistAppIgaUserImportSchemaDocument({
  application,
  mappings,
  importedAt,
  cfgPlain = {},
}) {
  const tenantSlug = await resolveTenantSlugFromTenantId(application.tenantId);
  const schemaCollection = getAppSchemaCollectionName(application.name, tenantSlug);
  const plain = (map) =>
    map && typeof map.toObject === "function" ? map.toObject() : { ...map };
  const displayModeSchema = String(cfgPlain.displayNameMode || "direct").toLowerCase();
  const dnA = String(cfgPlain.displayNameFirstColumn || "").trim();
  const dnB = String(cfgPlain.displayNameLastColumn || "").trim();
  const schemaDoc = {
    importedAt,
    applicationId: application._id,
    tenantId: application.tenantId,
  };
  for (const map of mappings || []) {
    const m = plain(map);
    const sf = String(m.standardField || "").trim();
    if (!sf) continue;
    const sl = sf.toLowerCase();
    let csvHeader = String(m.csvColumn || "").trim() || sf;
    if (sl === "display_name" && displayModeSchema === "first_last" && dnA && dnB) {
      csvHeader = `${dnA} + ${dnB}`;
    }
    if (m.isPrimaryKey) {
      schemaDoc.primaryKey = csvHeader;
      continue;
    }
    schemaDoc[sf] = csvHeader;
  }
  await mongoose.connection.db
    .collection(schemaCollection)
    .deleteMany({ applicationId: application._id });
  await mongoose.connection.db.collection(schemaCollection).insertOne(schemaDoc);
}

function isMongoDuplicateKeyError(err) {
  if (!err) return false;
  if (err.code === 11000 || err.code === 11001) return true;
  const m = String(err.message || err.errmsg || "");
  return m.includes("E11000") || m.includes("duplicate key");
}

/**
 * Map & import only: remove the entitlement *list* attribute from live user docs (`app_*_users`).
 * Values stay in `rawData`. (Handled inside CompiledCsvMapper for mapped upload.)
 */
function escapeMongoRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickFromRawData(raw, ...patterns) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of Object.keys(raw)) {
    const lk = key.toLowerCase();
    if (patterns.some((p) => lk.includes(String(p || "").toLowerCase()))) {
      const val = raw[key];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        return String(val).trim();
      }
    }
  }
  return "";
}

function normalizeLifecycleStatusValue(rawValue, sourceKey = "") {
  const key = String(sourceKey || "")
    .trim()
    .toLowerCase();
  const isNegativeFlagKey = [
    "accountdisabled",
    "disabled",
    "locked",
    "lockout",
    "terminationflag",
    "terminated",
    "isinactive",
  ].includes(key.replace(/[^a-z0-9]/g, ""));

  if (typeof rawValue === "boolean") {
    if (isNegativeFlagKey) return rawValue ? "INACTIVE" : "ACTIVE";
    return rawValue ? "ACTIVE" : "INACTIVE";
  }

  const raw = String(rawValue ?? "").trim();
  if (!raw) return "";
  const s = raw.toUpperCase().replace(/\s+/g, "_");

  if (
    [
      "TRUE",
      "YES",
      "Y",
      "1",
      "ON",
      "ENABLED",
      "OPEN",
      "CURRENT",
      "EMPLOYED",
    ].includes(s)
  ) {
    return isNegativeFlagKey ? "INACTIVE" : "ACTIVE";
  }
  if (["FALSE", "NO", "N", "0", "OFF", "DISABLED", "LOCKED"].includes(s)) {
    return isNegativeFlagKey ? "ACTIVE" : "INACTIVE";
  }
  if (
    s.includes("TERM") ||
    s.includes("RESIGN") ||
    s.includes("SEPARAT") ||
    s.includes("OFFBOARD") ||
    s.includes("EXIT")
  ) {
    return "TERMINATED";
  }
  if (s.includes("LEAV")) return "LEAVER";
  if (s.includes("MOVER") || s.includes("TRANSFER")) return "MOVER";
  if (
    s.includes("SUSPEND") ||
    s.includes("LOCK") ||
    s.includes("DISABL") ||
    s.includes("INACTIVE")
  ) {
    return "INACTIVE";
  }
  if (s.includes("NEW") || s.includes("ONBOARD") || s.includes("JOIN")) {
    return "NEW";
  }
  if (s.includes("ACTIVE") || s === "ACT") return "ACTIVE";

  return s;
}

function resolveUserLifecycleStatus(user) {
  const raw = user?.rawData || {};
  const statusCandidates = [
    ["status", user?.status ?? raw.status],
    ["user_status", user?.user_status ?? raw.user_status],
    ["account_status", user?.account_status ?? raw.account_status],
    ["profile_status", user?.profile_status ?? raw.profile_status],
    ["lifecycleState", user?.lifecycleState ?? raw.lifecycleState],
    ["lifecycle", user?.lifecycle ?? raw.lifecycle],
    ["state", user?.state ?? raw.state],
    ["isActive", user?.isActive ?? raw.isActive],
    ["active", user?.active ?? raw.active],
    ["enabled", user?.enabled ?? raw.enabled],
    ["accountDisabled", user?.accountDisabled ?? raw.accountDisabled],
    ["locked", user?.locked ?? raw.locked],
    ["useraccountcontrol", user?.useraccountcontrol ?? raw.useraccountcontrol],
    ["userAccountControl", user?.userAccountControl ?? raw.userAccountControl],
    [
      "user_account_control",
      user?.user_account_control ?? raw.user_account_control,
    ],
  ];

  const pickedStatus = pickFromRawData(
    raw,
    "status",
    "user_status",
    "account_status",
    "profile_status",
    "lifecycle",
    "lifecycle_state",
    "state",
    "is_active",
    "enabled",
    "account_disabled",
    "locked",
    "useraccountcontrol",
    "user_account_control",
  );
  if (pickedStatus != null && String(pickedStatus).trim() !== "") {
    const normalized = normalizeLifecycleStatusValue(pickedStatus, "status");
    if (normalized) return normalized;
  }

  for (const [k, v] of statusCandidates) {
    if (v == null || String(v).trim() === "") continue;
    const normalized = normalizeLifecycleStatusValue(v, k);
    if (normalized) return normalized;
  }

  return "UNKNOWN";
}

// FR-136
// 1. Create a new application
export const createApplication = async (req, res) => {
  try {
    const body = { ...req.body };
    if (Object.prototype.hasOwnProperty.call(body, "iconId")) {
      const assignment = await resolveApplicationIconAssignment(
        body.tenantId,
        body.iconId,
        body.color,
      );
      if (assignment) Object.assign(body, assignment);
    }
    const authIcon = await applyAuthoritativeDefaultIcon(body.tenantId, body);
    if (authIcon) Object.assign(body, authIcon);

    const newApplication = await Application.create(body);
    res.status(201).json({
      status: true,
      data: newApplication,
    });
  } catch (error) {
    const status = error.statusCode || 400;
    res.status(status).json({
      status: false,
      message: error.message,
    });
  }
};

// 2. Get all applications
export const getApplications = async (req, res) => {
  try {
    // Non-blocking stub ensure — do not await on hot path when already done
    const stubPromise = ensureDelimitedHrmsStubApplicationsOnce();

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 500);
    const skip = (page - 1) * limit;

    const query = {};
    if (
      req.query.tenantId &&
      mongoose.Types.ObjectId.isValid(req.query.tenantId)
    ) {
      query.tenantId = new mongoose.Types.ObjectId(req.query.tenantId);
    }

    const leanList = String(req.query.lean || "") === "1" || String(req.query.fields) === "registry";

    await stubPromise;

    let applications;
    let total;
    if (leanList) {
      [applications, total] = await Promise.all([
        Application.find(query)
          .select(
            "name description type status owner ownerEmail connectorType integrationType authoritativeSource icon iconId color totalUsers userMappings sourceApplicationId tenantId createdAt updatedAt lastManualCorrelation lastManualCorrelationAt",
          )
          .skip(skip)
          .limit(limit)
          .sort({ authoritativeSource: -1, name: 1 })
          .lean(),
        Application.countDocuments(query),
      ]);
      applications = await ensureAuthoritativeIconsForApplications(applications);
      applications = await ensureBuiltinPackIconsForApplications(applications);
    } else {
      [applications, total] = await Promise.all([
        Application.find(query)
          .skip(skip)
          .limit(limit)
          .populate("createdBy", "name email")
          .populate("tenantId", "name code"),
        Application.countDocuments(query),
      ]);
      applications = await ensureAuthoritativeIconsForApplications(applications);
      applications = await ensureBuiltinPackIconsForApplications(applications);
    }

    res.status(200).json({
      success: true,
      count: applications.length,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      data: applications,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// 3. Get a single application by ID
export const getApplicationById = async (req, res) => {
  try {
    // 1. Find the specific application by its ID and populate refs (tenant for Overview UI)
    const application = await Application.findById(req.params.id)
      .populate("createdBy", "name email")
      .populate("updatedBy", "name email")
      .populate("tenantId", "name code");

    //2. check if application exist
    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    const data = await ensureApplicationAuthoritativeIcon(application);

    // ensureApplicationAuthoritativeIcon may return a fresh doc without populates
    if (data && !data.tenantId?.name && typeof data.populate === "function") {
      await data.populate("tenantId", "name code");
    }

    // 3. Send the response
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    // 4. Handle errors (like an invalid ID format)
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

function normalizeAccountsTablePreferencesInput(prefs) {
  const columnOrder = Array.isArray(prefs?.columnOrder)
    ? prefs.columnOrder.map((k) => String(k || "").trim()).filter(Boolean).slice(0, 200)
    : [];
  const visibleColumns = Array.isArray(prefs?.visibleColumns)
    ? prefs.visibleColumns.map((k) => String(k || "").trim()).filter(Boolean).slice(0, 200)
    : [];
  return {
    columnOrder,
    visibleColumns,
    updatedAt: new Date(),
  };
}

/** UI-only: Current accounts table column order / visibility (does not touch schema, sync, or mappings). */
export const patchAccountsTablePreferences = async (req, res) => {
  try {
    const normalized = normalizeAccountsTablePreferencesInput(req.body);
    const updatedApp = await Application.findByIdAndUpdate(
      req.params.id,
      { accountsTablePreferences: normalized },
      { new: true, runValidators: true },
    ).select("accountsTablePreferences name");

    if (!updatedApp) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        accountsTablePreferences: updatedApp.accountsTablePreferences,
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/** Security scan thresholds (e.g. inactive users day count) for Security Center + AD sync scans. */
export const patchSecurityScanSettings = async (req, res) => {
  try {
    const normalized = normalizeSecurityScanSettingsInput(req.body);
    const updatedApp = await Application.findByIdAndUpdate(
      req.params.id,
      { securityScanSettings: normalized },
      { new: true, runValidators: true },
    ).select("securityScanSettings name");

    if (!updatedApp) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        securityScanSettings: updatedApp.securityScanSettings,
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// 4. Update an application by ID
const DERIVED_APP_INTEGRATION_FIELDS = [
  "integrationType",
  "connectorType",
  "autoUploadSchedule",
  "autoUploadTime",
  "authoritativeSource",
];

export const updateApplication = async (req, res) => {
  try {
    const existing = await Application.findById(req.params.id).lean();
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    const body = { ...req.body };

    if (isDerivedAdApplication(existing)) {
      for (const key of DERIVED_APP_INTEGRATION_FIELDS) {
        delete body[key];
      }
      if (body.connectionConfig !== undefined) {
        const preservedDerived = existing.connectionConfig?.derivedAd || {};
        const incomingDerived = body.connectionConfig?.derivedAd || {};
        body.connectionConfig = {
          derivedAd: { ...preservedDerived, ...incomingDerived },
        };
      }
    }

    if (body.userMappings !== undefined) {
      const v = validateUserMappings(body.userMappings);
      if (!v.ok) {
        return res.status(400).json({ success: false, message: v.message });
      }
      body.userMappings = v.normalized;
    }
    if (body.entitlementMappings !== undefined) {
      const v = validateEntitlementMappings(body.entitlementMappings);
      if (!v.ok) {
        return res.status(400).json({ success: false, message: v.message });
      }
      body.entitlementMappings = v.normalized;
    }
    if (body.accountsTablePreferences !== undefined) {
      body.accountsTablePreferences = normalizeAccountsTablePreferencesInput(
        body.accountsTablePreferences,
      );
    }

    if (Object.prototype.hasOwnProperty.call(body, "iconId")) {
      const tenantId = body.tenantId || existing.tenantId;
      const assignment = await resolveApplicationIconAssignment(
        tenantId,
        body.iconId,
        Object.prototype.hasOwnProperty.call(body, "color")
          ? body.color
          : undefined,
      );
      if (assignment) Object.assign(body, assignment);
    }

    const nextAuth =
      body.authoritativeSource !== undefined
        ? body.authoritativeSource
        : existing.authoritativeSource;
    const nextIconId =
      body.iconId !== undefined ? body.iconId : existing.iconId;
    const authIcon = await applyAuthoritativeDefaultIcon(
      body.tenantId || existing.tenantId,
      {
        authoritativeSource: nextAuth,
        iconId: nextIconId,
        color: body.color !== undefined ? body.color : existing.color,
      },
    );
    if (authIcon) Object.assign(body, authIcon);

    const updatedApp = await Application.findByIdAndUpdate(
      req.params.id,
      body,
      {
        new: true,
        runValidators: true,
      },
    );

    if (!updatedApp) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    res.status(200).json({
      success: true,
      data: updatedApp,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// 5. Delete an application by ID (and cascade delete its data)
export const deleteApplication = async (req, res) => {
  try {
    const application = await Application.findById(req.params.id);
    if (!application)
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });

    const UsersModel = await getDynamicUserModelForTenantId(application.name, application.tenantId);
    const EntitlementsModel = await getDynamicEntitlementModelForTenantId(application.name, application.tenantId);

    // Completely drop the isolated collections from MongoDB!
    try {
      await UsersModel.collection.drop();
    } catch (e) {
      /* Ignores error if collection is already empty/missing */
    }
    try {
      await EntitlementsModel.collection.drop();
    } catch (e) {}

    await Application.findByIdAndDelete(req.params.id);

    res
      .status(200)
      .json({
        success: true,
        message: "Application and dynamic collections deleted successfully",
      });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. Upload application data via CSV file (FR-139)
export const uploadApplicationData = async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });

    const application = await Application.findById(req.params.id);
    if (!application)
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });

    const dataType = req.body.dataType || "application_users";
    let mappings =
      dataType === "application_users"
        ? application.userMappings || []
        : application.entitlementMappings || [];

    if (mappings.length === 0) {
      const hint =
        dataType === "application_users"
          ? "Configure Application schema (users) first."
          : "Configure Entitlement schema in application details first.";
      return res.status(400).json({
        success: false,
        message: `No schema mapping found for ${dataType}. ${hint}`,
      });
    }

    const results = [];
    let rejectedForRowLimit = false;

    const uploadStream = streamifier
      .createReadStream(req.file.buffer)
      .pipe(csv());

    uploadStream
      .on("data", (data) => {
        if (rejectedForRowLimit) return;
        results.push(data);
        if (results.length > DEFAULT_MAX_CSV_ROWS) {
          rejectedForRowLimit = true;
          uploadStream.destroy();
          res.status(400).json({
            success: false,
            message: `CSV exceeds the maximum of ${DEFAULT_MAX_CSV_ROWS.toLocaleString()} rows — split the file and import in batches.`,
          });
        }
      })
      .on("end", async () => {
        if (rejectedForRowLimit) return;
        try {
          let documentsToInsert = [];
          let ingestSummary = null;
          if (dataType === "application_users") {
            const built = buildUserDocsFromMappedRowsWithStats(
              results,
              mappings,
              application._id,
            );
            documentsToInsert = built.documents;
            const { summary, reconciliation, runId } = await ingestApplicationUsersWithReconciliation(
              application,
              documentsToInsert,
              {
                source: "csv_upload_legacy",
                initialSkippedMissingPk: built.skippedMissingPk,
                uploadedFileName: req.file?.originalname,
                uploadedBy: req.user?._id,
              },
            );
            ingestSummary = { ...summary, reconciliation, runId };
          } else {
            const entitlementIngest = await replaceApplicationEntitlementsFromRows(
              application,
              results,
              mappings,
            );
            documentsToInsert = entitlementIngest.documentsToInsert;
          }

          if (dataType === "application_users") {
            res.status(200).json({
              success: true,
              message: `Successfully processed ${ingestSummary.liveRows} ${dataType}.`,
              totalRecords: ingestSummary.liveRows,
              summary: ingestSummary,
            });
            return;
          }

          res.status(200).json({
            success: true,
            message: `Successfully processed ${documentsToInsert.length} ${dataType}.`,
            totalRecords: documentsToInsert.length,
          });
        } catch (err) {
          console.error("Mapping error:", err);
          const msg = err?.message || "Error mapping data to database";
          res.status(isMongoDuplicateKeyError(err) ? 409 : 500).json({
            success: false,
            message: msg,
          });
        }
      });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to process file" });
  }
};

/**
 * Upload application users CSV: headers must match userMappings standardField set exactly (order-insensitive).
 */
export const uploadApplicationUsersCsvStrict = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const application = await Application.findById(req.params.id);
    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const mappings = application.userMappings || [];
    if (mappings.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No user schema (userMappings) defined. Configure Application schema first.",
      });
    }

    const text = req.file.buffer.toString("utf-8");
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) =>
        String(h || "")
          .replace(/^\uFEFF/, "")
          .trim(),
    });
    if ((parsed.data || []).length > DEFAULT_MAX_CSV_ROWS) {
      return res.status(400).json({
        success: false,
        message: `CSV exceeds the maximum of ${DEFAULT_MAX_CSV_ROWS.toLocaleString()} rows — split the file and import in batches.`,
      });
    }
    const fields = parsed.meta.fields || [];
    const headerCheck = validateUserCsvHeadersAgainstSchema(mappings, fields);
    if (!headerCheck.ok) {
      return res.status(400).json({
        success: false,
        message: headerCheck.message,
        missing: headerCheck.missing,
        extra: headerCheck.extra,
      });
    }

    const results = parsed.data || [];
    // Strict upload: CSV headers match technical names, so always read columns by standardField
    // (legacy userMappings may still have csvColumn aliases until the user saves Manual Setup).
    const plainMapping = (m) =>
      m && typeof m.toObject === "function" ? m.toObject() : { ...m };
    const mappingsForStrict = (mappings || []).map((m) => {
      const o = plainMapping(m);
      return { ...o, csvColumn: o.standardField };
    });
    const built = buildUserDocsFromMappedRowsWithStats(
      results,
      mappingsForStrict,
      application._id,
    );
    const { summary, reconciliation, runId } = await ingestApplicationUsersWithReconciliation(
      application,
      built.documents,
      {
        source: "csv_strict",
        initialSkippedMissingPk: built.skippedMissingPk,
        uploadedFileName: req.file?.originalname,
        uploadedBy: req.user?._id,
      },
    );

    // ── `app_iga_<tenant>_<app>_schema` (CSV header map) + mapped_users projection for certification ──
    // Strict uploads use standardField as both column and field name,
    // so schema doc maps each standardField to itself.
    try {
      const tenantSlugResolved = await resolveTenantSlugFromTenantId(
        application.tenantId,
      );
      if (!tenantSlugResolved) {
        throw new Error(
          `Cannot build mapped_users collection: could not resolve tenant slug for application "${application.name}". ` +
          `Ensure the Application has a valid tenantId and the Tenant document exists.`
        );
      }
      const tenantSeg = slugIgaSegment(tenantSlugResolved);
      const appSeg = slugIgaSegment(application.name || "app") || "app";
      const projectionCollection = `app_iga_${tenantSeg}_${appSeg}_mapped_users`;
      const importedAt = new Date();

      await persistAppIgaUserImportSchemaDocument({
        application,
        mappings,
        importedAt,
        cfgPlain: {},
      });

      // Build projection docs
      const UsersModel = await getDynamicUserModelForTenantId(
        application.name,
        application.tenantId,
      );
      const liveDocs = await UsersModel.find({
        applicationId: application._id,
      }).lean();
      const pkMap = mappings.find((m) => m.isPrimaryKey);
      const pkField = pkMap?.standardField
        ? String(pkMap.standardField).trim()
        : "";

      const projectionDocs = liveDocs.map((doc) => {
        const base = {
          primaryKey: pkField ? doc[pkField] : undefined,
          display_name: doc.display_name,
          status: doc.status,
          importedAt,
          applicationId: application._id,
          tenantId: application.tenantId,
        };
        for (const map of mappings) {
          const m = plainMapping(map);
          const sf = String(m.standardField || "").trim();
          if (!sf || m.isPrimaryKey) continue;
          if (sf === "display_name" || sf === "status") continue;
          const v = doc[sf];
          if (v !== undefined && v !== null && String(v).trim() !== "")
            base[sf] = v;
        }
        return base;
      });

      await mongoose.connection.db
        .collection(projectionCollection)
        .deleteMany({ applicationId: application._id });
      if (projectionDocs.length > 0) {
        await mongoose.connection.db
          .collection(projectionCollection)
          .insertMany(projectionDocs);
      }
    } catch (schemaErr) {
      console.warn(
        "[StrictUpload] Failed to generate schema/projection collections:",
        schemaErr.message,
      );
      // Non-fatal: upload itself succeeded
    }

    res.status(200).json({
      success: true,
      message: `Successfully processed ${summary.liveRows} application_users.`,
      totalRecords: summary.liveRows,
      summary: { ...summary, reconciliation, runId },
      reconciliation,
      runId,
    });
  } catch (error) {
    const msg = error?.message || "Failed to process file";
    res.status(isMongoDuplicateKeyError(error) ? 409 : 500).json({
      success: false,
      message: msg,
    });
  }
};

/**
 * Save CSV import mapping (Map & import).
 * Always writes csvImportMapping. Also ensures Application.userMappings is populated from
 * the *complete* detected schema when provided (`schemaMappings` or `detectedHeaders`),
 * without overwriting existing metadata with a reduced/partial field list.
 */
export const saveCsvImportMapping = async (req, res) => {
  try {
    const application = await Application.findById(req.params.id);
    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const {
      mappings,
      schemaMappings,
      detectedHeaders,
      displayNameMode,
      displayNameFirstColumn,
      displayNameLastColumn,
      displayNameFallbackFirstColumn,
      displayNameFallbackLastColumn,
      entitlementsStandardField,
    } = req.body || {};
    if (!Array.isArray(mappings)) {
      return res
        .status(400)
        .json({ success: false, message: "mappings must be an array" });
    }

    const v = validateUserMappings(mappings);
    if (!v.ok) {
      return res.status(400).json({ success: false, message: v.message });
    }

    const reqCheck = validateRequiredUserSchemaFields(v.normalized, {
      authoritative: Boolean(application.authoritativeSource),
    });
    if (!reqCheck.ok) {
      return res.status(400).json({
        success: false,
        message: reqCheck.message,
        missing: reqCheck.missing,
      });
    }

    const mode =
      String(displayNameMode || "direct").toLowerCase() === "first_last"
        ? "first_last"
        : "direct";
    application.csvImportMapping = {
      mappings: v.normalized,
      displayNameMode: mode,
      displayNameFirstColumn: String(displayNameFirstColumn || "").trim(),
      displayNameLastColumn: String(displayNameLastColumn || "").trim(),
      displayNameFallbackFirstColumn: String(displayNameFallbackFirstColumn || "").trim(),
      displayNameFallbackLastColumn: String(displayNameFallbackLastColumn || "").trim(),
      entitlementsStandardField: String(entitlementsStandardField || "").trim(),
    };

    // Complete detected schema (all CSV columns) — never the reduced import mapping alone.
    let completeSchema = null;
    if (Array.isArray(schemaMappings) && schemaMappings.length > 0) {
      completeSchema = schemaMappings;
    } else if (Array.isArray(detectedHeaders) && detectedHeaders.length > 0) {
      const pkFromImport =
        v.normalized.find((m) => m.isPrimaryKey)?.csvColumn ||
        v.normalized.find((m) => m.isPrimaryKey)?.standardField ||
        "";
      completeSchema = buildUserMappingsFromDetectedHeaders(detectedHeaders, {
        primaryKey: pkFromImport,
      });
    }

    if (completeSchema) {
      const ensured = ensureUserMappingsFromCompleteSchema(
        application.userMappings,
        completeSchema,
      );
      if (!ensured.ok) {
        return res.status(400).json({ success: false, message: ensured.message });
      }
      if (ensured.changed) {
        application.userMappings = ensured.userMappings;
      }
    }

    await application.save();

    res.status(200).json({ success: true, data: application });
  } catch (error) {
    res
      .status(400)
      .json({
        success: false,
        message: error.message || "Failed to save import mapping",
      });
  }
};

/**
 * Upload users CSV using saved csvImportMapping only (separate from userMappings strict upload).
 */
export const uploadApplicationUsersCsvMapped = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const application = await Application.findById(req.params.id);
    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const engineResult = await runCsvImportEngine(req.file.buffer, application, {
      originalname: req.file?.originalname,
    });

    const { summary, reconciliation, runId, stageTimings } =
      await runCsvMappedReconciliation(
        application,
        engineResult.documents,
        {
          source: "csv_mapped",
          userMappingsForPk: engineResult.mappings,
          initialSkippedMissingPk: engineResult.skippedMissingPk,
          uploadedFileName: req.file?.originalname,
          uploadedBy: req.user?._id,
          loadCanonicalDocs: false,
          skipFullReRead: true,
          skipDedupeScan: true,
        },
        engineResult.engineTimings,
      );

    // Backend guarantee: persist complete CSV header schema into userMappings when missing,
    // without replacing richer existing metadata with a partial list.
    try {
      const pkCsv =
        (engineResult.mappings || []).find((m) => m.isPrimaryKey)?.csvColumn ||
        (engineResult.mappings || []).find((m) => m.isPrimaryKey)?.standardField ||
        "";
      const completeSchema = buildUserMappingsFromDetectedHeaders(engineResult.fields, {
        primaryKey: pkCsv,
      });
      const ensured = ensureUserMappingsFromCompleteSchema(
        application.userMappings,
        completeSchema,
      );
      if (ensured.ok && ensured.changed) {
        application.userMappings = ensured.userMappings;
        await application.save();
      }
    } catch (umErr) {
      console.warn(
        "[MappedUpload] Failed to ensure Application.userMappings from CSV headers:",
        umErr.message,
      );
    }

    try {
      await persistAppIgaUserImportSchemaDocument({
        application,
        mappings: engineResult.mappings,
        importedAt: new Date(),
        cfgPlain: engineResult.cfgPlain,
      });
    } catch (schemaErr) {
      console.warn(
        "[MappedUpload] Failed to persist app_iga_*_schema collection:",
        schemaErr.message,
      );
    }

    res.status(200).json({
      success: true,
      message: `Successfully processed ${summary.liveRows} application_users (mapped import).`,
      totalRecords: summary.liveRows,
      summary: { ...summary, reconciliation, runId, stageTimings },
      reconciliation,
      runId,
    });
  } catch (error) {
    const status = error?.statusCode || (isMongoDuplicateKeyError(error) ? 409 : 500);
    const msg = error?.message || "Failed to process file";
    res.status(status).json({
      success: false,
      message: msg,
      ...(error?.details || {}),
    });
  }
};

/**
 * Entitlement CSV: headers must match entitlementMappings standardField set exactly (order-insensitive).
 */
export const uploadEntitlementsCsvStrict = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const application = await Application.findById(req.params.id);
    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const mappings = application.entitlementMappings || [];
    if (mappings.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No entitlement schema (entitlementMappings) defined. Configure Entitlement schema in application details first.",
      });
    }

    const text = req.file.buffer.toString("utf-8");
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) =>
        String(h || "")
          .replace(/^\uFEFF/, "")
          .trim(),
    });
    if ((parsed.data || []).length > DEFAULT_MAX_CSV_ROWS) {
      return res.status(400).json({
        success: false,
        message: `CSV exceeds the maximum of ${DEFAULT_MAX_CSV_ROWS.toLocaleString()} rows — split the file and import in batches.`,
      });
    }
    const fields = parsed.meta.fields || [];
    const headerCheck = validateEntitlementCsvHeadersAgainstSchema(
      mappings,
      fields,
    );
    if (!headerCheck.ok) {
      return res.status(400).json({
        success: false,
        message: headerCheck.message,
        missing: headerCheck.missing,
        extra: headerCheck.extra,
      });
    }

    const results = parsed.data || [];
    const entitlementIngest = await replaceApplicationEntitlementsFromRows(
      application,
      results,
      mappings,
    );

    res.status(200).json({
      success: true,
      message: `Successfully processed ${entitlementIngest.inserted} entitlements.`,
      totalRecords: entitlementIngest.inserted,
    });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: error.message || "Failed to process file",
      });
  }
};

// 7. Get users for a specific application (FR-140) — supports ?page=&limit= for large tenants
export const getApplicationUsers = async (req, res) => {
  try {
    const application = await Application.findById(req.params.id);
    if (!application)
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });

    const UsersModel = await getDynamicUserModelForTenantId(application.name, application.tenantId);

    const searchRaw =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const searchTerm =
      searchRaw.length > 200 ? searchRaw.slice(0, 200) : searchRaw;

    const baseFilter = { applicationId: req.params.id };
    const andParts = [];
    const accountStatusRaw = String(req.query.accountStatus || "").trim().toLowerCase();
    const statusClause = buildAccountStatusFilterClause(
      application,
      accountStatusRaw === "active" || accountStatusRaw === "inactive"
        ? accountStatusRaw
        : "",
    );
    if (statusClause) andParts.push(statusClause);

    if (searchTerm.length > 0) {
      const re = new RegExp(escapeMongoRegex(searchTerm), "i");
      const isAd =
        application.connectorType === "ACTIVE_DIRECTORY" ||
        application.connectionConfig?.ad;
      const keySet = new Set([
        "user_id",
        "employee_id",
        "username",
        "email",
        "display_name",
        "status",
        "department",
        "title",
        "manager_id",
        "telephone",
        "location",
        "user_type",
      ]);
      if (isAd) {
        for (const ldapField of [
          "sAMAccountName",
          "userPrincipalName",
          "mail",
          "displayName",
          "givenName",
          "sn",
          "department",
          "title",
          "memberOf",
          "userAccountControl",
          "manager",
          "telephoneNumber",
          "employeeNumber",
          "employeeID",
          "distinguishedName",
          "cn",
        ]) {
          keySet.add(`rawData.${ldapField}`);
        }
      }
      for (const m of application.userMappings || []) {
        const k = String(m.standardField || "").trim();
        if (k) keySet.add(k);
        const csv = String(m.csvColumn || "").trim();
        if (csv && csv !== k) {
          keySet.add(csv);
          if (isAd) keySet.add(`rawData.${csv}`);
        }
      }
      andParts.push({ $or: [...keySet].map((field) => ({ [field]: re })) });
    }

    const wantPrivileged = parseIsPrivilegedQuery(req.query.isPrivileged);
    if (wantPrivileged === true) {
      andParts.push(buildPrivilegeOrClause());
    } else if (wantPrivileged === false) {
      andParts.push({ $nor: [buildPrivilegeOrClause()] });
    }
    const levelClause = buildPrivilegeLevelClause(req.query.privilegeLevel);
    if (levelClause) andParts.push(levelClause);

    const filter = mergeFilterAnd(baseFilter, andParts);

    const rawPage = parseInt(String(req.query.page ?? "0"), 10);
    const rawLimit = parseInt(String(req.query.limit ?? "10"), 10);
    const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;
    const limit = Number.isFinite(rawLimit)
      ? Math.min(10000, Math.max(1, rawLimit))
      : 10;
    const skip = page * limit;

    const [users, total] = await Promise.all([
      UsersModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      UsersModel.countDocuments(filter),
    ]);

    // Merge rawData into the top-level user object so every original CSV column is accessible
    // by its exact header name. Schema-mapped top-level fields take precedence over rawData.
    const mergedUsers = users.map((u) => {
      const { rawData, ...rest } = u;
      if (rawData && typeof rawData === "object") {
        return { ...rawData, ...rest };
      }
      return rest;
    });

    // Best-effort identity-link enrichment for the current page only (bounded to page size).
    const identityByAccountId = new Map();
    const accountIdStrs = mergedUsers.map((u) => String(u._id)).filter(Boolean);
    if (accountIdStrs.length) {
      try {
        const links = await IdentityAccountLink.find({
          applicationId: req.params.id,
          accountId: { $in: accountIdStrs },
          isActive: true,
        })
          .select("accountId identityId")
          .lean();
        const identityIds = [...new Set(links.map((l) => String(l.identityId)).filter(Boolean))];
        if (identityIds.length) {
          const identities = await Identity.find({ _id: { $in: identityIds } })
            .select("displayName email")
            .lean();
          const identityMap = new Map(identities.map((i) => [String(i._id), i]));
          for (const link of links) {
            const identity = identityMap.get(String(link.identityId));
            if (identity) {
              identityByAccountId.set(String(link.accountId), {
                identityId: String(identity._id),
                identityName: identity.displayName,
              });
            }
          }
        }
      } catch {
        // Enrichment is best-effort — fall through without correlatedIdentity fields.
      }
    }

    const usersWithIdentity = mergedUsers.map((u) => {
      const link = identityByAccountId.get(String(u._id));
      return link
        ? { ...u, correlatedIdentityId: link.identityId, correlatedIdentityName: link.identityName }
        : u;
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    res.status(200).json({
      success: true,
      count: usersWithIdentity.length,
      total,
      page,
      limit,
      totalPages,
      data: usersWithIdentity,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 8. Get entitlements for a specific application (FR-141) — supports ?page=&limit= like /users
export const getApplicationEntitlements = async (req, res) => {
  try {
    const application = await Application.findById(req.params.id);
    if (!application)
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });

    const EntitlementsModel = await getDynamicEntitlementModelForTenantId(application.name, application.tenantId);
    const andParts = [];
    const searchRaw =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const searchTerm =
      searchRaw.length > 200 ? searchRaw.slice(0, 200) : searchRaw;
    if (searchTerm.length > 0) {
      const re = new RegExp(escapeMongoRegex(searchTerm), "i");
      andParts.push({
        $or: [
          { entitlement_name: re },
          { entitlement_id: re },
          { name: re },
          { description: re },
          { entitlementName: re },
          { entitlementId: re },
        ],
      });
    }
    const wantPrivileged = parseIsPrivilegedQuery(req.query.isPrivileged);
    if (wantPrivileged === true) {
      andParts.push(buildPrivilegeOrClause());
    } else if (wantPrivileged === false) {
      andParts.push({ $nor: [buildPrivilegeOrClause()] });
    }
    const levelClause = buildPrivilegeLevelClause(req.query.privilegeLevel);
    if (levelClause) andParts.push(levelClause);
    const entitlementTypeRaw =
      typeof req.query.entitlementType === "string" ? req.query.entitlementType.trim() : "";
    if (entitlementTypeRaw) {
      andParts.push({ entitlement_type: entitlementTypeRaw });
    }

    const filter = mergeFilterAnd({ applicationId: req.params.id }, andParts);

    const rawPage = parseInt(String(req.query.page ?? "0"), 10);
    const rawLimit = parseInt(String(req.query.limit ?? "10"), 10);
    const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;
    const limit = Number.isFinite(rawLimit)
      ? Math.min(10000, Math.max(1, rawLimit))
      : 10;
    const skip = page * limit;

    const [entitlements, total] = await Promise.all([
      EntitlementsModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      EntitlementsModel.countDocuments(filter),
    ]);

    // Merge raw CSV row into top-level so schema columns match import headers (same pattern as getApplicationUsers).
    const merged = entitlements.map((e) => {
      const { rawData, ...rest } = e;
      if (rawData && typeof rawData === "object") {
        return { ...rawData, ...rest };
      }
      return rest;
    });

    // Page-scoped assigned-user counts (correlation collection). Best-effort — omit the
    // column rather than fail the request when the app has no correlation collection.
    const assignedCountByEntId = new Map();
    if (merged.length && application.name) {
      try {
        const db = mongoose.connection.db;
        const corrColl = getAppCorrelationCollectionName(application.name);
        const entIds = merged
          .map((e) => e._id)
          .filter(Boolean)
          .map((id) =>
            (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id))),
          );
        const entIdStrs = entIds.map((id) => String(id));
        const agg = await db
          .collection(corrColl)
          .aggregate([
            {
              $match: {
                applicationId: applicationIdInClause(req.params.id),
                entitlementId: { $in: [...entIds, ...entIdStrs] },
              },
            },
            {
              $group: {
                _id: { $toString: "$entitlementId" },
                users: { $addToSet: "$userId" },
              },
            },
            { $project: { count: { $size: "$users" } } },
          ])
          .toArray();
        for (const row of agg || []) {
          assignedCountByEntId.set(String(row._id), Number(row.count) || 0);
        }
      } catch {
        // correlation collection may not exist for this app — assignedUsers stays null
      }
    }

    const mergedWithCounts = merged.map((e) => ({
      ...e,
      assignedUsers: assignedCountByEntId.has(String(e._id))
        ? assignedCountByEntId.get(String(e._id))
        : null,
    }));

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    res.status(200).json({
      success: true,
      count: mergedWithCounts.length,
      total,
      page,
      limit,
      totalPages,
      data: mergedWithCounts,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

function clampHealth(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

/** Live 0–100 health from the same counts the Application View header displays. */
function computeApplicationViewHealth(stats) {
  const users = Number(stats.users) || 0;
  const privUsers = Number(stats.privilegedUsers) || 0;
  const ents = Number(stats.entitlements) || 0;
  const privEnts = Number(stats.privilegedEntitlements) || 0;
  const sodOpen = Number(stats.openSodViolations) || 0;
  const orphans = Number(stats.openOrphans ?? stats.hygieneOpen) || 0;
  const correlated = Number(stats.correlatedLinks) || 0;
  const uncorrelated = Number(
    stats.uncorrelatedAccounts ?? Math.max(0, users - correlated),
  );
  const duplicates = Number(stats.duplicateAccounts) || 0;
  const stale = Number(stats.staleAccounts) || 0;

  const correlationRate = users > 0 ? correlated / users : correlated > 0 ? 1 : 0;
  const security = clampHealth(
    100
      - Math.min(40, sodOpen * 2.2)
      - Math.min(25, privUsers > 0 && users > 0 ? (privUsers / users) * 80 : 0)
      - Math.min(20, privEnts > 0 && ents > 0 ? (privEnts / Math.max(ents, 1)) * 60 : 0),
  );
  const correlation = clampHealth(Math.round(correlationRate * 100));
  const hygiene = clampHealth(
    100
      - Math.min(40, orphans * 1.5)
      - Math.min(25, users > 0 ? (uncorrelated / users) * 40 : 0)
      - Math.min(15, duplicates * 1.2)
      - Math.min(15, stale * 0.8),
  );
  const compliance = clampHealth(100 - Math.min(55, sodOpen * 2.5));
  const health = clampHealth(
    Math.round(security * 0.35 + correlation * 0.25 + hygiene * 0.25 + compliance * 0.15),
  );
  return {
    health,
    risk: clampHealth(100 - health),
    security: Math.round(security),
    correlation,
    hygiene: Math.round(hygiene),
    compliance: Math.round(compliance),
    correlationRate: Math.round(correlationRate * 100),
  };
}

/**
 * Overview tiles for Application View catalog — composed counts for one app.
 * GET /applications/:id/view-summary
 */
export const getApplicationViewSummary = async (req, res) => {
  try {
    const application = await Application.findById(req.params.id).lean();
    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const appOid = application._id;
    const UsersModel = await getDynamicUserModelForTenantId(
      application.name,
      application.tenantId,
    );
    const EntitlementsModel = await getDynamicEntitlementModelForTenantId(
      application.name,
      application.tenantId,
    );

    const baseUser = { applicationId: applicationIdInClause(appOid) };
    const baseEnt = { applicationId: applicationIdInClause(appOid) };
    const privUsers = {
      applicationId: applicationIdInClause(appOid),
      ...buildPrivilegeOrClause(),
    };
    const privEnts = {
      applicationId: applicationIdInClause(appOid),
      ...buildPrivilegeOrClause(),
    };

    const policyFilter = {
      $or: [
        { applications: appOid },
        ...(application.name
          ? [{ applicationNames: { $in: [application.name] } }]
          : []),
      ],
    };
    if (application.tenantId != null) {
      policyFilter.tenantId = String(application.tenantId);
    }

    const disabledStatusFilter = {
      ...baseUser,
      $or: [
        { status: { $regex: /^(inactive|disabled|locked)$/i } },
        { accountStatus: { $regex: /^(inactive|disabled|locked)$/i } },
        { enabled: false },
        { isActive: false },
      ],
    };

    const [
      users,
      privilegedUsers,
      statusCounts,
      entitlements,
      privilegedEntitlements,
      policies,
      correlatedLinks,
      openOrphans,
      topPrivilegedEnts,
      duplicateAccountGroups,
      staleResult,
      highRiskResult,
      discoveryConfirmedEntityIds,
      entitlementTypeAgg,
      serviceAccountsCount,
      userTypeTrackedCount,
    ] = await Promise.all([
      UsersModel.countDocuments(baseUser).catch(() => 0),
      UsersModel.countDocuments(privUsers).catch(() => 0),
      countApplicationUserStatuses(UsersModel, appOid, application).catch(() => ({
        active: 0,
        inactive: 0,
        unknown: 0,
        total: 0,
      })),
      EntitlementsModel.countDocuments(baseEnt).catch(() => 0),
      EntitlementsModel.countDocuments(privEnts).catch(() => 0),
      SodPolicy.find(policyFilter)
        .select("_id name severity openViolations totalViolations")
        .lean()
        .catch(() => []),
      IdentityAccountLink.countDocuments({
        applicationId: appOid,
        isActive: true,
        correlationStatus: "correlated",
      }).catch(() => 0),
      OrphanAccount.countDocuments({
        applicationId: appOid,
        status: "OPEN",
      }).catch(() => 0),
      EntitlementsModel.find(privEnts)
        .select("name displayName display_name entitlement_name entitlement_id entitlementName riskLevel memberCount assignedUsers count")
        .sort({ memberCount: -1, assignedUsers: -1, count: -1 })
        .limit(5)
        .lean()
        .catch(() => []),
      ApplicationUserDuplicate.countDocuments({
        applicationId: applicationIdInClause(appOid),
      }).catch(() => 0),
      countStaleApplicationUsers(UsersModel, appOid).catch(() => ({
        staleAccounts: 0,
        scanned: 0,
        staleDays: 90,
      })),
      countHighRiskAccountsForApplication({
        UsersModel,
        EntitlementsModel,
        applicationId: appOid,
        applicationName: application.name,
        tenantId: application.tenantId,
      }).catch(() => ({
        highRiskAccounts: 0,
        privilegedUsers: 0,
        privilegedEntitlementHolders: 0,
      })),
      DiscoveryResult.distinct("entityId", {
        applicationId: applicationIdInClause(appOid),
        entityType: "USER",
        reviewStatus: "confirmed",
      }).catch(() => []),
      EntitlementsModel.aggregate([
        { $match: baseEnt },
        {
          $group: {
            _id: { $ifNull: ["$entitlement_type", null] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]).catch(() => []),
      UsersModel.countDocuments({
        ...baseUser,
        user_type: { $regex: /service|svc|system|bot|automation|non.?human|nhi/i },
      }).catch(() => 0),
      UsersModel.countDocuments({
        ...baseUser,
        user_type: { $exists: true, $ne: null, $nin: ["", "N/A", "NA"] },
      }).catch(() => 0),
    ]);

    const inactiveUsers = Number(statusCounts?.inactive) || 0;
    const disabledUsersFallback = await UsersModel.countDocuments(disabledStatusFilter).catch(() => 0);
    const inactiveAccounts = inactiveUsers > 0 ? inactiveUsers : disabledUsersFallback;

    // Distinct Discovery "Mark Privileged" users (UI source of truth) — avoid duplicate result rows
    const discoveryConfirmedIds = Array.isArray(discoveryConfirmedEntityIds)
      ? discoveryConfirmedEntityIds.filter(Boolean).map((id) => String(id))
      : [];
    const discoveryConfirmedDistinct = new Set(discoveryConfirmedIds).size;

    // Privileged Users: prefer Discovery confirmed marks when present; else privilege flags on users
    const flaggedPrivileged = Math.max(
      Number(privilegedUsers) || 0,
      Number(highRiskResult?.privilegedUsers) || 0,
    );
    const privilegedUsersResolved =
      discoveryConfirmedDistinct > 0 ? discoveryConfirmedDistinct : flaggedPrivileged;

    const highRiskAccounts = Math.max(
      Number(highRiskResult?.highRiskAccounts) || 0,
      privilegedUsersResolved,
    );

    const policyIds = (policies || []).map((p) => p._id);
    let openSodViolations = 0;
    let policyExceptions = 0;
    let sodBySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    if (policyIds.length) {
      const [openCount, severityAgg, exceptionCount] = await Promise.all([
        SodViolation.countDocuments({
          policy: { $in: policyIds },
          status: "open",
        }).catch(() =>
          (policies || []).reduce((s, p) => s + (Number(p.openViolations) || 0), 0),
        ),
        SodViolation.aggregate([
          { $match: { policy: { $in: policyIds }, status: "open" } },
          {
            $group: {
              _id: { $toUpper: { $ifNull: ["$severity", "LOW"] } },
              count: { $sum: 1 },
            },
          },
        ]).catch(() => []),
        SodViolation.countDocuments({
          policy: { $in: policyIds },
          status: "exception_granted",
        }).catch(() => 0),
      ]);
      openSodViolations = openCount;
      policyExceptions = exceptionCount;
      for (const row of severityAgg || []) {
        const key = String(row._id || "LOW").toUpperCase();
        if (Object.prototype.hasOwnProperty.call(sodBySeverity, key)) {
          sodBySeverity[key] = row.count;
        } else if (key === "MODERATE") {
          sodBySeverity.MEDIUM += row.count;
        } else {
          sodBySeverity.LOW += row.count;
        }
      }
    }

    const hygieneOpen = openOrphans;
    const uncorrelatedAccounts = Math.max(0, Number(users) - Number(correlatedLinks));
    const topSodPolicies = [...(policies || [])]
      .sort((a, b) => (Number(b.openViolations) || 0) - (Number(a.openViolations) || 0))
      .slice(0, 5)
      .map((p) => ({
        _id: p._id,
        name: p.name,
        severity: p.severity || "MEDIUM",
        openViolations: Number(p.openViolations) || 0,
        totalViolations: Number(p.totalViolations) || 0,
        deepLink: `/governance/sod-policies/${p._id}`,
      }));

    // Assigned-user counts for top privileged entitlements (correlation + member_of scan)
    const assignedByEntId = new Map();
    const topPrivList = topPrivilegedEnts || [];
    if (topPrivList.length && application.name) {
      try {
        const db = mongoose.connection.db;
        const corrColl = getAppCorrelationCollectionName(application.name);
        const entIds = topPrivList
          .map((e) => e._id)
          .filter(Boolean)
          .map((id) =>
            (id instanceof mongoose.Types.ObjectId
              ? id
              : new mongoose.Types.ObjectId(String(id))),
          );
        const entIdStrs = entIds.map((id) => String(id));
        const agg = await db
          .collection(corrColl)
          .aggregate([
            {
              $match: {
                applicationId: applicationIdInClause(appOid),
                entitlementId: { $in: [...entIds, ...entIdStrs] },
              },
            },
            {
              $group: {
                _id: { $toString: "$entitlementId" },
                users: { $addToSet: "$userId" },
              },
            },
            { $project: { count: { $size: "$users" } } },
          ])
          .toArray();
        for (const row of agg || []) {
          assignedByEntId.set(String(row._id), Number(row.count) || 0);
        }
      } catch {
        // correlation collection may not exist for delimited apps
      }
    }

    // Fallback: scan member_of tokens when correlation has no rows for an entitlement
    const needsScan = topPrivList.some(
      (e) => !assignedByEntId.get(String(e._id)),
    );
    if (needsScan && topPrivList.length) {
      const tokenToEntIds = new Map();
      for (const e of topPrivList) {
        const tokens = [
          e.entitlement_name,
          e.entitlement_id,
          e.displayName,
          e.display_name,
          e.name,
          e.entitlementName,
          e._id != null ? String(e._id) : "",
        ]
          .map((t) => String(t || "").trim().toLowerCase())
          .filter(Boolean);
        for (const t of tokens) {
          if (!tokenToEntIds.has(t)) tokenToEntIds.set(t, new Set());
          tokenToEntIds.get(t).add(String(e._id));
        }
      }
      const holderSets = new Map(topPrivList.map((e) => [String(e._id), new Set()]));
      let scanned = 0;
      const cursor = UsersModel.find({ applicationId: applicationIdInClause(appOid) })
        .select("member_of_entitlements entitlements roles groups organization_role rawData")
        .lean()
        .cursor({ batchSize: 500 });
      for await (const user of cursor) {
        scanned += 1;
        const raw = user.rawData && typeof user.rawData === "object" ? user.rawData : {};
        const tokens = extractEntitlementTokensFromAppUser(user, raw);
        const uid = String(user._id);
        for (const tok of tokens) {
          const entIdsForTok = tokenToEntIds.get(String(tok).trim().toLowerCase());
          if (!entIdsForTok) continue;
          for (const eid of entIdsForTok) {
            if (!assignedByEntId.get(eid)) holderSets.get(eid)?.add(uid);
          }
        }
        if (scanned >= 50000) break;
      }
      for (const [eid, set] of holderSets) {
        if (!assignedByEntId.get(eid) && set.size) {
          assignedByEntId.set(eid, set.size);
        }
      }
    }

    const topPrivilegedEntitlements = topPrivList.map((e) => ({
      _id: e._id,
      name:
        e.displayName ||
        e.display_name ||
        e.entitlement_name ||
        e.name ||
        e.entitlementName ||
        "Entitlement",
      risk: e.riskLevel || "HIGH",
      assignedUsers:
        assignedByEntId.get(String(e._id)) ||
        Number(e.memberCount ?? e.assignedUsers ?? e.count) ||
        0,
    }));

    const staleAccounts = Number(staleResult?.staleAccounts) || 0;
    const duplicateAccounts = Number(duplicateAccountGroups) || 0;

    // Entitlements grouped by their real `entitlement_type` value — replaces the
    // fabricated Business/Technical Roles split (no "role" concept exists in this schema).
    const entitlementTypeRows = (entitlementTypeAgg || [])
      .map((r) => ({ type: r._id ? String(r._id) : null, count: Number(r.count) || 0 }))
      .filter((r) => r.type && r.count > 0)
      .sort((a, b) => b.count - a.count);
    const entitlementsByType = entitlementTypeRows.slice(0, 3);
    const otherTypeCount = entitlementTypeRows.slice(3).reduce((s, r) => s + r.count, 0);
    if (otherTypeCount > 0) entitlementsByType.push({ type: "Other", count: otherTypeCount });

    const scores = computeApplicationViewHealth({
      users,
      privilegedUsers: privilegedUsersResolved,
      entitlements,
      privilegedEntitlements,
      openSodViolations,
      openOrphans,
      hygieneOpen,
      correlatedLinks,
      uncorrelatedAccounts,
      duplicateAccounts,
      staleAccounts,
    });

    res.status(200).json({
      success: true,
      data: {
        applicationId: String(appOid),
        users,
        privilegedUsers: privilegedUsersResolved,
        inactiveUsers: inactiveAccounts,
        /** @deprecated use inactiveUsers — kept for older clients */
        disabledUsers: inactiveAccounts,
        entitlements,
        privilegedEntitlements,
        highRiskAccounts,
        privilegedEntitlementHolders: Number(highRiskResult?.privilegedEntitlementHolders) || 0,
        criticalPermissions: privilegedEntitlements,
        openSodViolations,
        policyExceptions,
        hygieneOpen,
        correlatedLinks,
        openOrphans,
        pendingCorrelation: openOrphans,
        uncorrelatedAccounts,
        duplicateAccounts,
        staleAccounts,
        staleDays: Number(staleResult?.staleDays) || 90,
        sodPolicies: (policies || []).length,
        sodBySeverity,
        topSodPolicies,
        topPrivilegedEntitlements,
        entitlementsByType,
        entitlementTypeCount: entitlementTypeRows.length,
        health: scores.health,
        risk: scores.risk,
        security: scores.security,
        correlationRate: scores.correlationRate,
        hygiene: scores.hygiene,
        compliance: scores.compliance,
        serviceAccounts: Number(serviceAccountsCount) || 0,
        serviceAccountsTracked: Number(userTypeTrackedCount) > 0,
        lastSyncedAt: application.lastSyncedAt || application.updatedAt || null,
        connectorType: application.connectorType || null,
        status: application.status || null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * SoD policies + open violations scoped to this application.
 * GET /applications/:id/sod
 */
export const getApplicationSod = async (req, res) => {
  try {
    const application = await Application.findById(req.params.id).lean();
    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const appOid = application._id;
    const policyFilter = {
      $or: [
        { applications: appOid },
        ...(application.name
          ? [{ applicationNames: { $in: [application.name] } }]
          : []),
      ],
    };
    if (application.tenantId != null) {
      policyFilter.tenantId = String(application.tenantId);
    }

    const policies = await SodPolicy.find(policyFilter)
      .sort({ updatedAt: -1 })
      .lean();
    const policyIds = policies.map((p) => p._id);
    const nameById = new Map(policies.map((p) => [String(p._id), p.name]));

    const violations = policyIds.length
      ? await SodViolation.find({
          policy: { $in: policyIds },
        })
          .sort({ detectedAt: -1 })
          .limit(200)
          .lean()
      : [];

    const enriched = violations.map((v) => ({
      ...v,
      policyName: v.policyName || nameById.get(String(v.policy)) || "Policy",
      deepLink: `/governance/sod-violations?policyId=${v.policy}`,
    }));

    const open = enriched.filter((v) => v.status === "open");
    const criticalHigh = open.filter((v) =>
      ["CRITICAL", "HIGH"].includes(String(v.severity || "").toUpperCase()),
    ).length;
    const exceptionCount = enriched.filter(
      (v) => v.status === "exception_granted",
    ).length;

    res.status(200).json({
      success: true,
      data: {
        applicationId: String(appOid),
        policies: policies.map((p) => ({
          _id: p._id,
          policyId: p.policyId,
          name: p.name,
          status: p.status,
          severity: p.severity,
          openViolations: p.openViolations || 0,
          totalViolations: p.totalViolations || 0,
          deepLink: `/governance/sod-policies/${p._id}`,
        })),
        violations: enriched,
        summary: {
          policyCount: policies.length,
          openCount: open.length,
          criticalHigh,
          exceptionCount,
          totalCount: enriched.length,
        },
        deepLink: "/governance/sod-violations",
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 9. Get dynamic schema fields for the frontend mapping wizard
export const getModelFields = async (req, res) => {
  try {
    const { type } = req.params;

    // Determine model by type
    let Model;
    if (type === "entitlements") {
      Model = getDynamicEntitlementModel("schema_reader");
    } else if (type === "identities") {
      const Identity = await import("../models/identity/Identity.js");
      Model = { schema: Identity.identitySchema };
    } else {
      Model = getDynamicUserModel("schema_reader");
    }

    const paths = Object.keys(Model.schema.paths);
    const excludedFields = [
      "_id",
      "__v",
      "createdAt",
      "updatedAt",
      "applicationId",
      "rawData",
    ];
    const availableFields = paths.filter((f) => !excludedFields.includes(f));

    console.log(
      "getModelFields:",
      type,
      availableFields.length,
      availableFields.slice(0, 20),
    );

    res.status(200).json({ success: true, data: availableFields });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get applications grouped by tenant (enterprise-optimized for certification wizard)
// Fetches user's tenantId from database since JWT doesn't include it
export const getApplicationsGroupedByTenant = async (req, res) => {
  try {
    const { tenantId: queryTenantId } = req.query;
    const jwtUser = req.user;

    // Fetch full user document to get tenantId (JWT doesn't include it)
    const currentUser = await User.findById(jwtUser?.id).lean();
    const isAdmin = ["admin", "superAdmin"].includes(
      currentUser?.role || jwtUser?.role,
    );
    const userTenantId = currentUser?.tenantId;

    // Build match stage based on user permissions
    const matchStage = {};

    if (!isAdmin && userTenantId) {
      // Non-admin users can only see their own tenant's applications
      matchStage.tenantId = new mongoose.Types.ObjectId(userTenantId);
    } else if (queryTenantId) {
      // Admin filtering by specific tenant
      matchStage.tenantId = new mongoose.Types.ObjectId(queryTenantId);
    }
    // Admin with no filter sees all tenants (no matchStage restriction)

    // Aggregation pipeline for efficient grouping
    const pipeline = [
      // Stage 1: Filter by tenant if needed
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),

      // Stage 2: Lookup tenant details
      {
        $lookup: {
          from: "tenants",
          localField: "tenantId",
          foreignField: "_id",
          as: "tenant",
        },
      },

      // Stage 3: Unwind tenant (preserving docs without tenant)
      {
        $unwind: {
          path: "$tenant",
          preserveNullAndEmptyArrays: true,
        },
      },

      // Stage 4: Project only needed fields (reduce payload size)
      {
        $project: {
          _id: 1,
          applicationName: "$name",
          appType: "$type",
          status: 1,
          riskLevel: 1,
          tenantId: 1,
          tenantName: { $ifNull: ["$tenant.name", "Unknown Tenant"] },
          tenantCode: { $ifNull: ["$tenant.code", ""] },
        },
      },

      // Stage 5: Sort applications by name within each group
      { $sort: { tenantName: 1, applicationName: 1 } },

      // Stage 6: Group by tenant
      {
        $group: {
          _id: "$tenantId",
          tenantId: { $first: "$tenantId" },
          tenantName: { $first: "$tenantName" },
          tenantCode: { $first: "$tenantCode" },
          applications: {
            $push: {
              appId: { $toString: "$_id" },
              applicationName: "$applicationName",
              appType: "$appType",
              status: "$status",
              riskLevel: "$riskLevel",
            },
          },
        },
      },

      // Stage 7: Sort groups by tenant name
      { $sort: { tenantName: 1 } },

      // Stage 8: Final projection
      {
        $project: {
          _id: 0,
          tenantId: { $toString: "$tenantId" },
          tenantName: 1,
          tenantCode: 1,
          applications: 1,
          appCount: { $size: "$applications" },
        },
      },
    ];

    const groups = await Application.aggregate(pipeline);

    // Calculate totals for response metadata
    const totalApps = groups.reduce((sum, g) => sum + g.appCount, 0);
    const totalTenants = groups.length;

    res.status(200).json({
      success: true,
      data: groups,
      meta: {
        totalApplications: totalApps,
        totalTenants: totalTenants,
        isAdmin,
        userTenantId: userTenantId ? String(userTenantId) : null,
        isFiltered: !!queryTenantId || !isAdmin,
      },
    });
  } catch (error) {
    console.error("Error in getApplicationsGroupedByTenant:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch grouped applications",
    });
  }
};

/** Lists MongoDB collections and counts for selective application cleanup. */
export const getApplicationDeletionImpact = async (req, res) => {
  try {
    const data = await getDeletionImpactSummary(req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    const code = error.statusCode === 404 ? 404 : 500;
    res.status(code).json({
      success: false,
      message: error.message || "Failed to load deletion impact",
    });
  }
};

/**
 * Deletes data for an application by scope. Body: { scopes: { [scopeKey]: boolean, applicationRecord?: boolean } }
 */
export const deleteApplicationScoped = async (req, res) => {
  try {
    const scopes =
      req.body?.scopes && typeof req.body.scopes === "object"
        ? req.body.scopes
        : {};
    const selected = Object.values(scopes).some(Boolean);
    if (!selected) {
      return res.status(400).json({
        success: false,
        message: "Select at least one scope or application record to delete.",
      });
    }
    const data = await executeScopedApplicationDeletion(req.params.id, scopes);
    res.status(200).json({ success: true, data });
  } catch (error) {
    const code = error.statusCode === 404 ? 404 : 500;
    res.status(code).json({
      success: false,
      message: error.message || "Scoped delete failed",
    });
  }
};

// 7b. Get active/inactive user counts for a specific application (aggregation; respects status → LDAP mapping)
export const getApplicationUserStatusCounts = async (req, res) => {
  try {
    const application = await Application.findById(req.params.id).select(
      "name tenantId connectorType connectionConfig userMappings csvImportMapping",
    );
    if (!application)
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });

    const UsersModel = await getDynamicUserModelForTenantId(
      application.name,
      application.tenantId,
    );

    const counts = await countApplicationUserStatuses(
      UsersModel,
      application._id,
      application,
    );

    return res.status(200).json({
      success: true,
      data: counts,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
