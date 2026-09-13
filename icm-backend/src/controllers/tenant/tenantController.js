import * as tenantService from '../../services/tenant/tenantService.js';

export async function getTenantConfig(req, res, next) {
  try {
    const config = await tenantService.getTenantConfig();
    res.json({ success: true, data: config });
  } catch (err) { next(err); }
}

export async function updateTenantConfig(req, res, next) {
  try {
    const config = await tenantService.updateTenantConfig(req.body, req.user.id);
    res.json({ success: true, data: config });
  } catch (err) { next(err); }
}

export async function getFeatureFlags(req, res, next) {
  try {
    const features = await tenantService.getFeatureFlags();
    res.json({ success: true, data: features });
  } catch (err) { next(err); }
}

export async function updateFeatureFlags(req, res, next) {
  try {
    const features = await tenantService.updateFeatureFlags(req.body, req.user.id);
    res.json({ success: true, data: features });
  } catch (err) { next(err); }
}

export async function getLicenceStatus(req, res, next) {
  try {
    const status = await tenantService.getLicenceStatus();
    res.json({ success: true, data: status });
  } catch (err) { next(err); }
}

import Tenant from '../../models/platform/Tenant.js';

export async function createTenant(req, res, next) {
  try {
    const { name, code, subscriptionTier } = req.body;
    const tenant = await Tenant.create({ 
      name, 
      code, 
      subscriptionTier,
      createdBy: req.user?.id 
    });
    res.status(201).json({ success: true, data: tenant });
  } catch (err) { next(err); }
}

export async function getTenants(req, res, next) {
  try {
    const tenants = await Tenant.find({ isActive: true }).sort({ name: 1 });
    res.json({ success: true, data: tenants });
  } catch (err) { next(err); }
}
