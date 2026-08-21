import TenantConfig from '../models/platform/TenantConfig.js';
import { AppError } from '../middleware/errorHandler.js';

async function getOrCreateDefault() {
  let config = await TenantConfig.findOne();
  if (!config) {
    config = await TenantConfig.create({ tenantId: 'default', tenantName: 'Default Tenant' });
  }
  return config;
}

export async function getTenantConfig() {
  return getOrCreateDefault();
}

export async function updateTenantConfig(updates, userId) {
  const allowed = [
    'tenantName',
    'licenseType',
    'maxUsers',
    'contactEmail',
    'iamTeamEmail',
    'features',
    'branding',
  ];
  const filtered = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
  if (typeof filtered.iamTeamEmail === 'string') {
    filtered.iamTeamEmail = filtered.iamTeamEmail.trim().toLowerCase();
    if (
      filtered.iamTeamEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(filtered.iamTeamEmail)
    ) {
      throw new AppError('IAM team email must be a valid email address', 400, 'INVALID_EMAIL');
    }
  }
  filtered.updatedBy = userId;

  let config = await TenantConfig.findOne();
  if (!config) {
    config = await TenantConfig.create({ tenantId: 'default', tenantName: 'Default Tenant', ...filtered });
  } else {
    Object.assign(config, filtered);
    await config.save();
  }
  return config;
}

export async function getFeatureFlags() {
  const config = await getOrCreateDefault();
  return config.features;
}

export async function updateFeatureFlags(features, userId) {
  const config = await getOrCreateDefault();
  Object.assign(config.features, features);
  config.updatedBy = userId;
  await config.save();
  return config.features;
}

export async function getTenantConfigByTenantId(tenantId) {
  if (tenantId) {
    const config = await TenantConfig.findOne({ tenantId }).lean();
    if (config) return config;
  }
  return getOrCreateDefault();
}

export async function getLicenceStatus() {
  const config = await getOrCreateDefault();
  return {
    licenseType: config.licenseType,
    maxUsers: config.maxUsers,
    tenantName: config.tenantName,
    contactEmail: config.contactEmail,
  };
}
