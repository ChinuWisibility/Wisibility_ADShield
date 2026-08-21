import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ExcelJS from 'exceljs';

function safeSlug(s) {
  return String(s)
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeCsv(outPath, csv) {
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, csv, 'utf8');
}

/** RFC-style CSV cell escaping (aligned with prior xlsx-based script). */
function escapeCsvCell(val) {
  if (val == null || val === '') return '';
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object' && val !== null) {
    if (val.text != null) return escapeCsvCell(val.text);
    if (val.result != null) return escapeCsvCell(val.result);
    if (val.richText && Array.isArray(val.richText)) {
      return escapeCsvCell(val.richText.map((r) => r.text || '').join(''));
    }
    if (val.hyperlink != null && val.text != null) return escapeCsvCell(val.text);
    return '';
  }
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function convertWorkbook(inputFile, outDir) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputFile);
  const wbBase = safeSlug(path.basename(inputFile, path.extname(inputFile)));

  for (const worksheet of workbook.worksheets) {
    const sheetName = worksheet.name;
    const lines = [];

    worksheet.eachRow({ includeEmpty: true }, (row) => {
      let maxCol = 0;
      row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
        maxCol = Math.max(maxCol, colNumber);
      });
      if (maxCol === 0) {
        lines.push('');
        return;
      }
      const parts = [];
      for (let c = 1; c <= maxCol; c += 1) {
        const cell = row.getCell(c);
        parts.push(escapeCsvCell(cell.value));
      }
      lines.push(parts.join(','));
    });

    const body = lines.join('\n');
    const finalCsv = body.trim().length ? body : '__EMPTY_SHEET__\n';

    const outName = `${wbBase}__${safeSlug(sheetName)}.csv`;
    const outPath = path.join(outDir, outName);
    writeCsv(outPath, finalCsv);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const outDirArgIdx = args.findIndex((a) => a === '--outDir');
  if (outDirArgIdx === -1 || outDirArgIdx === args.length - 1) {
    console.error('Usage: node scripts/xlsx-to-csv.mjs --outDir <dir> <file1.xlsx> <file2.xlsx> ...');
    process.exit(1);
  }

  const outDir = args[outDirArgIdx + 1];
  const files = args.filter((_, idx) => idx !== outDirArgIdx && idx !== outDirArgIdx + 1);

  if (!files.length) {
    console.error('No input .xlsx files provided.');
    process.exit(1);
  }

  ensureDir(outDir);

  const results = [];
  for (const f of files) {
    const abs = path.resolve(f);
    if (!fs.existsSync(abs)) {
      console.error(`Missing file: ${abs}`);
      process.exit(1);
    }
    await convertWorkbook(abs, outDir);
    results.push(abs);
  }

  console.log(`Converted ${results.length} workbook(s) into CSVs at: ${path.resolve(outDir)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
