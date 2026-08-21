/**
 * Create or update "Certification Revoke - Simple Test" from template.
 *
 * Run from icm-backend:
 *   node scripts/qa/seedSimpleCertWorkflow.js
 *   node scripts/qa/seedSimpleCertWorkflow.js --name "fdfdf"
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(
  __dirname,
  "../../src/workflows/templates/cert-revoke-simple-test.json",
);

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGODB_URI not set");
    process.exit(1);
  }

  const nameArg = process.argv.find((a) => a.startsWith("--name="));
  const overrideName = nameArg ? nameArg.slice("--name=".length).trim() : null;

  const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8"));
  const workflowName = overrideName || template.name;

  await mongoose.connect(uri, { dbName: process.env.DB_NAME || "IGA-V3" });

  const { default: RemediationWorkflowDefinition } = await import(
    "../../src/models/workflow/RemediationWorkflowDefinition.js"
  );

  let doc = await RemediationWorkflowDefinition.findOne({ name: workflowName });
  if (doc) {
    doc.description = template.description;
    doc.trigger = template.trigger;
    doc.nodes = template.nodes;
    doc.edges = template.edges;
    doc.tags = template.tags;
    doc.enabled = template.enabled !== false;
    doc.version = (doc.version || 1) + 1;
    await doc.save();
    console.log(`Updated workflow "${workflowName}" (${doc._id}) → v${doc.version}`);
  } else {
    doc = await RemediationWorkflowDefinition.create({
      tenantId: null,
      name: workflowName,
      description: template.description,
      trigger: template.trigger,
      nodes: template.nodes,
      edges: template.edges,
      tags: template.tags,
      enabled: template.enabled !== false,
      version: 1,
    });
    console.log(`Created workflow "${workflowName}" (${doc._id})`);
  }

  console.log(`Nodes: ${template.nodes.length}, edges: ${template.edges.length}`);
  console.log("Open Governance → Workflows → edit this workflow to test.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
