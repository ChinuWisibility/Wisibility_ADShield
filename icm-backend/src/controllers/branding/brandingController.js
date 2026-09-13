import * as brandingService from '../services/brandingService.js';

export async function getBranding(req, res, next) {
  try {
    const branding = await brandingService.getBranding();
    res.json({ success: true, data: branding });
  } catch (err) { next(err); }
}

export async function updateBranding(req, res, next) {
  try {
    const branding = await brandingService.updateBranding(req.body);
    res.json({ success: true, data: branding });
  } catch (err) { next(err); }
}

export async function resetBranding(req, res, next) {
  try {
    const branding = await brandingService.resetBranding();
    res.json({ success: true, data: branding });
  } catch (err) { next(err); }
}

export async function previewBranding(req, res, next) {
  try {
    const preview = await brandingService.previewBranding(req.body);
    res.json({ success: true, data: preview });
  } catch (err) { next(err); }
}
