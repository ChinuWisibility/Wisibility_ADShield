import os from "os";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import env from "../../config/env.js";
import { readVersionMetadata } from "../../config/versionMetadata.js";
import { loadProductionConfigFile } from "../../config/productionConfig.js";
import {
  isLicenseRequiredMode,
  isProductLicensed,
  getLicenseManager,
} from "../../licensing/licenseRuntime.js";

/**
 * Support diagnostics payload for GET /api/system/diagnostics
 */
export async function collectDiagnostics() {
  const version = readVersionMetadata(env.paths?.versionPath);
  let configValidation = { ok: true, source: env.configSource };
  try {
    if (env.paths?.configPath && fs.existsSync(env.paths.configPath)) {
      loadProductionConfigFile(env.paths.configPath);
      configValidation = { ok: true, source: "config.json", path: env.paths.configPath };
    }
  } catch (err) {
    configValidation = { ok: false, error: err.message, path: env.paths?.configPath };
  }

  let mongo = { connected: false };
  try {
    const state = mongoose.connection.readyState;
    mongo = {
      connected: state === 1,
      readyState: state,
      host: mongoose.connection.host || null,
      dbName: env.mongodb.dbName,
    };
  } catch (err) {
    mongo = { connected: false, error: err.message };
  }

  const license = getLicenseManager()?.getValidatedLicense();
  const disk = {};
  for (const [label, dir] of [
    ["data", env.paths?.data],
    ["uploads", env.upload?.path],
    ["logs", env.paths?.logsDir],
    ["backups", env.paths?.backupsDir],
  ]) {
    try {
      if (dir && fs.existsSync(dir)) {
        const st = fs.statSync(dir);
        disk[label] = { path: dir, exists: true, isDirectory: st.isDirectory() };
      } else {
        disk[label] = { path: dir || null, exists: false };
      }
    } catch (err) {
      disk[label] = { path: dir || null, error: err.message };
    }
  }

  return {
    product: {
      company: "Wisbility",
      name: "Identity Sphere",
      servicePrefix: "ADSecurity",
    },
    version,
    runtime: {
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      memory: process.memoryUsage(),
      hostname: os.hostname(),
    },
    config: configValidation,
    server: {
      port: env.port,
      host: env.host,
      nodeEnv: env.nodeEnv,
      configSource: env.configSource,
    },
    license: {
      licensed: isProductLicensed(),
      licenseRequiredMode: isLicenseRequiredMode(),
      summary: license?.toLogSummary?.() || null,
    },
    mongo,
    disk,
    services: {
      note: "Windows service status is reported by ADSecurity-doctor on the host",
      expected: ["ADSecurity.API", "ADSecurity.Mongo"],
    },
  };
}
