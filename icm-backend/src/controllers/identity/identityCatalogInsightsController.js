import {
  buildIdentitySodInsights,
  buildIdentityCertificationInsights,
  buildIdentityHygieneInsights,
  buildIdentityPrivilegeInsights,
} from '../../services/identity/identityCatalogInsightsService.js';

function sendError(res, err, fallback) {
  const status = err.statusCode || 500;
  if (status >= 500) {
    console.error('[identityCatalogInsights]', err?.message || err);
  }
  return res.status(status).json({
    success: false,
    message: err.message || fallback,
  });
}

/** GET /api/identities/:id/sod */
export async function getIdentitySod(req, res) {
  try {
    const data = await buildIdentitySodInsights(req.params.id, req.scopedTenantId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return sendError(res, err, 'Failed to load identity SoD insights');
  }
}

/** GET /api/identities/:id/certifications */
export async function getIdentityCertifications(req, res) {
  try {
    const data = await buildIdentityCertificationInsights(req.params.id, req.scopedTenantId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return sendError(res, err, 'Failed to load identity certification insights');
  }
}

/** GET /api/identities/:id/hygiene */
export async function getIdentityHygiene(req, res) {
  try {
    const data = await buildIdentityHygieneInsights(req.params.id, req.scopedTenantId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return sendError(res, err, 'Failed to load identity hygiene insights');
  }
}

/** GET /api/identities/:id/privileges */
export async function getIdentityPrivileges(req, res) {
  try {
    const data = await buildIdentityPrivilegeInsights(req.params.id, req.scopedTenantId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return sendError(res, err, 'Failed to load identity privilege insights');
  }
}
