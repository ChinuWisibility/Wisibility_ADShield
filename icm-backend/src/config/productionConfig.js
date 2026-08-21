import fs from "fs";
import path from "path";
import Joi from "joi";
import { ensureDirSync } from "./productPaths.js";

const configSchema = Joi.object({
  server: Joi.object({
    port: Joi.number().integer().min(1).max(65535).default(8081),
    host: Joi.string().default("0.0.0.0"),
  }).default(),
  database: Joi.object({
    uri: Joi.string().min(1).required(),
    name: Joi.string().min(1).default("IGA-V3"),
  }).required(),
  paths: Joi.object({
    uploads: Joi.string().allow("").optional(),
    license: Joi.string().allow("").optional(),
    logs: Joi.string().allow("").optional(),
    backups: Joi.string().allow("").optional(),
    data: Joi.string().allow("").optional(),
  }).default(),
  security: Joi.object({
    jwtSecret: Joi.string().allow("").optional(),
    jwtExpiresIn: Joi.string().default("24h"),
    // Purpose-specific portal-token secrets (WIS-004/WIS-006) — auto-generated
    // and persisted here by ensureSecret() on first run, same as jwtSecret.
    certificationJwtSecret: Joi.string().allow("").optional(),
    remediationTicketJwtSecret: Joi.string().allow("").optional(),
    orphanIamPortalJwtSecret: Joi.string().allow("").optional(),
    certSignoffSecret: Joi.string().allow("").optional(),
    adminPassword: Joi.string().allow("").optional(),
    defaultInitialPassword: Joi.string().allow("").optional(),
    identityOnboardingTokenTtlDays: Joi.number().integer().min(1).optional(),
    forceAdminPasswordReset: Joi.boolean().default(true),
    ldapRejectUnauthorized: Joi.boolean().default(true),
    /** When true, skip seedDefaultAdmin — installer will call POST /api/setup/initialize */
    setupMode: Joi.boolean().default(false),
  }).unknown(true).default(),
  smtp: Joi.object({
    host: Joi.string().allow("").optional(),
    port: Joi.number().integer().default(465),
    user: Joi.string().allow("").optional(),
    pass: Joi.string().allow("").optional(),
    secure: Joi.boolean().optional(),
  }).default(),
  cors: Joi.object({
    origins: Joi.array().items(Joi.string()).default([]),
  }).default(),
  deployment: Joi.object({
    mode: Joi.string().valid("internal", "public").default("internal"),
    publicUrl: Joi.string().uri({ scheme: ["http", "https"] }).allow("").default(""),
    requireMfa: Joi.boolean().default(false),
    iamTeamEmail: Joi.string().email({ tlds: { allow: false } }).allow("").default(""),
  }).default(),
  workflow: Joi.object({
    fromEmail: Joi.string().email({ tlds: { allow: false } }).allow("").optional(),
    iamTeamEmail: Joi.string().email({ tlds: { allow: false } }).allow("").optional(),
  }).default(),
}).unknown(true);

/**
 * @param {string} configPath
 * @returns {{ config: object, source: "config.json" } | null}
 */
export function loadProductionConfigFile(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    return null;
  }

  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    throw new Error(`Unable to read config.json at ${configPath}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config.json is not valid JSON (${configPath}): ${err.message}`);
  }

  const { error, value } = configSchema.validate(parsed, {
    abortEarly: false,
    stripUnknown: false,
  });

  if (error) {
    const details = error.details.map((d) => d.message).join("; ");
    throw new Error(`config.json validation failed (${configPath}): ${details}`);
  }

  return { config: value, source: "config.json", configPath };
}

/**
 * Persist full config object to disk (atomic replace).
 * @param {string} configPath
 * @param {object} config
 */
export function writeProductionConfig(configPath, config) {
  ensureDirSync(path.dirname(configPath));
  const tmp = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, configPath);
}

/**
 * Update a nested key path in config.json (e.g. security.jwtSecret).
 * @param {string} configPath
 * @param {Record<string, unknown>} patch shallow merge at top level
 */
export function patchProductionConfig(configPath, patch) {
  const existing = loadProductionConfigFile(configPath);
  const base = existing?.config || {};
  const merged = deepMerge(base, patch);
  writeProductionConfig(configPath, merged);
  return merged;
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof a?.[k] === "object" && a[k] && !Array.isArray(a[k])) {
      out[k] = deepMerge(a[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
