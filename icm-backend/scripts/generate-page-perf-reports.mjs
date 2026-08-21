/**
 * Generate one <PageName>-performance-report.md per sidebar page from benchmark-raw.json
 *
 * Usage:
 *   node scripts/generate-page-perf-reports.mjs
 *   node scripts/generate-page-perf-reports.mjs 2026-07-18_16-44-32-123
 *   node scripts/generate-page-perf-reports.mjs /absolute/or/relative/run/folder
 *
 * Without args, uses the latest datetime folder under:
 *   docs/page-performance/reports/
 *
 * Each run folder keeps its own README + page reports, so prior runs are never overwritten.
 *
 * Framework v2: schemaVersion >= 2 → layered page grades.
 * Framework v3: schemaVersion >= 3 → Performance Observatory
 *   (feature / action / shared API reports + hierarchical README).
 * v1 raw files still render via the legacy template.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { gradeFromMs } from "./page-perf/lib/grades.mjs";
import { renderPageReportV2, renderReadmeV2 } from "./page-perf/render-reports.mjs";
import { navigationAsLegacyPages } from "./page-perf/registry/index.mjs";
import {
  renderFeatureReport,
  renderActionReport,
  renderSharedApiReport,
  renderObservatoryReadme,
  featureReportFilename,
  actionReportFilename,
  sharedApiReportFilename,
} from "./page-perf/render-observatory.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsRoot = path.join(__dirname, "../docs/page-performance/reports");
const legacyDir = path.join(__dirname, "../docs/page-performance");

function listRunDirs() {
  if (!fs.existsSync(reportsRoot)) return [];
  return fs
    .readdirSync(reportsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(reportsRoot, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, "benchmark-raw.json")))
    .sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
}

function resolveOutDir(arg) {
  if (!arg) {
    const latest = listRunDirs()[0];
    if (latest) return latest;
    // Backward-compatible fallback for the original flat layout.
    if (fs.existsSync(path.join(legacyDir, "benchmark-raw.json"))) return legacyDir;
    throw new Error(
      `No benchmark runs found under ${reportsRoot}. Run: node scripts/page-perf-benchmark.mjs`,
    );
  }

  if (path.isAbsolute(arg) && fs.existsSync(arg)) return arg;

  const asReportsChild = path.join(reportsRoot, arg);
  if (fs.existsSync(asReportsChild)) return asReportsChild;

  const asRelative = path.resolve(process.cwd(), arg);
  if (fs.existsSync(asRelative)) return asRelative;

  throw new Error(`Run folder not found: ${arg}`);
}

const outDir = resolveOutDir(process.argv[2]);
const rawPath = path.join(outDir, "benchmark-raw.json");
if (!fs.existsSync(rawPath)) {
  throw new Error(`Missing ${rawPath}. Run page-perf-benchmark.mjs first.`);
}
const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));

const byLabel = Object.fromEntries(raw.results.map((r) => [r.label, r]));

function peerTable(currentMs) {
  const peers = [
    ["Applications", byLabel.Applications_page10?.ms],
    ["Identity Profiles", byLabel.IdentityProfiles_list?.ms],
    ["Correlated Accounts", byLabel.CorrelatedAccounts_page10?.ms],
    ["Uncorrelated Accounts", byLabel.UncorrelatedAccounts_page10?.ms],
    ["All Identities", byLabel.AllIdentities_page10?.ms],
    ["Audit Log", byLabel.AuditLog_page10?.ms],
  ].filter(([, ms]) => ms != null);
  const rows = peers
    .map(([name, ms]) => `| ${name} | ${ms} ms |${name.includes("All Identities") && currentMs === byLabel.AllIdentities_page10?.ms ? " ← this page" : ""}`)
    .join("\n");
  return `| Peer page | Measured ms |\n|-----------|-------------|\n${rows}`;
}

/* gradeFromMs imported from page-perf/lib/grades.mjs */

