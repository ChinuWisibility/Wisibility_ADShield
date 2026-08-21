/**
 * Update existing "Certification Revoke - Enterprise" workflow definitions in the DB
 * to the latest verify-first orchestration graph from the template.
 *
 * The seed API (seedTemplateHandler) skips workflows that already exist by name, so
 * this script is used to roll an updated graph out to already-seeded tenants without
 * recreating the workflow (preserving its _id, so existing executions keep working).
 *
 * Run from icm-backend:
 *   node scripts/qa/reseedCertRevokeWorkflow.js
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
  "../../src/workflows/templates/cert-revoke-flow.json",
);

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGODB_URI not set");
    process.exit(1);
  }

  const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8"));
  await mongoose.connect(uri, { dbName: process.env.DB_NAME || "IGA-V3" });

  const { default: RemediationWorkflowDefinition } = await import(
    "../../src/models/workflow/RemediationWorkflowDefinition.js"
  );

  const docs = await RemediationWorkflowDefinition.find({ name: template.name });
  if (!docs.length) {
    console.log(`No workflows named "${template.name}" found. Nothing to update.`);
    await mongoose.disconnect();
    return;
  }

  let updated = 0;
  for (const doc of docs) {
    doc.description = template.description;
    doc.trigger = template.trigger;
    doc.nodes = template.nodes;
    doc.edges = template.edges;
    doc.tags = template.tags;
    doc.version = (doc.version || 1) + 1;
    await doc.save();
    updated += 1;
    console.log(
      `Updated workflow ${doc._id} (tenant: ${doc.tenantId || "global"}) → version ${doc.version}, ${template.nodes.length} nodes / ${template.edges.length} edges`,
    );
  }

  console.log(`\nDone. ${updated} workflow(s) updated to the verify-first orchestration graph.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
