/**
 * ISO 27001-style control list + effectiveness rules (aligned with Iso2007Report.jsx).
 */
export const ISO_GOVERNANCE_CONTROLS = [
  { id: "A.5.15", title: "Access control", domain: "Organizational", desc: "Rules to control logical and physical access to information and assets shall be established." },
  { id: "A.5.18", title: "Access rights", domain: "Organizational", desc: "Access rights shall be provisioned, reviewed, modified and removed in accordance with policy." },
  { id: "A.6.1", title: "Screening", domain: "People", desc: "Background verification checks shall be carried out on all candidates prior to joining." },
  { id: "A.8.2", title: "Privileged access rights", domain: "Technological", desc: "Allocation and use of privileged access rights shall be restricted and managed." },
  { id: "A.8.3", title: "Information access restriction", domain: "Technological", desc: "Access to information and application system functions shall be restricted." },
  { id: "A.8.5", title: "Secure authentication", domain: "Technological", desc: "Secure authentication technologies and procedures shall be implemented." },
  { id: "A.8.7", title: "Protection against malware", domain: "Technological", desc: "Protection against malware shall be implemented and supported by user awareness." },
  { id: "A.8.18", title: "Use of privileged utility programs", domain: "Technological", desc: "The use of utility programs that might override system and application controls shall be restricted." },
  { id: "A.8.19", title: "Installation of software on operational systems", domain: "Technological", desc: "Procedures and measures shall be implemented to securely manage software installation." },
];

/** Controls we can score from IGA account / privilege / orphan evidence. */
export const ISO_ASSESSED_CONTROL_IDS = new Set([
  "A.5.15",
  "A.5.18",
  "A.8.2",
  "A.8.3",
  "A.8.18",
]);

/**
 * Governance health 0–100 (higher = stronger posture).
 * Penalties: inactive share (up to −20), privileged share > 30% (−10), orphan share (up to −14).
 */
export function computeGovernanceHealthScore(stats, privilegedCount, orphanBucketCount = 0) {
  if (!stats || stats.total === 0) return null;
  let score = 100;
  const denom = Math.max(stats.total, 1);
  const inactiveRatio = Math.max(0, Number(stats.inactive) || 0) / denom;
  const inactivePenalty = inactiveRatio * 20;
  score -= inactivePenalty;

  const privRatio = Math.max(0, Number(privilegedCount) || 0) / denom;
  const privPenalty = privRatio > 0.3 ? 10 : 0;
  score -= privPenalty;

  const orphanRatio = Math.max(0, Number(orphanBucketCount) || 0) / denom;
  const orphanPenalty = Math.min(14, orphanRatio * 120);
  score -= orphanPenalty;

  return Math.max(0, Math.round(score));
}

/**
 * Structured penalty breakdown for UI (same math as computeGovernanceHealthScore).
 */
export function explainGovernanceHealth(stats, privilegedCount, orphanBucketCount = 0) {
  if (!stats || stats.total === 0) {
    return { health: null, exposure: null, penalties: [], denom: 0 };
  }
  const denom = Math.max(stats.total, 1);
  const inactiveRatio = Math.max(0, Number(stats.inactive) || 0) / denom;
  const inactivePenalty = inactiveRatio * 20;
  const privRatio = Math.max(0, Number(privilegedCount) || 0) / denom;
  const privPenalty = privRatio > 0.3 ? 10 : 0;
  const orphanRatio = Math.max(0, Number(orphanBucketCount) || 0) / denom;
  const orphanPenalty = Math.min(14, orphanRatio * 120);
  const health = Math.max(0, Math.round(100 - inactivePenalty - privPenalty - orphanPenalty));
  const exposure = governanceHealthToRiskExposure10(health);

  return {
    health,
    exposure,
    denom,
    penalties: [
      {
        key: "inactive",
        label: "Inactive accounts",
        sharePct: Math.round(inactiveRatio * 100),
        delta: -inactivePenalty,
        applied: inactivePenalty > 0,
      },
      {
        key: "privileged",
        label: "Privileged share",
        sharePct: Math.round(privRatio * 100),
        delta: -privPenalty,
        applied: privPenalty > 0,
        note: privRatio > 0.3 ? "> 30% threshold" : "Under 30% — no penalty",
      },
      {
        key: "orphan",
        label: "Orphan / uncorrelated",
        sharePct: Math.round(orphanRatio * 100),
        delta: -orphanPenalty,
        applied: orphanPenalty > 0,
      },
    ],
  };
}

/** Risk exposure 0–10: higher = more exposure. (100 − health) / 10. */
export function governanceHealthToRiskExposure10(health100) {
  if (health100 == null || Number.isNaN(Number(health100))) return null;
  return Math.round(((100 - Number(health100)) / 10) * 10) / 10;
}

export function deriveControlStatus(controlId, stats, privilegedCount, openUncorrelatedOrphanCount = 0) {
  if (!stats || stats.total === 0) return "NOT_APPLICABLE";
  if (!ISO_ASSESSED_CONTROL_IDS.has(controlId)) return "NOT_APPLICABLE";

  const inactiveRatio = stats.inactive / Math.max(stats.total, 1);
  const privRatio = privilegedCount / Math.max(stats.total, 1);
  const nOr = Math.max(0, Number(openUncorrelatedOrphanCount) || 0);
  const orphanRatio = nOr / Math.max(stats.total, 1);

  switch (controlId) {
    case "A.5.15":
      if (nOr > 0 && inactiveRatio <= 0.1 && orphanRatio > 0.05) return "PARTIAL";
      return inactiveRatio > 0.25 ? "NON_COMPLIANT" : inactiveRatio > 0.1 ? "PARTIAL" : "COMPLIANT";
    case "A.5.18":
      if (nOr > 0) {
        if (orphanRatio > 0.1 || nOr >= 25) return "NON_COMPLIANT";
        return inactiveRatio > 0.3 ? "NON_COMPLIANT" : "PARTIAL";
      }
      return inactiveRatio > 0.3 ? "NON_COMPLIANT" : inactiveRatio > 0.1 ? "PARTIAL" : "COMPLIANT";
    case "A.8.2":
      return privilegedCount > 0 ? (privRatio > 0.2 ? "PARTIAL" : "COMPLIANT") : "COMPLIANT";
    case "A.8.3":
      if (nOr > 0) return inactiveRatio > 0.2 ? "NON_COMPLIANT" : "PARTIAL";
      return inactiveRatio > 0.2 ? "PARTIAL" : "COMPLIANT";
    case "A.8.18":
      return privRatio > 0.15 ? "PARTIAL" : "COMPLIANT";
    default:
      return "NOT_APPLICABLE";
  }
}

/**
 * Weighted ISO compliance % over applicable controls only.
 * COMPLIANT=1, PARTIAL=0.5, NON_COMPLIANT=0; N/A excluded from denominator.
 */
export function computeIsoCompliancePercent(stats, privilegedCount, orphanBucketCount = 0) {
  if (!stats || stats.total === 0) return 0;
  let weight = 0;
  let score = 0;
  for (const c of ISO_GOVERNANCE_CONTROLS) {
    const status = deriveControlStatus(c.id, stats, privilegedCount, orphanBucketCount);
    if (status === "NOT_APPLICABLE") continue;
    weight += 1;
    if (status === "COMPLIANT") score += 1;
    else if (status === "PARTIAL") score += 0.5;
  }
  if (weight === 0) return 0;
  return Math.round((score / weight) * 100);
}
