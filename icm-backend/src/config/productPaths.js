import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Package root = icm-backend/ (…/src/config → …/icm-backend). */
export const PACKAGE_ROOT = path.resolve(__dirname, "../..");

/**
 * Resolve install (immutable) and data (mutable) roots.
 * Env overrides: ADSecurity_HOME, ADSecurity_DATA.
 */
export function resolveProductPaths() {
  const isWin = process.platform === "win32";
  const defaultHome = isWin
    ? path.join(process.env.ProgramFiles || "C:\\Program Files", "ADSecurity")
    : path.join(os.homedir(), "ADSecurity");
  const defaultData = isWin
    ? path.join(process.env.ProgramData || "C:\\ProgramData", "ADSecurity")
    : path.join(os.homedir(), ".ADSecurity");

  const home = process.env.ADSecurity_HOME
    ? path.resolve(process.env.ADSecurity_HOME)
    : process.env.NODE_ENV === "production"
      ? defaultHome
      : PACKAGE_ROOT;

  const data = process.env.ADSecurity_DATA
    ? path.resolve(process.env.ADSecurity_DATA)
    : process.env.NODE_ENV === "production"
      ? defaultData
      : path.join(PACKAGE_ROOT, ".data");

  const configPath = path.join(data, "config", "config.json");
  const versionPath = path.join(data, "version.json");
  const licenseDefault = path.join(data, "license", "license.lic.json");
  const logsDir = path.join(data, "logs");
  const uploadsDir = path.join(data, "uploads");
  const backupsDir = path.join(data, "backups");

  return {
    home,
    data,
    configPath,
    versionPath,
    licenseDefault,
    logsDir,
    uploadsDir,
    backupsDir,
    packageRoot: PACKAGE_ROOT,
  };
}

export function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
