import { useMemo, useState } from "react";
import ConfigField from "./ConfigField";
import VariablePickerModal from "../VariablePickerModal";
import {
  getStepDefinition,
  getDefaultVariablePath,
  getFieldVariableHints,
  mergeConfigWithDefaults,
  validateStepConfig,
  computeFieldDisplayValue,
  isFieldVisible,
} from "../../config/stepConfigCatalog";
import BuildCoachPanel from "./BuildCoachPanel";
import { resolveCompareStringsContext } from "../../utils/compareStringsContext";

export default function StepConfigPanel({
  node,
  nodes,
  edges = [],
  onUpdate,
  onDelete,
  triggerType,
  triggerLabel,
  remediationAction,
  coachPanelProps,
}) {
  const [pickerField, setPickerField] = useState(null);
  const [tab, setTab] = useState("basic");
  const [igaOpen, setIgaOpen] = useState(false);
  const [presetMsg, setPresetMsg] = useState(null);

  const stepType = node?.data?.stepType;
  const def = useMemo(() => getStepDefinition(stepType), [stepType]);

  const config = useMemo(() => {
    if (!node || !def) return {};
    const raw = node.data?.config;
    if (!raw || Object.keys(raw).length === 0) {
      return mergeConfigWithDefaults(stepType, {});
    }
    return raw;
  }, [node, def, stepType]);

  const fieldErrors = useMemo(() => {
    if (!node) return {};
    const errs = validateStepConfig(stepType, node.data?.label, config);
    const map = {};
    for (const msg of errs) {
      const fieldDef = def?.fields?.find((f) => msg.includes(f.label));
      if (fieldDef) map[fieldDef.key] = msg;
    }
    return map;
  }, [node, stepType, config, def]);

  const setConfig = (patch) => {
    onUpdate({
      ...node,
      data: {
        ...node.data,
        config: { ...config, ...patch },
      },
    });
  };

  const applyPreset = (preset) => {
    setConfig({ ...preset.config });
    setPresetMsg(`Applied preset: ${preset.label}`);
    setTimeout(() => setPresetMsg(null), 3000);
  };

  const compareContext = useMemo(() => {
    if (stepType !== "CompareStrings" || !node) return null;
    const raw = node.data?.config;
    const cfg =
      !raw || Object.keys(raw).length === 0
        ? mergeConfigWithDefaults(stepType, {})
        : raw;
    return resolveCompareStringsContext({
      nodes,
      edges,
      currentNodeId: node.id,
      triggerType,
      remediationAction,
      config: cfg,
    });
  }, [stepType, node, nodes, edges, triggerType, remediationAction]);

  if (!node) {
    return (
      <div className="isc-rp-empty">
        {coachPanelProps ? (
          <BuildCoachPanel {...coachPanelProps} />
        ) : (
          <div className="isc-rp-empty-card">
            <span className="isc-rp-empty-icon" aria-hidden>
              <svg viewBox="0 0 32 32" width="32" height="32" fill="none">
                <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.25" />
                <path d="M12 16h8M16 12v8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
              </svg>
            </span>
            <h3 className="isc-rp-empty-heading">No step selected</h3>
            <p className="isc-rp-empty-text">
              Click a step on the canvas to edit it, or use Build helper to add steps automatically.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (!def) {
    return (
      <div className="isc-right-panel-inner">
        {coachPanelProps && <BuildCoachPanel {...coachPanelProps} compact />}
        <div className="isc-rp-inner">
          <p style={{ color: "#d93025" }}>Unknown step type: {stepType}</p>
        </div>
      </div>
    );
  }

  const basicFields = (def.fields || []).filter((f) => f.section !== "advanced");
  const advancedFields = (def.fields || []).filter((f) => f.section === "advanced");
  const showAdvanced = def.hasAdvanced && tab === "advanced";
  const fieldsToShow = showAdvanced ? advancedFields : basicFields;
  const hasConfigDescriptionField = (def.fields || []).some((f) => f.key === "description");
  const tabHint = def.tabHints?.[showAdvanced ? "advanced" : "basic"];

  const presetOptions = compareContext?.scenarios?.length
    ? compareContext.scenarios
    : (def.presets || []);

  return (
    <div className="isc-right-panel-inner">
      {coachPanelProps && <BuildCoachPanel {...coachPanelProps} compact />}
      <div className="isc-rp-inner">
        <section className="isc-rp-section">
          <h3 className="isc-rp-section__title">Step information</h3>
          <div className="isc-rp-field">
            <div className="isc-rp-label">
              <span className="isc-rp-label-text">Step name</span>
            </div>
            <input
              className="isc-rp-input"
              value={node.data?.label || ""}
              onChange={(e) => onUpdate({ ...node, data: { ...node.data, label: e.target.value } })}
            />
          </div>
          <div className="isc-rp-field">
            <div className="isc-rp-label">
              <span className="isc-rp-label-text">Step type</span>
            </div>
            <div className="isc-rp-readonly" title={stepType}>
              {def.title || stepType}
            </div>
          </div>
          {!hasConfigDescriptionField && (
            <div className="isc-rp-field">
              <div className="isc-rp-label">
                <span className="isc-rp-label-text">Description</span>
              </div>
              <textarea
                className="isc-rp-textarea"
                rows={3}
                value={config.description || ""}
                onChange={(e) => setConfig({ description: e.target.value })}
                placeholder="Describe this step…"
              />
            </div>
          )}
          {def.help && <p className="isc-rp-desc isc-rp-desc--inline">{def.help}</p>}
        </section>

        <section className="isc-rp-section">
          <div className="isc-rp-section__head">
            <h3 className="isc-rp-section__title">Configuration</h3>
            {onDelete && (
              <button type="button" className="isc-rp-delete" onClick={onDelete}>
                Delete
              </button>
            )}
          </div>

        {def.hasAdvanced && (
          <div className="isc-rp-tabs">
            <button
              type="button"
              className={`isc-rp-tab ${tab === "basic" ? "active" : ""}`}
              onClick={() => setTab("basic")}
            >
              Basic
            </button>
            <button
              type="button"
              className={`isc-rp-tab ${tab === "advanced" ? "active" : ""}`}
              onClick={() => setTab("advanced")}
            >
              Advanced
            </button>
          </div>
        )}

        {tabHint && (
          <p className="isc-rp-tab-hint">{tabHint}</p>
        )}

        {def.infoOnly && (
          <div className="isc-rp-info-banner">
            No configuration required — uses{" "}
            {triggerLabel ? `${triggerLabel} ` : ""}trigger data automatically.
          </div>
        )}

        {compareContext && (
          <div className="isc-compare-guide">
            <div className="isc-compare-guide__title">{compareContext.purposeTitle}</div>
            <p className="isc-compare-guide__text">{compareContext.purposeHint}</p>
            {compareContext.upstreamEmail && (
              <p className="isc-compare-guide__meta">
                Linked email step:{" "}
                <strong>{compareContext.upstreamEmail.data?.label || compareContext.upstreamEmail.id}</strong>
                {" · "}
                <code>{`$.steps.${compareContext.upstreamEmail.id}.queued`}</code>
              </p>
            )}
          </div>
        )}

        {presetOptions.length > 0 && (
          <div className="isc-rp-field">
            <div className="isc-rp-label-text" style={{ marginBottom: 6 }}>
              {compareContext ? "What are you checking?" : "Quick presets"}
            </div>
            <div className="isc-compare-preset-list">
              {presetOptions.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`isc-compare-preset ${p.recommended ? "is-recommended" : ""} ${compareContext?.activeScenario?.id === p.id ? "is-active" : ""}`}
                  onClick={() => applyPreset(p)}
                >
                  <span className="isc-compare-preset__label">
                    {p.label}
                    {p.recommended && (
                      <span className="isc-compare-preset__pill">Suggested</span>
                    )}
                  </span>
                  {p.description && (
                    <span className="isc-compare-preset__desc">{p.description}</span>
                  )}
                </button>
              ))}
            </div>
            {presetMsg && (
              <div style={{ fontSize: 11, color: "#22a05a", marginTop: 4 }}>{presetMsg}</div>
            )}
          </div>
        )}

        {fieldsToShow
          .filter((field) => isFieldVisible(field, config))
          .map((field) => {
            const hints = field.allowVariable
              ? getFieldVariableHints(stepType, field.key)
              : null;
            let recommended = hints?.recommended || [];
            if (
              compareContext?.upstreamEmail
              && field.key === "left"
              && compareContext.upstreamEmail.id
            ) {
              recommended = [
                `$.steps.${compareContext.upstreamEmail.id}.queued`,
                ...recommended,
              ];
            }

            const fieldHelp =
              compareContext?.fieldHints?.[field.key] || field.help;

            return (
              <div key={`${node.id}-${field.key}`}>
                {!showAdvanced && recommended.length > 0 && field.allowVariable && (
                  <div className="isc-rp-recommended-vars">
                    {recommended.slice(0, 4).map((path) => (
                      <button
                        key={path}
                        type="button"
                        className="isc-choose-var-btn isc-choose-var-btn--chip"
                        onClick={() => setConfig({ [field.key]: path })}
                      >
                        {path.replace("$.trigger.", "trigger.").replace("$.steps.", "steps.")}
                      </button>
                    ))}
                  </div>
                )}
                <ConfigField
                  field={{ ...field, help: fieldHelp }}
                  value={config[field.key]}
                  displayValue={computeFieldDisplayValue(field, config, node)}
                  defaultVariablePath={getDefaultVariablePath(stepType, field.key, {
                    nodeLabel: node.data?.label,
                    nodeId: node.id,
                    nodes,
                    edges,
                  })}
                  onChange={(v) => setConfig({ [field.key]: v })}
                  onPickVariable={field.allowVariable ? () => setPickerField(field.key) : undefined}
                  error={fieldErrors[field.key]}
                  nodes={nodes}
                  currentNodeId={node.id}
                  advancedMode={showAdvanced}
                />
              </div>
            );
          })}

        {def.igaFields?.length > 0 && (
          <div className="isc-rp-field">
            <button
              type="button"
              className="isc-choose-var-btn"
              onClick={() => setIgaOpen(!igaOpen)}
            >
              {igaOpen ? "Hide" : "Show"} IGA field mapping (Wisibility)
            </button>
            {igaOpen && (
              <table style={{ width: "100%", fontSize: 11, marginTop: 8, borderCollapse: "collapse" }}>
                <tbody>
                  {(def.igaFields || []).map((row) => (
                    <tr key={row.path} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ fontFamily: "monospace", padding: "4px 0" }}>{row.path}</td>
                      <td style={{ color: "#888", padding: "4px 0 4px 8px" }}>{row.igaRef}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        </section>

        <section className="isc-rp-section isc-rp-section--settings">
          <h3 className="isc-rp-section__title">Settings</h3>
          <label className="isc-rp-switch-row">
            <span className="isc-rp-switch-row__label">Continue on error</span>
            <input
              type="checkbox"
              className="isc-rp-switch"
              checked={Boolean(config.continueOnError)}
              onChange={(e) => setConfig({ continueOnError: e.target.checked })}
            />
          </label>
          <label className="isc-rp-switch-row">
            <span className="isc-rp-switch-row__label">
              Retry on failure
              <span className="isc-rp-switch-row__hint" title="Retry this step once if it fails">
                i
              </span>
            </span>
            <input
              type="checkbox"
              className="isc-rp-switch"
              checked={config.retryOnFailure !== false}
              onChange={(e) => setConfig({ retryOnFailure: e.target.checked })}
            />
          </label>
        </section>

        <div className="isc-rp-status-card">
          <div className="isc-rp-status-card__top">
            <span className="isc-rp-status-card__icon" aria-hidden>
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none">
                <path
                  d="M5 10.5l2.2 2.2L15 5.5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div className="isc-rp-status-card__title">{(node.data?.label || "Step").toUpperCase()}</div>
            <span className="isc-rp-status-card__badge">
              {Object.keys(fieldErrors).length ? "Needs review" : "Complete"}
            </span>
          </div>
          <p className="isc-rp-status-card__desc">
            {config.description || def.help || "Configure this step, then validate the workflow."}
          </p>
          <div
            className={`isc-rp-status-card__pill ${
              Object.keys(fieldErrors).length ? "is-warn" : "is-ok"
            }`}
          >
            {Object.keys(fieldErrors).length ? "Fix highlighted fields" : "Ready to validate"}
          </div>
        </div>
      </div>

      <VariablePickerModal
        open={Boolean(pickerField)}
        onClose={() => setPickerField(null)}
        onSave={(path) => {
          if (pickerField) setConfig({ [pickerField]: path });
          setPickerField(null);
        }}
        nodes={nodes}
        edges={edges}
        currentStepId={node.id}
        fieldKey={pickerField}
        stepType={stepType}
        triggerType={triggerType}
        triggerLabel={triggerLabel}
      />
    </div>
  );
}
