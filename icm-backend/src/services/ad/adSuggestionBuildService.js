import { normalizeDn } from "./ldapNormalizer.js";
import { clusterGroupsByPrefix } from "../discovery/groupPatternEngine.js";
import {
  evaluateRuleSet,
  normalizeRuleDefinitions,
  toRuleEvaluationEntity,
} from "./adSuggestionRuleEngine.js";

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function getStaleAfterMs(metadata) {
  const configured = Number(metadata?.staleAfterMs);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return DEFAULT_STALE_AFTER_MS;
}

export function computeCacheMetadata(snapshot) {
  const generatedAt = snapshot?.generatedAt
    ? new Date(snapshot.generatedAt)
  : null;
  const generatedAtMs = generatedAt && !Number.isNaN(generatedAt.getTime())
    ? generatedAt.getTime()
    : null;
  const ageMs =
    generatedAtMs != null ? Math.max(0, Date.now() - generatedAtMs) : null;
  const staleAfterMs = getStaleAfterMs(snapshot?.metadata);
  const isStale =
    generatedAtMs == null ? true : ageMs != null && ageMs > staleAfterMs;

  return {
    status: snapshot?.status || "refresh_required",
    generatedAt: generatedAt?.toISOString() || null,
    ageMs,
    isStale,
    staleAfterMs,
    totalGroups: Number(snapshot?.totalGroups) || 0,
    totalSuggestions: Number(snapshot?.totalSuggestions) || 0,
    groupingMode: snapshot?.metadata?.groupingMode || "hybrid",
    refreshError: String(snapshot?.refreshError || "").trim() || null,
  };
}

function toMemberCount(group, groupToUsers) {
  const resolvedUsers = groupToUsers?.get(normalizeDn(group?.groupDN));
  if (Array.isArray(resolvedUsers) && resolvedUsers.length) {
    return resolvedUsers.length;
  }
  return Array.isArray(group?.members)
    ? group.members.filter(Boolean).length
    : 0;
}

function buildUniqueUserCount(groups, groupToUsers) {
  const uniqueUsers = new Set();
  for (const group of groups || []) {
    const resolvedUsers = groupToUsers?.get(normalizeDn(group?.groupDN));
    if (Array.isArray(resolvedUsers) && resolvedUsers.length) {
      resolvedUsers.forEach((userId) => {
        const key = String(userId || "").trim();
        if (key) uniqueUsers.add(key);
      });
    } else {
      (group?.members || []).forEach((memberDn) => {
        const key = String(memberDn || "").trim();
        if (key) uniqueUsers.add(key);
      });
    }
  }
  return uniqueUsers.size;
}

export function buildSuggestionPayload(clusters, groupToUsers) {
  return (clusters || []).map((cluster) => {
    const groups = (cluster.groups || []).map((group) => ({
      name:
        String(group?.groupName || "").trim() ||
        String(group?.groupDN || "").trim(),
      memberCount: toMemberCount(group, groupToUsers),
      dn: String(group?.groupDN || "").trim(),
    }));

    return {
      appName: cluster.appName,
      groupCount: groups.length,
      userCount: buildUniqueUserCount(cluster.groups, groupToUsers),
      groups,
      sampleEntitlements: [],
      suggestionSource: cluster.suggestionSource || "prefix",
      ruleOrder:
        cluster.ruleOrder == null || cluster.ruleOrder === undefined
          ? undefined
          : cluster.ruleOrder,
    };
  });
}

function groupIdentity(group) {
  return (
    normalizeDn(group?.groupDN) ||
    String(group?.groupName || "").trim().toLowerCase()
  );
}

const SUGGESTION_SOURCE_RANK = {
  custom: 0,
  hybrid: 1,
  prefix: 2,
};

export function enrichSuggestionsForDisplay(suggestions, ruleDefinitions = []) {
  const customAppNames = new Set(
    normalizeRuleDefinitions(ruleDefinitions).map((def) =>
      String(def.appName || "").trim().toLowerCase(),
    ),
  );

  return (suggestions || []).map((suggestion, index) => {
    const appKey = String(suggestion?.appName || "").trim().toLowerCase();
    let suggestionSource = suggestion?.suggestionSource;
    let ruleOrder = suggestion?.ruleOrder;

    if (!suggestionSource && customAppNames.has(appKey)) {
      suggestionSource = "custom";
    }
    if (suggestionSource == null) {
      suggestionSource = "prefix";
    }

    if (ruleOrder == null && suggestionSource === "custom") {
      const defs = normalizeRuleDefinitions(ruleDefinitions);
      ruleOrder = defs.findIndex(
        (def) => def.appName.toLowerCase() === appKey,
      );
      if (ruleOrder < 0) ruleOrder = index;
    }

    return {
      ...suggestion,
      suggestionSource,
      ruleOrder: ruleOrder == null ? undefined : ruleOrder,
    };
  });
}

