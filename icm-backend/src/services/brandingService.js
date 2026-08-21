import Branding from '../models/branding/Branding.js';

const DEFAULTS = {
  companyName: 'ADSecurity',
  primaryColor: '#2563EB',
  secondaryColor: '#7C3AED',
  customCss: '',
};

async function getOrCreateDefault() {
  let branding = await Branding.findOne().populate('logoId faviconId');
  if (!branding) {
    branding = await Branding.create(DEFAULTS);
  }
  return branding;
}

export async function getBranding() {
  return getOrCreateDefault();
}

export async function updateBranding(updates) {
  const allowed = ['companyName', 'primaryColor', 'secondaryColor', 'logoId', 'faviconId', 'customCss'];
  const filtered = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));

  let branding = await Branding.findOne();
  if (!branding) {
    branding = await Branding.create({ ...DEFAULTS, ...filtered });
  } else {
    Object.assign(branding, filtered);
    await branding.save();
  }
  return branding.populate('logoId faviconId');
}

export async function resetBranding() {
  await Branding.deleteMany({});
  return Branding.create(DEFAULTS);
}

export async function previewBranding(overrides) {
  const current = await getOrCreateDefault();
  const preview = current.toObject();
  const allowed = ['companyName', 'primaryColor', 'secondaryColor', 'customCss'];
  for (const key of allowed) {
    if (overrides[key] !== undefined) preview[key] = overrides[key];
  }
  return preview;
}
