/**
 * Performance Observatory report templates (schemaVersion >= 3).
 */
import { bandForGrade } from "./lib/grades.mjs";

function fmtMs(v) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v * 10) / 10} ms`;
}

function fmtBytes(v) {
  if (v == null) return "—";
  return Number(v).toLocaleString();
}

function topFieldsTable(topFields = []) {
  if (!topFields.length) return "_No field breakdown._";
  return [
    "| Field | Bytes (page) |",
    "|-------|--------------|",
    ...topFields.slice(0, 8).map((f) => `| \`${f.field}\` | ${fmtBytes(f.bytes)} |`),
  ].join("\n");
}

function safeFile(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function featureReportFilename(tb) {
  return `Feature-${safeFile(tb.targetId)}-performance-report.md`;
}

export function actionReportFilename(tb) {
  return `Action-${safeFile(tb.targetId)}-performance-report.md`;
}

export function sharedApiReportFilename(rep) {
  return `SharedAPI-${safeFile(rep.id)}-performance-report.md`;
}

export function renderFeatureReport(tb, raw) {
  const g = tb.grades || {};
  const db = tb.layers?.database || {};
  const api = tb.layers?.api || {};
  const payload = tb.layers?.payload || {};
  const fe = tb.layers?.frontend || {};
  const shared = (raw.sharedApiReports || []).filter((s) =>
    (tb.sharedApiIds || []).includes(s.id),
  );

  return `# Feature Performance Report

**Feature:** ${tb.name} (\`${tb.targetId}\`)  
**Parent:** \`${tb.parentId || "—"}\`  
**Route:** \`${tb.route || "—"}\`  
**Trigger:** ${tb.trigger ? `${tb.trigger.type}${tb.trigger.key ? ` / \`${tb.trigger.key}\`` : ""}` : "—"}  
**Measured:** ${raw.measuredAt} · DB \`${raw.dbName}\` · tenant ${raw.tenant}

---

## Grades

| Dimension | Grade |
|-----------|-------|
| Database | **${g.database}** |
| API | **${g.api}** |
| Payload | **${g.payload}** |
| Frontend | **${g.frontend}** |
| **Overall** | **${g.overall}** |

**Bottleneck:** ${tb.primaryBottleneck} · **Optimize?** **${tb.optimizeRequired}** · ${tb.band || bandForGrade(g.overall)}

---

## Route & Trigger

| | |
|--|--|
| Route | \`${tb.route || "—"}\` |
| Trigger | ${tb.trigger?.label || tb.trigger?.key || "—"} (${tb.trigger?.type || "—"}) |
| Primary API | ${(tb.primaryApis || []).map((a) => `\`${a}\``).join(", ") || "—"} |
| Controller | \`${tb.controller || "—"}\` |
| Metric label | \`${tb.metricLabel || "—"}\` |
| Mode | \`${tb.measurementMode}\` |

---

## Timing

| Metric | Value |
|--------|-------|
| Response / API p50 | ${fmtMs(api.p50Ms)} |
| Database exec | ${fmtMs(db.execMs)} |
| Mongo wall | ${fmtMs(db.wallMs)} |
| Controller app overhead | ${fmtMs(api.breakdown?.appMs)} |
| Serialize | ${fmtMs(api.breakdown?.serializeMs)} |

---

## Database

| Metric | Value |
|--------|-------|
| Docs examined | ${db.docsExamined ?? "—"} |
| Keys examined | ${db.keysExamined ?? "—"} |
| Returned | ${db.nReturned ?? "—"} |
| Indexes | ${(db.indexNames || []).join(", ") || db.indexName || "—"} |
| Blocking SORT | ${db.hasBlockingSort ? "**yes**" : "no"} |
| Collection scan | ${db.hasCollectionScan ? "**yes**" : "no"} |
| Collections | ${(db.collections || []).join(", ") || "—"} |

---

## Payload

| Metric | Value |
|--------|-------|
| Raw bytes | ${fmtBytes(payload.rawBytes)} |
| API bytes | ${fmtBytes(payload.apiBytes)} |
| Projected estimate | ${fmtBytes(payload.projectedBytes)} |
| Potential savings | ${payload.potentialSavingsPct != null ? `${payload.potentialSavingsPct}%` : "—"} |
| Pagination | page size ${raw.pageSize || 10} |

### Largest fields

${topFieldsTable(payload.topFields)}

---

## Shared APIs

${
  shared.length
    ? shared
        .map(
          (s) =>
            `- \`${s.api}\` — used by ${s.impactCount} targets · Overall **${s.overallGrade}** · [report](./${sharedApiReportFilename(s)})`,
        )
        .join("\n")
    : "_No shared API linkage._"
}