export function sortSuggestionsForDisplay(suggestions) {
  return [...(suggestions || [])].sort((a, b) => {
    const rankA = SUGGESTION_SOURCE_RANK[a?.suggestionSource] ?? 2;
    const rankB = SUGGESTION_SOURCE_RANK[b?.suggestionSource] ?? 2;
    if (rankA !== rankB) return rankA - rankB;

    const orderA =
      a?.suggestionSource === "custom" && Number.isFinite(a?.ruleOrder)
        ? a.ruleOrder
        : Number.MAX_SAFE_INTEGER;
    const orderB =
      b?.suggestionSource === "custom" && Number.isFinite(b?.ruleOrder)
        ? b.ruleOrder
        : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;

    return (b?.groupCount || 0) - (a?.groupCount || 0);
  });
}

export function serializeGroupToUsers(groupToUsers) {
  if (!groupToUsers || typeof groupToUsers.entries !== "function") return [];
  return [...groupToUsers.entries()];
}

export function deserializeGroupToUsers(entries) {
  const map = new Map();
  for (const entry of entries || []) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    map.set(entry[0], entry[1]);
  }
  return map;
}

/**
 * Hybrid grouping: custom rules run first (shown at top), then prefix clustering
 * for groups not matched by any custom rule.
 */
export function buildHybridSuggestions(
  normalizedGroups,
  groupToUsers,
  ruleDefinitions,
) {
  const customRules = normalizeRuleDefinitions(ruleDefinitions);
  const assigned = new Set();
  const customClusters = [];

  for (let ruleIndex = 0; ruleIndex < customRules.length; ruleIndex += 1) {
    const definition = customRules[ruleIndex];
    const matchedGroups = [];

    for (const group of normalizedGroups || []) {
      const identity = groupIdentity(group);
      if (!identity || assigned.has(identity)) continue;

      const entity = toRuleEvaluationEntity(group);
      const { passed } = evaluateRuleSet(entity, definition.ruleSet);
      if (!passed) continue;

      assigned.add(identity);
      matchedGroups.push(group);
    }

    if (!matchedGroups.length) continue;

    customClusters.push({
      appName: definition.appName,
      groups: matchedGroups,
      suggestionSource: "custom",
      ruleOrder: ruleIndex,
    });
  }

  const remainingGroups = (normalizedGroups || []).filter((group) => {
    const identity = groupIdentity(group);
    return identity && !assigned.has(identity);
  });

  const prefixClusters = clusterGroupsByPrefix(remainingGroups).map((cluster) => ({
    ...cluster,
    suggestionSource: "prefix",
  }));

  const orderedClusters = [...customClusters, ...prefixClusters];
  return buildSuggestionPayload(orderedClusters, groupToUsers);
}

export function normalizeDirectoryGroups(directoryGroups) {
  return (directoryGroups || [])
    .map((group) => ({
      groupName: String(group?.groupName || "").trim(),
      groupDN: String(group?.groupDN || "").trim(),
      description: String(group?.description || "").trim(),
      members: Array.isArray(group?.members)
        ? group.members.filter(Boolean)
        : [],
      objectSid: String(group?.objectSid || "").trim(),
    }))
    .filter((group) => group.groupName || group.groupDN);
}

export function buildAdSuggestions(
  normalizedGroups,
  groupToUsers,
  { ruleDefinitions } = {},
) {
  const customRules = normalizeRuleDefinitions(ruleDefinitions);
  const built = buildHybridSuggestions(normalizedGroups, groupToUsers, customRules);
  const suggestions = sortSuggestionsForDisplay(
    enrichSuggestionsForDisplay(built, customRules),
  );

  return {
    suggestions,
    groupingMode: "hybrid",
    ruleDefinitions: customRules,
  };
}

export function paginateArray(items, page, pageSize) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(Math.max(1, pageSize), 100);
  const total = items.length;
  const totalPages = total ? Math.ceil(total / safePageSize) : 0;
  const start = (safePage - 1) * safePageSize;
  const data = items.slice(start, start + safePageSize);

  return {
    data,
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages,
    },
  };
}

export function stripGroupsFromSuggestions(suggestions) {
  return (suggestions || []).map((suggestion) => ({
    appName: suggestion.appName,
    groupCount: suggestion.groupCount,
    userCount: suggestion.userCount,
    groups: [],
    sampleEntitlements: suggestion.sampleEntitlements || [],
    suggestionSource: suggestion.suggestionSource || "prefix",
    ruleOrder: suggestion.ruleOrder,
  }));
}

export function getAllAppNames(suggestions) {
  return (suggestions || [])
    .map((suggestion) => String(suggestion?.appName || "").trim())
    .filter(Boolean);
}
