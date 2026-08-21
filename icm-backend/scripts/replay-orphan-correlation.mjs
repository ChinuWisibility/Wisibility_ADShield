/**
 * Replay correlation to rebuild orphan_accounts after the account-identity fix.
 *
 * Flow:
 *   1. (Optional) confirm imports already present — this script does not re-ingest CSV/LDAP.
 *   2. Re-run manual correlation for each target application using lastManualCorrelation.rules
 *      (or --rules-json).
 *   3. Upserts orphans by (applicationId, accountId) — restores collision victims.
 *   4. Recompute tenant_correlation_stats (dashboard OPEN counts).
 *
 * Prerequisites:
 *   - Migration 025 completed (non-unique correlationKey index).
 *   - Deployed code with account-scoped orphan upserts.
 *   - Application users already imported / reconciled.
 *
 * Usage:
 *   node scripts/replay-orphan-correlation.mjs --tenant-id <oid>
 *   node scripts/replay-orphan-correlation.mjs --application-id <oid>
 *   node scripts/replay-orphan-correlation.mjs --tenant-id <oid> --dry-run
 *   node scripts/replay-orphan-correlation.mjs --application-id <oid> --confirm
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { connectDB } from "../src/config/database.js";
import Application from "../src/models/application/Application.js";
import OrphanAccount from "../src/models/identity/OrphanAccount.js";
import { runCorrelationForApp } from "../src/controllers/correlation/correlationController.js";
import { recomputeTenantCorrelationStats } from "../src/services/tenantCorrelationStatsService.js";

dotenv.config();

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return null;
  return process.argv[i + 1];
}

function createFakeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function runCorrelationForApplication(app, { dryRun }) {
  const rules = app.lastManualCorrelation?.rules;
  if (!Array.isArray(rules) || rules.length === 0) {
    return {
      applicationId: String(app._id),
      name: app.name,
      skipped: true,
      reason: "no_lastManualCorrelation.rules — pass rules via UI or store them first",
    };
  }

  const openBefore = await OrphanAccount.countDocuments({
    applicationId: app._id,
    status: "OPEN",
  });

  if (dryRun) {
    return {
      applicationId: String(app._id),
      name: app.name,
      dryRun: true,
      openOrphansBefore: openBefore,
      wouldRunRules: rules,
    };
  }

  const req = {
    params: { applicationId: String(app._id) },
    body: { rules },
  };
  const res = createFakeRes();
  await runCorrelationForApp(req, res);

  const openAfter = await OrphanAccount.countDocuments({
    applicationId: app._id,
    status: "OPEN",
  });

  return {
    applicationId: String(app._id),
    name: app.name,
    httpStatus: res.statusCode,
    response: res.body,
    openOrphansBefore: openBefore,
    openOrphansAfter: openAfter,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const confirm = process.argv.includes("--confirm");
  const tenantId = argValue("--tenant-id");
  const applicationId = argValue("--application-id");

  if (!tenantId && !applicationId) {
    console.error("Provide --tenant-id <oid> and/or --application-id <oid>");
    process.exit(1);
  }
  if (!dryRun && !confirm) {
    console.error("Refusing to mutate without --dry-run or --confirm");
    process.exit(1);
  }

  await connectDB();

  try {
    const filter = {};
    if (applicationId) {
      if (!mongoose.Types.ObjectId.isValid(applicationId)) {
        throw new Error(`Invalid --application-id: ${applicationId}`);
      }
      filter._id = new mongoose.Types.ObjectId(applicationId);
    }
    if (tenantId) {
      if (!mongoose.Types.ObjectId.isValid(tenantId)) {
        throw new Error(`Invalid --tenant-id: ${tenantId}`);
      }
      filter.tenantId = new mongoose.Types.ObjectId(tenantId);
    }

    const apps = await Application.find(filter)
      .select("_id name tenantId lastManualCorrelation")
      .lean();

    if (!apps.length) {
      console.error("No applications matched filter", filter);
      process.exit(1);
    }

    const results = [];
    for (const app of apps) {
      // eslint-disable-next-line no-console
      console.log(`[replay] ${dryRun ? "dry-run" : "running"} correlation for ${app.name} (${app._id})`);
      results.push(await runCorrelationForApplication(app, { dryRun }));
    }

    const tenantIds = [
      ...new Set(
        apps
          .map((a) => (a.tenantId ? String(a.tenantId) : null))
          .filter(Boolean),
      ),
    ];

    const stats = [];
    if (!dryRun) {
      for (const tid of tenantIds) {
        await recomputeTenantCorrelationStats(tid);
        const open = await OrphanAccount.countDocuments({
          tenantId: new mongoose.Types.ObjectId(tid),
          status: "OPEN",
        });
        stats.push({ tenantId: tid, orphansOpenCount: open });
      }
    } else {
      for (const tid of tenantIds) {
        const open = await OrphanAccount.countDocuments({
          tenantId: new mongoose.Types.ObjectId(tid),
          status: "OPEN",
        });
        stats.push({ tenantId: tid, orphansOpenCount: open, dryRun: true });
      }
    }

    const report = {
      dryRun,
      applications: results,
      tenantStats: stats,
      note:
        "Import/reconciliation is out of scope for this script — ensure app_*_users are current before replay.",
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));

    // Allow correlation setImmediate background work to finish before closing the pool.
    if (!dryRun) {
      await new Promise((r) => setTimeout(r, 2500));
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("[replay-orphan-correlation] failed", err);
  process.exit(1);
});
