import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import PostureScanResult from "../models/security/PostureScanResult.js";
import { saveScanResult } from "../services/posture/postureScanResultsStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_SCAN_RESULTS_DIR = path.resolve(__dirname, "../data/scanResults");

let migratedOnce = false;

/**
 * One-time import of legacy JSON scan files into MongoDB (per process).
 * Safe to run repeatedly — skips scanIds already stored in the database.
 */
export async function migratePostureScanResultsFromFilesystemOnce() {
  if (migratedOnce) return { imported: 0, skipped: 0 };
  migratedOnce = true;

  let files;
  try {
    files = await fs.readdir(LEGACY_SCAN_RESULTS_DIR);
  } catch (err) {
    if (err?.code === "ENOENT") return { imported: 0, skipped: 0 };
    throw err;
  }

  let imported = 0;
  let skipped = 0;

  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(LEGACY_SCAN_RESULTS_DIR, name), "utf8");
      const payload = JSON.parse(raw);
      const scanId = String(payload?.scanId || "").trim();
      if (!scanId) continue;

      const exists = await PostureScanResult.exists({ scanId });
      if (exists) {
        skipped += 1;
        continue;
      }

      await saveScanResult(payload);
      imported += 1;
    } catch {
      /* skip corrupt legacy files */
    }
  }

  if (imported > 0) {
    console.log(
      `[PostureScanResult] Imported ${imported} legacy scan file(s) from data/scanResults`,
    );
  }

  return { imported, skipped };
}
