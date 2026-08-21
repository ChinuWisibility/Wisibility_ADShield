import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import BlockOutlinedIcon from "@mui/icons-material/BlockOutlined";
import PersonOffOutlinedIcon from "@mui/icons-material/PersonOffOutlined";
import PersonAddAlt1OutlinedIcon from "@mui/icons-material/PersonAddAlt1Outlined";
import RemediationPageShell from "../../remediation-events/components/RemediationPageShell";
import { workflowApi } from "../services/api";
import { useAuth } from "../../../contexts/AuthContext";
import { REMEDIATION_WORKFLOW_EVENTS } from "../config/remediationWorkflowCatalog";
import { getTemplatesForTrigger } from "../config/workflowTriggerRegistry";
import {
  buildCreatePayloadFromImport,
  formatImportFileSize,
  isDuplicateWorkflowName,
  prepareImportedWorkflow,
  readImportFile,
  suggestCopyWorkflowName,
  summarizeImportedDefinition,
} from "../utils/workflowImport";

function apiErrorMessage(error, fallback) {
  return error?.response?.data?.error?.message || error?.response?.data?.message || fallback;
}

const OPTION2_WORKFLOW_NAME = "Access Revoke — Automated (Option 2)";
const TENANT_STORAGE_KEY = "iga_workflows_tenant_id";

function resolveUserTenantId(user) {
  if (!user?.tenantId) return null;
  return typeof user.tenantId === "object"
    ? String(user.tenantId._id || user.tenantId.id || "")
    : String(user.tenantId);
}

async function openSeededWorkflow(seedKey, tenantParams) {
  if (seedKey === "accessRevokeDualNotify") {
    return workflowApi.seedAccessRevokeDualNotifyTemplate(tenantParams);
  }
  if (seedKey === "iamOrphan") {
    return workflowApi.seedIamOrphanTemplate(tenantParams);
  }
  if (seedKey === "accessRevokeOption2") {
    const listRes = await workflowApi.list(tenantParams);
    const wf = (listRes.data.data || []).find((w) => w.name === OPTION2_WORKFLOW_NAME);
    if (wf?.id) {
      return { data: { data: wf } };
    }
    throw new Error(
      `"${OPTION2_WORKFLOW_NAME}" was not found for this tenant. Use Dual notify template or New workflow.`,
    );
  }
  throw new Error("Unknown template.");
}

function ImportStepper({ fileReady, detailsReady }) {
  const steps = [
    { id: "upload", label: "Upload", complete: fileReady, active: !fileReady },
    { id: "details", label: "Details", complete: detailsReady, active: fileReady && !detailsReady },
    { id: "builder", label: "Builder", complete: false, active: false },
  ];

  return (
    <ol className="re-stepper" aria-label="Import progress">
      {steps.map((step, index) => (
        <li key={step.id} className="re-stepper__segment">
          <div
            className={`re-stepper__item ${step.complete ? "is-complete" : ""} ${
              step.active ? "is-active" : ""
            }`}
          >
            <span className="re-stepper__marker" aria-hidden="true">
              {step.complete ? <CheckRoundedIcon sx={{ fontSize: 14 }} /> : index + 1}
            </span>
            <span className="re-stepper__label">{step.label}</span>
          </div>
          {index < steps.length - 1 && (
            <span
              className={`re-stepper__connector ${step.complete ? "is-complete" : ""}`}
              aria-hidden="true"
            />
          )}
        </li>
      ))}
    </ol>
  );
}

function CreatePageShell({ breadcrumbs, title, subtitle, children }) {
  return (
    <div className="isc-remediation-events-feature">
      <RemediationPageShell
        eyebrow="Governance · Automation"
        title={title}
        subtitle={subtitle}
        breadcrumbs={breadcrumbs}
      >
        {children}
      </RemediationPageShell>
    </div>
  );
}