function report(p) {
  const m = p.metric ? byLabel[p.metric] : null;
  const ms = m?.ms ?? p.msOverride ?? null;
  const payload = m?.payloadBytes ?? p.payloadOverride ?? null;
  const { grade, band } = p.comingSoon
    ? { grade: "N/A", band: "N/A — ComingSoon / no API" }
    : p.gradeOverride
      ? { grade: p.gradeOverride, band: p.bandOverride }
      : gradeFromMs(ms, { rows: m?.rows, payloadBytes: payload });

  const optRequired = p.comingSoon
    ? "NO"
    : grade === "Critical" || grade === "D" || grade === "C"
      ? "YES"
      : p.optRequired ?? "NO";

  const bottlenecks = p.bottlenecks?.length
    ? p.bottlenecks
        .map(
          (b) => `### ${b.rank} — ${b.title}\n\n| | |\n|--|--|\n| Evidence | ${b.evidence} |\n| Root cause | ${b.rootCause} |\n| Impact | ${b.impact} |`
        )
        .join("\n\n")
    : grade === "A+" || grade === "A" || grade === "N/A"
      ? "### P0 — none\n\nNo blocking bottleneck measured on primary load path."
      : "### P0 — see Current Performance\n\nSee measurements above.";

  const opps = (p.opportunities || [])
    .map(
      (o) =>
        `| ${o.item} | ${o.gain} | ${o.difficulty} | ${o.risk} | ${o.priority} |`
    )
    .join("\n");

  const actions = (p.actions || ["- [ ] No blocking action — re-measure if data volume grows materially"])
    .map((a) => (a.startsWith("- [") ? a : `- [ ] ${a}`))
    .join("\n");

  return `# Performance Report

**Page:** ${p.pageName} (\`${p.route}\`)  
**Stack:** \`${p.feFile}\` → ${p.primaryApis.map((a) => `\`${a}\``).join(" + ")} → \`${p.controller}\`  
**Measured:** ${raw.deepMeasuredAt || raw.measuredAt} · live DB \`${raw.dbName}\` · tenant ${raw.tenant} (\`${raw.tenantId}\`)  
**Method:** Mongo wall-clock / explain on production-like data (not estimates)${p.methodNote ? ` · ${p.methodNote}` : ""}

---

## Overview

| | |
|--|--|
| **Overall Grade** | **${grade}** |
| **Status** | ${band} |
| **Optimization required?** | **${optRequired}** |

---

## Current Performance

### Frontend

| Item | Finding |
|------|---------|
| FE file | \`${p.feFile}\` |
| Pattern | ${p.fePattern || "useState/useEffect (typical list page)"} |
| React Query | ${p.reactQuery || "No"} |
| Primary APIs on mount | ${p.primaryApis.join(", ")} |
| Notes | ${p.feNotes || "—"} |

### Backend / API / Mongo / Payload

${
  p.comingSoon
    ? "_No backend path — ComingSoon stub._"
    : `| Metric | Value |
|--------|-------|
| Primary load time | **${ms != null ? ms + " ms" : "see notes"}** |
| Rows / total | ${m?.rows ?? "—"} / ${typeof m?.total === "object" ? JSON.stringify(m.total) : m?.total ?? "—"} |
| Payload bytes | **${payload != null ? payload.toLocaleString() : "—"}** |
| Collections | ${(m?.collections || p.collections || []).join(", ") || "—"} |
| Explain / meta | ${m?.explain ? `\`${JSON.stringify(m.explain)}\`` : m?.meta ? `\`${JSON.stringify(m.meta).slice(0, 280)}\`` : p.mongoNotes || "—"} |`
}

${p.extraPerf || ""}

---

## Benchmark

Compared with peer list pages (same tenant, page size 10 where applicable):

${peerTable(ms)}

**Band vs peers:** ${band}

---

## Bottlenecks

${bottlenecks}

---

## Optimization Opportunities

| Opportunity | Expected Gain | Difficulty | Risk | Priority |
|-------------|---------------|------------|------|----------|
${opps || "| — | — | — | — | — |"}

---

## Developer Action Items

${actions}

---

## Final Verdict

| Question | Answer |
|----------|--------|
| Is optimization required? | **${optRequired}** |
| Expected improvement | ${p.expectedImprovement || (optRequired === "YES" ? "See P0/P1 above" : "Incremental only")} |
| Estimated effort | ${p.effort || (optRequired === "YES" ? "0.5–2 days" : "None / polish only")} |
| Grade | **${grade}** |

**One-liner:** ${p.oneliner}
`;
}

const pages = navigationAsLegacyPages();

const byPageBenchmark = Object.fromEntries(
  (raw.pageBenchmarks || []).map((pb) => [pb.pageId, pb]),
);
const isV2 = Number(raw.schemaVersion || 0) >= 2 && (raw.pageBenchmarks || []).length > 0;
const isV3 = Number(raw.schemaVersion || 0) >= 3 && (raw.targetBenchmarks || []).length > 0;

