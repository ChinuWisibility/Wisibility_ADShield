import { useCallback, useEffect, useMemo, useState } from "react";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { mergePaletteCatalog } from "../../config/paletteCatalogExtras";
import { workflowApi } from "../../services/api";
import { canAddStepType } from "../../utils/workflowConstraints";
import {
  ACTION_GROUP_META,
  ACTION_PALETTE_GROUPS,
  getPaletteCatalogView,
  isPaletteItemOnCanvas,
  isRecommendedPaletteItem,
} from "../../utils/paletteItems";
import { resolveBuildCoachState, paletteTabLabel } from "../../utils/workflowBuildCoach";
import { getTriggerRegistryEntry } from "../../config/workflowTriggerRegistry";

const DRAG_TYPE = "application/workflow-step";

const PRIMARY_TABS = [
  { id: "trigger", label: "Triggers" },
  { id: "action", label: "Actions" },
  { id: "operator", label: "Operators" },
];

export function readDragStep(dataTransfer) {
  try {
    const raw = dataTransfer.getData(DRAG_TYPE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setDragStep(dataTransfer, item) {
  dataTransfer.setData(DRAG_TYPE, JSON.stringify(item));
  dataTransfer.effectAllowed = "move";
}

function emptyPaletteView() {
  return {
    actionGroups: Object.fromEntries(ACTION_PALETTE_GROUPS.map((g) => [g, []])),
    operators: [],
    actionCount: 0,
    operatorCount: 0,
    totalCount: 0,
  };
}

function StepRow({
  item,
  groupId,
  nodes,
  catalogItems,
  draggingKey,
  onAddStep,
  onBlockedAdd,
  setDraggingKey,
  isRecommendedNext,
}) {
  const itemKey = `${item.type}-${item.label}`;
  const check = canAddStepType(nodes, item.type);
  const disabled = !check.allowed;
  const onCanvas = isPaletteItemOnCanvas(nodes, item, catalogItems);
  const badge =
    item._category === "operator"
      ? { label: "OPR", tone: "operator" }
      : {
          label: ACTION_GROUP_META[groupId]?.short || "ACT",
          tone: groupId || "process",
        };

  const handleAdd = () => {
    if (disabled) {
      onBlockedAdd?.(check.reason);
      return;
    }
    onAddStep({ ...item });
  };

  const handleDragStart = (e) => {
    if (disabled) {
      e.preventDefault();
      onBlockedAdd?.(check.reason);
      return;
    }
    setDraggingKey(itemKey);
    setDragStep(e.dataTransfer, { ...item });
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      draggable={!disabled}
      className={`isc-step-row ${disabled ? "is-disabled" : ""} ${onCanvas ? "is-on-canvas" : ""} ${draggingKey === itemKey ? "is-dragging" : ""} ${isRecommendedNext ? "is-recommended-next" : ""}`}
      onDragStart={handleDragStart}
      onDragEnd={() => setDraggingKey(null)}
      onClick={handleAdd}
      onKeyDown={(e) => e.key === "Enter" && handleAdd()}
      title={disabled ? check.reason : item.description || item.label}
    >
      <span className="isc-step-row__badge" data-tone={badge.tone}>
        {badge.label}
      </span>
      <span className="isc-step-row__main">
        <span className="isc-step-row__name">{item.label}</span>
        {item.description && (
          <span className="isc-step-row__desc">{item.description}</span>
        )}
      </span>
      {isRecommendedNext ? (
        <span className="isc-step-row__next-pill">Next</span>
      ) : onCanvas ? (
        <span className="isc-step-row__status">Added</span>
      ) : (
        <span className="isc-step-row__add" aria-hidden>
          <AddRoundedIcon sx={{ fontSize: 16 }} />
        </span>
      )}
    </div>
  );
}

export default function ComponentPalette({
  nodes,
  onAddStep,
  onBlockedAdd,
  onBrowseSteps,
  remediationAction,
  remediationEvent,
}) {
  const [activeTab, setActiveTab] = useState("action");
  const [actionFilter, setActionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [paletteView, setPaletteView] = useState(emptyPaletteView);
  const [draggingKey, setDraggingKey] = useState(null);

  useEffect(() => {
    workflowApi
      .catalog(remediationAction)
      .then((r) =>
        setPaletteView(getPaletteCatalogView(mergePaletteCatalog(r.data.data || {}))),
      )
      .catch(() => setPaletteView(emptyPaletteView()));
  }, [remediationAction]);

  const buildCoach = useMemo(
    () => resolveBuildCoachState({ nodes, remediationAction, selectedNodeId: null }),
    [nodes, remediationAction],
  );

  const recommendedNext = buildCoach?.phase === "add" ? buildCoach.nextPathStep : null;

  const catalogItems = useMemo(
    () => [
      ...ACTION_PALETTE_GROUPS.flatMap((g) => paletteView.actionGroups[g] || []),
      ...(paletteView.operators || []),
    ],
    [paletteView],
  );

  const isRecommendedItem = useCallback(
    (item, groupId) => isRecommendedPaletteItem(item, recommendedNext, groupId),
    [recommendedNext],
  );

  const actionSections = useMemo(() => {
    const groups =
      actionFilter === "all"
        ? ACTION_PALETTE_GROUPS
        : ACTION_PALETTE_GROUPS.filter((g) => g === actionFilter);
    return groups
      .map((groupId) => ({
        groupId,
        meta: ACTION_GROUP_META[groupId],
        items: paletteView.actionGroups[groupId] || [],
      }))
      .filter((s) => s.items.length > 0);
  }, [paletteView, actionFilter]);

  const filteredActionSections = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return actionSections;
    return actionSections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (i) =>
            i.label.toLowerCase().includes(q) ||
            i.description?.toLowerCase().includes(q) ||
            i.type?.toLowerCase().includes(q),
        ),
      }))
      .filter((s) => s.items.length > 0);
  }, [actionSections, search]);

  const filteredOperators = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = paletteView.operators || [];
    if (!q) return list;
    return list.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.description?.toLowerCase().includes(q) ||
        i.type?.toLowerCase().includes(q),
    );
  }, [paletteView.operators, search]);

  const actionFilterOptions = useMemo(
    () =>
      ACTION_PALETTE_GROUPS.filter((g) => (paletteView.actionGroups[g] || []).length > 0),
    [paletteView],
  );

  const isActionTab = activeTab === "action";
  const isTriggerTab = activeTab === "trigger";
  const triggerEntry = remediationEvent?.triggerType
    ? getTriggerRegistryEntry(remediationEvent.triggerType)
    : null;

  return (
    <aside className="isc-left-panel isc-components-panel">
      <div className="isc-panel-head isc-panel-head-compact">
        <h2 className="isc-panel-head-title">Components</h2>
        <p className="isc-panel-head-sub">
          {remediationEvent
            ? `${remediationEvent.badge} · ${remediationEvent.triggerLabel}`
            : "Drag or click to add · trigger is fixed on canvas"}
        </p>
      </div>

      <div className="isc-components-tabs" role="tablist" aria-label="Component type">
        {PRIMARY_TABS.map((tab) => {
          const count =
            tab.id === "trigger"
              ? triggerEntry ? 1 : 0
              : tab.id === "action"
                ? paletteView.actionCount
                : paletteView.operatorCount;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`isc-components-tab ${activeTab === tab.id ? "is-active" : ""}`}
              onClick={() => {
                setActiveTab(tab.id);
                setSearch("");
              }}
            >
              {paletteTabLabel(tab.id)}
              <span className="isc-components-tab__count">{count}</span>
            </button>
          );
        })}
      </div>

      {onBrowseSteps && !isTriggerTab && (
        <div className="isc-components-browse">
          <button type="button" className="isc-choose-var-btn" onClick={onBrowseSteps}>
            Browse all steps…
          </button>
        </div>
      )}

      {isActionTab && actionFilterOptions.length > 1 && (
        <div className="isc-components-filters" role="group" aria-label="Action category">
          <button
            type="button"
            className={`isc-components-filter ${actionFilter === "all" ? "is-active" : ""}`}
            onClick={() => setActionFilter("all")}
          >
            All
          </button>
          {actionFilterOptions.map((groupId) => (
            <button
              key={groupId}
              type="button"
              className={`isc-components-filter ${actionFilter === groupId ? "is-active" : ""}`}
              onClick={() => setActionFilter(groupId)}
            >
              {ACTION_GROUP_META[groupId].label}
            </button>
          ))}
        </div>
      )}

      <div className="isc-components-search">
        {!isTriggerTab && (
          <>
            <SearchRoundedIcon sx={{ fontSize: 17 }} aria-hidden />
            <input
              type="search"
              placeholder={`Search ${isActionTab ? "actions" : "operators"}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search components"
            />
          </>
        )}
      </div>

      <div className="isc-components-body" role="tabpanel">
        {isTriggerTab ? (
          triggerEntry ? (
            <div className="isc-trigger-readonly">
              <div className="isc-trigger-readonly__row">
                <span className="isc-step-row__badge" data-tone="trigger">
                  TRG
                </span>
                <div className="isc-trigger-readonly__main">
                  <span className="isc-step-row__name">
                    {remediationEvent.triggerLabel || triggerEntry.triggerType}
                  </span>
                  <span className="isc-step-row__desc">
                    Fixed for this workflow — shown on the canvas start node.
                  </span>
                </div>
                <span className="isc-trigger-readonly__lock">Fixed</span>
              </div>
            </div>
          ) : (
            <p className="isc-components-empty">No trigger metadata for this workflow.</p>
          )
        ) : isActionTab ? (
          filteredActionSections.length === 0 ? (
            <p className="isc-components-empty">
              {search ? "No actions match your search." : "No actions for this event."}
            </p>
          ) : (
            filteredActionSections.map((section) => (
              <section key={section.groupId} className="isc-step-group">
                {actionFilter === "all" && (
                  <header className="isc-step-group__head">
                    <span>{section.meta.label}</span>
                    <span className="isc-step-group__count">{section.items.length}</span>
                  </header>
                )}
                <div className="isc-step-table">
                  {section.items.map((item) => (
                    <StepRow
                      key={`${item.type}-${item.label}`}
                      item={item}
                      groupId={section.groupId}
                      nodes={nodes}
                      catalogItems={catalogItems}
                      draggingKey={draggingKey}
                      onAddStep={onAddStep}
                      onBlockedAdd={onBlockedAdd}
                      setDraggingKey={setDraggingKey}
                      isRecommendedNext={isRecommendedItem(item, section.groupId)}
                    />
                  ))}
                </div>
              </section>
            ))
          )
        ) : filteredOperators.length === 0 ? (
          <p className="isc-components-empty">
            {search ? "No operators match your search." : "No operators for this event."}
          </p>
        ) : (
          <div className="isc-step-table">
            {filteredOperators.map((item) => (
              <StepRow
                key={`${item.type}-${item.label}`}
                item={item}
                groupId="operator"
                nodes={nodes}
                catalogItems={catalogItems}
                draggingKey={draggingKey}
                onAddStep={onAddStep}
                onBlockedAdd={onBlockedAdd}
                setDraggingKey={setDraggingKey}
                isRecommendedNext={isRecommendedItem(item, "operator")}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
