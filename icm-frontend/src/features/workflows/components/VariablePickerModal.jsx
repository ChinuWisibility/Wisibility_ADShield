import { useEffect, useMemo, useState } from "react";
import {
  getPriorStepsInOrder,
  getFieldVariableHints,
  buildStepVariablePaths,
  buildConfigVariablePaths,
  getStepDefinition,
} from "../config/stepConfigCatalog";

export default function VariablePickerModal({
  open,
  onClose,
  onSave,
  nodes = [],
  edges = [],
  currentStepId,
  fieldKey,
  stepType,
  triggerType,
  triggerLabel,
}) {
  const priorSteps = useMemo(
    () => getPriorStepsInOrder(nodes, edges, currentStepId),
    [nodes, edges, currentStepId],
  );

  const resolvedTriggerType = useMemo(() => {
    if (triggerType) return triggerType;
    const triggerNode = nodes.find((n) => {
      const t = n.data?.stepType;
      return t === "CertificationSignedOff" || t === "UncorrelatedAccountIAMDecision";
    });
    return triggerNode?.data?.stepType || "CertificationSignedOff";
  }, [nodes, triggerType]);

  const resolvedTriggerLabel = useMemo(() => {
    if (triggerLabel) return triggerLabel;
    return getStepDefinition(resolvedTriggerType)?.title || "Trigger";
  }, [triggerLabel, resolvedTriggerType]);

  const stepOptions = useMemo(() => {
    const opts = [
      {
        id: "trigger",
        label: resolvedTriggerLabel,
        stepType: resolvedTriggerType,
      },
    ];
    priorSteps.forEach((n) => {
      opts.push({
        id: n.id,
        label: n.data?.label || n.id,
        stepType: n.data?.stepType,
      });
    });
    opts.push({ id: "config", label: "Workflow config", stepType: "Config" });
    return opts;
  }, [priorSteps, resolvedTriggerLabel, resolvedTriggerType]);

  const [stepKey, setStepKey] = useState("trigger");
  const [selectedPath, setSelectedPath] = useState("");

  useEffect(() => {
    if (open) {
      setStepKey(stepOptions[0]?.id || "trigger");
      setSelectedPath("");
    }
  }, [open, stepOptions]);

  const selectedOption = stepOptions.find((s) => s.id === stepKey) || stepOptions[0];
  const hints = useMemo(
    () => getFieldVariableHints(stepType, fieldKey),
    [stepType, fieldKey],
  );

  const paths = useMemo(() => {
    if (!selectedOption) return [];

    let list = [];
    if (selectedOption.id === "config") {
      list = buildConfigVariablePaths();
    } else {
      list = buildStepVariablePaths(selectedOption);
    }

    if (typeof hints.filter === "function") {
      list = list.filter(hints.filter);
    }

    return list;
  }, [selectedOption, hints]);

  const recommendedPaths = useMemo(() => {
    const rec = hints.recommended || [];
    const allSources = [
      buildStepVariablePaths({
        id: "trigger",
        stepType: resolvedTriggerType,
      }),
      ...priorSteps.flatMap((n) =>
        buildStepVariablePaths({ id: n.id, label: n.data?.label, stepType: n.data?.stepType }),
      ),
      buildConfigVariablePaths(),
    ].flat();

    const byPath = new Map(allSources.map((p) => [p.path, p]));
    return rec.map((path) => byPath.get(path) || { path, label: path.split(".").pop(), sample: "" });
  }, [hints.recommended, priorSteps, resolvedTriggerType]);

  if (!open) return null;

  const fieldLabel =
    fieldKey === "to"
      ? "recipient"
      : fieldKey === "body"
        ? "message body"
        : fieldKey || "field";

  return (
    <div
      className="isc-modal-overlay open"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="isc-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="isc-modal-header">
          <div className="isc-modal-title">Select Variable from Input</div>
          <button type="button" className="isc-modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="isc-modal-desc">
          Variables come from <strong>{resolvedTriggerLabel}</strong>, prior steps, and workflow
          config. Pick a path for <strong>{fieldLabel}</strong> on{" "}
          <strong>{stepType || "this step"}</strong>.
          {fieldKey === "subject" || fieldKey === "body" ? (
            <>
              {" "}
              For subject/body you can also type inline{" "}
              <code style={{ fontSize: 11 }}>{"{{$.trigger.identityName}}"}</code> in Enter Value
              mode.
            </>
          ) : null}
        </p>

        {recommendedPaths.length > 0 && (
          <div className="isc-modal-section">
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1e6bba", marginBottom: 7 }}>
              Recommended for this field
            </div>
            <div className="isc-var-list">
              {recommendedPaths.map((p) => (
                <div
                  key={`rec-${p.path}`}
                  className={`isc-var-item ${selectedPath === p.path ? "selected" : ""}`}
                  onClick={() => setSelectedPath(p.path)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedPath(p.path)}
                  role="button"
                  tabIndex={0}
                >
                  <input
                    type="radio"
                    name="varsel"
                    checked={selectedPath === p.path}
                    onChange={() => setSelectedPath(p.path)}
                  />
                  <span className="isc-var-item-name">{p.label}</span>
                  <span className="isc-var-item-path">{p.path}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="isc-modal-section">
          <div style={{ fontSize: 12, fontWeight: 700, color: "#3a3a50", marginBottom: 7 }}>
            Select Step
          </div>
          <select
            className="isc-rp-select"
            value={stepKey}
            onChange={(e) => {
              setStepKey(e.target.value);
              setSelectedPath("");
            }}
          >
            {stepOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="isc-modal-section">
          <div style={{ fontSize: 12, fontWeight: 700, color: "#3a3a50", marginBottom: 7 }}>
            Available Variables
            {selectedOption && (
              <span style={{ fontWeight: 400, color: "#888", marginLeft: 6 }}>
                ({paths.length})
              </span>
            )}
          </div>
          {paths.length === 0 ? (
            <p style={{ fontSize: 12, color: "#888" }}>
              No variables match this field from the selected step. Try{" "}
              <strong>{resolvedTriggerLabel}</strong>, <strong>Workflow config</strong>, or use a
              recommended path above.
            </p>
          ) : (
            <div className="isc-var-list">
              {paths.map((p) => (
                <div
                  key={p.path}
                  className={`isc-var-item ${selectedPath === p.path ? "selected" : ""}`}
                  onClick={() => setSelectedPath(p.path)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedPath(p.path)}
                  role="button"
                  tabIndex={0}
                >
                  <input
                    type="radio"
                    name="varsel"
                    checked={selectedPath === p.path}
                    onChange={() => setSelectedPath(p.path)}
                  />
                  <span className="isc-var-item-name">{p.label}</span>
                  <span className="isc-var-item-path">{p.path}</span>
                  {p.igaRef && (
                    <span style={{ fontSize: 10, color: "#999", display: "block", marginLeft: 22 }}>
                      {p.igaRef}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="isc-modal-footer">
          <button type="button" className="isc-btn isc-btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="isc-btn isc-btn-primary"
            disabled={!selectedPath}
            onClick={() => {
              onSave(selectedPath);
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