---

## Optimization Opportunities

| Priority | Opportunity |
|----------|-------------|
| ${tb.optimizeRequired === "YES" ? "P0" : "—"} | ${tb.primaryBottleneck === "none" ? "Re-measure if data volume grows" : `Address **${tb.primaryBottleneck}** layer (${tb.gradeReasons?.[tb.primaryBottleneck] || ""})`} |

**One-liner:** ${tb.name}: overall ${g.overall}, bottleneck ${tb.primaryBottleneck}.
`;
}

export function renderActionReport(tb, raw) {
  const g = tb.grades || {};
  const action = tb.layers?.action || {};

  return `# Action Performance Report

**Action:** ${tb.name} (\`${tb.targetId}\`)  
**Parent:** \`${tb.parentId || "—"}\`  
**Trigger:** ${tb.trigger?.label || tb.trigger?.key || "—"} (${tb.trigger?.type || "button"})  
**Measured:** ${raw.measuredAt} · DB \`${raw.dbName}\`

---

## Grades

| Dimension | Grade |
|-----------|-------|
| Action | **${g.action}** |
| API (completion proxy) | **${g.api}** |
| Database | **${g.database}** |
| Payload | **${g.payload}** |
| **Overall** | **${g.overall}** |

**Optimize?** **${tb.optimizeRequired}** · Mode: \`${action.mode || tb.measurementMode}\`

---

## Execution Profile

| Metric | Value |
|--------|-------|
| Endpoint | \`${action.endpoint || (tb.primaryApis || [])[0] || "—"}\` |
| Poll endpoint | \`${action.pollEndpoint || "—"}\` |
| Queue time | ${fmtMs(action.queueMs)} |
| Execution time | ${fmtMs(action.executionMs)} |
| Completion time | ${fmtMs(action.completionMs)} |
| Polling count | ${action.pollCount ?? "—"} |
| Memory (heap Δ) | ${action.heapDeltaMb != null ? `${action.heapDeltaMb} MB` : "—"} |
| Status | ${action.status ?? "—"} |
| Retries | ${action.retries ?? "—"} |
| Success rate | ${action.successRate != null ? `${Math.round(action.successRate * 100)}%` : "—"} |
| Samples | ${action.sampleCount ?? "—"} / examined ${action.jobsExamined ?? "—"} |
| Failures | ${action.failedCount ?? "—"} |

${action.note ? `\n_${action.note}_\n` : ""}

---

## Final Verdict

| Question | Answer |
|----------|--------|
| Is the action slow? | ${["C", "D", "Critical"].includes(g.action) ? "**Yes**" : "No / N/A"} (${g.action}) |
| Optimize? | **${tb.optimizeRequired}** |
| Overall | **${g.overall}** |
`;
}

export function renderSharedApiReport(rep, raw) {
  return `# Shared API Performance Report

**API:** \`${rep.api}\`  
**Id:** \`${rep.id}\`  
**Controller:** \`${rep.controller || "—"}\`  
**Measured:** ${raw.measuredAt}

---

## Consumers

| Target | Name |
|--------|------|
${(rep.usedBy || [])
  .map((id, i) => `| \`${id}\` | ${rep.usedByNames?.[i] || id} |`)
  .join("\n")}

**Impact:** Optimizing this endpoint once improves **${rep.impactCount}** feature(s).

---

## Evidence

| | |
|--|--|
| Overall (worst consumer) | **${rep.overallGrade}** |
| Bottleneck | **${rep.bottleneck}** |
| API p50 | ${fmtMs(rep.evidence?.api?.p50Ms)} |
| Payload bytes | ${fmtBytes(rep.evidence?.api?.payloadBytes ?? rep.evidence?.payload?.apiBytes)} |
| Auto-detected? | ${rep.autoDetected ? "Yes" : "No"} |

---

## Recommendation

${rep.recommendation || "Optimize this shared endpoint; validate all consumers after change."}

**Expected impact:** Improves ${rep.impactCount} screens/features that call \`${rep.api}\`.
`;
}

/**
 * Hierarchical observatory README.
 * @param {object} raw
 * @param {object[]} navIndexRows — navigation scoreboard rows (same shape as v2)
 * @param {string} outDirRel
 */
