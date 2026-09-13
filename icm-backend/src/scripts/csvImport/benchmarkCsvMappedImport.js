#!/usr/bin/env node
/**
 * CSV Map & Import performance + DB equivalence benchmark.
 *
 * Usage:
 *   node src/scripts/csvImport/benchmarkCsvMappedImport.js [--sizes=5000,50000,100000] [--skip-equivalence]
 *
 * Env:
 *   MONGODB_URI (from .env)
 *   CSV_IMPORT_FIXTURE (default: ~/Downloads/hr_users_master.csv)
 *   CSV_IMPORT_USE_NATIVE_DRIVER=0|1
 *
 * Exit 1 if performance budgets or equivalence fail.
 */
import fs from "fs";
import path from "path";
import os from "os";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import Tenant from "../../models/platform/Tenant.js";
import Application from "../../models/application/Application.js";
import IdentitySyncState from "../../models/sync/IdentitySyncState.js";
import ApplicationUserDuplicate from "../../models/application/ApplicationUserDuplicate.js";
import { getDynamicUserModel } from "../../models/application/Users.js";
import { getReconciliationModels } from "../../utils/reconciliationCollections.js";
import { resolveTenantSlugFromTenantId } from "../../utils/applicationDynamicCollections.js";
import { applicationIdInClause } from "../../services/application/applicationUserIngestService.js";
import { runCsvImportEngine } from "../../services/csvImport/csvImportEngine.js";
import { runCsvMappedReconciliation } from "../../services/reconciliation/strategies/index.js";
import { ingestApplicationUsersWithReconciliation } from "../../services/reconciliation/ingestWithReconciliation.js";
import {
  exportApplicationIngestState,
  compareIngestStates,
} from "../../services/csvImport/dbEquivalence.js";
import { CSV_BULK_DEFAULTS } from "../../services/csvImport/bulkWritePool.js";

const BUDGETS_MS = {
  5000: 5000,
  50000: 20000,
  100000: 45000,
};
/** Soft scale: 100k rows with full rawData projections need more RSS headroom. */
const MEMORY_BUDGET_MB_BY_SIZE = {
  5000: 500,
  50000: 500,
  100000: 900,
};
const MEMORY_BUDGET_MB = 500;

const FIXTURE =
  process.env.CSV_IMPORT_FIXTURE ||
  path.join(os.homedir(), "Downloads", "hr_users_master.csv");

const MAPPINGS = [
  { csvColumn: "employee_id", standardField: "employee_id", isPrimaryKey: true, displayName: "Employee Id" },
  { csvColumn: "display_name", standardField: "display_name", displayName: "Display Name" },
  { csvColumn: "status", standardField: "status", displayName: "Status" },
  { csvColumn: "email", standardField: "email", displayName: "Email" },
  { csvColumn: "manager_id", standardField: "manager_id", displayName: "Manager Id" },
];

function parseArgs(argv) {
  const out = { sizes: [5000, 50000, 100000], skipEquivalence: false, equivalenceOnly: false };
  for (const a of argv) {
    if (a.startsWith("--sizes=")) {
      out.sizes = a
        .slice("--sizes=".length)
        .split(",")
        .map((x) => parseInt(x.trim(), 10))
        .filter(Boolean);
    }
    if (a === "--skip-equivalence") out.skipEquivalence = true;
    if (a === "--equivalence-only") out.equivalenceOnly = true;
  }
  return out;
}

function rssMb() {
  return Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
}

function generateCsv(n, seedHeaders) {
  const headers =
    seedHeaders ||
    "employee_id,user_id,first_name,last_name,display_name,email,department,job_title,location,country,phone,hire_date,termination_date,cost_center,status,manager_id,manager_name";
  const lines = [headers];
  for (let i = 1; i <= n; i++) {
    const id = `EMP${String(200000 + i).padStart(6, "0")}`;
    const un = `user${i}`;
    lines.push(
      `${id},${un},First${i},Last${i},First${i} Last${i},${un}@wisibility.lcl,IT,Engineer,NY,US,1000,2020-01-01,,CC-IT,ACTIVE,mgr1,Manager One`,
    );
  }
  return Buffer.from(lines.join("\n"), "utf8");
}

async function findDeloitteTenant() {
  const t =
    (await Tenant.findOne({ name: /deloitte/i }).lean()) ||
    (await Tenant.findOne({ code: /deloitte/i }).lean()) ||
    (await Tenant.findOne({}).lean());
  if (!t) throw new Error("No tenant found (expected Deloitte)");
  return t;
}

