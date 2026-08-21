import { memo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  MarkerType,
} from "reactflow";

function labelClass(label, isFailurePath) {
  if (label === "Still present") return "still-present";
  if (label === "Removed") return "removed";
  if (isFailurePath) return "no";
  return "yes";
}

function WorkflowCanvasEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
  style,
  markerEnd,
  selected,
}) {
  const [hovered, setHovered] = useState(false);
  const isPlaceholder = Boolean(data?.isPlaceholder);
  const isDropTarget = Boolean(data?.isDropTarget);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 24,
  });

  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  const isFailurePath =
    label === "Still present" ||
    label === "No" ||
    (data?.branch === "false" && label !== "Removed");
  const pillClass = labelClass(label, isFailurePath);
  const showInsert = !isPlaceholder && (hovered || isDropTarget || selected);

  const stroke = isDropTarget
    ? "#2563eb"
    : isPlaceholder
      ? "#94a3b8"
      : style?.stroke || "#475569";

  const edgeStyle = {
    ...style,
    stroke,
    strokeWidth: isDropTarget ? 3 : style?.strokeWidth || 2.5,
    strokeDasharray: isPlaceholder ? "8 6" : undefined,
  };

  const resolvedMarker = markerEnd || {
    type: MarkerType.ArrowClosed,
    color: stroke,
    width: 20,
    height: 20,
  };

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: isPlaceholder ? "default" : "pointer" }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={edgeStyle}
        markerEnd={resolvedMarker}
        interactionWidth={20}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`workflow-edge-label ${pillClass}`}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "none",
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
      <EdgeLabelRenderer>
        <div
          className={`workflow-edge-insert-wrap ${showInsert ? "visible" : ""}`}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${midX}px,${midY}px)`,
            pointerEvents: showInsert ? "all" : "none",
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <button
            type="button"
            className="workflow-edge-insert-btn"
            title="Insert step"
            onClick={(e) => {
              e.stopPropagation();
              data?.onInsertClick?.(id);
            }}
          >
            + Insert
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(WorkflowCanvasEdge);
