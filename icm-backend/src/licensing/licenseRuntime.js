/**
 * Process-wide LicenseManager singleton so routes and middleware share live state.
 */
let licenseManager = null;
let licenseRequiredMode = false;
let onLicenseActivated = null;

export function setLicenseManager(manager) {
  licenseManager = manager;
}

export function getLicenseManager() {
  return licenseManager;
}

export function setLicenseRequiredMode(enabled) {
  const wasRequired = licenseRequiredMode;
  licenseRequiredMode = Boolean(enabled);
  if (wasRequired && !licenseRequiredMode && typeof onLicenseActivated === "function") {
    Promise.resolve()
      .then(() => onLicenseActivated())
      .catch((err) => console.warn("[License] post-activation hook failed:", err?.message || err));
  }
}

export function setOnLicenseActivated(fn) {
  onLicenseActivated = fn;
}

export function isLicenseRequiredMode() {
  return licenseRequiredMode;
}

export function isProductLicensed() {
  return Boolean(licenseManager?.isLicensed());
}