async function createBenchApp(tenantId, name) {
  return Application.create({
    name,
    description: "CSV Map & Import performance bench (auto)",
    tenantId,
    type: "custom",
    status: "active",
    authoritativeSource: true,
    csvImportMapping: {
      mappings: MAPPINGS,
      displayNameMode: "direct",
    },
    userMappings: MAPPINGS.map((m) => ({ ...m, dataType: "String" })),
  });
}

async function wipeAppData(application) {
  const tenantSlug = await resolveTenantSlugFromTenantId(application.tenantId);
  const models = getReconciliationModels(application.name, tenantSlug);
  const UsersModel = getDynamicUserModel(application.name, tenantSlug);
  const appId = application._id;
  const appClause = applicationIdInClause(appId);
  await Promise.all([
    UsersModel.deleteMany({ applicationId: appClause }),
    models.Snapshot.deleteMany({ applicationId: appId }),
    models.Delta.deleteMany({ applicationId: appId }),
    models.EntitlementDelta.deleteMany({ applicationId: appId }),
    models.Staging.deleteMany({ applicationId: appId }),
    models.Runs.deleteMany({ applicationId: appClause }),
    IdentitySyncState.deleteMany({ applicationId: appClause }),
    ApplicationUserDuplicate.deleteMany({ applicationId: appClause }),
  ]);
  application.totalUsers = 0;
  await application.save();
}

async function runOptimized(application, buffer) {
  const memBefore = rssMb();
  const t0 = Date.now();
  const engine = await runCsvImportEngine(buffer, application, {
    originalname: "bench.csv",
  });
  const result = await runCsvMappedReconciliation(
    application,
    engine.documents,
    {
      source: "csv_mapped",
      userMappingsForPk: engine.mappings,
      initialSkippedMissingPk: engine.skippedMissingPk,
      uploadedFileName: "bench.csv",
      loadCanonicalDocs: false,
      skipFullReRead: true,
      skipDedupeScan: true,
    },
    engine.engineTimings,
  );
  const totalMs = Date.now() - t0;
  const memAfter = rssMb();
  return {
    totalMs,
    liveRows: result.summary?.liveRows,
    stageTimings: result.stageTimings,
    memBefore,
    memAfter,
    memPeakApprox: Math.max(memBefore, memAfter),
    rowsPerSec: result.summary?.liveRows
      ? Math.round((result.summary.liveRows / totalMs) * 1000)
      : 0,
  };
}

