import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { resolveProductPaths } from "./productPaths.js";
import { loadProductionConfigFile } from "./productionConfig.js";
import { ensureSecret } from "./secretsBootstrap.js";
import { readVersionMetadata } from "./versionMetadata.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const paths = resolveProductPaths();

/** Prefer production config.json when present; otherwise development .env. */
const productionLoaded = loadProductionConfigFile(paths.configPath);
const useProductionConfig = Boolean(productionLoaded);

if (!useProductionConfig) {
  dotenv.config({ path: path.resolve(__dirname, "../../.env") });
}

const prod = productionLoaded?.config || null;

function prodOrEnv(prodValue, envValue, fallback) {
  if (prodValue !== undefined && prodValue !== null && prodValue !== "") {
    return prodValue;
  }
  if (envValue !== undefined && envValue !== null && envValue !== "") {
    return envValue;
  }
  return fallback;
}

/**
 * Resolve a required security secret: production config.json auto-generates
 * and persists one on first run (installer never writes secrets); .env mode
 * requires the operator to set it explicitly and fails fast if missing —
 * there is deliberately no hardcoded fallback string for any of these, since
 * a fallback that ships in source control is not a secret.
 */
function resolveRequiredSecret(configKey, envVarName) {
  if (useProductionConfig) {
    return ensureSecret(paths.configPath, prod, configKey);
  }
  const value = process.env[envVarName];
  if (!value || !String(value).trim()) {
    throw new Error(
      `${envVarName} is not set. Generate one (e.g. \`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"\`) and add it to icm-backend/.env — see .env.example.`,
    );
  }
  return String(value).trim();
}

const jwtSecret = resolveRequiredSecret("jwtSecret", "JWT_SECRET");
const certificationJwtSecret = resolveRequiredSecret("certificationJwtSecret", "CERTIFICATION_JWT_SECRET");
const remediationTicketJwtSecret = resolveRequiredSecret("remediationTicketJwtSecret", "REMEDIATION_TICKET_JWT_SECRET");
const orphanIamPortalJwtSecret = resolveRequiredSecret("orphanIamPortalJwtSecret", "ORPHAN_IAM_PORTAL_JWT_SECRET");
const certSignoffSecret = resolveRequiredSecret("certSignoffSecret", "CERT_SIGNOFF_SECRET");

const uploadPath = prodOrEnv(
  prod?.paths?.uploads,
  process.env.UPLOAD_PATH,
  useProductionConfig ? paths.uploadsDir : "./uploads",
);

const licensePathFromConfig = prod?.paths?.license || "";
const licenseSearchPaths = useProductionConfig
  ? [licensePathFromConfig || paths.licenseDefault].filter(Boolean)
  : (process.env.LICENSE_SEARCH_PATHS || "config/license.lic.json,license/license.lic.json")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

const keysDir = (() => {
  if (process.env.LICENSE_KEYS_DIR) {
    return path.isAbsolute(process.env.LICENSE_KEYS_DIR)
      ? process.env.LICENSE_KEYS_DIR
      : path.resolve(__dirname, "../..", process.env.LICENSE_KEYS_DIR);
  }
  if (useProductionConfig) {
    return path.join(paths.home, "app", "keys");
  }
  return path.resolve(__dirname, "../../keys");
})();

const corsOrigins = useProductionConfig
  ? Array.isArray(prod?.cors?.origins) && prod.cors.origins.length
    ? prod.cors.origins
    : [`http://127.0.0.1:${prodOrEnv(prod?.server?.port, process.env.PORT, 8081)}`]
  : (process.env.CORS_ORIGINS || "http://localhost:3000").split(",");

const configuredPublicUrl = String(
  prodOrEnv(
    prod?.deployment?.publicUrl,
    process.env.FRONTEND_URL || process.env.BACKEND_PUBLIC_URL,
    useProductionConfig
      ? `http://127.0.0.1:${prodOrEnv(prod?.server?.port, process.env.PORT, 8081)}`
      : "http://localhost:3000",
  ),
).replace(/\/+$/, "");

