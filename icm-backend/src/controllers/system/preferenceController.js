import * as preferenceService from '../../services/system/preferenceService.js';

export async function getPreferences(req, res, next) {
  try {
    const prefs = await preferenceService.getPreferences(req.user.id);
    res.json({ success: true, data: prefs });
  } catch (err) { next(err); }
}

export async function updatePreferences(req, res, next) {
  try {
    const prefs = await preferenceService.updatePreferences(req.user.id, req.body);
    res.json({ success: true, data: prefs });
  } catch (err) { next(err); }
}

export async function resetPreferences(req, res, next) {
  try {
    const result = await preferenceService.resetPreferences(req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
