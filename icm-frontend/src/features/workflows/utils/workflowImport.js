const MAX_IMPORT_BYTES = 400 * 1024;

const PERSISTED_FIELD_KEYS = new Set([
  "id",
  "_id",
  "createdAt",
  "updatedAt",
  "successCount",
  "errorCount",
  "createdBy",
]);

export function getImportSizeLimitBytes() {
  return MAX_IMPORT_BYTES;
}

export function unwrapWorkflowExport(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid workflow JSON.");
  }
  if (raw.data && typeof raw.data === "object" && (raw.data.nodes || raw.data.trigger)) {
    return raw.data;
  }
  if (raw.nodes || raw.trigger) {
    return raw;
  }
  throw new Error("Invalid workflow JSON. Expected nodes and trigger fields.");
}

export function stripPersistedWorkflowFields(definition) {
  const copy = { ...definition };
  for (const key of PERSISTED_FIELD_KEYS) {
    delete copy[key];
  }
  return copy;
}

export function extractImportMetadata(definition) {
  return {
    name: String(definition?.name || "").trim(),
    description: String(definition?.description || "").trim(),
  };
}

export function prepareImportedWorkflow(raw) {
  const parsed = unwrapWorkflowExport(raw);
  const metadata = extractImportMetadata(parsed);
  const definition = stripPersistedWorkflowFields(parsed);
  return { metadata, definition };
}

export function buildCreatePayloadFromImport(definition, name, description) {
  return {
    ...definition,
    name: String(name || "").trim(),
    description: String(description || "").trim(),
  };
}

export function normalizeWorkflowName(name) {
  return String(name || "").trim().toLowerCase();
}

export function isDuplicateWorkflowName(name, workflows = []) {
  const normalized = normalizeWorkflowName(name);
  if (!normalized) return false;
  return workflows.some((workflow) => normalizeWorkflowName(workflow.name) === normalized);
}

export function suggestCopyWorkflowName(originalName, workflows = []) {
  const base = String(originalName || "").trim() || "Untitled workflow";
  const taken = new Set(workflows.map((workflow) => normalizeWorkflowName(workflow.name)));
  let candidate = `${base} (Copy)`;
  let suffix = 2;
  while (taken.has(normalizeWorkflowName(candidate))) {
    candidate = `${base} (Copy ${suffix})`;
    suffix += 1;
  }
  return candidate;
}

export function formatImportFileSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function summarizeImportedDefinition(definition) {
  if (!definition) return null;
  const nodeCount = definition.nodes?.length || 0;
  const triggerType = definition.trigger?.type || "Unknown";
  return { nodeCount, triggerType };
}

export function readImportFile(file) {
  if (!file) {
    return Promise.reject(new Error("No file selected."));
  }
  if (!/\.json$/i.test(file.name)) {
    return Promise.reject(new Error("Supported file types: .json only."));
  }
  if (!file.size) {
    return Promise.reject(new Error("The selected file is empty."));
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return Promise.reject(new Error("Maximum file size is 400KB."));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (!text.trim()) {
        reject(new Error("The selected file is empty."));
        return;
      }
      try {
        const parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(
            new Error(
              "Invalid workflow JSON. Expected a JSON object with workflow fields (nodes, trigger).",
            ),
          );
          return;
        }
        resolve(parsed);
      } catch (err) {
        const detail = String(err?.message || "").trim();
        reject(
          new Error(
            detail
              ? `Invalid or malformed JSON. ${detail}`
              : "Invalid or malformed JSON file.",
          ),
        );
      }
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsText(file);
  });
}
