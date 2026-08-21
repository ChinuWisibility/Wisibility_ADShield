import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

function readCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  // Some sheets have title lines before the header row; find the first row that looks like a header.
  const headerIdx = lines.findIndex((l) => /FR-ID|Collection,Domain|Domain,Collection,Field|#,Sprint,Domain/.test(l));
  const csv = headerIdx > 0 ? lines.slice(headerIdx).join('\n') : raw;
  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  });
}

function asNum(v) {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
  }
  return '';
}

function main() {
  const rawDir = process.argv[2];
  const outDir = process.argv[3];
  if (!rawDir || !outDir) {
    console.error('Usage: node scripts/normalize-requirements.mjs <rawCsvDir> <outDir>');
    process.exit(1);
  }

  const files = fs.readdirSync(rawDir).filter((f) => f.endsWith('.csv'));
  const file = (namePart) => path.join(rawDir, files.find((f) => f.includes(namePart)) || '');

  const devPriorityRows = readCsv(file('Schema_Gap_Analysis__Development_Priority'));
  const fieldCatalogRows = readCsv(file('Master_Schema_Catalog_128_Collections__Field_Catalog'));
  const frMatrixRows = readCsv(file('Complete_FR_Tracker_1__Complete_FR_Matrix'));
  const sprintPlanRows = readCsv(file('Functionality_Document__To_Build_Sprint_Plan'));

  const fieldCatalogByCollection = new Map();
  for (const r of fieldCatalogRows) {
    const collection = pick(r, ['Collection', 'collection']);
    if (!collection) continue;
    const entry = {
      domain: pick(r, ['Domain']),
      collection,
      field: pick(r, ['Field']),
      type: pick(r, ['Type']),
      required: pick(r, ['Required']),
      indexed: pick(r, ['Indexed']),
      fkCollection: pick(r, ['FK → Collection', 'FK']),
      notes: pick(r, ['Notes / Governance', 'Notes']),
    };
    const arr = fieldCatalogByCollection.get(collection) || [];
    arr.push(entry);
    fieldCatalogByCollection.set(collection, arr);
  }

  const devPriority = devPriorityRows
    .filter((r) => pick(r, ['Collection']))
    .map((r) => ({
      rank: asNum(pick(r, ['#', 'Rank'])) ?? null,
      collection: pick(r, ['Collection']),
      domain: pick(r, ['Domain']),
      currentState: pick(r, ['Current State']),
      action: pick(r, ['Action']),
      priority: pick(r, ['Priority']),
      effortDays: asNum(pick(r, ['Effort (days)'])) ?? null,
      dependencies: pick(r, ['Dependencies']),
    }));

  const frMatrix = frMatrixRows
    .filter((r) => pick(r, ['FR-ID #', 'FR-ID']))
    .map((r) => ({
      frId: pick(r, ['FR-ID #', 'FR-ID']),
      area: pick(r, ['Functionality Area']),
      title: pick(r, ['Functional Requirements']),
      description: pick(r, ['Requirement Description']),
      entities: pick(r, ['Related ERD Entities']),
      scope: pick(r, ['Scope']),
      priority: pick(r, ['Priority']),
      status: pick(r, ['Status']),
      acceptanceCriteria: pick(r, ['Acceptance Criteria']),
    }));

  const sprintPlan = sprintPlanRows
    .filter((r) => pick(r, ['#']))
    .map((r) => ({
      sprint: pick(r, ['Sprint']),
      domain: pick(r, ['Domain']),
      collection: pick(r, ['Collection']),
      functionName: pick(r, ['Function']),
      method: pick(r, ['Method']),
      endpoint: pick(r, ['Endpoint']),
      roles: pick(r, ['Roles']),
      compliance: pick(r, ['Compliance']),
      acceptanceCriteria: pick(r, ['Acceptance Criteria']),
    }));

  // Unified backlog: start from schema priority list, enrich with field catalog + sprint functions + FR items
  const sprintByCollection = new Map();
  for (const s of sprintPlan) {
    const c = s.collection;
    if (!c) continue;
    const arr = sprintByCollection.get(c) || [];
    arr.push(s);
    sprintByCollection.set(c, arr);
  }

  const frByCollection = new Map();
  for (const fr of frMatrix) {
    const entities = String(fr.entities || '');
    // Entities may contain multiple; try to map to exact collection names.
    for (const [collection] of fieldCatalogByCollection) {
      if (entities.includes(collection)) {
        const arr = frByCollection.get(collection) || [];
        arr.push(fr);
        frByCollection.set(collection, arr);
      }
    }
  }

  const unifiedBacklog = devPriority.map((item) => {
    const fields = fieldCatalogByCollection.get(item.collection) || [];
    const functions = sprintByCollection.get(item.collection) || [];
    const frs = frByCollection.get(item.collection) || [];
    return {
      epic: item.domain,
      collection: item.collection,
      schemaImpact: {
        currentState: item.currentState,
        action: item.action,
        fieldsCount: fields.length,
      },
      apiImpact: functions.map((f) => ({ method: f.method, endpoint: f.endpoint, functionName: f.functionName, roles: f.roles })),
      frImpact: frs.map((f) => ({ frId: f.frId, title: f.title, priority: f.priority, status: f.status })),
      priority: item.priority,
      effortDays: item.effortDays,
      dependencies: item.dependencies,
      links: {
        fieldCatalog: `Field_Catalog:${item.collection}`,
      },
    };
  });

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'backlog.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    counts: {
      devPriority: devPriority.length,
      fieldCatalogRows: fieldCatalogRows.length,
      frMatrix: frMatrix.length,
      sprintPlan: sprintPlan.length,
      unifiedBacklog: unifiedBacklog.length,
    },
    devPriority,
    frMatrix,
    sprintPlan,
    unifiedBacklog,
  }, null, 2));

  // Quick first-5 recommendation: Critical Not Built from dev priority
  const first5 = devPriority
    .filter((x) => String(x.priority).toLowerCase() === 'critical' && /not built/i.test(String(x.currentState)))
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
    .slice(0, 5);

  const md = [
    '## First 5 (Critical + Not Built)',
    '',
    ...first5.map((x, i) => `- **${i + 1}. ${x.collection}** (${x.domain}) — ${x.action} (deps: ${x.dependencies || '—'})`),
    '',
    '## Notes',
    '- Source: Development Priority Matrix + Field Catalog + FR Matrix + Sprint Plan',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'first-5.md'), md);

  console.log(`Wrote normalized backlog to: ${path.resolve(outDir)}`);
}

main();

