import * as templateService from '../../services/system/notificationTemplateService.js';

export async function listTemplates(req, res, next) {
  try {
    const { page, limit, channel } = req.query;
    const result = await templateService.listTemplates({ page, limit, channel });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function getTemplate(req, res, next) {
  try {
    const template = await templateService.getTemplate(req.params.key);
    res.json({ success: true, data: template });
  } catch (err) { next(err); }
}

export async function updateTemplate(req, res, next) {
  try {
    const template = await templateService.updateTemplate(req.params.key, req.body);
    res.json({ success: true, data: template });
  } catch (err) { next(err); }
}

export async function previewTemplate(req, res, next) {
  try {
    const result = await templateService.previewTemplate(req.params.key, req.body);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function resetTemplate(req, res, next) {
  try {
    const template = await templateService.resetTemplate(req.params.key);
    res.json({ success: true, data: template });
  } catch (err) { next(err); }
}
