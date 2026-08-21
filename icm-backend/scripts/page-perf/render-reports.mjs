/**
 * Framework v2 markdown report + README rendering.
 * Consumes pageBenchmarks[] from benchmark-raw.json (schemaVersion >= 2).
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

function pct(v) {
  if (v == null) return "—";
  return `${v}%`;
}

function topFieldsTable(topFields = []) {
  if (!topFields.length) return "_No field breakdown (mongo-only or empty)._";
  return [
    "| Field | Bytes (page) |",
    "|-------|--------------|",
    ...topFields.slice(0, 8).map((f) => `| \`${f.field}\` | ${fmtBytes(f.bytes)} |`),
  ].join("\n");
}

function opportunityFromBenchmark(pb) {
  const rows = [];
  const bottleneck = pb.primaryBottleneck;
  if (bottleneck === "database") {
    rows.push({
      priority: "P0",
      item: "Fix index / remove blocking SORT so docsExamined ≈ page size",
      gain: "DB exec toward <20 ms; API p50 drops with it",
      difficulty: "Low",
      risk: "Low",
      effort: "0.5 day",
    });
  }
  if (bottleneck === "payload" || (pb.grades.payload && ["C", "D", "Critical"].includes(pb.grades.payload))) {
    rows.push({
      priority: "P0",
      item: "List projection / thin DTO (omit heavy nested fields on list)",
      gain: pb.layers.payload?.potentialSavingsPct
        ? `~${pb.layers.payload.potentialSavingsPct}% payload reduction`
        : "Large payload cut",
      difficulty: "Low–Med",
      risk: "Low",
      effort: "0.5–2 days",
    });
  }
  if (bottleneck === "api" || (pb.grades.api && ["C", "D", "Critical"].includes(pb.grades.api))) {
    rows.push({
      priority: "P0",
      item: "Reduce controller work (counts, populate, sequential awaits)",
      gain: "Lower API p50 toward peer list pages",
      difficulty: "Med",
      risk: "Med",
      effort: "1–3 days",
    });
  }
  if (bottleneck === "frontend" || (pb.grades.frontend && ["C", "D"].includes(pb.grades.frontend))) {
    rows.push({
      priority: "P1",
      item: "Dedupe mount fetches / adopt React Query staleTime",
      gain: "Fewer duplicate API calls on remount",
      difficulty: "Low",
      risk: "Low",
      effort: "0.5 day",
    });
  }
  if (!rows.length) {
    rows.push({
      priority: "—",
      item: "No blocking optimization — re-measure if data volume grows",
      gain: "—",
      difficulty: "—",
      risk: "—",
      effort: "—",
    });
  }
  return rows;
}

/**
 * @param {object} p — legacy page narrative from generator pages[]
 * @param {object|null} pb — pageBenchmark from enrich
 * @param {object} raw — full raw json
 */
export function renderPageReportV2(p, pb, raw) {
  if (!pb) {
    return null; // caller falls back to v1 template
  }

  const g = pb.grades;
  const db = pb.layers.database || {};
  const api = pb.layers.api || {};
  const payload = pb.layers.payload || {};
  const fe = pb.layers.frontend || {};
  const share = pb.timeSharePct || {};
  const opps = opportunityFromBenchmark(pb);
  const shared = (raw.sharedOptimizations || []).find((s) => s.id === pb.sharedBackendId);

  const narrativeBottlenecks = (p.bottlenecks || [])
    .map(
      (b) =>
        `### ${b.rank} — ${b.title}\n\n| | |\n|--|--|\n| Evidence | ${b.evidence} |\n| Root cause | ${b.rootCause} |\n| Impact | ${b.impact} |`,
    )
    .join("\n\n");

  const measuredBottleneck = `### Measured primary bottleneck — **${pb.primaryBottleneck}**

| Layer | Grade | Signal |
|-------|-------|--------|
| Database | **${g.database}** | ${pb.gradeReasons?.database || "—"} |
| API | **${g.api}** | ${pb.gradeReasons?.api || "—"} |
| Payload | **${g.payload}** | ${pb.gradeReasons?.payload || "—"} |
| Frontend | **${g.frontend}** | ${pb.gradeReasons?.frontend || "—"} |

**Time share (approx):** DB ${pct(share.database)} · Application ${pct(share.application)} · Serialization ${pct(share.serialization)}  
_Mode:_ \`${pb.measurementMode}\`${pb.inheritedFrom ? ` · inherited from \`${pb.inheritedFrom}\`` : ""}`;

  return `# Performance Report (Framework v2)

