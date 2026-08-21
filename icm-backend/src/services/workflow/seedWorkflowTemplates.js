import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import RemediationWorkflowDefinition from "../../models/workflow/RemediationWorkflowDefinition.js";
import { createGlobalWorkflowTemplate } from "../../workflows/persistence/workflowStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CERT_REVOKE_TEMPLATE = path.join(__dirname, "../../workflows/templates/cert-revoke-flow.json");
const IAM_ORPHAN_TEMPLATE = path.join(__dirname, "../../workflows/templates/iam-orphan-review-flow.json");
const JOINER_TEMPLATE = path.join(__dirname, "../../workflows/templates/joiner-provision-flow.json");
const LIFECYCLE_UPDATE_TEMPLATE = path.join(
  __dirname,
  "../../workflows/templates/lifecycle-update-flow.json",
);
const LIFECYCLE_DISABLE_TEMPLATE = path.join(
  __dirname,
  "../../workflows/templates/lifecycle-disable-flow.json",
);
const ACCESS_REVOKE_OPTION2_TEMPLATE = path.join(
  __dirname,
  "../../workflows/templates/access-revoke-option2-flow.json",
);
const ACCESS_REVOKE_OPTION1_TEMPLATE = path.join(
  __dirname,
  "../../workflows/templates/access-revoke-option1-flow.json",
);

function readTemplate(templatePath) {
  return JSON.parse(fs.readFileSync(templatePath, "utf8"));
}

async function seedIdempotent(templatePath) {
  const template = readTemplate(templatePath);
  const existing = await RemediationWorkflowDefinition.findOne({
    name: template.name,
    $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
  }).lean();
  if (existing) return;
  await createGlobalWorkflowTemplate(template, "system");
  console.log(`[seedWorkflowTemplates] Seeded global template: "${template.name}"`);
}

export async function seedWorkflowTemplates() {
  try {
    await seedIdempotent(CERT_REVOKE_TEMPLATE);
  } catch (err) {
    console.warn("[seedWorkflowTemplates] cert-revoke seed failed:", err.message);
  }

  try {
    // Automated MVP access-revoke starter (Option 2) — default ACCESS_REVOKE workflow.
    await seedIdempotent(ACCESS_REVOKE_OPTION2_TEMPLATE);
  } catch (err) {
    console.warn("[seedWorkflowTemplates] access-revoke-option2 seed failed:", err.message);
  }

  try {
    // Human-in-the-loop access-revoke starter (Option 1) — optional, not the default.
    await seedIdempotent(ACCESS_REVOKE_OPTION1_TEMPLATE);
  } catch (err) {
    console.warn("[seedWorkflowTemplates] access-revoke-option1 seed failed:", err.message);
  }

  try {
    // Do not force-reseed IAM orphan on every boot — that deletes builder customizations.
    await seedIdempotent(IAM_ORPHAN_TEMPLATE);
  } catch (err) {
    console.warn("[seedWorkflowTemplates] iam-orphan seed failed:", err.message);
  }

  try {
    await seedIdempotent(JOINER_TEMPLATE);
  } catch (err) {
    console.warn("[seedWorkflowTemplates] joiner seed failed:", err.message);
  }

  try {
    await seedIdempotent(LIFECYCLE_UPDATE_TEMPLATE);
  } catch (err) {
    console.warn("[seedWorkflowTemplates] lifecycle-update seed failed:", err.message);
  }

  try {
    await seedIdempotent(LIFECYCLE_DISABLE_TEMPLATE);
  } catch (err) {
    console.warn("[seedWorkflowTemplates] lifecycle-disable seed failed:", err.message);
  }
}