export default function WorkflowCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const effectiveTenantId =
    resolveUserTenantId(user)
    || searchParams.get("tenantId")
    || sessionStorage.getItem(TENANT_STORAGE_KEY)
    || "";
  const tenantParams = useMemo(
    () => (effectiveTenantId ? { tenantId: effectiveTenantId } : {}),
    [effectiveTenantId],
  );
  const fileInputRef = useRef(null);
  const [step, setStep] = useState("choose");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [pendingAutoBuild, setPendingAutoBuild] = useState(false);
  const [nameError, setNameError] = useState("");
  const [nameSuggestion, setNameSuggestion] = useState("");
  const [importedDefinition, setImportedDefinition] = useState(null);
  const [importFileName, setImportFileName] = useState("");
  const [importFileSize, setImportFileSize] = useState(0);
  const [importError, setImportError] = useState("");
  const [importValidationErrors, setImportValidationErrors] = useState([]);
  const [dragActive, setDragActive] = useState(false);

  const resetImportState = () => {
    setImportedDefinition(null);
    setImportFileName("");
    setImportFileSize(0);
    setImportError("");
    setImportValidationErrors([]);
    setNameSuggestion("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetFormState = () => {
    setName("");
    setDescription("");
    setNameError("");
    setNameSuggestion("");
    setPendingAutoBuild(false);
  };

  const ensureUniqueName = (trimmedName, workflows, originalNameForSuggestion) => {
    if (isDuplicateWorkflowName(trimmedName, workflows)) {
      const suggestion = suggestCopyWorkflowName(originalNameForSuggestion || trimmedName, workflows);
      setNameSuggestion(suggestion);
      setNameError(`A workflow named "${trimmedName}" already exists.`);
      return false;
    }
    setNameSuggestion("");
    return true;
  };

  const createWorkflowAndOpen = async (payload, navState) => {
    if (!effectiveTenantId) {
      throw new Error("Select a tenant on the Workflows page before creating a workflow.");
    }
    const res = await workflowApi.create(payload, tenantParams);
    navigate(`/governance/workflows/${res.data.data.id}/edit`, navState ? { state: navState } : undefined);
  };

  const fromTemplate = async () => {
    setCreating(true);
    try {
      if (!effectiveTenantId) {
        throw new Error("Select a tenant on the Workflows page before creating a workflow.");
      }
      const { data } = await workflowApi.template();
      const res = await workflowApi.create(data.data, tenantParams);
      navigate(`/governance/workflows/${res.data.data.id}/edit`);
    } catch (error) {
      alert(apiErrorMessage(error, "Could not create workflow from template."));
    } finally {
      setCreating(false);
    }
  };

  const startEvent = (event, { autoBuild = false } = {}) => {
    resetFormState();
    resetImportState();
    setSelectedEvent(event);
    setPendingAutoBuild(autoBuild);
    setStep("details");
  };

  const useRegistryTemplate = async (event, template) => {
    if (template.kind === "autoBuild") {
      startEvent(event, { autoBuild: true });
      return;
    }
    if (template.kind !== "seed" || !template.seedKey) return;

    setCreating(true);
    try {
      const res = await openSeededWorkflow(template.seedKey, tenantParams);
      const wf = res.data?.data;
      if (wf?.id) {
        navigate(`/governance/workflows/${wf.id}/edit`);
        return;
      }
      alert("Template already exists. Open it from the workflow list.");
      navigate("/governance/workflows");
    } catch (error) {
      alert(apiErrorMessage(error, "Could not open template."));
    } finally {
      setCreating(false);
    }
  };

  const createFromScratch = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Workflow name is required.");
      return;
    }

    setCreating(true);
    setNameError("");
    try {
      const listRes = await workflowApi.list(tenantParams);
      const workflows = listRes.data.data || [];
      if (!ensureUniqueName(trimmed, workflows, trimmed)) {
        return;
      }
      await createWorkflowAndOpen(
        {
          name: trimmed,
          description: description.trim(),
          trigger: selectedEvent ? { type: selectedEvent.triggerType } : { type: "" },
          tags: selectedEvent ? [selectedEvent.tag] : [],
          remediationAction: selectedEvent?.action || undefined,
          nodes: [],
          edges: [],
        },
        pendingAutoBuild ? { runAutoBuild: true } : undefined,
      );
    } catch (error) {
      setNameError(apiErrorMessage(error, "Could not create workflow."));
    } finally {
      setCreating(false);
    }
  };

  const processImportFile = useCallback(async (file) => {
    setUploading(true);
    setImportError("");
    setImportValidationErrors([]);
    setNameError("");
    setNameSuggestion("");
    setStep("import");

    try {
      const raw = await readImportFile(file);
      const { metadata, definition } = prepareImportedWorkflow(raw);
      const validationRes = await workflowApi.validateDefinition(definition);
      const validation = validationRes.data?.data;
      if (!validation?.valid) {
        const errors = validation?.errors?.length
          ? validation.errors
          : ["Workflow validation failed."];
        setImportedDefinition(null);
        setImportFileName(file.name);
        setImportFileSize(file.size);
        setImportError("Import rejected — fix the validation errors below and upload again.");
        setImportValidationErrors(errors);
        return;
      }

      setImportedDefinition(definition);
      setImportFileName(file.name);
      setImportFileSize(file.size);
      setName(metadata.name);
      setDescription(metadata.description);
      setImportError("");
      setImportValidationErrors([]);

      // Flag duplicate names immediately so Open builder is blocked with a suggested copy.
      if (metadata.name) {
        try {
          const listRes = await workflowApi.list(tenantParams);
          const workflows = listRes.data?.data || [];
          if (isDuplicateWorkflowName(metadata.name, workflows)) {
            const suggestion = suggestCopyWorkflowName(metadata.name, workflows);
            setNameSuggestion(suggestion);
            setNameError(`A workflow named "${metadata.name.trim()}" already exists.`);
          }
        } catch {
          // List failure should not block a valid import; create-time check still applies.
        }
      }
    } catch (error) {
      setImportedDefinition(null);
      setImportFileName(file?.name || "");
      setImportFileSize(file?.size || 0);
      setImportValidationErrors([]);
      setImportError(
        apiErrorMessage(error, error?.message || "Invalid or malformed JSON file."),
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const onUploadInput = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void processImportFile(file);
  };

  const onImportDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    void processImportFile(file);
  };

  const createFromImport = async (e) => {
    e.preventDefault();
    if (!importedDefinition) {
      setImportError("Upload a workflow JSON file before continuing.");
      return;
    }

    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Workflow name is required.");
      setNameSuggestion("");
      return;
    }

    setCreating(true);
    setImportError("");
    try {
      const listRes = await workflowApi.list(tenantParams);
      const workflows = listRes.data?.data || [];
      if (!ensureUniqueName(trimmed, workflows, trimmed)) {
        return;
      }

      const payload = buildCreatePayloadFromImport(importedDefinition, trimmed, description);
      const validationRes = await workflowApi.validateDefinition(payload);
      const validation = validationRes.data?.data;
      if (!validation?.valid) {
        setImportValidationErrors(validation?.errors || ["Workflow validation failed."]);
        return;
      }

      await createWorkflowAndOpen(payload);
    } catch (error) {
      const message = apiErrorMessage(
        error,
        `A workflow named "${trimmed}" already exists.`,
      );
      if (error?.response?.status === 409 || /already exists/i.test(message)) {
        setNameError(message);
        const listRes = await workflowApi.list(tenantParams).catch(() => null);
        const workflows = listRes?.data?.data || [];
        setNameSuggestion(suggestCopyWorkflowName(trimmed, workflows));
      } else {
        setImportError(message);
      }
    } finally {
      setCreating(false);
    }
  };

  const applySuggestedName = () => {
    if (!nameSuggestion) return;
    setName(nameSuggestion);
    setNameError("");
    setNameSuggestion("");
  };

  const importSummary = useMemo(
    () => summarizeImportedDefinition(importedDefinition),
    [importedDefinition],
  );

  const detailsReady = Boolean(importedDefinition && name.trim() && !nameError);

  const renderNameField = (inputId) => (
    <div className="re-field">
      <label htmlFor={inputId}>
        Name <span className="re-required">*</span>
      </label>
      <input
        id={inputId}
        type="text"
        className={`re-input ${nameError ? "re-input--error" : ""}`}
        placeholder="e.g. Certification Revoke — Finance"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (nameError) setNameError("");
          if (nameSuggestion) setNameSuggestion("");
        }}
        autoFocus={step !== "import"}
      />
      {nameError && (
        <div className="re-field-hint" role="alert">
          <div>
            <p style={{ margin: 0 }}>{nameError}</p>
            {nameSuggestion && (
              <button type="button" className="re-btn re-btn--secondary" style={{ marginTop: 8 }} onClick={applySuggestedName}>
                Use: {nameSuggestion}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const renderImportDropzone = () => {
    const hasValidImport = Boolean(importedDefinition);
    const hasRejectedFile = Boolean(importFileName && !importedDefinition && !uploading);

    return (
    <div
      className={`re-dropzone ${dragActive ? "is-active" : ""} ${hasValidImport ? "is-ready" : ""} ${
        hasRejectedFile ? "is-error" : ""
      }`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragActive(false);
      }}
      onDrop={onImportDrop}
    >
      {uploading ? (
        <>
          <UploadFileOutlinedIcon sx={{ fontSize: 28, color: "#2563eb" }} />
          <p className="re-dropzone__title">Validating definition…</p>
          <p className="re-dropzone__subtitle">Checking workflow structure and step configuration.</p>
        </>
      ) : hasValidImport ? (
        <>
          <CheckRoundedIcon sx={{ fontSize: 28, color: "#059669" }} />
          <p className="re-dropzone__title">Definition ready</p>
          <div className="re-file-chip">
            <UploadFileOutlinedIcon sx={{ fontSize: 18, color: "#64748b" }} />
            <span>
              <span className="re-file-chip__name" title={importFileName}>{importFileName}</span>
              <span className="re-file-chip__size"> · {formatImportFileSize(importFileSize)}</span>
            </span>
          </div>
        </>
      ) : hasRejectedFile ? (
        <>
          <BlockOutlinedIcon sx={{ fontSize: 28, color: "#dc2626" }} />
          <p className="re-dropzone__title">Import rejected</p>
          <div className="re-file-chip">
            <UploadFileOutlinedIcon sx={{ fontSize: 18, color: "#64748b" }} />
            <span>
              <span className="re-file-chip__name" title={importFileName}>{importFileName}</span>
              <span className="re-file-chip__size"> · {formatImportFileSize(importFileSize)}</span>
            </span>
          </div>
          <p className="re-dropzone__subtitle">Upload a valid workflow JSON to continue.</p>
        </>
      ) : (
        <>
          <UploadFileOutlinedIcon sx={{ fontSize: 28, color: "#64748b" }} />
          <p className="re-dropzone__title">Drag and drop JSON here</p>
          <p className="re-dropzone__subtitle">
            Exported definitions from this builder or SailPoint are supported.
          </p>
        </>
      )}

      <label className="re-btn re-btn--secondary re-btn-file">
        {uploading ? "Uploading…" : importFileName ? "Replace file" : "Choose file"}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={onUploadInput}
          disabled={uploading || creating}
        />
      </label>

      <div className="re-dropzone__meta">
        <span>.json only</span>
        <span>Max 400 KB</span>
      </div>
    </div>
    );
  };

  if (step === "import") {
    return (
      <CreatePageShell
        breadcrumbs={[
          { label: "Workflows", to: "/governance/workflows" },
          { label: "Import JSON" },
        ]}
        title="Import workflow"
        subtitle="Upload a JSON definition, review details, then open the builder."
      >
        <ImportStepper fileReady={Boolean(importedDefinition)} detailsReady={detailsReady} />

        <form onSubmit={createFromImport} className="re-form-panel re-form-panel--wide">
          <div className="re-form">
            {renderImportDropzone()}

            {importSummary && (
              <div className="re-alert re-alert--success" role="status">
                <CheckRoundedIcon sx={{ fontSize: 18, flexShrink: 0 }} />
                <div>
                  <strong>Definition validated</strong>
                  <div style={{ fontSize: "0.82rem", marginTop: 2 }}>
                    {importSummary.nodeCount} step{importSummary.nodeCount === 1 ? "" : "s"} · Trigger: {importSummary.triggerType}
                  </div>
                </div>
              </div>
            )}

            {(importError || importValidationErrors.length > 0) && (
              <div className="re-alert re-alert--error" role="alert">
                <div>
                  {importError && (
                    <p style={{ margin: importValidationErrors.length ? "0 0 8px" : 0 }}>
                      <strong>{importError}</strong>
                    </p>
                  )}
                  {importValidationErrors.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {importValidationErrors.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {renderNameField("wf-import-name")}

            <div className="re-field">
              <label htmlFor="wf-import-desc">Description</label>
              <textarea
                id="wf-import-desc"
                className="re-textarea"
                placeholder="What this workflow does when it runs…"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="re-form-actions">
              <button
                type="button"
                className="re-btn re-btn--secondary"
                onClick={() => {
                  resetImportState();
                  resetFormState();
                  setStep("choose");
                }}
                disabled={creating || uploading}
              >
                Back
              </button>
              <button
                type="submit"
                className="re-btn re-btn--primary"
                disabled={creating || uploading || !importedDefinition || Boolean(nameError)}
              >
                {creating ? "Creating…" : "Open builder"}
              </button>
            </div>
          </div>
        </form>
      </CreatePageShell>
    );
  }

  if (step === "details") {
    return (
      <CreatePageShell
        breadcrumbs={[
          { label: "Workflows", to: "/governance/workflows" },
          { label: selectedEvent ? `${selectedEvent.title} workflow` : "Workflow details" },
        ]}
        title={selectedEvent ? `New ${selectedEvent.title} workflow` : "Workflow details"}
        subtitle={
          selectedEvent
            ? pendingAutoBuild
              ? `Starter flow for "${selectedEvent.triggerLabel}" — name it, then we build the recommended steps on the canvas (edit anything after).`
              : `Trigger is fixed to "${selectedEvent.triggerLabel}". Name it, then compose steps on the canvas.`
            : "Name your workflow. You will add triggers and steps on the canvas next."
        }
      >
        <div className="re-form-panel">
          <form onSubmit={createFromScratch} className="re-form">
            {selectedEvent && (
              <div className="re-alert re-alert--success" role="status" style={{ marginBottom: 4 }}>
                <CheckRoundedIcon sx={{ fontSize: 18, flexShrink: 0 }} />
                <div>
                  <strong>{selectedEvent.badge}</strong>
                  <div style={{ fontSize: "0.82rem", marginTop: 2 }}>
                    Trigger: {selectedEvent.triggerLabel} · Tag: {selectedEvent.tag}
                    {pendingAutoBuild ? " · Starter flow will be built on open" : ""}
                  </div>
                </div>
              </div>
            )}
            {renderNameField("wf-name")}

            <div className="re-field">
              <label htmlFor="wf-desc">Description</label>
              <textarea
                id="wf-desc"
                className="re-textarea"
                placeholder="What this workflow does when it runs…"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="re-form-actions">
              <button
                type="button"
                className="re-btn re-btn--secondary"
                onClick={() => {
                  setSelectedEvent(null);
                  setStep("choose");
                }}
                disabled={creating}
              >
                Back
              </button>
              <button type="submit" className="re-btn re-btn--primary" disabled={creating}>
                {creating
                  ? "Creating…"
                  : pendingAutoBuild
                    ? "Create and build starter flow"
                    : "Create and open builder"}
              </button>
            </div>
          </form>
        </div>
      </CreatePageShell>
    );
  }

  const eventIcon = (action) => {
    if (action === "ACCESS_REVOKE") return <BlockOutlinedIcon fontSize="small" />;
    if (action === "JOINER") return <PersonAddAlt1OutlinedIcon fontSize="small" />;
    return <PersonOffOutlinedIcon fontSize="small" />;
  };

  const eventAccentClass = (accent) => {
    if (accent === "green" || accent === "blue") return "blue";
    if (accent === "amber") return "violet";
    return "violet";
  };

  return (
    <CreatePageShell
      breadcrumbs={[{ label: "Workflows", to: "/governance/workflows" }, { label: "Create workflow" }]}
      title="Create workflow"
      subtitle="Pick a remediation event to build a workflow for. The trigger is set automatically — you compose the steps."
    >
      <div className="re-choice-grid">
        {REMEDIATION_WORKFLOW_EVENTS.map((event) => {
          const templates = getTemplatesForTrigger(event.triggerType).filter(
            (t) => t.id !== "mvp-auto",
          );
          const accentClass = eventAccentClass(event.accent);

          return (
            <article
              key={event.action}
              className={`re-choice-card re-choice-card--${accentClass}`}
            >
              <div className="re-choice-card__header">
                <div className={`re-choice-card__icon re-choice-card__icon--${accentClass}`}>
                  {eventIcon(event.action)}
                </div>
                {event.action === "ACCESS_REVOKE" && (
                  <span className="re-choice-card__badge">Recommended</span>
                )}
              </div>
              <h3 className="re-choice-card__title">{event.title} workflow</h3>
              <p className="re-choice-card__desc">{event.description}</p>
              <div className="re-choice-card__footer re-choice-card__footer--stack">
                <button
                  type="button"
                  className="re-btn re-btn--primary re-btn--block"
                  onClick={() => startEvent(event, { autoBuild: true })}
                  disabled={creating || uploading}
                >
                  Build recommended MVP
                </button>
                <button
                  type="button"
                  className="re-btn re-btn--secondary re-btn--block"
                  onClick={() => startEvent(event)}
                  disabled={creating || uploading}
                >
                  Start from scratch
                </button>
                {templates.length > 0 && (
                  <div className="re-choice-card__templates">
                    {templates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className="re-btn re-btn--ghost re-btn--block"
                        onClick={() => useRegistryTemplate(event, template)}
                        disabled={creating || uploading}
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="re-choice-grid" style={{ marginTop: 16 }}>
        <article className="re-choice-card re-choice-card--teal">
          <div className="re-choice-card__header">
            <div className="re-choice-card__icon re-choice-card__icon--teal">
              <AutoAwesomeOutlinedIcon fontSize="small" />
            </div>
            <span className="re-choice-card__badge">Advanced</span>
          </div>
          <h3 className="re-choice-card__title">Enterprise template</h3>
          <p className="re-choice-card__desc">
            Pre-built certification revoke flow with verify, notifications, and IAM escalation.
          </p>
          <div className="re-choice-card__footer">
            <button
              type="button"
              className="re-btn re-btn--secondary re-btn--block"
              onClick={fromTemplate}
              disabled={creating || uploading}
            >
              {creating ? "Loading…" : "Use template"}
            </button>
          </div>
        </article>

        <article className="re-choice-card re-choice-card--teal">
          <div className="re-choice-card__header">
            <div className="re-choice-card__icon re-choice-card__icon--teal">
              <UploadFileOutlinedIcon fontSize="small" />
            </div>
            <span className="re-choice-card__badge">Advanced</span>
          </div>
          <h3 className="re-choice-card__title">Import JSON</h3>
          <p className="re-choice-card__desc">
            Upload a workflow definition exported from this builder or SailPoint.
          </p>
          <div className="re-choice-card__footer">
            <button
              type="button"
              className="re-btn re-btn--secondary re-btn--block"
              onClick={() => {
                resetFormState();
                resetImportState();
                setStep("import");
              }}
              disabled={creating || uploading}
            >
              Import JSON
            </button>
          </div>
        </article>
      </div>
    </CreatePageShell>
  );
}
