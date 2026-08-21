/**
 * Pre-demo readiness check for JML provisioning.
 *
 * Usage:
 *   node src/scripts/provisioning/checkDemoReadiness.js "Test Tenant"
 *
 * Reports whether a tenant can run the full chain:
 *   create identity -> JOINER event -> provisioning request -> approve -> plan -> task -> CSV account
 * Read-only: it never writes.
 */

import "dotenv/config";
import mongoose from "mongoose";
import Tenant from "../../models/platform/Tenant.js";
import Application from "../../models/application/Application.js";
import IdentityProvisioningRule from "../../models/provisioning/IdentityProvisioningRule.js";
import RemediationWorkflowDefinition from "../../models/workflow/RemediationWorkflowDefinition.js";
import { resolveConnectorFamily } from "../../services/provisioning/provisioningCapabilityCatalog.js";

const OK = "PASS";
const BAD = "FAIL";
const WARN = "WARN";

function line(state, message, hint) {
  const prefix = state === OK ? "  [PASS]" : state === WARN ? "  [WARN]" : "  [FAIL]";
  console.log(`${prefix} ${message}`);
  if (hint && state !== OK) console.log(`         -> ${hint}`);
}

async function main() {
  const tenantName = process.argv[2] || "Test Tenant";
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await mongoose.connect(uri, { dbName: process.env.DB_NAME || undefined });

  const tenant = await Tenant.findOne({
    $or: [{ name: tenantName }, { code: tenantName }],
  }).lean();

  console.log(`\nJML provisioning readiness — "${tenantName}"\n`);

  if (!tenant) {
    line(BAD, `No tenant named "${tenantName}"`, "Check the exact tenant name in Org Admin.");
    await mongoose.disconnect();
    process.exit(1);
  }
  line(OK, `Tenant found (${tenant._id})`);

  console.log("\nEnvironment flags");
  const lifecycleWorker = String(process.env.LIFECYCLE_WORKER_ENABLED ?? "true") !== "false";
  line(
    lifecycleWorker ? OK : BAD,
    `LIFECYCLE_WORKER_ENABLED=${process.env.LIFECYCLE_WORKER_ENABLED ?? "(unset, defaults true)"}`,
    "Without it, JOINER events are detected but never processed.",
  );
  const provisioningWorker =
    String(process.env.PROVISIONING_WORKER_ENABLED).toLowerCase() === "true";
  line(
    provisioningWorker ? OK : WARN,
    `PROVISIONING_WORKER_ENABLED=${process.env.PROVISIONING_WORKER_ENABLED ?? "(unset, defaults false)"}`,
    "Approved tasks will stay PENDING; you must click Run on each task in the UI.",
  );

  console.log("\nProvisioning rules");
  const rules = await IdentityProvisioningRule.find({ tenantId: tenant._id }).lean();
  const enabledRules = rules.filter((r) => r.enabled !== false);
  if (!rules.length) {
    line(BAD, "No provisioning rules", "Governance > Provisioning > Rules > New rule.");
  } else if (!enabledRules.length) {
    line(BAD, `${rules.length} rule(s), all disabled`, "Enable at least one rule.");
  } else {
    line(OK, `${enabledRules.length} enabled rule(s)`);
    for (const rule of enabledRules) {
      const conditions = (rule.conditions || [])
        .map((c) => `${c.field} ${c.operator} "${c.value}"`)
        .join(` ${rule.conditionLogic || "AND"} `);
      console.log(`         "${rule.name}": ${conditions || "(no conditions)"}`);
      if (!rule.conditions?.length) {
        line(WARN, `  Rule "${rule.name}" has no conditions`, "It will not match any identity.");
      }
    }
  }

  console.log("\nTarget applications");
  const ruleAppIds = [
    ...new Set(
      enabledRules.flatMap((r) => (r.actions || []).map((a) => String(a.applicationId))),
    ),
  ].filter(Boolean);

  if (!ruleAppIds.length) {
    line(BAD, "No rule targets an application", "Add an ENSURE_ACCOUNT action to a rule.");
  } else {
    const apps = await Application.find({
      _id: { $in: ruleAppIds },
      tenantId: tenant._id,
    }).lean();
    const found = new Set(apps.map((a) => String(a._id)));
    for (const id of ruleAppIds) {
      if (!found.has(id)) {
        line(BAD, `Rule targets application ${id} which is not in this tenant`);
      }
    }
    for (const app of apps) {
      const family = resolveConnectorFamily(app);
      const csvReady =
        family === "file_delimited" || app.connectionConfig?.provisioningTestMode === "csv";
      const adReady = family === "ldap_ad" || Boolean(app.connectionConfig?.ad);
      if (csvReady) {
        line(OK, `"${app.name}" resolves to the CSV connector (family=${family})`);
      } else if (adReady) {
        line(OK, `"${app.name}" resolves to the AD connector (family=${family})`);
      } else {
        line(
          BAD,
          `"${app.name}" has no provisioning connector (connectorType=${app.connectorType || "none"}, family=${family})`,
          'Set connectionConfig.provisioningTestMode = "csv" to use the CSV test connector.',
        );
      }
      if (app.status && app.status !== "active") {
        line(WARN, `"${app.name}" status is ${app.status}`, "Inactive apps are skipped by policy evaluation.");
      }
      if (!app.userMappings?.length) {
        line(
          WARN,
          `"${app.name}" has no userMappings`,
          "The CSV connector maps identity attributes through these; the row may be nearly empty.",
        );
      }
    }
  }

  console.log("\nApproval workflow");
  const joinerWorkflow = await RemediationWorkflowDefinition.findOne({
    tenantId: String(tenant._id),
    $or: [{ name: /joiner/i }, { tags: "JOINER" }],
  }).lean();
  const globalJoinerWorkflow = joinerWorkflow
    ? null
    : await RemediationWorkflowDefinition.findOne({
      tenantId: null,
      $or: [{ name: /joiner/i }, { tags: "JOINER" }],
    }).lean();

  if (joinerWorkflow) {
    line(OK, `Tenant-owned Joiner workflow "${joinerWorkflow.name}"`);
  } else if (globalJoinerWorkflow) {
    line(
      WARN,
      `Only a global Joiner template ("${globalJoinerWorkflow.name}") exists`,
      "Copy it into the tenant via Workflows > Template library so the demo shows a tenant workflow.",
    );
  } else {
    line(
      WARN,
      "No Joiner workflow definition",
      "Approval still works from the Provisioning UI; only the workflow visualisation is missing.",
    );
  }

  console.log("");
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("readiness check failed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
