import { buildIdentityPosture } from '../../services/identity/identityPostureService.js';

/**
 * GET /api/identities/:id/posture
 */
export async function getIdentityPosture(req, res) {
  try {
    const { id } = req.params;
    const data = await buildIdentityPosture(id, req.scopedTenantId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) {
      console.error('[identityPosture]', err?.message || err);
    }
    return res.status(status).json({
      success: false,
      message: err.message || 'Failed to load identity posture',
    });
  }
}