// Legacy email/link modules still read process.env at module evaluation time.
// Mirror the canonical production config before those modules initialize.
process.env.FRONTEND_URL = configuredPublicUrl;
process.env.BACKEND_PUBLIC_URL = configuredPublicUrl;
if (prod?.smtp?.host) process.env.EMAIL_HOST = prod.smtp.host;
if (prod?.smtp?.port) process.env.EMAIL_PORT = String(prod.smtp.port);
if (prod?.smtp?.user) process.env.EMAIL_USER = prod.smtp.user;
if (prod?.smtp?.pass) process.env.EMAIL_PASS = prod.smtp.pass;
if (prod?.smtp?.secure !== undefined) {
  process.env.EMAIL_SECURE = String(prod.smtp.secure);
}
const bootIamTeamEmail = String(
  prod?.deployment?.iamTeamEmail || prod?.workflow?.iamTeamEmail || process.env.IAM_TEAM_EMAIL || "",
).trim();
if (bootIamTeamEmail) process.env.IAM_TEAM_EMAIL = bootIamTeamEmail;

const version = readVersionMetadata(paths.versionPath);

const env = {
  port: parseInt(String(prodOrEnv(prod?.server?.port, process.env.PORT, 8081)), 10) || 8081,
  host: String(prodOrEnv(prod?.server?.host, process.env.HOST, "0.0.0.0")),
  nodeEnv: process.env.NODE_ENV || (useProductionConfig ? "production" : "development"),
  isDev: (process.env.NODE_ENV || (useProductionConfig ? "production" : "development")) !== "production",
  configSource: useProductionConfig ? "config.json" : ".env",
  paths,
  version,

  mongodb: {
    uri: prodOrEnv(prod?.database?.uri, process.env.MONGODB_URI, "mongodb://127.0.0.1:27017"),
    dbName: prodOrEnv(prod?.database?.name, process.env.DB_NAME, "ADShield"),
  },

  jwt: {
    secret: jwtSecret,
    expiresIn: prodOrEnv(prod?.security?.jwtExpiresIn, process.env.JWT_EXPIRES_IN, "24h"),
  },

  // Purpose-specific secrets for public review-portal tokens — deliberately
  // distinct from jwt.secret so a leak of one doesn't forge the others.
  portalSecrets: {
    certification: certificationJwtSecret,
    remediationTicket: remediationTicketJwtSecret,
    orphanIamPortal: orphanIamPortalJwtSecret,
    certSignoff: certSignoffSecret,
  },

  cors: {
    origins: corsOrigins,
  },

  deployment: {
    mode: String(prodOrEnv(prod?.deployment?.mode, process.env.DEPLOYMENT_MODE, "internal")),
    publicUrl: configuredPublicUrl,
    requireMfa: Boolean(
      prod?.deployment?.requireMfa ??
        (String(process.env.REQUIRE_MFA || "false").toLowerCase() === "true"),
    ),
  },

  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 10485760,
    path: uploadPath,
  },

  email: {
    host: prodOrEnv(prod?.smtp?.host, process.env.EMAIL_HOST, undefined),
    port: parseInt(String(prodOrEnv(prod?.smtp?.port, process.env.EMAIL_PORT, 465)), 10) || 465,
    user: prodOrEnv(prod?.smtp?.user, process.env.EMAIL_USER, undefined),
    pass: prodOrEnv(prod?.smtp?.pass, process.env.EMAIL_PASS, undefined),
  },

  // No hardcoded fallback on purpose — a fallback that ships in source
  // control is not a secret. If unset, seedDefaultAdmin() generates and
  // logs a random one-time password instead (see authService.js).
  adminPassword: prodOrEnv(prod?.security?.adminPassword, process.env.ADMIN_PASSWORD, ""),
  /**
   * Temporary/demo initial password for portal Users created from Identity onboarding.
   * Never log or return this value. Unset disables portal-user creation from identities.
   */
  defaultInitialPassword: String(
    prodOrEnv(
      prod?.security?.defaultInitialPassword,
      process.env.DEFAULT_INITIAL_PASSWORD,
      "",
    ),
  ),
  /** TTL for Identity New Identity "Create Own Password" tokens only. */
  identityOnboardingTokenTtlDays: Math.max(
    1,
    parseInt(
      String(
        prodOrEnv(
          prod?.security?.identityOnboardingTokenTtlDays,
          process.env.IDENTITY_ONBOARDING_TOKEN_TTL_DAYS,
          7,
        ),
      ),
      10,
    ) || 7,
  ),
  forceAdminPasswordReset: Boolean(
    prod?.security?.forceAdminPasswordReset ??
      (String(process.env.FORCE_ADMIN_PASSWORD_RESET || "false").toLowerCase() === "true"),
  ),
  setupMode: Boolean(
    prod?.security?.setupMode ??
      (String(process.env.FORCE_SETUP_BOOTSTRAP || "false").toLowerCase() === "true"),
  ),
  ldapRejectUnauthorized:
    prod?.security?.ldapRejectUnauthorized !== undefined
      ? Boolean(prod.security.ldapRejectUnauthorized)
      : String(process.env.LDAP_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false",

  frontendUrl: configuredPublicUrl,
  backendUrl: configuredPublicUrl,

  workflow: {
    fromEmail: process.env.WORKFLOW_FROM_EMAIL || process.env.EMAIL_USER || "",
    iamTeamEmail: String(
      prodOrEnv(
        prod?.deployment?.iamTeamEmail ?? prod?.workflow?.iamTeamEmail,
        process.env.IAM_TEAM_EMAIL,
        "",
      ),
    ).trim(),
  },

  hrms: {
    syntheticEmailDomain: String(process.env.HRMS_SYNTHETIC_EMAIL_DOMAIN || "sync.local")
      .trim()
      .replace(/^@/, ""),
  },

  workflowRemediation: {
    schedulerEnabled:
      String(process.env.WORKFLOW_REMEDIATION_SCHEDULER_ENABLED || "false").toLowerCase() ===
      "true",
    queuePollMs: Number(process.env.WORKFLOW_REMEDIATION_QUEUE_POLL_MS) || 60 * 60 * 1000,
  },

  legacyRemediationEnabled:
    String(process.env.LEGACY_REMEDIATION_ENABLED || "false").toLowerCase() === "true",

  /**
   * Optional ADShield .NET engine for live ACL / security-descriptor analysis.
   * Disabled by default — ACL intelligence falls back to Node detectors.
   */
  adShield: {
    enabled:
      String(process.env.ADSHIELD_ENABLED || "false").toLowerCase() === "true",
    baseUrl: String(process.env.ADSHIELD_BASE_URL || "http://127.0.0.1:5088")
      .trim()
      .replace(/\/+$/, ""),
    /** HTTP client timeout for ACL analysis (ms). Keep below FE scan budget (600s). */
    timeoutMs: Math.min(
      Math.max(parseInt(process.env.ADSHIELD_TIMEOUT_MS, 10) || 180000, 5000),
      540000,
    ),
    /** Optional shared secret sent as X-ADShield-Key when set on both sides. */
    apiKey: String(process.env.ADSHIELD_API_KEY || "").trim(),
  },

  /**
   * Offline product licensing (LMS).
   * There is intentionally no flag to disable licensing.
   */
  license: {
    appRoot: useProductionConfig ? paths.home : path.resolve(__dirname, "../.."),
    searchPaths: licenseSearchPaths,
    envFilePath: licensePathFromConfig || process.env.LICENSE_PATH || paths.licenseDefault || "",
    envContent: process.env.LICENSE_CONTENT || "",
    keysDir,
    issuer: process.env.LICENSE_ISSUER || "Wisibility",
    audience: process.env.LICENSE_AUDIENCE || "ADSecurity",
    expectedProduct: process.env.LICENSE_PRODUCT || process.env.LICENSE_AUDIENCE || "ADSecurity",
    schemaVersion: process.env.LICENSE_SCHEMA_VERSION || "1.0",
    allowedAlgorithms: (process.env.LICENSE_ALLOWED_ALGS || "RS256")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
    allowedHashes: (process.env.LICENSE_ALLOWED_HASHES || "SHA-256")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
    allowedTypes: (
      process.env.LICENSE_ALLOWED_TYPES ||
      "Commercial,Trial,Evaluation,Educational,Internal,development"
    )
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  },
};

export default env;
