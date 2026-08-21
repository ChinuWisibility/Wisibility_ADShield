/**
 * Benchmark Registry — single source of truth for Observatory targets.
 */
import { REGISTRY_VERSION, assertTarget } from "./schema.mjs";
import { NAVIGATION_TARGETS } from "./targets/navigation.mjs";
import { APPLICATION_FEATURE_TARGETS } from "./targets/features/applications.mjs";
import { SECURITY_FEATURE_TARGETS } from "./targets/features/security.mjs";
import { IDENTITY_FEATURE_TARGETS } from "./targets/features/identities.mjs";
import { APPLICATION_ACTION_TARGETS } from "./targets/actions/applications.mjs";
import { SECURITY_ACTION_TARGETS } from "./targets/actions/security.mjs";
import { SHARED_APIS, SHARED_BACKENDS } from "./targets/apis.mjs";

const ALL_TARGETS = [
  ...NAVIGATION_TARGETS,
  ...APPLICATION_FEATURE_TARGETS,
  ...SECURITY_FEATURE_TARGETS,
  ...IDENTITY_FEATURE_TARGETS,
  ...APPLICATION_ACTION_TARGETS,
  ...SECURITY_ACTION_TARGETS,
  ...SHARED_APIS,
];

ALL_TARGETS.forEach((t, i) => assertTarget(t, { index: i }));

const byId = Object.fromEntries(ALL_TARGETS.map((t) => [t.id, t]));

export function loadRegistry() {
  return {
    version: REGISTRY_VERSION,
    targets: ALL_TARGETS.filter((t) => t.enabled !== false),
    byId,
  };
}

export function targetsByKind(kind) {
  return loadRegistry().targets.filter((t) => t.kind === kind);
}

export function navigationTargets() {
  return targetsByKind("navigation");
}

export function featureTargets() {
  return targetsByKind("feature");
}

export function actionTargets() {
  return targetsByKind("action");
}

export function sharedApiTargets() {
  return targetsByKind("sharedApi");
}

export function childrenOf(parentId) {
  return loadRegistry().targets.filter((t) => t.parentId === parentId);
}

/** Build v2 catalog maps from navigation targets. */
export function buildPageCatalogMaps() {
  const PAGE_FE = {};
  const PAGE_METRIC = {};
  const PAGE_ROUTES = {};
  for (const t of navigationTargets()) {
    if (t.comingSoon || !t.pageId) continue;
    PAGE_FE[t.pageId] = t.fe || {
      reactQuery: false,
      mountApiCalls: 1,
      duplicateRisk: "low",
      primaryApis: t.primaryApis || [],
    };
    if (t.metricLabel) PAGE_METRIC[t.pageId] = t.metricLabel;
    if (t.route) PAGE_ROUTES[t.pageId] = t.route;
  }
  return { PAGE_FE, PAGE_METRIC, PAGE_ROUTES, SHARED_BACKENDS };
}

/**
 * Adapt navigation (+ comingSoon) targets to legacy generator `pages[]` shape.
 */
export function navigationAsLegacyPages() {
  return navigationTargets().map((t) => ({
    pageName: t.pageId,
    route: t.route || "",
    feFile: t.feFile || "",
    primaryApis: t.primaryApis || t.fe?.primaryApis || [],
    controller: t.controller || "N/A",
    metric: t.metricLabel,
    comingSoon: Boolean(t.comingSoon),
    oneliner: t.narrative?.oneliner,
    fePattern: t.narrative?.fePattern,
    feNotes: t.narrative?.feNotes,
    reactQuery: t.narrative?.reactQuery || (t.fe?.reactQuery ? "Yes" : undefined),
    bottlenecks: t.narrative?.bottlenecks,
    opportunities: t.narrative?.opportunities,
    actions: t.narrative?.actions,
    // Live grades preferred — do not set gradeOverride
  }));
}

export { SHARED_BACKENDS, SHARED_APIS, REGISTRY_VERSION };
