import mongoose from "mongoose";
import Application from "../models/application/Application.js";
import AdSuggestionSnapshot from "../models/application/AdSuggestionSnapshot.js";
import { getDynamicEntitlementModelForTenantId } from "../models/application/Entitlements.js";
import { getScopedTenantId } from "../middleware/auth.js";
import { normalizeDn } from "../services/ldapNormalizer.js";
import {
  fetchAdDirectory,
  normalizeAdConfig,
} from "../services/adLdapService.js";
import {
  buildDerivedAdConnectionConfig,
  cloneAdSchemaFieldsFromSource,
  syncDerivedApplicationFromAdDirectory,
  syncInheritedMetadataFromSource,
} from "../services/adDerivedApplicationService.js";
import {
  buildAdSuggestions,
  computeCacheMetadata,
  deserializeGroupToUsers,
  getAllAppNames,
  normalizeDirectoryGroups,
  paginateArray,
  serializeGroupToUsers,
  enrichSuggestionsForDisplay,
  sortSuggestionsForDisplay,
  stripGroupsFromSuggestions,
} from "../services/adSuggestionBuildService.js";
import {
  evaluateRuleSet,
  toRuleEvaluationEntity,
} from "../services/adSuggestionRuleEngine.js";

function trimString(value) {
  return String(value || "").trim();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTags(tags) {
  const raw = Array.isArray(tags) ? tags : trimString(tags).split(",");
  const seen = new Set();
  return raw
    .map((tag) => trimString(tag))
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeSelectedGroup(group, index) {
  const dn = trimString(group?.dn);
  const name = trimString(group?.name) || dn;
  if (!dn && !name) {
    throw new Error(`selectedGroups[${index}] must include dn or name`);
  }
  const memberCountRaw = Number(group?.memberCount);
  return {
    dn,
    name,
    memberCount:
      Number.isFinite(memberCountRaw) && memberCountRaw >= 0
        ? memberCountRaw
        : 0,
  };
}

function normalizeRequestedApplication(app, index) {
  const detectedAppName = trimString(app?.detectedAppName);
  const customName = trimString(app?.customName);
  const applicationName = customName || detectedAppName;
  if (!applicationName) {
    throw new Error(
      `applications[${index}] must include detectedAppName or customName`,
    );
  }
  if (!Array.isArray(app?.selectedGroups) || app.selectedGroups.length === 0) {
    throw new Error(
      `applications[${index}].selectedGroups must be a non-empty array`,
    );
  }

  const seenGroups = new Set();
  const selectedGroups = app.selectedGroups
    .map((group, groupIndex) => normalizeSelectedGroup(group, groupIndex))
    .filter((group) => {
      const key = trimString(group.dn || group.name).toLowerCase();
      if (!key || seenGroups.has(key)) return false;
      seenGroups.add(key);
      return true;
    });

  if (!selectedGroups.length) {
    throw new Error(
      `applications[${index}].selectedGroups must contain at least one valid group`,
    );
  }

  return {
    detectedAppName: detectedAppName || applicationName,
    customName: applicationName,
    tags: normalizeTags(app?.tags),
    selectedGroups,
  };
}

function resolveMemberCount(group, groupToUsers, fallbackCount = 0) {
  const resolvedUsers = groupToUsers?.get(normalizeDn(group?.groupDN));
  if (Array.isArray(resolvedUsers) && resolvedUsers.length) {
    return resolvedUsers.length;
  }
  if (Array.isArray(group?.members) && group.members.length) {
    return group.members.filter(Boolean).length;
  }
  return Number.isFinite(Number(fallbackCount)) ? Number(fallbackCount) : 0;
}

function buildDirectoryGroupIndex(groups) {
  const byDn = new Map();
  const byName = new Map();
  for (const group of groups || []) {
    const dnKey = normalizeDn(group?.groupDN);
    if (dnKey && !byDn.has(dnKey)) byDn.set(dnKey, group);
    const nameKey = trimString(group?.groupName).toLowerCase();
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, group);
  }
  return { byDn, byName };
}

function resolveSelectedAdGroup(selectedGroup, groupIndex, groupToUsers) {
  const byDn = groupIndex?.byDn || new Map();
  const byName = groupIndex?.byName || new Map();
  const match =
    byDn.get(normalizeDn(selectedGroup?.dn)) ||
    byName.get(trimString(selectedGroup?.name).toLowerCase()) ||
    null;

  return {
    groupName:
      trimString(match?.groupName) ||
      trimString(selectedGroup?.name) ||
      trimString(selectedGroup?.dn),
    groupDN: trimString(match?.groupDN) || trimString(selectedGroup?.dn),
    description: trimString(match?.description),
    members: Array.isArray(match?.members) ? match.members.filter(Boolean) : [],
    objectSid: trimString(match?.objectSid),
    memberCount: resolveMemberCount(
      match || selectedGroup,
      groupToUsers,
      selectedGroup?.memberCount,
    ),
    _raw: {
      selectedMemberCount: Number(selectedGroup?.memberCount) || 0,
    },
  };
}

async function resolveAdSourceApplication(req, applicationId) {
  if (!applicationId || !mongoose.Types.ObjectId.isValid(String(applicationId))) {
    return {
      error: {
        status: 400,
        body: { success: false, message: "Valid applicationId is required" },
      },
    };
  }

  const appOid = new mongoose.Types.ObjectId(String(applicationId));
  const application = await Application.findById(appOid)
    .select("name tenantId connectionConfig connectorType")
    .lean();

  if (!application) {
    return {
      error: {
        status: 404,
        body: { success: false, message: "Application not found" },
      },
    };
  }

  const scopedTenantId = getScopedTenantId(req.user);
  if (
    scopedTenantId &&
    String(application.tenantId || "") !== String(scopedTenantId)
  ) {
    return {
      error: {
        status: 403,
        body: { success: false, message: "Application not in tenant scope" },
      },
    };
  }

  const storedAdConfig =
    application.connectionConfig &&
    typeof application.connectionConfig === "object"
      ? application.connectionConfig.ad
      : null;

  if (!storedAdConfig || typeof storedAdConfig !== "object") {
    return {
      error: {
        status: 400,
        body: {
          success: false,
          message:
            "Active Directory configuration not found on this application.",
        },
      },
    };
  }

  const cfg = normalizeAdConfig(storedAdConfig);
  if (!cfg.url || !cfg.bindDn || !cfg.baseDn) {
    return {
      error: {
        status: 400,
        body: {
          success: false,
          message:
            "Incomplete AD configuration. Save LDAP URL, base DN, and bind DN on the application first.",
        },
      },
    };
  }

  return { application, appOid, cfg };
}

async function loadSnapshotForApplication(application, appOid) {
  return AdSuggestionSnapshot.findOne({
    tenantId: application.tenantId,
    sourceApplicationId: appOid,
  }).lean();
}

async function persistBuiltSuggestions({
  tenantId,
  sourceApplicationId,
  normalizedGroups,
  groupToUsers,
  ruleDefinitions,
  metadata = {},
}) {
  const built = buildAdSuggestions(normalizedGroups, groupToUsers, {
    ruleDefinitions,
  });
  const generatedAt = new Date();

  return AdSuggestionSnapshot.findOneAndUpdate(
    { tenantId, sourceApplicationId },
    {
      $set: {
        status: "ready",
        refreshError: "",
        generatedAt,
        totalGroups: normalizedGroups.length,
        totalSuggestions: built.suggestions.length,
        suggestions: built.suggestions,
        metadata: {
          groupingMode: built.groupingMode,
          ruleDefinitions: built.ruleDefinitions,
          normalizedGroups,
          groupToUsersEntries: serializeGroupToUsers(groupToUsers),
          ...metadata,
        },
      },
    },
    { upsert: true, new: true },
  ).lean();
}

export async function getSuggestedApps(req, res) {
  try {
    const resolved = await resolveAdSourceApplication(req, req.query?.applicationId);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const { application, appOid } = resolved;
    const page = Math.max(1, parseInt(String(req.query?.page ?? "1"), 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(String(req.query?.pageSize ?? "10"), 10) || 10),
    );
    const includeGroups = String(req.query?.includeGroups || "").toLowerCase() === "true";

    const snapshot = await loadSnapshotForApplication(application, appOid);

    if (!snapshot) {
      return res.status(200).json({
        success: true,
        data: [],
        cache: {
          status: "refresh_required",
          generatedAt: null,
          ageMs: null,
          isStale: true,
          totalGroups: 0,
          totalSuggestions: 0,
        },
        pagination: { page, pageSize, total: 0, totalPages: 0 },
        allAppNames: [],
        message: "Analyzing Active Directory groups.",
      });
    }

    const cache = computeCacheMetadata(snapshot);

    if (snapshot.status === "refreshing") {
      return res.status(200).json({
        success: true,
        data: [],
        cache,
        pagination: { page, pageSize, total: 0, totalPages: 0 },
        allAppNames: getAllAppNames(snapshot.suggestions),
        message: "AD suggestions refresh is in progress.",
      });
    }

    if (snapshot.status === "failed" && !(snapshot.suggestions || []).length) {
      return res.status(200).json({
        success: true,
        data: [],
        cache,
        pagination: { page, pageSize, total: 0, totalPages: 0 },
        allAppNames: [],
        message:
          snapshot.refreshError ||
          "Last AD suggestions refresh failed. Retry refresh.",
      });
    }

    const ruleDefinitions =
      snapshot.metadata?.ruleDefinitions ||
      application.connectionConfig?.ad?.suggestionRuleDefinitions ||
      [];
    const orderedSuggestions = sortSuggestionsForDisplay(
      enrichSuggestionsForDisplay(snapshot.suggestions || [], ruleDefinitions),
    );
    const { data, pagination } = paginateArray(orderedSuggestions, page, pageSize);
    const payload = includeGroups ? data : stripGroupsFromSuggestions(data);

    return res.status(200).json({
      success: true,
      data: payload,
      cache,
      pagination,
      allAppNames: getAllAppNames(snapshot.suggestions),
    });
  } catch (error) {
    console.error("[getSuggestedApps]", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to load AD app suggestions.",
    });
  }
}

