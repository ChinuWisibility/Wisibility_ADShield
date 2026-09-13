import * as logoService from '../../services/system/logoService.js';

export async function listLogos(req, res, next) {
  try {
    const logos = await logoService.listLogos();
    res.json({ success: true, data: logos });
  } catch (err) { next(err); }
}

export async function getLogo(req, res, next) {
  try {
    const logo = await logoService.getLogo(req.params.id);
    res.json({ success: true, data: logo });
  } catch (err) { next(err); }
}

export async function getLogoImage(req, res, next) {
  try {
    const logo = await logoService.getLogoImage(req.params.id);
    res.set('Content-Type', logo.mimeType || 'application/octet-stream');
    res.send(logo.data);
  } catch (err) { next(err); }
}

export async function uploadLogo(req, res, next) {
  try {
    const logoType = req.body.logoType || 'PLATFORM';
    const logo = await logoService.uploadLogo(req.file, logoType);
    res.status(201).json({ success: true, data: logo });
  } catch (err) { next(err); }
}

export async function deleteLogo(req, res, next) {
  try {
    const result = await logoService.deleteLogo(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function setDefaultLogo(req, res, next) {
  try {
    const branding = await logoService.setDefaultLogo(req.params.id, req.body);
    res.json({ success: true, data: branding });
  } catch (err) { next(err); }
}
