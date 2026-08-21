import SystemConfiguration from "../../models/platform/SystemConfiguration.js";
import env from "../../config/env.js";
import { patchProductionConfig } from "../../config/productionConfig.js";
import { AppError } from "../../middleware/errorHandler.js";

const SETTINGS_KEY = "deployment.access";

let current = null;

function normalizeHttpUrl(value, fieldName) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError(`${fieldName} must be a valid URL`, 400, "INVALID_DEPLOYMENT_URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new AppError(`${fieldName} must use http or https`, 400, "INVALID_DEPLOYMENT_URL");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new AppError(
      `${fieldName} must contain only scheme, host, and optional port/path`,
      400,
      "INVALID_DEPLOYMENT_URL",
    );
  }
  return raw;
}

function normalizeEmail(value, fieldName) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(`${fieldName} must be a valid email address`, 400, "INVALID_EMAIL");
  }
  return email;
}

function desktopLoopbackOrigins() {
  const port = Number(env.port) || 8081;
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

function uniqueOrigins(list) {
  return [...new Set((list || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function defaultsFromEnvironment() {
  const publicUrl = normalizeHttpUrl(
    env.deployment?.publicUrl || env.frontendUrl,
    "Application URL",
  );
  return {
    mode: env.deployment?.mode === "public" ? "public" : "internal",
    publicUrl,
    allowedOrigins: uniqueOrigins([new URL(publicUrl).origin, ...desktopLoopbackOrigins()]),
    requireMfa: Boolean(env.deployment?.requireMfa),
    iamTeamEmail: String(env.workflow?.iamTeamEmail || "").trim().toLowerCase(),
    smtp: {
      host: env.email?.host || "",
      port: Number(env.email?.port) || 465,
      user: env.email?.user || "",
      pass: env.email?.pass || "",
      secure: Number(env.email?.port) === 465,
    },
  };
}

export function normalizeDeploymentAccess(input = {}, previous = defaultsFromEnvironment()) {
  const publicUrl = normalizeHttpUrl(input.publicUrl, "Application URL");
  const mode = "internal";

  const iamTeamEmail = normalizeEmail(
    input.iamTeamEmail !== undefined ? input.iamTeamEmail : previous.iamTeamEmail,
    "IAM team email",
  );

  const smtpInput = input.smtp || {};
  const smtpPort = Number(smtpInput.port ?? previous.smtp?.port ?? 465);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new AppError("SMTP port must be between 1 and 65535", 400, "INVALID_SMTP_PORT");
  }

  const suppliedPassword = typeof smtpInput.pass === "string" ? smtpInput.pass : "";
  return {
    mode,
    publicUrl,
    allowedOrigins: uniqueOrigins([new URL(publicUrl).origin, ...desktopLoopbackOrigins()]),
    requireMfa: Boolean(input.requireMfa),
    iamTeamEmail,
    smtp: {
      host: String(smtpInput.host ?? previous.smtp?.host ?? "").trim(),
      port: smtpPort,
      user: String(smtpInput.user ?? previous.smtp?.user ?? "").trim(),
      pass: suppliedPassword || previous.smtp?.pass || "",
      secure: Boolean(smtpInput.secure ?? smtpPort === 465),
    },
  };
}

function applyRuntime(settings) {
  current = settings;
  env.deployment = {
    mode: settings.mode,
    publicUrl: settings.publicUrl,
    requireMfa: settings.requireMfa,
    iamTeamEmail: settings.iamTeamEmail,
  };
  env.cors.origins = [...settings.allowedOrigins];
  env.frontendUrl = settings.publicUrl;
  env.backendUrl = settings.publicUrl;
  env.email = { ...settings.smtp };
  env.workflow = {
    ...(env.workflow || {}),
    iamTeamEmail: settings.iamTeamEmail,
  };

  process.env.FRONTEND_URL = settings.publicUrl;
  process.env.BACKEND_PUBLIC_URL = settings.publicUrl;
  process.env.EMAIL_HOST = settings.smtp.host;
  process.env.EMAIL_PORT = String(settings.smtp.port);
  process.env.EMAIL_USER = settings.smtp.user;
  process.env.EMAIL_PASS = settings.smtp.pass;
  process.env.EMAIL_SECURE = String(settings.smtp.secure);
  process.env.IAM_TEAM_EMAIL = settings.iamTeamEmail;
}

function toPublic(settings) {
  return {
    mode: settings.mode,
    publicUrl: settings.publicUrl,
    allowedOrigins: [...settings.allowedOrigins],
    requireMfa: settings.requireMfa,
    iamTeamEmail: settings.iamTeamEmail,
    smtp: {
      host: settings.smtp.host,
      port: settings.smtp.port,
      user: settings.smtp.user,
      secure: settings.smtp.secure,
      passwordConfigured: Boolean(settings.smtp.pass),
    },
  };
}

export async function initializeDeploymentAccess() {
  const fallback = defaultsFromEnvironment();
  const stored = await SystemConfiguration.findOne({ key: SETTINGS_KEY }).lean();
  const settings = stored?.value
    ? normalizeDeploymentAccess(stored.value, fallback)
    : fallback;

  if (!stored) {
    await SystemConfiguration.create({
      key: SETTINGS_KEY,
      value: settings,
      category: "deployment",
      description: "Organization deployment access, application URL, IAM team email, and SMTP",
      isSecret: true,
    });
  }

  applyRuntime(settings);
  return toPublic(settings);
}

export function getDeploymentAccess() {
  if (!current) applyRuntime(defaultsFromEnvironment());
  return toPublic(current);
}

export async function updateDeploymentAccess(input, updatedBy) {
  const previous = current || defaultsFromEnvironment();
  const settings = normalizeDeploymentAccess(input, previous);

  if (env.configSource === "config.json" && env.paths?.configPath) {
    patchProductionConfig(env.paths.configPath, {
      deployment: {
        mode: settings.mode,
        publicUrl: settings.publicUrl,
        requireMfa: settings.requireMfa,
        iamTeamEmail: settings.iamTeamEmail,
      },
      workflow: {
        iamTeamEmail: settings.iamTeamEmail,
      },
      cors: { origins: settings.allowedOrigins },
      smtp: settings.smtp,
    });
  }

  await SystemConfiguration.findOneAndUpdate(
    { key: SETTINGS_KEY },
    {
      value: settings,
      category: "deployment",
      description: "Organization deployment access, application URL, IAM team email, and SMTP",
      isSecret: true,
      updatedBy,
    },
    { new: true, upsert: true, runValidators: true },
  );

  applyRuntime(settings);
  return toPublic(settings);
}

const DEV_BROWSER_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
]);

export function isCorsOriginAllowed(origin) {
  if (!origin) return true;
  if (!current) applyRuntime(defaultsFromEnvironment());
  if (current.allowedOrigins.includes(origin)) return true;
  if (desktopLoopbackOrigins().includes(origin)) return true;
  if (!env.isDev) return false;
  if (DEV_BROWSER_ORIGINS.has(origin)) return true;
  return (env.cors?.origins || []).map((value) => String(value).trim()).includes(origin);
}
