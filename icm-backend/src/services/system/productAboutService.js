import mongoose from "mongoose";
import env from "../../config/env.js";
import { readVersionMetadata } from "../../config/versionMetadata.js";
import {
  getLicenseManager,
  isLicenseRequiredMode,
  isProductLicensed,
} from "../../licensing/licenseRuntime.js";
import Tenant from "../../models/platform/Tenant.js";
import User from "../../models/platform/User.js";
import {
  getDynamicIdentityModelForTenantId,
  getLegacyIdentityModel,
} from "../../models/identity/Identity.js";
import Application from "../../models/application/Application.js";
import {
  PRODUCT_ABOUT_DEFAULTS as D,
  PRODUCT_ABOUT_OVERRIDES as O,
  firstValue,
} from "../../config/productAbout.config.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function environmentLabel() {
  const explicit = O.environment;
  if (explicit) return explicit;
  return env.nodeEnv === "production" ? "Production" : "Development";
}

/** Licensed identity ceiling is optional in the LMS schema — several claim spellings are accepted. */
function licensedIdentitiesFromClaims(claims) {
  if (!claims) return null;
  const candidates = [
    claims.limits?.identities,
    claims.limits?.maxIdentities,
    claims.limits?.licensedIdentities,
    claims.licensedIdentities,
    claims.maxIdentities,
    claims.identityLimit,
    claims.seats,
  ];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

async function resolveTenant(req) {
  const raw = req.user?.tenantId;
  if (raw && typeof raw === "object" && (raw.name || raw.code)) {
    return {
      id: raw._id ? String(raw._id) : null,
      name: firstValue(raw.name, raw.code),
      code: firstValue(raw.code),
    };
  }

  let tenantId = raw ? String(raw) : null;
  if (!tenantId && req.user?.id) {
    const user = await User.findById(req.user.id).select("tenantId").lean();
    tenantId = user?.tenantId ? String(user.tenantId) : null;
  }
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    return { id: null, name: null, code: null };
  }

  const tenant = await Tenant.findById(tenantId).select("name code").lean();
  return {
    id: tenantId,
    name: firstValue(tenant?.name, tenant?.code),
    code: firstValue(tenant?.code),
  };
}

/** Identities live in per-tenant collections; platform actors fall back to the legacy mirror. */
async function countIdentities(tenantOid) {
  if (!tenantOid) {
    return getLegacyIdentityModel().countDocuments({});
  }
  const IdentityModel = await getDynamicIdentityModelForTenantId(tenantOid, {
    ensureBackfill: false,
  });
  return IdentityModel.countDocuments({ tenantId: tenantOid });
}

async function resolveUsage(tenantId) {
  const tenantOid = tenantId ? new mongoose.Types.ObjectId(tenantId) : null;
  const [identities, applications] = await Promise.all([
    countIdentities(tenantOid).catch(() => null),
    Application.countDocuments(tenantOid ? { tenantId: tenantOid } : {}).catch(() => null),
  ]);
  return { identities, applications };
}

function resolveLicense() {
  let claims = null;
  try {
    claims = getLicenseManager()?.getValidatedLicense?.()?.claims || null;
  } catch {
    claims = null;
  }
  const licensed = isProductLicensed();
  const expiresAt = firstValue(claims?.expiresAt);
  const daysRemaining = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / MS_PER_DAY))
    : null;

  return {
    licensed,
    licenseRequiredMode: isLicenseRequiredMode(),
    status: licensed ? "Active" : claims ? "Inactive" : "Not activated",
    model: firstValue(O.licenseModel, claims?.type ? `${claims.type} / ${D.licenseModel}` : null, D.licenseModel),
    type: firstValue(claims?.type),
    edition: firstValue(claims?.edition),
    licenseId: firstValue(claims?.licenseId),
    customer: firstValue(
      typeof claims?.customer === "object" ? claims?.customer?.name : claims?.customer,
      typeof claims?.customer === "object" ? claims?.customer?.code : null,
    ),
    issuer: firstValue(claims?.iss),
    issuedAt: firstValue(claims?.issuedAt),
    expiresAt,
    daysRemaining,
    licensedIdentities: licensedIdentitiesFromClaims(claims),
    features: Array.isArray(claims?.features) ? claims.features : [],
  };
}

/**
 * Live product / license / deployment facts for Admin → About.
 * Values that cannot be resolved are returned as null so the UI can fall back
 * to the published datasheet instead of rendering an empty cell.
 */
export async function getProductAbout(req) {
  const version = readVersionMetadata(env.paths?.versionPath);
  const license = resolveLicense();
  const tenant = await resolveTenant(req).catch(() => ({
    id: null,
    name: null,
    code: null,
  }));
  const usage = await resolveUsage(tenant.id);
  const databaseConnected = mongoose.connection.readyState === 1;

  const licensedIdentities = license.licensedIdentities;
  const utilizationPct =
    licensedIdentities && Number.isFinite(usage.identities)
      ? Math.min(100, Math.round((usage.identities / licensedIdentities) * 100))
      : null;

  return {
    product: {
      name: D.name,
      company: D.company,
      servicePrefix: D.servicePrefix,
      tagline: D.tagline,
      description: D.description,
      edition: firstValue(O.edition, license.edition, D.edition),
      version: firstValue(version?.productVersion, D.version),
      buildNumber: firstValue(O.buildNumber, version?.buildNumber, D.buildNumber),
      releaseDate: firstValue(O.releaseDate, version?.releaseDate, D.releaseDate),
      productType: D.productType,
      deploymentModel: firstValue(O.deploymentModel, D.deploymentModel),
    },
    platform: {
      status: databaseConnected && !license.licenseRequiredMode ? "Active" : "Degraded",
      environment: environmentLabel(),
      nodeEnv: env.nodeEnv,
      configSource: env.configSource,
      nodeVersion: process.versions.node,
      schemaVersion: version?.schemaVersion ?? null,
      uptimeSec: Math.round(process.uptime()),
      database: { connected: databaseConnected, dbName: env.mongodb?.dbName || null },
    },
    license,
    tenant,
    usage: { ...usage, licensedIdentities, utilizationPct },
    generatedAt: new Date().toISOString(),
  };
}