async function runLegacy(application, buffer) {
  const engine = await runCsvImportEngine(buffer, application, {
    originalname: "bench-legacy.csv",
  });
  const t0 = Date.now();
  const result = await ingestApplicationUsersWithReconciliation(
    application,
    engine.documents,
    {
      source: "csv_mapped",
      userMappingsForPk: engine.mappings,
      initialSkippedMissingPk: engine.skippedMissingPk,
      uploadedFileName: "bench-legacy.csv",
      loadCanonicalDocs: false,
      skipFullReRead: true,
      skipDedupeScan: true,
    },
  );
  return {
    totalMs: Date.now() - t0,
    liveRows: result.summary?.liveRows,
    stageTimings: result.stageTimings,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI missing");
    process.exit(2);
  }

  await mongoose.connect(uri, { dbName: process.env.DB_NAME || "IGA-V3" });
  const tenant = await findDeloitteTenant();
  console.log(`[bench] db=${mongoose.connection.name} tenant=${tenant.name || tenant.code} id=${tenant._id}`);
  console.log(
    `[bench] bulk chunk=${CSV_BULK_DEFAULTS.chunkSize} concurrency=${CSV_BULK_DEFAULTS.concurrency} native=${process.env.CSV_IMPORT_USE_NATIVE_DRIVER || "0"}`,
  );

  let fixtureBuf = null;
  if (fs.existsSync(FIXTURE)) {
    fixtureBuf = fs.readFileSync(FIXTURE);
    console.log(`[bench] fixture=${FIXTURE} bytes=${fixtureBuf.length}`);
  } else {
    console.warn(`[bench] fixture missing at ${FIXTURE}; will synthesize CSVs`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    tenant: { id: String(tenant._id), name: tenant.name, code: tenant.code },
    budgetsMs: BUDGETS_MS,
    memoryBudgetMb: MEMORY_BUDGET_MB,
    bulkDefaults: CSV_BULK_DEFAULTS,
    results: [],
    equivalence: null,
    passed: true,
  };

  // Equivalence: same CSV on two apps (legacy vs optimized)
  if (!args.skipEquivalence) {
    const n = Math.min(args.sizes[0] || 5000, 5000);
    const buf =
      n === 5000 && fixtureBuf
        ? fixtureBuf
        : generateCsv(n);
    const legacyApp = await createBenchApp(
      tenant._id,
      `CsvBench Legacy ${Date.now()}`,
    );
    const optApp = await createBenchApp(
      tenant._id,
      `CsvBench Opt ${Date.now()}`,
    );
    try {
      console.log(`[equiv] running legacy (${n} rows)...`);
      const legacyTiming = await runLegacy(legacyApp, buf);
      console.log(`[equiv] legacy ${legacyTiming.totalMs}ms live=${legacyTiming.liveRows}`);
      console.log(`[equiv] running optimized (${n} rows)...`);
      const optTiming = await runOptimized(optApp, buf);
      console.log(`[equiv] optimized ${optTiming.totalMs}ms live=${optTiming.liveRows}`);

      const legacyState = await exportApplicationIngestState(legacyApp, "employee_id");
      const optState = await exportApplicationIngestState(optApp, "employee_id");
      const cmp = compareIngestStates(legacyState, optState);
      report.equivalence = {
        rows: n,
        legacyMs: legacyTiming.totalMs,
        optimizedMs: optTiming.totalMs,
        ...cmp,
      };
      if (!cmp.ok) {
        report.passed = false;
        console.error("[equiv] FAILED mismatches:");
        for (const m of cmp.mismatches.slice(0, 40)) console.error("  -", m);
        if (cmp.mismatches.length > 40) {
          console.error(`  ... +${cmp.mismatches.length - 40} more`);
        }
      } else {
        console.log("[equiv] PASSED — semantic DB state matches");
      }
    } finally {
      await wipeAppData(legacyApp).catch(() => {});
      await wipeAppData(optApp).catch(() => {});
      await Application.deleteOne({ _id: legacyApp._id }).catch(() => {});
      await Application.deleteOne({ _id: optApp._id }).catch(() => {});
    }
  }

  if (args.equivalenceOnly) {
    await mongoose.disconnect();
    process.exit(report.passed ? 0 : 1);
  }

  const benchApp = await createBenchApp(
    tenant._id,
    `CsvBench Perf ${Date.now()}`,
  );

  try {
    // Warm indexes / collections once (not part of budget): tiny import then wipe data.
    console.log("[bench] warming indexes...");
    const warmBuf = generateCsv(10);
    await runOptimized(await Application.findById(benchApp._id), warmBuf);
    await wipeAppData(await Application.findById(benchApp._id));

    for (const size of args.sizes) {
      const buf =
        size === 5000 && fixtureBuf ? fixtureBuf : generateCsv(size);
      await wipeAppData(await Application.findById(benchApp._id));
      const app = await Application.findById(benchApp._id);
      console.log(`\n[bench] size=${size} starting...`);
      const mem0 = rssMb();
      const result = await runOptimized(app, buf);
      const budget = BUDGETS_MS[size] ?? BUDGETS_MS[100000];
      const memBudget = MEMORY_BUDGET_MB_BY_SIZE[size] ?? MEMORY_BUDGET_MB;
      const memOk = result.memPeakApprox < memBudget;
      const timeOk = result.totalMs < budget;
      const row = {
        size,
        ...result,
        budgetMs: budget,
        timeOk,
        memOk,
        memBudgetMb: memBudget,
        memStartMb: mem0,
      };
      report.results.push(row);
      console.log(
        `[bench] size=${size} totalMs=${result.totalMs} budget=${budget} ` +
          `rows/s=${result.rowsPerSec} mem≈${result.memPeakApprox}MB (budget ${memBudget}) ` +
          `${timeOk && memOk ? "PASS" : "FAIL"}`,
      );
      console.log(`[bench] stageTimings`, JSON.stringify(result.stageTimings, null, 2));
      if (!timeOk || !memOk) report.passed = false;
    }
  } finally {
    await wipeAppData(benchApp).catch(() => {});
    await Application.deleteOne({ _id: benchApp._id }).catch(() => {});
  }

  const outDir = path.resolve(__dirname, "../../../../");
  const reportPath = path.join(outDir, "CSV_IMPORT_BENCHMARK_RAW.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[bench] wrote ${reportPath}`);
  console.log(`[bench] overall ${report.passed ? "PASSED" : "FAILED"}`);

  await mongoose.disconnect();
  process.exit(report.passed ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(2);
});
