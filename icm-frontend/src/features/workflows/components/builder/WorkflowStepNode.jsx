import { memo } from "react";
import { Handle, Position } from "reactflow";
import { getNodeCategory, isTriggerStepType } from "../../utils/workflowStepMeta";
import { isBranchingStep } from "../../utils/workflowConstraints";

function badgeClass(cat, stepType) {
  if (stepType === "EndSuccess") return "nb-success";
  if (stepType === "EndFailure") return "nb-failure";
  if (cat === "trigger") return "nb-trigger";
  if (cat === "operator") return "nb-operator";
  return "nb-action";
}

function badgeLabel(cat, stepType) {
  if (stepType === "EndSuccess" || stepType === "EndFailure") return "End";
  if (cat === "trigger") return "Trigger";
  if (cat === "operator") return "Operator";
  return "Action";
}

function nodeTone(cat, stepType) {
  if (stepType === "EndSuccess") return "success";
  if (stepType === "EndFailure") return "failure";
  if (cat === "trigger") return "trigger";
  if (cat === "operator") return "operator";
  return "action";
}

function NodeIcon({ tone }) {
  if (tone === "trigger") {
    return (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8.5 7.5v5l4-2.5-4-2.5z" fill="currentColor" />
      </svg>
    );
  }
  if (tone === "operator") {
    return (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden>
        <path
          d="M10 3v4M10 13v4M3 10h4M13 10h4M5.8 5.8l2.8 2.8M11.4 11.4l2.8 2.8M5.8 14.2l2.8-2.8M11.4 8.6l2.8-2.8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (tone === "success") {
    return (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden>
        <path
          d="M6 10l2.5 2.5L14 7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (tone === "failure") {
    return (
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden>
        <path
          d="M7 7l6 6M13 7l-6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden>
      <path
        d="M10 4v8M6 8h8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function nodeSubtitle(stepType, label, config) {
  if (stepType === "CompareStrings" || stepType === "CompareNumbers") {
    if (label === "Boolean" || label?.includes("Revoke")) return "Decision = Revoke?";
    if (label?.includes("Still") || label?.includes("Exists") || config?.branchLabelTrue === "Still present")
      return "Access Still Exists?";
    if (stepType === "CompareNumbers") return "Compare Numbers";
    return "Compare Strings";
  }
  if (stepType === "Loop") return `Max ${config?.maxIterations ?? 10} iterations`;
  if (stepType === "Scheduler") {
    const v = config?.delayValue;
    const u = config?.delayUnit || "hours";
    return v ? `Wait ${v} ${u}` : "Schedule delay";
  }
  if (stepType === "RevokeAccess") {
    if (label === "Manage Access") return config?.entitlementName ? `Revoke ${config.entitlementName}` : "Revoke Access";
    return config?.entitlementName ? `Revoke ${config.entitlementName}` : null;
  }
  if (stepType === "VerifyAccessRemoved") return label === "Get Identity" ? "Verify Removal" : "Verify Removal";
  if (stepType === "SendEmail" && label !== "Send Email") return label;
  return null;
}

function WorkflowStepNode({ id, data, selected }) {
  const cat = getNodeCategory(data.stepType, data.config);
  const displayLabel =
    data.stepType === "CatalogStub" ? data.config?.catalogLabel || data.label : data.label;
  const isTrigger =
    isTriggerStepType(data.stepType) ||
    (data.stepType === "CatalogStub" && data.config?.catalogCategory === "trigger");
  const isEnd =
    data.stepType === "EndSuccess" ||
    data.stepType === "EndFailure" ||
    data.stepType === "EndWaiting";
  const isBranch = isBranchingStep(data.stepType);
  const subtitle = nodeSubtitle(data.stepType, data.label, data.config);
  const tone = nodeTone(cat, data.stepType);
  const endClass =
    data.stepType === "EndSuccess" ? "end-success" : data.stepType === "EndFailure" ? "end-failure" : "";
  const showPulse = Boolean(data.awaitingConnection);

  const onHandleDblClick = (e, handleType, handleId) => {
    e.stopPropagation();
    data.onDisconnectHandle?.(id, handleType, handleId);
  };

  return (
    <div
      className={`workflow-node workflow-node--${tone} ${isTrigger ? "workflow-node--trigger" : ""} ${endClass} ${selected ? "selected" : ""}`}
    >
      <div className="workflow-node__stripe" aria-hidden />

      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          className="workflow-handle workflow-handle-target"
          onDoubleClick={(e) => onHandleDblClick(e, "target", null)}
        />
      )}

      <div className="workflow-node__content">
        <div className={`workflow-node__icon workflow-node__icon--${tone}`}>
          <NodeIcon tone={tone} />
        </div>
        <div className="workflow-node-body">
          <div className={`workflow-node-type-badge ${badgeClass(cat, data.stepType)}`}>
            {badgeLabel(cat, data.stepType)}
          </div>
          <div className="workflow-node-label">{displayLabel}</div>
          {subtitle && <div className="workflow-node-sub">{subtitle}</div>}
        </div>
      </div>

      {isBranch && (
        <div className="workflow-node-branches">
          <div className="workflow-branch-label yes">
            {data.config?.branchLabelTrue || "Yes"}
          </div>
          <div className="workflow-branch-label no">
            {data.config?.branchLabelFalse || "No"}
          </div>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            className="workflow-handle workflow-handle-yes"
            style={{ left: "28%" }}
            onDoubleClick={(e) => onHandleDblClick(e, "source", "true")}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            className="workflow-handle workflow-handle-no"
            style={{ left: "72%" }}
            onDoubleClick={(e) => onHandleDblClick(e, "source", "false")}
          />
        </div>
      )}

      {!isBranch && !isEnd && (
        <Handle
          type="source"
          position={Position.Bottom}
          className={`workflow-handle workflow-handle-source ${showPulse ? "workflow-handle--pulse" : ""}`}
          onDoubleClick={(e) => onHandleDblClick(e, "source", null)}
        />
      )}

      {selected && data.onDelete && (
        <button
          type="button"
          className="workflow-node-delete"
          title="Delete step (Del)"
          onClick={(e) => {
            e.stopPropagation();
            data.onDelete(id);
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export default memo(WorkflowStepNode);