export async function getSuggestedAppGroups(req, res) {
  try {
    const resolved = await resolveAdSourceApplication(req, req.query?.applicationId);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const appName = trimString(req.query?.appName);
    if (!appName) {
      return res.status(400).json({
        success: false,
        message: "appName is required",
      });
    }

    const { application, appOid } = resolved;
    const page = Math.max(1, parseInt(String(req.query?.page ?? "1"), 10) || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(String(req.query?.pageSize ?? "25"), 10) || 25),
    );

    const snapshot = await loadSnapshotForApplication(application, appOid);
    if (!snapshot || snapshot.status !== "ready") {
      return res.status(409).json({
        success: false,
        message: "Cached AD suggestions are not ready. Refresh suggestions first.",
      });
    }

    const suggestion = (snapshot.suggestions || []).find(
      (entry) =>
        String(entry?.appName || "").trim().toLowerCase() === appName.toLowerCase(),
    );

    if (!suggestion) {
      return res.status(404).json({
        success: false,
        message: `No suggestion cluster found for app name: ${appName}`,
      });
    }

    const { data: groups, pagination } = paginateArray(
      suggestion.groups || [],
      page,
      pageSize,
    );

    return res.status(200).json({
      success: true,
      data: {
        appName: suggestion.appName,
        groups,
        groupCount: suggestion.groupCount,
        userCount: suggestion.userCount,
      },
      pagination,
      cache: computeCacheMetadata(snapshot),
    });
  } catch (error) {
    console.error("[getSuggestedAppGroups]", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to load suggestion groups.",
    });
  }
}

