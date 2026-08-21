/**
 * Build / merge Security Posture workspace query params so navigations
 * never drop applicationId / scanId (Assessment context continuity).
 */

export function buildSecuritySearch(currentSearch, extras = {}) {
  const params =
    typeof currentSearch === "string"
      ? new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch)
      : currentSearch instanceof URLSearchParams
        ? new URLSearchParams(currentSearch)
        : new URLSearchParams();

  const { applicationId, scanId, assessmentId, versionId, viewVersionId, feature, highlight, compareLeft, compareRight, ...rest } = extras;

  if (applicationId !== undefined) {
    if (applicationId) params.set("applicationId", String(applicationId));
    else params.delete("applicationId");
  }
  if (scanId !== undefined) {
    if (scanId) params.set("scanId", String(scanId));
    else params.delete("scanId");
  }
  if (assessmentId !== undefined) {
    if (assessmentId) params.set("assessmentId", String(assessmentId));
    else params.delete("assessmentId");
  }
  if (versionId !== undefined) {
    if (versionId) params.set("versionId", String(versionId));
    else params.delete("versionId");
  }
  if (viewVersionId !== undefined) {
    if (viewVersionId) params.set("viewVersionId", String(viewVersionId));
    else params.delete("viewVersionId");
  }
  if (feature !== undefined) {
    if (feature) params.set("feature", String(feature));
    else params.delete("feature");
  }
  if (highlight !== undefined) {
    if (highlight) params.set("highlight", String(highlight));
    else params.delete("highlight");
  }
  if (compareLeft !== undefined) {
    if (compareLeft) params.set("compareLeft", String(compareLeft));
    else params.delete("compareLeft");
  }
  if (compareRight !== undefined) {
    if (compareRight) params.set("compareRight", String(compareRight));
    else params.delete("compareRight");
  }

  for (const [key, value] of Object.entries(rest)) {
    if (value == null || value === "") params.delete(key);
    else params.set(key, String(value));
  }

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function securityPath(path, currentSearch, extras = {}) {
  return `${path}${buildSecuritySearch(currentSearch, extras)}`;
}

/** Stable finding fingerprint for cross-assessment compare. */
export function findingFingerprint(f) {
  if (!f) return "";
  const feature = String(f.feature || "").trim();
  const dn = String(f.dn || "").trim().toLowerCase();
  const type = String(f.findingType || f.status || "").trim();
  return `${feature}::${dn}::${type}`;
}
