import { useMemo } from "react";
import { Typography } from "@mui/material";
import { canAddStepType } from "../../utils/workflowConstraints";
import { ACTION_GROUP_META, ACTION_PALETTE_GROUPS } from "../../utils/paletteItems";

function findRecommendedItem(items, recommendedStep) {
  if (!recommendedStep?.stepType) return null;
  if (recommendedStep.paletteLabel) {
    const exact = items.find(
      (i) =>
        i.type === recommendedStep.stepType &&
        i.implemented &&
        i.label === recommendedStep.paletteLabel,
    );
    if (exact) return exact;
  }
  return items.find((i) => i.type === recommendedStep.stepType && i.implemented) || null;
}

function groupItems(items) {
  const actions = Object.fromEntries(ACTION_PALETTE_GROUPS.map((g) => [g, []]));
  const operators = [];

  for (const item of items) {
    if (item._category === "operator") {
      operators.push(item);
      continue;
    }
    const group = ACTION_PALETTE_GROUPS.includes(item.paletteGroup)
      ? item.paletteGroup
      : "process";
    actions[group].push(item);
  }

  return { actions, operators };
}

export default function StepPickerList({
  items = [],
  search = "",
  nodes = [],
  recommendedStep = null,
  onSelect,
  emptyMessage = "No matching steps.",
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = !q
      ? items
      : items.filter(
          (i) =>
            i.label?.toLowerCase().includes(q) ||
            i.type?.toLowerCase().includes(q) ||
            i.description?.toLowerCase().includes(q),
        );
    return list.filter((item) => {
      if (!item.type) return true;
      return canAddStepType(nodes, item.type).allowed;
    });
  }, [items, search, nodes]);

  const recommendedItem = useMemo(
    () => findRecommendedItem(filtered, recommendedStep),
    [filtered, recommendedStep],
  );

  const { actions, operators } = useMemo(() => groupItems(filtered), [filtered]);

  const renderItem = (item) => (
    <button
      key={`${item.type}-${item.label}`}
      type="button"
      className={`isc-insert-step-item ${recommendedItem === item ? "is-recommended" : ""}`}
      onClick={() => onSelect(item)}
    >
      <span className="isc-insert-step-label">
        {item.label}
        {recommendedItem === item && (
          <span className="isc-insert-step-recommended-pill">Recommended</span>
        )}
      </span>
      {item.description && (
        <span className="isc-insert-step-desc">{item.description}</span>
      )}
    </button>
  );

  const actionSections = ACTION_PALETTE_GROUPS.filter((g) => (actions[g] || []).length > 0);

  if (filtered.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyMessage}
      </Typography>
    );
  }

  return (
    <div className="isc-step-picker-list">
      {recommendedItem && !search.trim() && (
        <section className="isc-step-picker-section">
          <header className="isc-step-picker-section__head">Recommended next</header>
          {renderItem(recommendedItem)}
        </section>
      )}

      {actionSections.map((groupId) => (
        <section key={groupId} className="isc-step-picker-section">
          <header className="isc-step-picker-section__head">
            {ACTION_GROUP_META[groupId]?.label || groupId}
          </header>
          <div className="isc-insert-step-list">
            {(actions[groupId] || [])
              .filter((item) => item !== recommendedItem || search.trim())
              .map(renderItem)}
          </div>
        </section>
      ))}

      {operators.length > 0 && (
        <section className="isc-step-picker-section">
          <header className="isc-step-picker-section__head">Operators</header>
          <div className="isc-insert-step-list">
            {operators
              .filter((item) => item !== recommendedItem || search.trim())
              .map(renderItem)}
          </div>
        </section>
      )}
    </div>
  );
}