export async function refreshSuggestions(req, res) {
  const startedAt = Date.now();
  let appOid;
  let tenantId;

  try {
    const applicationId = req.body?.applicationId || req.query?.applicationId;
    const resolved = await resolveAdSourceApplication(req, applicationId);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const { application, appOid: resolvedAppOid, cfg } = resolved;
    appOid = resolvedAppOid;
    tenantId = application.tenantId;

    const existing = await AdSuggestionSnapshot.findOne({
      tenantId,
      sourceApplicationId: appOid,
    })
      .select("status")
      .lean();

    if (existing?.status === "refreshing") {
      return res.status(409).json({
        success: false,
        message: "AD suggestions refresh is already in progress.",
      });
    }

    await AdSuggestionSnapshot.findOneAndUpdate(
      { tenantId, sourceApplicationId: appOid },
      {
        $set: {
          status: "refreshing",
          refreshError: "",
          generatedAt: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const directory = await fetchAdDirectory(cfg, {
      maxUsers: cfg.maxUsers,
      maxGroups: cfg.maxGroups,
      maxComputers: 0,
      syncGroups: true,
    });

    const normalizedGroups = normalizeDirectoryGroups(directory?.groups);
    const adConfig = application.connectionConfig?.ad || {};
    const ruleDefinitions = adConfig.suggestionRuleDefinitions;
    const snapshot = await persistBuiltSuggestions({
      tenantId,
      sourceApplicationId: appOid,
      normalizedGroups,
      groupToUsers: directory?.membership?.groupToUsers,
      ruleDefinitions,
      metadata: {
        ldapDurationMs: Date.now() - startedAt,
        refreshedBy: req.user?.id || null,
      },
    });

    return res.status(200).json({
      success: true,
      message: "AD suggestions refreshed successfully.",
      cache: computeCacheMetadata(snapshot),
      totalGroups: snapshot.totalGroups,
      totalSuggestions: snapshot.totalSuggestions,
    });
  } catch (error) {
    console.error("[refreshSuggestions]", error);
    if (appOid && tenantId) {
      await AdSuggestionSnapshot.findOneAndUpdate(
        { tenantId, sourceApplicationId: appOid },
        {
          $set: {
            status: "failed",
            refreshError: error?.message || "Failed to refresh AD suggestions.",
          },
        },
        { upsert: true },
      );
    }
    return res.status(502).json({
      success: false,
      message: error?.message || "Failed to refresh AD suggestions.",
    });
  }
}

function uiRuleDefinitionToRuleSet(rule) {
  if (!rule || typeof rule !== "object") return null;
  if (rule.ruleSet && typeof rule.ruleSet === "object") return rule.ruleSet;

  const steps = Array.isArray(rule.steps) ? rule.steps : [];
  return {
    stepLogic: String(rule.stepLogic || "OR").toUpperCase(),
    steps: steps.map((step) => ({
      fieldLogic: String(step?.fieldLogic || "OR").toUpperCase(),
      fields: (step?.fieldConditions || step?.fields || []).map((field) => ({
        fieldName: String(field?.fieldName || field?.field || "groupName").trim(),
        fieldLogic: String(field?.fieldLogic || field?.conditionLogic || "OR").toUpperCase(),
        conditions: (field?.conditions || [])
          .map((condition) => ({
            operator: String(condition?.operator || "contains"),
            value: String(condition?.value ?? ""),
            caseSensitive: Boolean(condition?.caseSensitive),
          }))
          .filter((condition) => condition.value),
      })),
    })),
  };
}

function resolveMemberCountForPreview(group, groupToUsers) {
  const dn = normalizeDn(group?.groupDN);
  const users = groupToUsers?.get?.(dn);
  if (Array.isArray(users) && users.length) return users.length;
  if (Array.isArray(group?.members) && group.members.length) {
    return group.members.filter(Boolean).length;
  }
  return 0;
}

/**
 * POST /ad/preview-group-matches — live match count + sample groups (no save).
 */
export async function previewGroupRuleMatches(req, res) {
  try {
    const applicationId = req.body?.applicationId || req.query?.applicationId;
    const resolved = await resolveAdSourceApplication(req, applicationId);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const { application, appOid } = resolved;
    const snapshot = await loadSnapshotForApplication(application, appOid);
    const normalizedGroups = snapshot?.metadata?.normalizedGroups;

    if (
      !snapshot ||
      snapshot.status !== "ready" ||
      !Array.isArray(normalizedGroups) ||
      !normalizedGroups.length
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Scan Active Directory first to preview which groups match this rule.",
      });
    }

    const ruleSet = uiRuleDefinitionToRuleSet(req.body?.rule);
    if (!ruleSet?.steps?.length) {
      return res.status(400).json({
        success: false,
        message: "A matching rule with at least one condition is required.",
      });
    }

    const groupToUsers = deserializeGroupToUsers(
      snapshot.metadata?.groupToUsersEntries,
    );
    const previewLimit = Math.min(
      8,
      Math.max(1, parseInt(String(req.body?.sampleLimit ?? "5"), 10) || 5),
    );

    let matchCount = 0;
    const samples = [];

    for (const group of normalizedGroups) {
      const entity = toRuleEvaluationEntity(group);
      const { passed } = evaluateRuleSet(entity, ruleSet);
      if (!passed) continue;
      matchCount += 1;
      if (samples.length < previewLimit) {
        samples.push({
          name: entity.groupName || group.groupName,
          dn: entity.dn || group.groupDN,
          memberCount: resolveMemberCountForPreview(group, groupToUsers),
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        matchCount,
        samples,
        totalGroupsScanned: normalizedGroups.length,
      },
    });
  } catch (error) {
    console.error("[previewGroupRuleMatches]", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to preview group matches.",
    });
  }
}

export async function recomputeSuggestions(req, res) {
  try {
    const applicationId = req.body?.applicationId || req.query?.applicationId;
    const resolved = await resolveAdSourceApplication(req, applicationId);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const { application, appOid } = resolved;
    const snapshot = await loadSnapshotForApplication(application, appOid);
    const normalizedGroups = snapshot?.metadata?.normalizedGroups;

    if (
      !snapshot ||
      snapshot.status !== "ready" ||
      !Array.isArray(normalizedGroups) ||
      !normalizedGroups.length
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Directory groups are not loaded yet. Open AD suggestions and wait for the scan to finish, then save custom rules.",
      });
    }

    const groupToUsers = deserializeGroupToUsers(
      snapshot.metadata?.groupToUsersEntries,
    );

    const bodyRules = req.body?.suggestionRuleDefinitions;
    const ruleDefinitions = Array.isArray(bodyRules)
      ? bodyRules
      : application.connectionConfig?.ad?.suggestionRuleDefinitions || [];

    const updatedSnapshot = await persistBuiltSuggestions({
      tenantId: application.tenantId,
      sourceApplicationId: appOid,
      normalizedGroups,
      groupToUsers,
      ruleDefinitions,
      metadata: {
        ...snapshot.metadata,
        recomputedAt: new Date().toISOString(),
        recomputedBy: req.user?.id || null,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Custom rules applied. Custom suggestions are listed first.",
      cache: computeCacheMetadata(updatedSnapshot),
      totalGroups: updatedSnapshot.totalGroups,
      totalSuggestions: updatedSnapshot.totalSuggestions,
    });
  } catch (error) {
    console.error("[recomputeSuggestions]", error);
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to recompute AD suggestions.",
    });
  }
}