export function renderObservatoryReadme(raw, navIndexRows, outDirRel) {
  const targets = raw.targetBenchmarks || [];
  const features = targets.filter((t) => t.kind === "feature" && !t.comingSoon);
  const actions = targets.filter((t) => t.kind === "action");
  const shared = raw.sharedApiReports || [];

  const byParent = new Map();
  for (const t of [...features, ...actions]) {
    const p = t.parentId || "orphan";
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(t);
  }

  let hierarchy = "";
  for (const row of navIndexRows) {
    const navTb = targets.find((t) => t.pageId === row.page && t.kind === "navigation");
    const parentId = navTb?.targetId;
    const kids = parentId ? byParent.get(parentId) || [] : [];
    hierarchy += `\n### ${row.page} — Overall **${row.overall}**\n\n`;
    hierarchy += `| Target | Kind | Overall | Bottleneck | Report |\n|--------|------|---------|------------|--------|\n`;
    hierarchy += `| ${row.page} (nav) | navigation | **${row.overall}** | ${row.bottleneck} | [${row.file}](./${row.file}) |\n`;
    for (const k of kids) {
      const file =
        k.kind === "action" ? actionReportFilename(k) : featureReportFilename(k);
      hierarchy += `| ${k.name} | ${k.kind} | **${k.grades?.overall}** | ${k.primaryBottleneck} | [${file}](./${file}) |\n`;
    }
  }

  const hot = [...features, ...actions, ...navIndexRows.map((r) => ({
    name: r.page,
    grades: { overall: r.overall },
    primaryBottleneck: r.bottleneck,
    kind: "navigation",
  }))]
    .filter((t) => ["Critical", "D", "C"].includes(t.grades?.overall || t.overall))
    .slice(0, 12);

  return `# Performance Observatory — Executive Dashboard

**Tenant:** ${raw.tenant} (\`${raw.tenantId}\`) · **DB:** ${raw.dbName}  
**Measured:** ${raw.measuredAt}  
**Run folder:** \`${outDirRel}\`  
**Framework:** Performance Observatory **v${raw.schemaVersion}** (registry v${raw.registryVersion || 1})  
**Harness:** \`icm-backend/scripts/page-perf-benchmark.mjs\`

Answers: which **page**, **feature**, **action**, or **shared API** is slow — and which fix helps multiple screens.

---

## Navigation Scoreboard

| Page | Route | DB | API | Payload | FE | Overall | Bottleneck | Primary ms | Payload B | Optimize? | Report |
|------|-------|----|-----|---------|----|---------|------------|------------|-----------|-----------|--------|
${navIndexRows
  .map(
    (r) =>
      `| ${r.page} | \`${r.route}\` | **${r.database}** | **${r.api}** | **${r.payload}** | **${r.frontend}** | **${r.overall}** | ${r.bottleneck} | ${r.ms} | ${typeof r.payloadBytes === "number" ? r.payloadBytes.toLocaleString() : r.payloadBytes} | ${r.opt} | [${r.file}](./${r.file}) |`,
  )
  .join("\n")}

---

## Feature & Action Hierarchy
${hierarchy || "\n_No child features in this run._\n"}

---

## Shared API Opportunities

${
  shared.length
    ? shared
        .map(
          (s) =>
            `### \`${s.api}\` — Overall **${s.overallGrade}** · impact **${s.impactCount}**\n\n- **Used by:** ${(s.usedByNames || s.usedBy || []).join(", ")}\n- **Fix once:** ${s.recommendation}\n- **Report:** [${sharedApiReportFilename(s)}](./${sharedApiReportFilename(s)})\n`,
        )
        .join("\n")
    : "_No shared APIs detected._"
}

---

## Cross-cutting P0 backlog

${
  hot.length
    ? hot
        .map(
          (t, i) =>
            `${i + 1}. **${t.name || t.page}** (${t.kind || "navigation"}) — Overall **${t.grades?.overall || t.overall}** · ${t.primaryBottleneck || t.bottleneck}`,
        )
        .join("\n")
    : "No Critical/D/C targets in this run."
}

---

## How to read grades

| Grade | Meaning |
|-------|---------|
| Database | Index health: docsExamined ≈ page size |
| API | Controller p50 or mongo proxy |
| Payload | Response bytes |
| FE | React Query, mount fan-out |
| Action | Long-running completion / success rate |
| Overall | Worst of measured core layers |

---

## Re-run

\`\`\`bash
cd icm-backend
node --env-file=.env scripts/page-perf-benchmark.mjs
node scripts/generate-page-perf-reports.mjs
\`\`\`

Architecture: \`scripts/page-perf/ARCHITECTURE.md\`
`;
}