**Page:** ${p.pageName} (\`${p.route}\`)  
**Stack:** \`${p.feFile}\` → ${(p.primaryApis || []).map((a) => `\`${a}\``).join(" + ") || "—"} → \`${p.controller}\`  
**Measured:** ${raw.measuredAt} · live DB \`${raw.dbName}\` · tenant ${raw.tenant} (\`${raw.tenantId}\`)  
**Harness:** Application Performance Benchmark v${raw.schemaVersion || 2}

---

## Executive Summary

| | |
|--|--|
| **What is slow?** | ${pb.primaryBottleneck === "none" ? "No blocking layer — within targets" : `Primary bottleneck: **${pb.primaryBottleneck}**`} |
| **Why?** | ${pb.gradeReasons?.[pb.primaryBottleneck] || pb.gradeReasons?.api || "See grades below"} |
| **Where?** | ${pb.measurementMode === "api+mongo" ? "Real controller + Mongo explain" : "Mongo-proxied (controller probe not registered)"} |
| **Can it be optimized?** | **${pb.optimizeRequired}** |
| **Shared fix?** | ${shared ? `Yes — \`${shared.id}\` also affects: ${shared.pages.filter((x) => x !== p.pageName).join(", ") || "—"}` : "No shared backend group"} |

---

## Performance Grades

| Dimension | Grade |
|-----------|-------|
| Database | **${g.database}** |
| API | **${g.api}** |
| Payload | **${g.payload}** |
| Frontend readiness | **${g.frontend}** |
| **Overall UX** | **${g.overall}** |

**Status:** ${pb.band || bandForGrade(g.overall)} · **Optimize?** **${pb.optimizeRequired}**

---

## Performance Breakdown

| Layer | Metric | Value |
|-------|--------|-------|
| Database exec | explain execMs | ${fmtMs(db.execMs)} |
| Database wall | mongo harness ms | ${fmtMs(db.wallMs)} |
| API p50 | controller / proxy | ${fmtMs(api.p50Ms)} |
| API p95 | | ${fmtMs(api.p95Ms)} |
| DB share | | ${pct(share.database)} |
| Application share | | ${pct(share.application)} |
| Serialization share | | ${pct(share.serialization)} |
| Serialize wall | | ${fmtMs(api.breakdown?.serializeMs)} |
| App overhead | | ${fmtMs(api.breakdown?.appMs)} |

---

## Database Analysis

| Metric | Value |
|--------|-------|
| Docs examined | ${db.docsExamined ?? "—"} |
| Keys examined | ${db.keysExamined ?? "—"} |
| Returned | ${db.nReturned ?? "—"} |
| Execution time | ${fmtMs(db.execMs)} |
| Indexes used | ${(db.indexNames || []).join(", ") || db.indexName || "—"} |
| Blocking SORT | ${db.hasBlockingSort ? "**yes**" : "no"} |
| Collection scan | ${db.hasCollectionScan ? "**yes**" : "no"} |
| Collections | ${(db.collections || []).join(", ") || "—"} |

---

## API Analysis

