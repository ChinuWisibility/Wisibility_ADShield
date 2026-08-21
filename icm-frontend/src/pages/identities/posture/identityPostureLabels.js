/**
 * Shared labels for Identity Posture Details and the org-admin rule studio.
 * Keep naming aligned so admins map rules directly to on-screen cards.
 */

export const IDENTITY_POSTURE_PAGE_TITLE = 'Identity Posture Overview';
export const IDENTITY_POSTURE_PAGE_SUBTITLE =
  'Assess identity hygiene, access risk, segregation of duties, and peer benchmarks for any user.';
export const IDENTITY_POSTURE_PAGE_EYEBROW = 'Identity risk';

/** Org-admin global rule set editor page title */
export const IDENTITY_POSTURE_RULES_PAGE_TITLE = 'Identity posture rules';

/** Four radial metrics on the identity posture page + org-admin scoring rules tab */
export const POSTURE_METRICS_TITLE = 'Posture Metrics';
/** @deprecated Use POSTURE_METRICS_TITLE */
export const HEALTH_ANALYSIS_TITLE = POSTURE_METRICS_TITLE;
export const SOD_ANALYSIS_TITLE = 'SoD Analysis';
export const ACCESS_DETAILS_TITLE = 'Access Details';
export const PEER_COMPARISON_TITLE = 'Peer Comparison';
export const OVERALL_RANKING_TITLE = 'Overall Ranking';
/** Read-only card on the identity posture page */
export const IDENTITY_ATTRIBUTES_TITLE = 'Identity Attributes';
/** Org-admin tab to define and map identity attributes for scoring */
export const IDENTITY_ATTRIBUTES_RULES_TITLE = 'Set Identity Attributes';

export const POSTURE_METRICS = [
  { key: 'identityHygiene', label: 'Identity Hygiene' },
  { key: 'accessHygiene', label: 'Access Mgmt Hygiene' },
  { key: 'sodRisk', label: 'SoD Risk' },
  { key: 'complexity', label: 'Complexity' },
];

/** Posture overview KPI row display order */
export const POSTURE_METRIC_ROW_ORDER = [
  'accessHygiene',
  'complexity',
  'identityHygiene',
  'sodRisk',
];

export const FINAL_POSTURE_SCORE_LABEL = 'Overall Posture Score';
export const PEER_AVERAGE_LABEL = 'Peer Average';

/** Maps to posture metric radials + org-admin scoring rules */
export const METRIC_BY_KEY = Object.fromEntries(POSTURE_METRICS.map((m) => [m.key, m]));

/** Identity profile card — hygiene check display names */
export const HYGIENE_BUILTIN_LABELS = {
  hasManager: 'Manager',
  hasEmail: 'Email',
  hasHrRecord: 'HR Record',
};

/** Access Details columns — privileged entitlements drive Access Mgmt Hygiene scoring */
export const ACCESS_DETAILS_FIELDS = [
  { key: 'accounts', label: 'Accounts', description: 'Total accounts (Access Details → Accounts)' },
  { key: 'entitlements', label: 'Entitlements', description: 'Unique entitlements across linked applications' },
  { key: 'privilegedEntitlements', label: 'Privileged entitlements', description: 'Unique privileged entitlements (drives Access Mgmt Hygiene score)' },
];

/** Org-admin Access Mgmt Hygiene card — scoring uses privileged entitlement count only */
export const ACCESS_HYGIENE_RULES_BADGE = 'Privileged entitlements';
export const ACCESS_HYGIENE_RULES_SUBTITLE =
  'Privileged entitlement count ranges (Safe / Low / Medium / High) and Access Hygiene % for each range';
export const ACCESS_HYGIENE_SCORE_SECTION_TITLE = 'Access Hygiene % by privileged entitlement count';

/** Org-admin Complexity card — scoring uses total entitlement count from Access Details */
export const COMPLEXITY_RULES_BADGE = 'Entitlements';
export const COMPLEXITY_RULES_SUBTITLE =
  'Total entitlement count ranges (Excellent / Good / Moderate / Poor) and Complexity % for each range';
export const COMPLEXITY_SCORE_SECTION_TITLE = 'Complexity % by entitlement count';

export const SOD_VIOLATIONS_LABEL = 'Violations';

export const POSTURE_SAMPLE_INPUTS = [
  { key: 'privilegedEntitlementCount', label: 'Privileged entitlements', max: 100, source: ACCESS_DETAILS_TITLE },
  { key: 'groupCount', label: 'Entitlements', max: 12, source: 'Complexity' },
  { key: 'sodViolationCount', label: SOD_VIOLATIONS_LABEL, max: 12, source: SOD_ANALYSIS_TITLE },
];

export const WEIGHT_PRESET_LABELS = {
  equal: 'Equal (25% each)',
  identityHygiene: '100% Identity Hygiene',
  accessHygiene: '100% Access Hygiene',
  sodRisk: '100% SoD Risk',
  complexity: '100% Complexity',
};

export const RULE_STUDIO_NAV = [
  { id: 'health', label: POSTURE_METRICS_TITLE },
  { id: 'peer', label: PEER_COMPARISON_TITLE },
  { id: 'attributes', label: IDENTITY_ATTRIBUTES_RULES_TITLE },
];

/** Empty-state capability chips on the posture picker page */
export const POSTURE_CAPABILITY_CHIPS = [
  { label: 'Identity hygiene', hint: 'Profile completeness' },
  { label: 'Access risk', hint: 'Privileged entitlements' },
  { label: 'SoD exposure', hint: 'Duty conflicts' },
  { label: 'Peer benchmarks', hint: 'Role peers' },
];
