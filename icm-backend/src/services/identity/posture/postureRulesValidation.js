import { cloneDefaultRules } from './postureRuleDefaults.js';

const UNSAFE_PATH = /\$|\[|\]/;

function validateTiers(tiers, field, errors) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    errors.push(`${field} must have at least one tier`);
    return;
  }
  for (const tier of tiers) {
    const score = tier.score;
    if (typeof score !== 'number' || score < 0 || score > 100) {
      errors.push(`${field} tier scores must be 0–100`);
      break;
    }
  }
}

function validateExactMatches(matches, field, countKey, errors) {
  if (!Array.isArray(matches)) return;
  if (matches.length > 50) errors.push(`${field} exactMatches max 50 entries`);
  for (const m of matches) {
    if (typeof m.score !== 'number' || m.score < 0 || m.score > 100) {
      errors.push(`${field} exact match scores must be 0–100`);
      break;
    }
    if (typeof m[countKey] !== 'number' || m[countKey] < 0) {
      errors.push(`${field} exact match counts must be non-negative`);
      break;
    }
  }
}

export function validatePostureRules(rules) {
  const errors = [];
  if (!rules || typeof rules !== 'object') {
    return { valid: false, errors: ['rules object is required'] };
  }

  const ih = rules.identityHygiene;
  if (ih) {
    if (typeof ih.baseScore === 'number' && (ih.baseScore < 0 || ih.baseScore > 100)) {
      errors.push('identityHygiene.baseScore must be 0–100');
    }
    if (Array.isArray(ih.checks)) {
      const ids = new Set();
      if (ih.checks.length > 50) errors.push('Too many identity hygiene checks (max 50)');
      for (const c of ih.checks) {
        if (!c.id || ids.has(c.id)) errors.push('Each check needs a unique id');
        ids.add(c.id);
        if (typeof c.points === 'number' && (c.points < 0 || c.points > 100)) {
          errors.push(`Check ${c.id}: points must be 0–100`);
        }
        const paths = c.evaluator?.resolvePaths || (c.evaluator?.path ? [c.evaluator.path] : []);
        for (const p of paths) {
          if (UNSAFE_PATH.test(String(p))) errors.push(`Unsafe path in check ${c.id}`);
        }
      }
    }
  }

  const ah = rules.accessHygiene;
  if (ah) {
    if (Array.isArray(ah.levels)) {
      for (const level of ah.levels) {
        if (typeof level.score === 'number' && (level.score < 0 || level.score > 100)) {
          errors.push('accessHygiene level scores must be 0–100');
          break;
        }
        if (typeof level.upTo === 'number' && level.upTo < 0) {
          errors.push('accessHygiene level counts must be non-negative');
          break;
        }
      }
    }
    if (ah.tiers) validateTiers(ah.tiers, 'accessHygiene', errors);
  }

  if (rules.complexity?.tiers) validateTiers(rules.complexity.tiers, 'complexity', errors);
  validateExactMatches(rules.complexity?.exactMatches, 'complexity', 'groupCount', errors);
  if (rules.sodRisk?.tiers) validateTiers(rules.sodRisk.tiers, 'sodRisk', errors);
  validateExactMatches(rules.sodRisk?.exactMatches, 'sodRisk', 'violationCount', errors);

  const pc = rules.peerComparison;
  if (pc) {
    for (const key of ['aboveAveragePoints', 'belowAveragePoints', 'maxPeers']) {
      const v = pc[key];
      if (typeof v === 'number' && v < 0) errors.push(`peerComparison.${key} must be non-negative`);
    }
    if (typeof pc.aboveAveragePoints === 'number' && pc.aboveAveragePoints > 50) {
      errors.push('peerComparison.aboveAveragePoints max 50');
    }
    if (typeof pc.belowAveragePoints === 'number' && pc.belowAveragePoints > 50) {
      errors.push('peerComparison.belowAveragePoints max 50');
    }
    if (typeof pc.maxPeers === 'number' && (pc.maxPeers < 1 || pc.maxPeers > 200)) {
      errors.push('peerComparison.maxPeers must be 1–200');
    }
  }

  const w = rules.finalPosture?.weights;
  if (w) {
    const sum = Object.values(w).reduce((s, v) => s + (Number(v) || 0), 0);
    if (sum < 0.99 || sum > 1.01) {
      errors.push('finalPosture.weights should sum to approximately 1');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function normalizeIncomingRules(body) {
  const incoming = body?.rules ?? body;
  if (!incoming || typeof incoming !== 'object') return cloneDefaultRules();
  return incoming;
}