| Metric | Value |
|--------|-------|
| Route | ${api.note?.includes("proxied") ? (p.primaryApis || [])[0] || "—" : pb.layers.api && !api.proxy ? (raw.apiProbes?.[p.pageName]?.route || (p.primaryApis || [])[0] || "—") : (p.primaryApis || [])[0] || "—"} |
| Controller | \`${p.controller}\` |
| HTTP status | ${api.status ?? "—"} |
| Response p50 | ${fmtMs(api.p50Ms)} |
| Payload (API) | ${fmtBytes(api.payloadBytes)} B |
| Rows | ${api.rows ?? "—"} |
| Pagination | page size ${raw.pageSize || 10} |
| Projection | ${payload.apiBytes != null && payload.rawBytes != null && payload.apiBytes < payload.rawBytes ? "compact/list fields in use (or estimated)" : api.proxy ? "not measured on controller" : "full or wide response"} |
| Proxy? | ${api.proxy ? "Yes — mongo wall used as API stand-in" : "No — real controller probe"} |

---

## Payload Analysis

| Metric | Value |
|--------|-------|
| Raw / full bytes | ${fmtBytes(payload.rawBytes)} |
| API / compact bytes | ${fmtBytes(payload.apiBytes)} |
| Estimated thin projection | ${fmtBytes(payload.projectedBytes)} |
| Potential savings | ${payload.potentialSavingsPct != null ? `${payload.potentialSavingsPct}%` : "—"} |
| Heavy objects | ${(payload.heavyObjects || []).map((h) => `\`${h}\``).join(", ") || "—"} |

### Largest fields

${topFieldsTable(payload.topFields)}

---

## Frontend Readiness

| Item | Finding |
|------|---------|
| FE file | \`${p.feFile}\` |
| React Query | ${fe.reactQuery ? "Yes" : "No"} |
| Mount API calls (catalog) | ${fe.mountApiCalls ?? "—"} |
| Duplicate risk | ${fe.duplicateRisk ?? "—"} |
| Est. parse cost | ${fmtMs(fe.estParseMs)} |
| Est. render cost | ${fmtMs(fe.estRenderMs)} |
| Primary APIs | ${(fe.primaryApis || p.primaryApis || []).join(", ")} |

---

## Bottlenecks

${measuredBottleneck}

${narrativeBottlenecks ? `\n### Catalog notes\n\n${narrativeBottlenecks}` : ""}

${
  shared
    ? `\n---\n\n## Shared Optimization\n\n| | |\n|--|--|\n| Shared backend | \`${shared.id}\` |\n| API | \`${shared.api}\` |\n| Pages | ${shared.pages.join(", ")} |\n| Bottleneck | **${shared.bottleneck}** |\n| Recommendation | ${shared.recommendation} |\n`
    : ""
}

---

## Optimization Opportunities

| Priority | Opportunity | Expected Gain | Difficulty | Risk | Est. effort |
|----------|-------------|-----------------|------------|------|-------------|
${opps.map((o) => `| ${o.priority} | ${o.item} | ${o.gain} | ${o.difficulty} | ${o.risk} | ${o.effort} |`).join("\n")}

${
  (p.opportunities || []).length
    ? `\n### Additional catalog opportunities\n\n| Opportunity | Expected Gain | Difficulty | Risk | Priority |\n|-------------|---------------|------------|------|----------|\n${(p.opportunities || []).map((o) => `| ${o.item} | ${o.gain} | ${o.difficulty} | ${o.risk} | ${o.priority} |`).join("\n")}`
    : ""
}

---

## Developer Action Items

${(p.actions || ["- [ ] Re-measure after data-volume changes"])
  .map((a) => (a.startsWith("- [") ? a : `- [ ] ${a}`))
  .join("\n")}

---

## Final Verdict

| Question | Answer |
|----------|--------|
| Is the database slow? | ${["C", "D", "Critical"].includes(g.database) ? "**Yes**" : "No"} (${g.database}) |
| Is the API slow? | ${["C", "D", "Critical"].includes(g.api) ? "**Yes**" : "No"} (${g.api}) |
| Is the payload too large? | ${["C", "D", "Critical"].includes(g.payload) ? "**Yes**" : "No"} (${g.payload}) |
| Primary layer | **${pb.primaryBottleneck}** |
| Shared multi-page fix? | ${shared ? "**Yes** — " + shared.id : "No"} |
| Optimize? | **${pb.optimizeRequired}** |
| Overall | **${g.overall}** |