export async function onboardApplications(req, res) {
  const createdResources = [];

  try {
    const { sourceApplicationId, applications } = req.body || {};

    if (
      !sourceApplicationId ||
      !mongoose.Types.ObjectId.isValid(String(sourceApplicationId))
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid sourceApplicationId is required",
      });
    }

    if (!Array.isArray(applications) || applications.length === 0) {
      return res.status(400).json({
        success: false,
        message: "applications must be a non-empty array",
      });
    }

    const sourceAppOid = new mongoose.Types.ObjectId(String(sourceApplicationId));
    const sourceApplication = await Application.findById(sourceAppOid)
      .select(
        "name tenantId type status owner ownerEmail integrationType connectorType connectionConfig userMappings entitlementMappings csvImportMapping accountsTablePreferences",
      )
      .lean();

    if (!sourceApplication) {
      return res.status(404).json({
        success: false,
        message: "Source application not found",
      });
    }

    const scopedTenantId =
      req.scopedTenantId || getScopedTenantId(req.user) || req.user?.tenantId;
    if (
      scopedTenantId &&
      String(sourceApplication.tenantId || "") !== String(scopedTenantId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Source application not in tenant scope",
      });
    }

    const isAdSource =
      sourceApplication.connectorType === "ACTIVE_DIRECTORY" ||
      Boolean(sourceApplication.connectionConfig?.ad);
    if (!isAdSource) {
      return res.status(400).json({
        success: false,
        message:
          "Source application is not configured with an Active Directory connector.",
      });
    }

    let normalizedApps;
    try {
      normalizedApps = applications.map((app, index) =>
        normalizeRequestedApplication(app, index),
      );
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError.message,
      });
    }

    const requestedNames = normalizedApps.map((app) => app.customName);
    const requestedNameKeys = new Set();
    for (const name of requestedNames) {
      const key = name.toLowerCase();
      if (requestedNameKeys.has(key)) {
        return res.status(409).json({
          success: false,
          message: `Duplicate application name in request: ${name}`,
        });
      }
      requestedNameKeys.add(key);
    }

    const existingApps = await Application.find({
      tenantId: sourceApplication.tenantId,
      $or: requestedNames.map((name) => ({
        name: new RegExp(`^${escapeRegex(name)}$`, "i"),
      })),
    })
      .select("name")
      .lean();
    if (existingApps.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Application already exists: ${existingApps[0].name}`,
      });
    }

    const storedAdConfig =
      sourceApplication.connectionConfig &&
      typeof sourceApplication.connectionConfig === "object"
        ? sourceApplication.connectionConfig.ad
        : null;
    const cfg = normalizeAdConfig(storedAdConfig || {});
    if (!cfg.url || !cfg.bindDn || !cfg.baseDn) {
      return res.status(400).json({
        success: false,
        message:
          "Incomplete AD configuration. Save LDAP URL, base DN, and bind DN on the source application first.",
      });
    }

    const directory = await fetchAdDirectory(cfg, {
      maxUsers: cfg.maxUsers,
      maxGroups: cfg.maxGroups,
      maxComputers: 0,
      syncGroups: true,
    });
    const groupIndex = buildDirectoryGroupIndex(directory?.groups || []);
    const groupToUsers = directory?.membership?.groupToUsers;
    const schemaFields = cloneAdSchemaFieldsFromSource(sourceApplication);

    const createdApplications = [];

    for (const spec of normalizedApps) {
      console.log("[onboardApplications] creating application", {
        sourceApplicationId: String(sourceAppOid),
        tenantId: String(sourceApplication.tenantId),
        detectedAppName: spec.detectedAppName,
        customName: spec.customName,
        selectedGroups: spec.selectedGroups.length,
      });

      const resolvedGroups = spec.selectedGroups.map((group) =>
        resolveSelectedAdGroup(group, groupIndex, groupToUsers),
      );

      const derivedConnectionConfig = buildDerivedAdConnectionConfig(
        resolvedGroups,
        spec.detectedAppName,
        sourceAppOid,
      );

      const appDoc = await Application.create({
        tenantId: sourceApplication.tenantId,
        name: spec.customName,
        description: `Auto-onboarded from Active Directory suggestions on ${sourceApplication.name}.`,
        type: sourceApplication.type || "directory",
        status: sourceApplication.status || "active",
        owner: sourceApplication.owner,
        ownerEmail: sourceApplication.ownerEmail,
        connectorType: sourceApplication.connectorType,
        integrationType: sourceApplication.integrationType || "connector",
        tags: spec.tags,
        source: "ActiveDirectory",
        onboardingType: "Auto",
        sourceApplicationId: sourceAppOid,
        userMappings: schemaFields.userMappings,
        entitlementMappings: schemaFields.entitlementMappings,
        ...(schemaFields.csvImportMapping
          ? { csvImportMapping: schemaFields.csvImportMapping }
          : {}),
        ...(schemaFields.accountsTablePreferences
          ? { accountsTablePreferences: schemaFields.accountsTablePreferences }
          : {}),
        connectionConfig: derivedConnectionConfig,
        createdBy: req.user?.id || undefined,
        updatedBy: req.user?.id || undefined,
      });

      await syncInheritedMetadataFromSource(appDoc, sourceApplication);

      createdResources.push({
        _id: appDoc._id,
        name: appDoc.name,
        tenantId: sourceApplication.tenantId,
      });

      const syncResult = await syncDerivedApplicationFromAdDirectory({
        derivedApplication: appDoc,
        directory,
        selectedGroups: resolvedGroups,
      });

      createdApplications.push({
        applicationId: String(appDoc._id),
        applicationName: appDoc.name,
        entitlementCount: syncResult.entitlementsSynced,
        userCount: syncResult.usersImported,
        accountAggregationsUpserted: syncResult.accountAggregationsUpserted,
        reconciliationRunId: syncResult.runId,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Applications onboarded successfully",
      data: {
        createdApplications,
      },
    });
  } catch (error) {
    console.error("[onboardApplications] failed", error);
    await Promise.allSettled(
      createdResources.map(async (resource) => {
        const EntitlementsModel = await getDynamicEntitlementModelForTenantId(
          resource.name,
          resource.tenantId,
        );
        await EntitlementsModel.deleteMany({ applicationId: resource._id });
        await Application.deleteOne({ _id: resource._id });
      }),
    );
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to onboard applications",
    });
  }
}
