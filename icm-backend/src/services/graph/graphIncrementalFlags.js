/**
 * Feature flag for Iteration #1 — true incremental graph edge writes.
 *
 * Env: ENABLE_INCREMENTAL_GRAPH_UPDATES
 *   - unset / empty / "true" / "1" → enabled (default TRUE for development)
 *   - "false" / "0" → disabled (legacy: upsert every desired edge)
 *
 * Instant disable (no restart required for next sync check if process reloads flag each call):
 *   Create file under ProgramData / ADSecurity_DATA: DISABLE_INCREMENTAL_GRAPH_UPDATES
 *   Or set ENABLE_INCREMENTAL_GRAPH_UPDATES=false and restart.
 *
 * Instant re-enable:
 *   Delete the kill-switch file and ensure env is not false.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveProductPaths } from "../../config/productPaths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Kill-switch under mutable data dir (ProgramData in production, icm-backend/.data in dev). */
export function incrementalGraphKillSwitchPath() {
  const { data } = resolveProductPaths();
  return path.join(data, "DISABLE_INCREMENTAL_GRAPH_UPDATES");
}

/**
 * @returns {boolean}
 */
export function isIncrementalGraphUpdatesEnabled() {
  try {
    if (fs.existsSync(incrementalGraphKillSwitchPath())) {
      return false;
    }
  } catch {
    /* ignore fs errors — fall through to env */
  }

  const raw = process.env.ENABLE_INCREMENTAL_GRAPH_UPDATES;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return true;
  }
  const v = String(raw).trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return true;
}

/**
 * Persist kill switch so subsequent syncs use legacy full upsert path.
 * @param {string} reason
 */
export function disableIncrementalGraphUpdates(reason = "validation failure") {
  const filePath = incrementalGraphKillSwitchPath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const body = [
    `disabledAt=${new Date().toISOString()}`,
    `reason=${reason}`,
    "Set ENABLE_INCREMENTAL_GRAPH_UPDATES=false or keep this file to force legacy graph writes.",
    "Delete this file to re-enable incremental graph updates (when env allows).",
    "",
  ].join("\n");
  fs.writeFileSync(filePath, body, "utf8");
  console.error(
    `[graph] ENABLE_INCREMENTAL_GRAPH_UPDATES killed: ${reason} (file=${filePath})`,
  );
  return filePath;
}

/**
 * Remove kill-switch file (does not override env=false).
 */
export function clearIncrementalGraphKillSwitch() {
  const filePath = incrementalGraphKillSwitchPath();
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return filePath;
}
