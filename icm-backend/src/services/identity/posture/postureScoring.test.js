import {
  computeAccessHygiene,
  computeComplexity,
  computeIdentityHygiene,
  computePostureFromInputs,
  computeSodRisk,
  getAccessHygieneTier,
  getMetricLabel,
  getSodViolationTier,
  evaluateIdentityCheck,
  resolveFieldValueFromIdentity,
  peerComparisonIndicator,
  resolvePeerComparisonConfig,
} from './identityPostureDashboard.js';
import { cloneDefaultRules } from './postureRuleDefaults.js';
import { mergeRulesWithDefaults } from './postureRuleResolver.js';

describe('postureScoring with configurable rules', () => {
  test('computeSodRisk uses four levels (safe / low / medium / high)', () => {
    const rules = cloneDefaultRules();
    expect(computeSodRisk(0, rules)).toBe(100);
    expect(computeSodRisk(1, rules)).toBe(85);
    expect(computeSodRisk(2, rules)).toBe(50);
    expect(computeSodRisk(5, rules)).toBe(0);
    expect(computeSodRisk(1, null)).toBe(85);
  });

  test('computeSodRisk uses three dot boundaries (safe / low / medium / high)', () => {
    const rules = cloneDefaultRules();
    rules.sodRisk = {
      levels: [
        { key: 'safe', upTo: 2, score: 100 },
        { key: 'low', upTo: 5, score: 85 },
        { key: 'medium', upTo: 10, score: 50 },
        { key: 'high', upTo: 999, score: 0 },
      ],
    };
    expect(computeSodRisk(2, rules)).toBe(100);
    expect(computeSodRisk(3, rules)).toBe(85);
    expect(computeSodRisk(6, rules)).toBe(50);
    expect(computeSodRisk(11, rules)).toBe(0);
  });

  test('computeSodRisk uses custom levels when tiers omitted', () => {
    const rules = cloneDefaultRules();
    rules.sodRisk = {
      levels: [
        { key: 'safe', upTo: 0, score: 100 },
        { key: 'low', upTo: 1, score: 90 },
        { key: 'medium', upTo: 3, score: 40 },
        { key: 'high', upTo: 999, score: 0 },
      ],
    };
    expect(computeSodRisk(1, rules)).toBe(90);
    expect(computeSodRisk(3, rules)).toBe(40);
    expect(computeSodRisk(5, rules)).toBe(0);
  });

  test('computeSodRisk uses tiers when levels absent', () => {
    const rules = cloneDefaultRules();
    rules.sodRisk = {
      levels: [],
      tiers: [
        { maxViolations: 0, score: 100 },
        { maxViolations: 1, score: 90 },
        { maxViolations: 2, score: 40 },
        { maxViolations: 999, score: 0 },
      ],
    };
    expect(computeSodRisk(1, rules)).toBe(90);
  });

  test('resolvePaths finds department on attributes.dept', () => {
    const identity = { department: '', attributes: { dept: 'Engineering' } };
    const check = {
      enabled: true,
      evaluator: {
        type: 'fieldPresent',
        logicalKey: 'department',
        resolvePaths: ['department', 'attributes.department', 'attributes.dept'],
      },
    };
    expect(evaluateIdentityCheck(identity, check)).toBe(true);
    expect(resolveFieldValueFromIdentity(identity, ['attributes.dept'])).toBe('Engineering');
  });

  test('location check finds attributes.location when resolvePaths only lists top-level location', () => {
    const identity = { location: '', attributes: { location: 'Mumbai' } };
    const check = {
      enabled: true,
      id: 'location',
      label: 'location',
      evaluator: {
        type: 'fieldPresent',
        logicalKey: 'location',
        resolvePaths: ['location'],
      },
    };
    expect(evaluateIdentityCheck(identity, check)).toBe(true);
  });

  test('location check finds case-variant attributes.Location', () => {
    const identity = { attributes: { Location: 'Mumbai' } };
    const check = {
      enabled: true,
      id: 'location',
      label: 'location',
      evaluator: {
        type: 'fieldPresent',
        logicalKey: 'location',
        resolvePaths: ['location'],
      },
    };
    expect(evaluateIdentityCheck(identity, check)).toBe(true);
  });

  test('computeIdentityHygiene scores location present from attributes', () => {
    const rules = cloneDefaultRules();
    rules.identityHygiene.checks = [
      { id: 'email', label: 'Email', enabled: true, evaluator: { type: 'builtin', key: 'hasEmail' } },
      {
        id: 'location',
        label: 'location',
        enabled: true,
        evaluator: { type: 'fieldPresent', logicalKey: 'location', resolvePaths: ['location'] },
      },
    ];
    const result = computeIdentityHygiene(
      { email: 'a@b.com', attributes: { location: 'Mumbai' } },
      rules,
    );
    expect(result.score).toBe(100);
    const loc = result.attributeChecks.find((c) => c.id === 'location');
    expect(loc.ok).toBe(true);
    expect(loc.label).toBe('Location');
  });

  test('Manager attribute passes when only managerId is resolved (not manager text field)', () => {
    const identity = {
      manager: '',
      managerEmail: 'samira.schulz@wisibility.lcl',
      managerId: { _id: 'abc', displayName: 'Samira Schulz' },
    };
    const check = {
      enabled: true,
      label: 'Manager present',
      evaluator: { type: 'fieldPresent', logicalKey: 'manager', resolvePaths: ['manager'] },
    };
    expect(evaluateIdentityCheck(identity, check)).toBe(true);
  });

  test('mergeRulesWithDefaults prefers sod levels over legacy tiers', () => {
    const merged = mergeRulesWithDefaults({
      sodRisk: {
        levels: [
          { key: 'safe', upTo: 0, score: 100 },
          { key: 'low', upTo: 6, score: 85 },
          { key: 'medium', upTo: 10, score: 50 },
          { key: 'high', upTo: 999, score: 0 },
        ],
        tiers: [{ maxViolations: 0, score: 100 }, { maxViolations: 1, score: 80 }],
      },
    });
    expect(computeSodRisk(1, merged)).toBe(85);
  });

  test('computeComplexity uses entitlement count levels (default tenant rules / Global rule set)', () => {
    const rules = cloneDefaultRules();
    expect(computeComplexity(0, rules)).toBe(100);
    expect(computeComplexity(2, rules)).toBe(85);
    expect(computeComplexity(5, rules)).toBe(85);
    expect(computeComplexity(7, rules)).toBe(50);
    expect(computeComplexity(10, rules)).toBe(50);
    expect(computeComplexity(12, rules)).toBe(0);
  });

  test('computeComplexity prefers levels over legacy thresholds when both are present', () => {
    const rules = cloneDefaultRules();
    rules.complexity = {
      ...rules.complexity,
      thresholds: [
        { key: 'high', minGroups: 10, score: 50 },
        { key: 'medium', minGroups: 5, score: 75 },
      ],
      levels: [
        { key: 'excellent', upTo: 0, score: 100 },
        { key: 'good', upTo: 5, score: 85 },
        { key: 'moderate', upTo: 10, score: 50 },
        { key: 'poor', upTo: 999, score: 0 },
      ],
    };
    expect(computeComplexity(2, rules)).toBe(85);
    expect(computeComplexity(5, rules)).toBe(85);
    expect(computeComplexity(7, rules)).toBe(50);
    expect(computeComplexity(11, rules)).toBe(0);
  });

  test('computeComplexity thresholds are fully configurable when levels/tiers absent', () => {
    const rules = cloneDefaultRules();
    rules.complexity = {
      defaultScore: 100,
      thresholds: [
        { key: 'high', minGroups: 10, score: 50 },
        { key: 'medium', minGroups: 3, score: 90 },
      ],
    };
    expect(computeComplexity(3, rules)).toBe(90);
    expect(computeComplexity(4, rules)).toBe(90);
    expect(computeComplexity(11, rules)).toBe(50);
  });

  test('computeComplexity matches entitlement count at exact threshold (e.g. 6 entitlements, high at 6)', () => {
    const rules = cloneDefaultRules();
    rules.complexity = {
      defaultScore: 100,
      thresholds: [
        { key: 'high', minGroups: 6, score: 50 },
        { key: 'medium', minGroups: 3, score: 75 },
      ],
    };
    expect(computeComplexity(6, rules)).toBe(50);
    expect(computeComplexity(3, rules)).toBe(75);
    expect(computeComplexity(2, rules)).toBe(100);
  });

  test('computeComplexity uses levels when thresholds empty', () => {
    const rules = cloneDefaultRules();
    rules.complexity = {
      defaultScore: 100,
      thresholds: [],
      levels: [
        { key: 'excellent', upTo: 2, score: 100 },
        { key: 'good', upTo: 6, score: 85 },
        { key: 'moderate', upTo: 10, score: 50 },
        { key: 'poor', upTo: 999, score: 0 },
      ],
    };
    expect(computeComplexity(2, rules)).toBe(100);
    expect(computeComplexity(4, rules)).toBe(85);
    expect(computeComplexity(8, rules)).toBe(50);
    expect(computeComplexity(11, rules)).toBe(0);
  });

  test('mergeRulesWithDefaults does not re-inject default thresholds over tenant complexity levels', () => {
    const merged = mergeRulesWithDefaults({
      complexity: {
        levels: [
          { key: 'excellent', upTo: 0, score: 100 },
          { key: 'good', upTo: 5, score: 85 },
          { key: 'moderate', upTo: 10, score: 50 },
          { key: 'poor', upTo: 999, score: 25 },
        ],
        tiers: [
          { maxGroups: 0, score: 100 },
          { maxGroups: 5, score: 85 },
          { maxGroups: 10, score: 50 },
          { maxGroups: 999, score: 25 },
        ],
      },
    });
    expect(merged.complexity.thresholds).toEqual([]);
    expect(computeComplexity(12, merged)).toBe(25);
  });

  test('computeAccessHygiene uses privileged entitlement count bands', () => {
    const rules = cloneDefaultRules();
    expect(computeAccessHygiene(0, rules)).toBe(100);
    expect(computeAccessHygiene(1, rules)).toBe(85);
    expect(computeAccessHygiene(3, rules)).toBe(50);
    expect(computeAccessHygiene(10, rules)).toBe(0);
  });

  test('computeAccessHygiene supports configurable count bands up to 100', () => {
    const rules = cloneDefaultRules();
    rules.accessHygiene = {
      levels: [
        { key: 'safe', upTo: 1, score: 100 },
        { key: 'low', upTo: 5, score: 80 },
        { key: 'medium', upTo: 20, score: 40 },
        { key: 'high', upTo: 100, score: 0 },
      ],
    };
    expect(computeAccessHygiene(1, rules)).toBe(100);
    expect(computeAccessHygiene(3, rules)).toBe(80);
    expect(computeAccessHygiene(10, rules)).toBe(40);
    expect(computeAccessHygiene(25, rules)).toBe(0);
  });

  test('getAccessHygieneTier returns Safe/Low/Medium/High label', () => {
    const rules = cloneDefaultRules();
    expect(getAccessHygieneTier(0, rules).label).toBe('Safe');
    expect(getAccessHygieneTier(1, rules).label).toBe('Low risk');
    expect(getAccessHygieneTier(3, rules).label).toBe('Medium');
    expect(getAccessHygieneTier(10, rules).label).toBe('High');
    expect(getAccessHygieneTier(1, rules).score).toBe(85);
  });

  test('computeIdentityHygiene splits 100 evenly across enabled checks', () => {
    const rules = cloneDefaultRules();
    rules.identityHygiene = {
      checks: [
        {
          id: 'hasEmail',
          enabled: true,
          evaluator: { type: 'builtin', key: 'hasEmail' },
        },
        {
          id: 'hasHrRecord',
          enabled: true,
          evaluator: { type: 'builtin', key: 'hasHrRecord' },
        },
      ],
    };
    expect(computeIdentityHygiene({ email: 'a@b.com' }, rules).score).toBe(50);
    expect(computeIdentityHygiene({}, rules).score).toBe(0);
    expect(computeIdentityHygiene({ email: 'a@b.com', identityProfileId: 'x' }, rules).score).toBe(100);
  });

  test('computeIdentityHygiene treats missing enabled as on (admin default)', () => {
    const rules = cloneDefaultRules();
    rules.identityHygiene = {
      checks: [
        { id: 'hasEmail', evaluator: { type: 'builtin', key: 'hasEmail' } },
        { id: 'hasHrRecord', evaluator: { type: 'builtin', key: 'hasHrRecord' } },
      ],
    };
    const result = computeIdentityHygiene({ email: 'a@b.com', identityProfileId: 'x' }, rules);
    expect(result.score).toBe(100);
    expect(result.attributeChecks.every((c) => c.enabled && c.ok)).toBe(true);
  });

  test('computeIdentityHygiene scores 100 when no attributes are configured', () => {
    const rules = cloneDefaultRules();
    rules.identityHygiene = { checks: [] };
    expect(computeIdentityHygiene({ email: 'a@b.com' }, rules).score).toBe(100);
  });

  test('computeIdentityHygiene respects explicit enabled:false', () => {
    const rules = cloneDefaultRules();
    rules.identityHygiene = {
      checks: [
        { id: 'hasEmail', enabled: false, evaluator: { type: 'builtin', key: 'hasEmail' } },
        { id: 'hasHrRecord', enabled: true, evaluator: { type: 'builtin', key: 'hasHrRecord' } },
      ],
    };
    expect(computeIdentityHygiene({ identityProfileId: 'x' }, rules).score).toBe(100);
    expect(computeIdentityHygiene({}, rules).score).toBe(0);
  });

  test('computePostureFromInputs applies equal-split identity checks', () => {
    const rules = cloneDefaultRules();
    rules.identityHygiene = {
      checks: [
        {
          id: 'hasEmail',
          enabled: true,
          evaluator: { type: 'builtin', key: 'hasEmail' },
        },
      ],
    };
    const result = computePostureFromInputs(
      { email: 'a@b.com' },
      0,
      0,
      0,
      0,
      rules,
    );
    expect(result.identityHygiene).toBe(100);
  });

  test('getMetricLabel uses identity and access scoreLevels bands', () => {
    const rules = cloneDefaultRules();
    rules.identityHygiene.scoreLevels = [
      { key: 'poor', upTo: 30, score: 0 },
      { key: 'moderate', upTo: 50, score: 50 },
      { key: 'good', upTo: 70, score: 85 },
      { key: 'excellent', upTo: 100, score: 100 },
    ];
    expect(getMetricLabel('identityHygiene', 25, rules)).toBe('Poor');
    expect(getMetricLabel('identityHygiene', 45, rules)).toBe('Moderate');
    expect(getMetricLabel('identityHygiene', 65, rules)).toBe('Good');
    expect(getMetricLabel('identityHygiene', 90, rules)).toBe('Excellent');
    expect(getMetricLabel('accessHygiene', 35, rules)).toBe('Low');
    expect(getMetricLabel('accessHygiene', 75, rules)).toBe('Fair');
  });

  test('getMetricLabel uses complexity scoreLevels bands', () => {
    const rules = cloneDefaultRules();
    rules.complexity.scoreLevels = [
      { key: 'poor', upTo: 40, score: 0 },
      { key: 'moderate', upTo: 60, score: 50 },
      { key: 'good', upTo: 80, score: 85 },
      { key: 'excellent', upTo: 100, score: 100 },
    ];
    expect(getMetricLabel('complexity', 100, rules)).toBe('Excellent');
    expect(getMetricLabel('complexity', 75, rules)).toBe('Good');
    expect(getMetricLabel('complexity', 35, rules)).toBe('Poor');
  });

  test('getSodViolationTier uses saved levels not stale tiers', () => {
    const rules = cloneDefaultRules();
    rules.sodRisk = {
      levels: [
        { key: 'safe', upTo: 0, score: 100 },
        { key: 'low', upTo: 6, score: 85 },
        { key: 'medium', upTo: 10, score: 50 },
        { key: 'high', upTo: 999, score: 0 },
      ],
      tiers: [
        { maxViolations: 0, score: 100 },
        { maxViolations: 1, score: 50 },
        { maxViolations: 999, score: 0 },
      ],
    };
    expect(getSodViolationTier(1, rules).label).toBe('Low');
    expect(getSodViolationTier(1, rules).score).toBe(85);
    expect(computeSodRisk(1, rules)).toBe(85);
  });

  test('peerComparisonIndicator uses configurable point margins', () => {
    const cfg = resolvePeerComparisonConfig({
      peerComparison: { aboveAveragePoints: 10, belowAveragePoints: 8 },
    });
    expect(peerComparisonIndicator(75, 60, cfg)).toBe('ABOVE_AVERAGE');
    expect(peerComparisonIndicator(62, 60, cfg)).toBe('AVERAGE');
    expect(peerComparisonIndicator(50, 60, cfg)).toBe('BELOW_AVERAGE');
  });
});