const indexRows = [];
for (const p of pages) {
  const pb = byPageBenchmark[p.pageName] || null;
  let body;
  if (isV2 && pb && !p.comingSoon) {
    body = renderPageReportV2(p, pb, raw);
  } else {
    body = report(p);
  }

  // Observatory: append feature/action summary on parent navigation reports
  if (isV3 && !p.comingSoon) {
    const parentTb = (raw.targetBenchmarks || []).find(
      (t) => t.pageId === p.pageName && t.kind === "navigation",
    );
    const kids = (raw.targetBenchmarks || []).filter(
      (t) => parentTb && t.parentId === parentTb.targetId && !t.comingSoon,
    );
    if (kids.length) {
      const rows = kids
        .map((k) => {
          const file =
            k.kind === "action" ? actionReportFilename(k) : featureReportFilename(k);
          return `| ${k.name} | ${k.kind} | **${k.grades?.overall}** | ${k.primaryBottleneck} | [${file}](./${file}) |`;
        })
        .join("\n");
      body += `

---

## Feature & Action Summary (Observatory)

| Target | Kind | Overall | Bottleneck | Report |
|--------|------|---------|------------|--------|
${rows}
`;
    }
  }

  const file = `${p.pageName}-performance-report.md`;
  fs.writeFileSync(path.join(outDir, file), body);

  if (p.comingSoon) {
    indexRows.push({
      page: p.pageName,
      route: p.route,
      database: "N/A",
      api: "N/A",
      payload: "N/A",
      frontend: "N/A",
      overall: "N/A",
      bottleneck: "—",
      ms: "—",
      payloadBytes: "—",
      opt: "N/A",
      file,
    });
    continue;
  }

  if (isV2 && pb) {
    const apiMs = pb.layers?.api?.p50Ms ?? byLabel[p.metric]?.ms ?? "—";
    const payloadBytes =
      pb.layers?.payload?.apiBytes ??
      pb.layers?.payload?.rawBytes ??
      byLabel[p.metric]?.payloadBytes ??
      "—";
    indexRows.push({
      page: p.pageName,
      route: p.route,
      database: pb.grades.database,
      api: pb.grades.api,
      payload: pb.grades.payload,
      frontend: pb.grades.frontend,
      overall: pb.grades.overall,
      bottleneck: pb.primaryBottleneck,
      ms: typeof apiMs === "number" ? Math.round(apiMs) : apiMs,
      payloadBytes,
      opt: pb.optimizeRequired,
      file,
    });
  } else {
    // Prefer live metric; ignore stale gradeOverride when metric exists
    const m = p.metric ? byLabel[p.metric] : null;
    const { grade } =
      m?.ms != null
        ? gradeFromMs(m.ms, { payloadBytes: m?.payloadBytes })
        : p.gradeOverride
          ? { grade: p.gradeOverride }
          : gradeFromMs(null);
    indexRows.push({
      page: p.pageName,
      route: p.route,
      database: "—",
      api: grade,
      payload: "—",
      frontend: "—",
      overall: grade,
      bottleneck: "—",
      ms: m?.ms ?? "—",
      payloadBytes: m?.payloadBytes ?? "—",
      opt: grade === "Critical" || grade === "D" || grade === "C" ? "YES" : "NO",
      file,
    });
  }
}

// Feature / Action / Shared API reports (v3)
let featureCount = 0;
let actionCount = 0;
let sharedCount = 0;
if (isV3) {
  for (const tb of raw.targetBenchmarks || []) {
    if (tb.comingSoon) continue;
    if (tb.kind === "feature") {
      fs.writeFileSync(
        path.join(outDir, featureReportFilename(tb)),
        renderFeatureReport(tb, raw),
      );
      featureCount += 1;
    } else if (tb.kind === "action") {
      fs.writeFileSync(
        path.join(outDir, actionReportFilename(tb)),
        renderActionReport(tb, raw),
      );
      actionCount += 1;
    }
  }
  for (const rep of raw.sharedApiReports || []) {
    fs.writeFileSync(
      path.join(outDir, sharedApiReportFilename(rep)),
      renderSharedApiReport(rep, raw),
    );
    sharedCount += 1;
  }
}

const outDirRel = path.relative(path.join(__dirname, ".."), outDir);
const index = isV3
  ? renderObservatoryReadme(raw, indexRows, outDirRel)
  : isV2
    ? renderReadmeV2(raw, indexRows, outDirRel)
    : `# Page Performance Reports (suite)

**Tenant:** ${raw.tenant} (\`${raw.tenantId}\`) · **DB:** ${raw.dbName}  
**Measured:** ${raw.deepMeasuredAt || raw.measuredAt}  
**Run folder:** \`${outDirRel}\`  
**Harness:** \`icm-backend/scripts/page-perf-benchmark.mjs\` → \`benchmark-raw.json\`

## Scoreboard

| Page | Route | Grade | Primary ms | Payload B | Optimize? | Report |
|------|-------|-------|------------|-----------|-----------|--------|
${indexRows
  .map(
    (r) =>
      `| ${r.page} | \`${r.route}\` | **${r.overall}** | ${r.ms} | ${typeof r.payloadBytes === "number" ? r.payloadBytes.toLocaleString() : r.payloadBytes} | ${r.opt} | [${r.file}](./${r.file}) |`
  )
  .join("\n")}

## Re-run

\`\`\`bash
cd icm-backend
node --env-file=.env scripts/page-perf-benchmark.mjs
node scripts/generate-page-perf-reports.mjs
\`\`\`
`;

fs.writeFileSync(path.join(outDir, "README.md"), index);
console.log(
  `Wrote ${indexRows.length} navigation reports` +
    (isV3 ? ` + ${featureCount} feature + ${actionCount} action + ${sharedCount} shared API` : "") +
    ` + README → ${outDir}`,
);
