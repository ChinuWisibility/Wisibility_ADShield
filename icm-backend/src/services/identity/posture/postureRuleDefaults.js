/**
 * System defaults — mirrors legacy hardcoded postureScoring behavior.
 */
export const DEFAULT_IDENTITY_POSTURE_RULES = {
  identityHygiene: {
    checks: [],
    scoreLevels: [
      { key: 'poor', upTo: 40, score: 0 },
      { key: 'moderate', upTo: 60, score: 50 },
      { key: 'good', upTo: 80, score: 85 },
      { key: 'excellent', upTo: 100, score: 100 },
    ],
  },
  accessHygiene: {
    levels: [
      { key: 'safe', upTo: 0, score: 100 },
      { key: 'low', upTo: 2, score: 85 },
      { key: 'medium', upTo: 5, score: 50 },
      { key: 'high', upTo: 100, score: 0 },
    ],
    tiers: [
      { maxPrivilegedEntitlements: 0, score: 100 },
      { maxPrivilegedEntitlements: 2, score: 85 },
      { maxPrivilegedEntitlements: 5, score: 50 },
      { maxPrivilegedEntitlements: 100, score: 0 },
    ],
  },
  complexity: {
    defaultScore: 100,
    thresholds: [
      { key: 'high', minGroups: 10, score: 50 },
      { key: 'medium', minGroups: 5, score: 75 },
    ],
    scoreLevels: [
      { key: 'poor', upTo: 40, score: 0 },
      { key: 'moderate', upTo: 60, score: 50 },
      { key: 'good', upTo: 80, score: 85 },
      { key: 'excellent', upTo: 100, score: 100 },
    ],
    levels: [
      { key: 'excellent', upTo: 0, score: 100 },
      { key: 'good', upTo: 5, score: 85 },
      { key: 'moderate', upTo: 10, score: 50 },
      { key: 'poor', upTo: 999, score: 0 },
    ],
    tiers: [
      { maxGroups: 0, score: 100 },
      { maxGroups: 5, score: 85 },
      { maxGroups: 10, score: 50 },
      { maxGroups: 999, score: 0 },
    ],
  },
  sodRisk: {
    levels: [
      { key: 'safe', upTo: 0, score: 100 },
      { key: 'low', upTo: 1, score: 85 },
      { key: 'medium', upTo: 3, score: 50 },
      { key: 'high', upTo: 999, score: 0 },
    ],
    tiers: [
      { maxViolations: 0, score: 100 },
      { maxViolations: 1, score: 85 },
      { maxViolations: 3, score: 50 },
      { maxViolations: 999, score: 0 },
    ],
  },
  finalPosture: {
    weights: {
      identityHygiene: 0.25,
      accessHygiene: 0.25,
      sodRisk: 0.25,
      complexity: 0.25,
    },
  },
  /** Peer Comparison card on Identity Posture Details */
  peerComparison: {
    enabled: true,
    /** Peers = other active users with the same job title (case-insensitive) */
    matchField: 'jobTitle',
    /** Final posture score must beat peer average by at least this many points */
    aboveAveragePoints: 5,
    /** Final posture score must trail peer average by at least this many points */
    belowAveragePoints: 5,
    maxPeers: 50,
    showEntitlements: true,
  },
  labels: {
    maturity: [
      { minScore: 80, label: 'EXCELLENT' },
      { minScore: 60, label: 'GOOD' },
      { minScore: 40, label: 'FAIR' },
      { minScore: 0, label: 'POOR' },
    ],
    sodRisk: [
      { minScore: 80, label: 'Safe' },
      { minScore: 40, label: 'Moderate' },
      { minScore: 0, label: 'Critical' },
    ],
    complexity: [
      { minScore: 100, label: 'Optimal' },
      { minScore: 75, label: 'Moderate' },
      { minScore: 0, label: 'High' },
    ],
    generic: [
      { minScore: 80, label: 'Good' },
      { minScore: 60, label: 'Fair' },
      { minScore: 0, label: 'Low' },
    ],
  },
};

/** Common logical key → resolve path fallbacks on app_{tenantSlug}_identities docs */
export const FIELD_PATH_ALIASES = {
  department: ['department', 'attributes.department', 'attributes.dept', 'attributes.Department'],
  dept: ['department', 'attributes.department', 'attributes.dept'],
  title: ['title', 'attributes.title', 'attributes.jobTitle', 'attributes.job_title'],
  jobtitle: ['title', 'attributes.title', 'attributes.jobTitle', 'attributes.job_title'],
  location: [
    'location',
    'attributes.location',
    'attributes.Location',
    'city',
    'attributes.city',
    'officeLocation',
    'attributes.officeLocation',
    'attributes.office_location',
  ],
  city: ['city', 'attributes.city', 'location', 'attributes.location'],
  country: ['country', 'attributes.country', 'attributes.Country', 'attributes.countryCode'],
  email: ['email', 'attributes.email', 'attributes.Email', 'mail', 'attributes.mail'],
  manager: ['managerId', 'managerEmail', 'manager', 'attributes.manager', 'attributes.managerEmail'],
  phone: ['phone', 'phoneNumber', 'attributes.phone', 'attributes.phoneNumber', 'mobile', 'attributes.mobile'],
};

export function cloneDefaultRules() {
  return JSON.parse(JSON.stringify(DEFAULT_IDENTITY_POSTURE_RULES));
}

export function suggestResolvePaths(logicalKey) {
  const key = String(logicalKey || '').trim();
  if (!key) return ['email'];
  const lower = key.toLowerCase();
  if (FIELD_PATH_ALIASES[lower]) return [...FIELD_PATH_ALIASES[lower]];
  if (key.includes('.')) return [key];
  return [key, `attributes.${key}`];
}
