import fs from "fs";
import path from "path";
import { ensureDirSync } from "./productPaths.js";

const DEFAULT_VERSION = {
  productVersion: "1.0.0",
  schemaVersion: 1,
  installerVersion: "1.0.0",
  nodeVersion: process.versions.node || "unknown",
  mongoVersion: "unknown",
};

/**
 * @param {string} versionPath
 * @returns {object}
 */
export function readVersionMetadata(versionPath) {
  if (!versionPath || !fs.existsSync(versionPath)) {
    return { ...DEFAULT_VERSION, nodeVersion: process.versions.node };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(versionPath, "utf8"));
    return {
      ...DEFAULT_VERSION,
      ...parsed,
      nodeVersion: parsed.nodeVersion || process.versions.node,
    };
  } catch {
    return { ...DEFAULT_VERSION, nodeVersion: process.versions.node };
  }
}

/**
 * @param {string} versionPath
 * @param {object} patch
 */
export function writeVersionMetadata(versionPath, patch = {}) {
  ensureDirSync(path.dirname(versionPath));
  const current = readVersionMetadata(versionPath);
  const next = {
    ...current,
    ...patch,
    nodeVersion: patch.nodeVersion || process.versions.node || current.nodeVersion,
  };
  const tmp = `${versionPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, versionPath);
  return next;
}
