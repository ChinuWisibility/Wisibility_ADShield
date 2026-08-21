import { useState } from "react";
import { humanizeVariablePath } from "../../utils/variablePathLabels.js";

function isVariableValue(val) {
  return typeof val === "string" && val.trim().startsWith("$");
}

function resolveVariableDefault(field, defaultVariablePath) {
  return defaultVariablePath || field.placeholder || "";
}

function detectInputMode(value, variableDefault, allowVariable) {
  if (!allowVariable) return "value";
  const s = String(value ?? "").trim();
  if (!s) return "value";
  if (variableDefault && s === variableDefault) return "auto";
  if (isVariableValue(s)) return "variable";
  return "value";
}

export default function ConfigField({
  field,
  value,
  displayValue,
  defaultVariablePath = "",
  onChange,
  onPickVariable,
  error,
  nodes = [],
  currentNodeId,
  advancedMode = false,
}) {
  const showError = Boolean(error);
  const variableDefault = resolveVariableDefault(field, defaultVariablePath);

  const [inputMode, setInputMode] = useState(() =>
    detectInputMode(value, variableDefault, field.allowVariable),
  );

  if (field.type === "readonly") {
    const shown = displayValue ?? field.value ?? value ?? "—";
    return (
      <div className="isc-rp-field">
        <div className="isc-rp-label">
          <span className="isc-rp-label-text">{field.label}</span>
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 12 }}>{shown}</div>
        {field.help && !showError && (
          <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{field.help}</div>
        )}
        {field.igaRef && (
          <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>IGA: {field.igaRef}</div>
        )}
      </div>
    );
  }

  const header = (
    <div className="isc-rp-label">
      <span className="isc-rp-label-text">
        {field.label}
        {field.required ? (
          <span style={{ color: "#d93025" }}> *</span>
        ) : (
          <span className="isc-rp-optional"> (optional)</span>
        )}
      </span>
      {field.allowVariable && (
        <select
          className="isc-mode-select"
          value={inputMode}
          onChange={(e) => {
            const mode = e.target.value;
            setInputMode(mode);
            if (mode === "auto" && variableDefault) {
              onChange(variableDefault);
            } else if (mode === "variable") {
              onChange(isVariableValue(value) ? value : variableDefault || "");
            } else if (mode === "value") {
              onChange(isVariableValue(value) ? "" : (value ?? ""));
            }
          }}
          aria-label={`${field.label} input mode`}
        >
          <option value="value">Enter Value</option>
          {variableDefault ? <option value="auto">Auto</option> : null}
          <option value="variable">Choose Variable</option>
        </select>
      )}
    </div>
  );

  if (field.type === "select") {
    return (
      <div className="isc-rp-field">
        {header}
        <select
          className="isc-rp-select"
          value={value ?? field.options?.[0]?.value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options || []).map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.implemented === false}>
              {opt.label}
            </option>
          ))}
        </select>
        {field.help && !showError && (
          <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{field.help}</div>
        )}
        {showError && <div style={{ fontSize: 11, color: "#d93025", marginTop: 4 }}>{error}</div>}
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <div className="isc-rp-field">
        {header}
        <input
          className="isc-rp-input"
          type="number"
          min={field.min}
          max={field.max}
          value={value ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" ? "" : Number(raw));
          }}
          placeholder={field.placeholder}
        />
        {showError ? (
          <div style={{ fontSize: 11, color: "#d93025", marginTop: 4 }}>{error}</div>
        ) : (
          field.help && (
            <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{field.help}</div>
          )
        )}
      </div>
    );
  }

  if (field.type === "toggle") {
    const checked = value !== false && value !== "false";
    return (
      <div className="isc-rp-field">
        <div className="isc-rp-label">
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span className="isc-rp-label-text">{field.label}</span>
          </label>
        </div>
        {showError ? (
          <div style={{ fontSize: 11, color: "#d93025", marginTop: 4 }}>{error}</div>
        ) : (
          field.help && (
            <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{field.help}</div>
          )
        )}
      </div>
    );
  }

  if (field.type === "stepSelect") {
    const stepOptions = nodes.filter((n) => n.id !== currentNodeId);
    return (
      <div className="isc-rp-field">
        {header}
        <select
          className="isc-rp-select"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select a step…</option>
          {stepOptions.map((n) => (
            <option key={n.id} value={n.id}>
              {n.data?.label || n.id} ({n.id})
            </option>
          ))}
        </select>
        {showError ? (
          <div style={{ fontSize: 11, color: "#d93025", marginTop: 4 }}>{error}</div>
        ) : (
          field.help && (
            <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{field.help}</div>
          )
        )}
      </div>
    );
  }

  const isTextarea = field.type === "textarea";
  const autoMode = field.allowVariable && inputMode === "auto";
  const variableMode = field.allowVariable && inputMode === "variable";
  const valueMode = !field.allowVariable || inputMode === "value";
  const basicVariableField = field.allowVariable && !advancedMode && !valueMode;

  return (
    <div className="isc-rp-field">
      {header}
      {basicVariableField ? (
        <div className="isc-rp-basic-variable">
          <div className="isc-rp-basic-variable__value">
            {humanizeVariablePath(value || variableDefault)}
          </div>
          {variableMode && onPickVariable && (
            <div className="isc-rp-basic-variable__actions">
              <button
                type="button"
                className="isc-choose-var-btn"
                onClick={() => onPickVariable(field.key)}
              >
                Choose variable
              </button>
            </div>
          )}
        </div>
      ) : autoMode && advancedMode ? (
        <div className="isc-rp-jsonpath">
          <input
            className="isc-rp-input"
            value={value ?? variableDefault}
            readOnly
            style={{ background: "#f8fafc", color: "#334155" }}
          />
          <span className="isc-rp-jsonpath-icon">{"{}"}</span>
        </div>
      ) : variableMode && advancedMode ? (
        <div className="isc-rp-jsonpath">
          <input
            className="isc-rp-input"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={variableDefault || "$.trigger.identityEmail"}
          />
          <span className="isc-rp-jsonpath-icon">{"{}"}</span>
        </div>
      ) : isTextarea ? (
        <textarea
          className="isc-rp-textarea"
          rows={field.rows || 5}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      ) : (
        <input
          className="isc-rp-input"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )}
      {variableMode && advancedMode && onPickVariable && (
        <button type="button" className="isc-open-var-btn" onClick={() => onPickVariable(field.key)}>
          <span>{"{}"}</span> Open Variable Selector
        </button>
      )}
      {autoMode && variableDefault && advancedMode && (
        <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
          Filled automatically. Switch to <strong>Choose Variable</strong> or <strong>Enter Value</strong> to edit or clear.
        </div>
      )}
      {field.igaRef && !showError && (
        <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>IGA: {field.igaRef}</div>
      )}
      {showError ? (
        <div style={{ fontSize: 11, color: "#d93025", marginTop: 4 }}>{error}</div>
      ) : (
        field.help && (
          <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{field.help}</div>
        )
      )}
      {field.supportsInline && (
        <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
          Use {"{{$.trigger.field}}"} for inline variables in subject/body.
        </div>
      )}
    </div>
  );
}
