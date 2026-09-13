import * as widgetService from '../services/dashboardWidgetService.js';

export async function getWidgets(req, res, next) {
  try {
    const widgets = await widgetService.getWidgets(req.user.id);
    res.json({ success: true, data: widgets });
  } catch (err) { next(err); }
}

export async function saveWidgets(req, res, next) {
  try {
    const widgets = await widgetService.saveWidgets(req.user.id, req.body.widgets || req.body);
    res.json({ success: true, data: widgets });
  } catch (err) { next(err); }
}

export async function resetWidgets(req, res, next) {
  try {
    const result = await widgetService.resetWidgets(req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
