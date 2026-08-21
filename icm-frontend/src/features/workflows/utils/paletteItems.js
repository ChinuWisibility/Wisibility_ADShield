import { isTriggerStepType } from "./workflowStepMeta";

/** Palette entries that actually run in the engine. */
export function isRunnablePaletteItem(item) {
  return Boolean(item?.type) && item?.implemented === true;
}

function sortNodesByCanvasPosition(nodes) {
  return [...nodes].sort(
    (a, b) =>
      (a.position?.y || 0) - (b.position?.y || 0)
      || (a.position?.x || 0) - (b.position?.x || 0),
  );
}

/** Non-trigger nodes of a step type in canvas top-to-bottom order. */
export function nodesOfStepType(nodes, stepType) {
  return sortNodesByCanvasPosition(
    nodes.filter(
      (n) => n.data?.stepType === stepType && !isTriggerStepType(n.data?.stepType),
    ),
  );
}

/** Catalog entries that share the same engine step type (e.g. Boolean + If / Compare Strings). */
export function paletteTypeSiblings(item, catalogItems = []) {
  if (!item?.type) return [];
  return catalogItems.filter((i) => i.type === item.type);
}

function inferPaletteLabelFromNode(node, siblings) {
  if (node.data?.paletteLabel) return node.data.paletteLabel;
  if (siblings.length <= 1) return siblings[0]?.label || null;
  if (node.data?.stepType === "CompareStrings") {
    return siblings.find((s) => s.label === "If / Compare Strings")?.label
      || siblings[siblings.length - 1]?.label;
  }
  return null;
}

/** Whether this palette row already has a matching step on the canvas. */
export function isPaletteItemOnCanvas(nodes, item, catalogItems = []) {
  if (!item?.type) return false;
  const siblings = paletteTypeSiblings(item, catalogItems);
  const hasSiblings = siblings.length > 1;

  return nodes.some((n) => {
    if (n.data?.stepType !== item.type || isTriggerStepType(n.data?.stepType)) return false;
    const nodePaletteLabel = inferPaletteLabelFromNode(n, siblings);
    if (hasSiblings) return nodePaletteLabel === item.label;
    return true;
  });
}

/** Highlight only the catalog row that matches the coach's next step. */
export function isRecommendedPaletteItem(item, recommendedStep, groupId) {
  if (!recommendedStep || item.type !== recommendedStep.stepType) return false;
  if (recommendedStep.paletteLabel && item.label !== recommendedStep.paletteLabel) return false;
  if (recommendedStep.paletteTab === "operator") return groupId === "operator";
  return groupId === recommendedStep.paletteGroup;
}

export function getRunnableCatalogByCategory(catalog = {}) {
  const pick = (items, category) =>
    (items || [])
      .filter(isRunnablePaletteItem)
      .map((i) => ({ ...i, _category: category }));

  return {
    triggers: pick(catalog.triggers, "trigger"),
    actions: pick(catalog.actions, "action"),
    operators: pick(catalog.operators, "operator"),
  };
}

export function flattenRunnableCatalog(catalog, { allowTriggers = true } = {}) {
  const { triggers, actions, operators } = getRunnableCatalogByCategory(catalog);
  const items = [...triggers, ...actions, ...operators];
  if (allowTriggers) return items;
  return items.filter((item) => !isTriggerStepType(item.type));
}

/** Palette entries grouped by paletteGroup metadata (includes flow operators). */
export const PALETTE_GROUPS = ["process", "ticket", "notifications", "queue", "flow"];

/** Sub-groups shown under the Action tab (flow operators use the Operator tab). */
export const ACTION_PALETTE_GROUPS = ["process", "ticket", "notifications", "queue"];

export const ACTION_GROUP_META = {
  process: { label: "Process", short: "PROC", hint: "Remediation & access steps" },
  ticket: { label: "Ticket", short: "TKT", hint: "ITSM ticket lifecycle" },
  notifications: { label: "Notify", short: "NTF", hint: "Email notifications" },
  queue: { label: "Queue", short: "QUE", hint: "Queue task status" },
};

export function getGroupedPaletteCatalog(catalog = {}) {
  const tagged = [
    ...(catalog.actions || []).map((i) => ({ ...i, _category: "action" })),
    ...(catalog.operators || []).map((i) => ({ ...i, _category: "operator" })),
  ].filter((i) => isRunnablePaletteItem(i) && !isTriggerStepType(i.type));

  const groups = Object.fromEntries(PALETTE_GROUPS.map((g) => [g, []]));
  for (const item of tagged) {
    const group = PALETTE_GROUPS.includes(item.paletteGroup) ? item.paletteGroup : "flow";
    groups[group].push(item);
  }
  return groups;
}

/** Action / Operator view for the step library (triggers excluded — fixed start node on canvas). */
export function getPaletteCatalogView(catalog = {}) {
  const grouped = getGroupedPaletteCatalog(catalog);
  const actionGroups = Object.fromEntries(
    ACTION_PALETTE_GROUPS.map((g) => [g, grouped[g] || []]),
  );
  const operators = grouped.flow || [];
  const actionCount = ACTION_PALETTE_GROUPS.reduce(
    (sum, g) => sum + (actionGroups[g]?.length || 0),
    0,
  );
  return {
    actionGroups,
    operators,
    actionCount,
    operatorCount: operators.length,
    totalCount: actionCount + operators.length,
  };
}
