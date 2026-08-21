import UserPreference from '../models/branding/UserPreference.js';
import { normalizeSecurityDashboardPrefs } from '../constants/securityDashboardPrefs.js';

function serializePrefs(prefs, userId) {
  if (!prefs) {
    return {
      userId,
      timezone: 'UTC',
      language: 'en',
      dateFormat: 'YYYY-MM-DD',
      notificationEmail: true,
      notificationInApp: true,
      securityDashboard: normalizeSecurityDashboardPrefs({}),
    };
  }
  const row = prefs.toObject ? prefs.toObject() : prefs;
  return {
    ...row,
    securityDashboard: normalizeSecurityDashboardPrefs(row.securityDashboard || {}),
  };
}

export async function getPreferences(userId) {
  const prefs = await UserPreference.findOne({ userId });
  return serializePrefs(prefs, userId);
}

export async function updatePreferences(userId, updates) {
  const allowed = ['timezone', 'language', 'dateFormat', 'notificationEmail', 'notificationInApp'];
  const filtered = Object.fromEntries(
    Object.entries(updates || {}).filter(([k]) => allowed.includes(k)),
  );

  if (updates?.securityDashboard != null) {
    filtered.securityDashboard = normalizeSecurityDashboardPrefs(updates.securityDashboard);
  }

  const prefs = await UserPreference.findOneAndUpdate(
    { userId },
    { userId, ...filtered },
    { new: true, upsert: true, runValidators: true },
  );
  return serializePrefs(prefs, userId);
}

export async function resetPreferences(userId) {
  await UserPreference.findOneAndDelete({ userId });
  return { message: 'Preferences reset to defaults' };
}
