function IconBack() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden>
      <path
        d="M12.5 4.5L7 10l5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.5 10h13M10 3.5c2 2.2 2 10.8 0 13M10 3.5c-2 2.2-2 10.8 0 13"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9v4.5M10 6.5h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconSave() {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden>
      <path
        d="M4 4.5h9.5L16 7v8.5H4V4.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M7 4.5v4h6v-4M7 15.5v-4h6v4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden>
      <path d="M7 5.5v9l8-4.5-8-4.5z" fill="currentColor" />
    </svg>
  );
}

export default function WorkflowEditorHeader({
  workflowName,
  remediationBadge,
  remediationAccent,
  triggerLabel,
  onBack,
  onDetails,
  onGlobalRuleSet,
  onSave,
  onTest,
  saving,
  isDirty,
}) {
  return (
    <header className="isc-builder-toolbar">
      <div className="isc-builder-toolbar-left">
        <button type="button" className="isc-back-btn" onClick={onBack}>
          <IconBack />
          Workflows
        </button>
        <span className="isc-builder-toolbar-divider" aria-hidden />
        <div className="isc-builder-title-block">
          <div className="isc-builder-title-row">
            <h1 className="isc-builder-wf-title" title={workflowName}>
              {workflowName || "Untitled workflow"}
            </h1>
            {remediationBadge && (
              <span
                className="isc-builder-remediation-badge"
                data-accent={remediationAccent || "green"}
                title="Fixed remediation event for this workflow"
              >
                {remediationBadge}
              </span>
            )}
            {isDirty && <span className="isc-builder-dirty-badge">Unsaved</span>}
          </div>
          <p className="isc-builder-subtitle">
            {triggerLabel
              ? `Trigger: ${triggerLabel} · visual editor`
              : "Remediation workflow · visual editor"}
          </p>
        </div>
      </div>
      <div className="isc-builder-toolbar-right">
        {onGlobalRuleSet && (
          <button type="button" className="isc-toolbar-link" onClick={onGlobalRuleSet}>
            <IconGlobe />
            Global Rule Set
          </button>
        )}
        <button type="button" className="isc-toolbar-link" onClick={onDetails}>
          <IconInfo />
          Workflow details
        </button>
        <button
          type="button"
          className="isc-btn isc-btn-outline isc-btn-with-icon"
          onClick={onSave}
          disabled={saving}
        >
          <IconSave />
          {saving ? "Saving…" : isDirty ? "Save *" : "Save"}
        </button>
        <button type="button" className="isc-btn isc-btn-primary isc-btn-with-icon" onClick={onTest}>
          <IconPlay />
          Test workflow
        </button>
      </div>
    </header>
  );
}
