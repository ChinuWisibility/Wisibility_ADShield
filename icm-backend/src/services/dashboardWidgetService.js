import DashboardWidget from '../models/branding/DashboardWidget.js';

const DEFAULT_WIDGETS = [
  { widgetType: 'SOD_SUMMARY', position: { x: 0, y: 0, w: 6, h: 4 }, config: {}, isVisible: true },
  { widgetType: 'CERT_PROGRESS', position: { x: 6, y: 0, w: 6, h: 4 }, config: {}, isVisible: true },
  { widgetType: 'RISK_SCORE', position: { x: 0, y: 4, w: 6, h: 4 }, config: {}, isVisible: true },
  { widgetType: 'ORPHAN_COUNT', position: { x: 6, y: 4, w: 6, h: 4 }, config: {}, isVisible: true },
];

export async function getWidgets(userId) {
  let widgets = await DashboardWidget.find({ userId }).sort({ 'position.y': 1, 'position.x': 1 });
  if (widgets.length === 0) {
    return DEFAULT_WIDGETS.map((w) => ({ ...w, userId }));
  }
  return widgets;
}

export async function saveWidgets(userId, widgets) {
  if (!Array.isArray(widgets)) {
    throw new Error('widgets must be an array');
  }

  await DashboardWidget.deleteMany({ userId });

  const docs = widgets.map((w) => ({
    userId,
    widgetType: w.widgetType,
    position: w.position,
    config: w.config || {},
    isVisible: w.isVisible !== false,
  }));

  const saved = await DashboardWidget.insertMany(docs);
  return saved;
}

export async function resetWidgets(userId) {
  await DashboardWidget.deleteMany({ userId });
  return { message: 'Dashboard reset to defaults' };
}
