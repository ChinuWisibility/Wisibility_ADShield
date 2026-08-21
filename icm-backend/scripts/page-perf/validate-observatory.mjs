/**
 * Post-run validation for Performance Observatory (Phase 6).
 * Usage: node scripts/page-perf/validate-observatory.mjs [stamp|path]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildPageCatalogMaps, loadRegistry } from "./registry/index.mjs";
import { missingApplicationFeatureTargets } from "./discover/from-application-tabs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsRoot = path.join(__dirname, "../../docs/page-performance/reports");

function resolveOutDir(arg) {
  if (!arg) {
    const dirs = fs
      .readdirSync(reportsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(reportsRoot, e.name))
      .filter((d) => fs.existsSync(path.join(d, "benchmark-raw.json")))
      .sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
    if (!dirs[0]) throw new Error("No runs found");
    return dirs[0];
  }
  if (path.isAbsolute(arg) && fs.existsSync(arg)) return arg;
  const child = path.join(reportsRoot, arg);
  if (fs.existsSync(child)) return child;
  throw new Error(`Run not found: ${arg}`);
}

const outDir = resolveOutDir(process.argv[2]);
const raw = JSON.parse(fs.readFileSync(path.join(outDir, "benchmark-raw.json"), "utf8"));
const { PAGE_METRIC } = buildPageCatalogMaps();
const registry = loadRegistry();
const byLabel = new Set((raw.results || []).map((r) => r.label));

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail || "" });
}

check("schemaVersion >= 3", Number(raw.schemaVersion) >= 3, `got ${raw.schemaVersion}`);
check("pageBenchmarks present", (raw.pageBenchmarks || []).length >= 20, `count=${raw.pageBenchmarks?.length}`);
check("targetBenchmarks present", (raw.targetBenchmarks || []).length >= 30, `count=${raw.targetBenchmarks?.length}`);
check("sharedApiReports present", (raw.sharedApiReports || []).length >= 3, `count=${raw.sharedApiReports?.length}`);

for (const [pageId, label] of Object.entries(PAGE_METRIC)) {
  check(`results has ${label} (for ${pageId})`, byLabel.has(label), label);
}

const navPageIds = registry.targets.filter((t) => t.kind === "navigation" && !t.comingSoon).map((t) => t.pageId);
for (const pageId of navPageIds) {
  const file = path.join(outDir, `${pageId}-performance-report.md`);
  check(`nav report ${pageId}`, fs.existsSync(file), file);
}

const featureIds = registry.targets.filter((t) => t.kind === "feature").map((t) => t.id);
const missing = missingApplicationFeatureTargets(featureIds);
check("Application detail tabs registered", missing.length === 0, missing.map((m) => m.key).join(","));

const identitiesShared = (raw.sharedApiReports || []).find((s) => s.id === "api.identities.list");
check(
  "identities shared API links Peer + Posture",
  identitiesShared &&
    identitiesShared.usedBy.includes("nav.peerComparison") &&
    identitiesShared.usedBy.includes("nav.identityPosture"),
  JSON.stringify(identitiesShared?.usedBy),
);

const appFeatures = (raw.targetBenchmarks || []).filter((t) => t.targetId?.startsWith("feat.applications."));
check("Applications feature benchmarks", appFeatures.length >= 5, `count=${appFeatures.length}`);

const actions = (raw.targetBenchmarks || []).filter((t) => t.kind === "action");
check("Action benchmarks", actions.length >= 2, `count=${actions.length}`);

check("README exists", fs.existsSync(path.join(outDir, "README.md")));

const failed = checks.filter((c) => !c.ok);
const lines = [
  `# Observatory Validation`,
  ``,
  `**Run:** \`${path.basename(outDir)}\``,
  `**Measured:** ${raw.measuredAt}`,
  `**schemaVersion:** ${raw.schemaVersion}`,
  ``,
  `| Check | Result | Detail |`,
  `|-------|--------|--------|`,
  ...checks.map((c) => `| ${c.name} | ${c.ok ? "PASS" : "FAIL"} | ${c.detail || "—"} |`),
  ``,
  `**Summary:** ${checks.length - failed.length}/${checks.length} passed`,
  failed.length ? `\n## Failures\n\n${failed.map((f) => `- ${f.name}: ${f.detail}`).join("\n")}` : `\nAll checks passed.`,
];

const outPath = path.join(outDir, "VALIDATION.md");
fs.writeFileSync(outPath, lines.join("\n"));
console.log(lines.join("\n"));
console.log(`\nWrote ${outPath}`);
process.exit(failed.length ? 1 : 0);
