import { Handle, Position } from "reactflow";
import AddRoundedIcon from "@mui/icons-material/AddRounded";

/** Visual add target — render-only, not saved to the workflow. */
export default function DropPlaceholderNode({ data }) {
  const onOpen = data?.onOpenPicker;

  return (
    <button
      type="button"
      className="workflow-node workflow-node--placeholder workflow-node-placeholder-btn"
      onClick={() => onOpen?.()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.();
        }
      }}
      aria-label="Add next step"
      disabled={!onOpen}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="workflow-handle workflow-handle-target workflow-handle--ghost"
        isConnectable={false}
      />
      <div className="workflow-node-placeholder__icon" aria-hidden>
        <AddRoundedIcon sx={{ fontSize: 20 }} />
      </div>
      <div className="workflow-node-placeholder__label">Add next step</div>
      <div className="workflow-node-placeholder__sub">
        Drag from Components, click here, or use Build helper
      </div>
    </button>
  );
}
