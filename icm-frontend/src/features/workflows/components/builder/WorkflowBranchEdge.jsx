import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
} from "reactflow";

function labelClass(label, isFailurePath) {
  if (label === "Still present") return "still-present";
  if (label === "Removed") return "removed";
  if (isFailurePath) return "no";
  return "yes";
}

function WorkflowBranchEdge({
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
}) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  const isFailurePath =
    label === "Still present" ||
    label === "No" ||
    (data?.branch === "false" && label !== "Removed");
  const pillClass = labelClass(label, isFailurePath);

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`workflow-edge-label ${pillClass}`}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(WorkflowBranchEdge);
