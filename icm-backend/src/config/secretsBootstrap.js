import crypto from "crypto";
import { loadProductionConfigFile, writeProductionConfig } from "./productionConfig.js";

/**
 * Backend-owned secret generation: if a named security.* secret is missing
 * from config.json, generate a fresh one and persist it. Installer must
 * never write secrets — this is the only code path allowed to.
 *
 * @param {string} configPath
 * @param {object} config loaded production config (mutated)
 * @param {string} key property name under config.security (e.g. "jwtSecret")
 * @returns {string} secret value
 */
export function ensureSecret(configPath, config, key) {
  const existing = config?.security?.[key];
  if (existing && String(existing).trim()) {
    return String(existing).trim();
  }

  const generated = crypto.randomBytes(48).toString("base64url");
  if (!config.security) config.security = {};
  config.security[key] = generated;

  if (configPath) {
    const onDisk = loadProductionConfigFile(configPath)?.config || config;
    if (!onDisk.security) onDisk.security = {};
    onDisk.security[key] = generated;
    writeProductionConfig(configPath, onDisk);
    console.log(`[config] Generated and persisted security.${key} in config.json`);
  } else {
    console.log(`[config] Generated in-memory secret for security.${key} (no config.json to persist)`);
  }

  return generated;
}

/** @deprecated Use ensureSecret(configPath, config, "jwtSecret") */
export function ensureJwtSecret(configPath, config) {
  return ensureSecret(configPath, config, "jwtSecret");
}