**One-liner:** ${p.oneliner || `${p.pageName}: overall ${g.overall}, bottleneck ${pb.primaryBottleneck}.`}
`;
}

export function renderReadmeV2(raw, indexRows, outDirRel) {
  const shared = raw.sharedOptimizations || [];
  const hot = indexRows
    .filter((r) => ["Critical", "D", "C"].includes(r.overall))
    .sort((a, b) => {
      const order = ["Critical", "D", "C"];
      return order.indexOf(a.overall) - order.indexOf(b.overall);
    });

  return `# Page Performance Reports — Executive Dashboard (v2)

**Tenant:** ${raw.tenant} (\`${raw.tenantId}\`) · **DB:** ${raw.dbName}  
**Measured:** ${raw.measuredAt}  
**Run folder:** \`${outDirRel}\`  
**Framework:** Application Performance Benchmark **v${raw.schemaVersion || 2}**  
**Harness:** \`icm-backend/scripts/page-perf-benchmark.mjs\`

This suite measures **Database + API + Payload + Frontend readiness** — not Mongo alone.

---

## Scoreboard

| Page | Route | DB | API | Payload | FE | Overall | Bottleneck | Primary ms | Payload B | Optimize? | Report |
|------|-------|----|-----|---------|----|---------|------------|------------|-----------|-----------|--------|
${indexRows
  .map(
    (r) =>
      `| ${r.page} | \`${r.route}\` | **${r.database}** | **${r.api}** | **${r.payload}** | **${r.frontend}** | **${r.overall}** | ${r.bottleneck} | ${r.ms} | ${typeof r.payloadBytes === "number" ? r.payloadBytes.toLocaleString() : r.payloadBytes} | ${r.opt} | [${r.file}](./${r.file}) |`,
  )
  .join("\n")}

---

## Shared Optimization Opportunities

${
  shared.length
    ? shared
        .map(
          (s) =>
            `### \`${s.id}\` — Overall **${s.overallGrade}** · bottleneck **${s.bottleneck}**\n\n- **API:** \`${s.api}\`\n- **Pages:** ${s.pages.join(", ")}\n- **Fix once:** ${s.recommendation}\n`,
        )
        .join("\n")
    : "_No shared backend groups in this run._"
}

---

## Cross-page P0 backlog (from live grades)

${
  hot.length
    ? hot
        .slice(0, 8)
        .map(
          (r, i) =>
            `${i + 1}. **${r.page}** — Overall **${r.overall}** · bottleneck **${r.bottleneck}** · ${r.ms} ms · ${typeof r.payloadBytes === "number" ? r.payloadBytes.toLocaleString() + " B" : r.payloadBytes}`,
        )
        .join("\n")
    : "No Critical/D/C pages in this run."
}

---

## How to read grades

| Grade | Meaning |
|-------|---------|
| Database | Index health: docsExamined ≈ page size, no blocking SORT / COLLSCAN |
| API | Real controller p50 (or mongo proxy if probe missing) |
| Payload | Response bytes for the page load |
| FE | React Query, mount fan-out, estimated parse cost |
| Overall | Worst of DB / API / Payload (FE soft-caps) |

---

## Re-run

Each run writes a **new** datetime folder under \`docs/page-performance/reports/\` (history preserved).

\`\`\`bash
cd icm-backend
node --env-file=.env scripts/page-perf-benchmark.mjs
node scripts/generate-page-perf-reports.mjs
# or: node scripts/generate-page-perf-reports.mjs <stamp>
\`\`\`

Architecture: \`scripts/page-perf/ARCHITECTURE.md\`
`;
}
