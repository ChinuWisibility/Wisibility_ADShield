/** Shared health / display helpers for Application View dashboard. */

export function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

export function pct(part, whole) {
  if (!whole || whole <= 0) return 0;
  return clamp(Math.round((Number(part) / Number(whole)) * 100));
}

/**
 * Share of total for legends — never shows "0%" when part > 0.
 * Uses one decimal under 1%, otherwise whole / one-decimal percent.
 */
export function formatSharePct(part, whole) {
  const p = Number(part) || 0;
  const w = Number(whole) || 0;
  if (p <= 0 || w <= 0) return '0%';
  const raw = (p / w) * 100;
  if (raw < 0.1) return '<0.1%';
  if (raw < 1) return `${raw.toFixed(1)}%`;
  const one = Math.round(raw * 10) / 10;
  if (Math.abs(one - Math.round(one)) < 0.05) return `${Math.round(one)}%`;
  return `${one.toFixed(1)}%`;
}

export function relativeTime(value) {
  if (!value) return 'Never';
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return '—';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function formatConnector(stored) {
  if (!stored) return '—';
  const s = String(stored).trim();
  if (s === 'ACTIVE_DIRECTORY') return 'Active Directory';
  const raw = s.startsWith('CONNECTOR_') ? s.slice('CONNECTOR_'.length) : s;
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function toDisplayLabel(value, fallback = '—') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function healthLabel(score) {
  if (score == null || Number.isNaN(Number(score))) {
    return { label: '—', color: '#64748B' };
  }
  if (score >= 90) return { label: 'Excellent', color: '#059669' };
  if (score >= 75) return { label: 'Good', color: '#16A34A' };
  if (score >= 55) return { label: 'Fair', color: '#D97706' };
  if (score >= 35) return { label: 'At risk', color: '#EA580C' };
  return { label: 'Critical', color: '#DC2626' };
}

export function riskLabel(score) {
  if (score == null || Number.isNaN(Number(score))) {
    return { label: '—', color: '#64748B' };
  }
  if (score >= 75) return { label: 'Critical', color: '#DC2626' };
  if (score >= 50) return { label: 'High', color: '#EA580C' };
  if (score >= 25) return { label: 'Medium', color: '#D97706' };
  return { label: 'Low', color: '#059669' };
}

export function deriveHealth(summary) {
  if (!summary) return null;

  const users = Number(summary?.users) || 0;
  const privUsers = Number(summary?.privilegedUsers) || 0;
  const ents = Number(summary?.entitlements) || 0;
  const privEnts = Number(summary?.privilegedEntitlements) || 0;
  const sodOpen = Number(summary?.openSodViolations) || 0;
  const orphans = Number(summary?.openOrphans ?? summary?.hygieneOpen) || 0;
  const correlated = Number(summary?.correlatedLinks) || 0;
  const uncorrelated = Number(summary?.uncorrelatedAccounts ?? Math.max(0, users - correlated));
  const duplicates = Number(summary?.duplicateAccounts) || 0;
  const stale = Number(summary?.staleAccounts) || 0;

  const correlationRate = users > 0 ? correlated / users : (correlated > 0 ? 1 : 0);
  const security = clamp(
    100
    - Math.min(40, sodOpen * 2.2)
    - Math.min(25, privUsers > 0 && users > 0 ? (privUsers / users) * 80 : 0)
    - Math.min(20, privEnts > 0 && ents > 0 ? (privEnts / Math.max(ents, 1)) * 60 : 0),
  );
  const correlation = clamp(Math.round(correlationRate * 100));
  const hygiene = clamp(
    100
    - Math.min(40, orphans * 1.5)
    - Math.min(25, users > 0 ? (uncorrelated / users) * 40 : 0)
    - Math.min(15, duplicates * 1.2)
    - Math.min(15, stale * 0.8),
  );
  const compliance = clamp(100 - Math.min(55, sodOpen * 2.5));
  const computedHealth = clamp(Math.round(security * 0.35 + correlation * 0.25 + hygiene * 0.25 + compliance * 0.15));

  // Prefer live scores from the view-summary API when present.
  const health = Number.isFinite(Number(summary.health))
    ? clamp(summary.health)
    : computedHealth;
  const correlationPct = Number.isFinite(Number(summary.correlationRate))
    ? clamp(summary.correlationRate)
    : correlation;
  const hygienePct = Number.isFinite(Number(summary.hygiene))
    ? clamp(summary.hygiene)
    : Math.round(hygiene);
  const compliancePct = Number.isFinite(Number(summary.compliance))
    ? clamp(summary.compliance)
    : Math.round(compliance);
  const securityPct = Number.isFinite(Number(summary.security))
    ? clamp(summary.security)
    : Math.round(security);
  const risk = Number.isFinite(Number(summary.risk))
    ? clamp(summary.risk)
    : clamp(100 - health);

  return {
    health,
    risk,
    security: securityPct,
    correlation: correlationPct,
    hygiene: hygienePct,
    compliance: compliancePct,
    correlationRate: correlationPct,
  };
}

/** Build a 30-day series ending at `end`, with date labels for chart axes. */
export function buildTrendSeries(end, {
  points = 30,
  variance = 0.08,
  rising = true,
  integer = false,
} = {}) {
  const target = Math.max(0, Number(end) || 0);
  const start = rising
    ? Math.max(0, target * (1 - variance * 2))
    : Math.max(0, target * (1 + variance * 2));
  const out = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const snap = (n) => {
    const v = Math.max(0, n);
    if (integer) return Math.round(v);
    // Correlation % — keep at most one decimal
    return Math.round(v * 10) / 10;
  };

  for (let i = 0; i < points; i += 1) {
    const t = i / Math.max(1, points - 1);
    const wobble = Math.sin(i * 0.7) * target * variance * 0.35;
    const d = new Date(today);
    d.setDate(today.getDate() - (points - 1 - i));
    out.push({
      day: i + 1,
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      value: snap(start + (target - start) * t + wobble),
    });
  }
  if (out.length) out[out.length - 1].value = snap(target);
  return out;
}

/** Client-side CSV export of the rows currently loaded in a tab (respects active filters/search). */
export function exportRowsToCsv(filename, columns, rows) {
  if (!rows?.length) return;
  const escapeCell = (cell) => {
    const s = String(cell ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => escapeCell(c.csvValue ? c.csvValue(row) : row[c.key])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const DASH = {
  card: {
    borderRadius: 2,
    border: '1px solid #E5E7EB',
    bgcolor: '#fff',
    boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
  },
  label: {
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#94A3B8',
  },
};
