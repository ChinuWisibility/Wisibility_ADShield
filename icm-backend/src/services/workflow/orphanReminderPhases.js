/** Parse "1h,3h,6h,12h" into millisecond offsets from workflow start. */
export function parseReminderPhasesMs(spec) {
  const raw = spec && String(spec).trim() ? String(spec) : "1h,3h,6h,12h";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parsePhaseTokenToMs);
}

function parsePhaseTokenToMs(token) {
  const m = String(token).trim().match(/^(\d+(?:\.\d+)?)(h|m|d)$/i);
  if (!m) return 60 * 60 * 1000;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === "h") return n * 60 * 60 * 1000;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "d") return n * 24 * 60 * 60 * 1000;
  return 60 * 60 * 1000;
}

/** Absolute poll time for phase index (0 = first offset, e.g. 1h after start). */
export function pollAtForPhase(startedAt, phaseIndex, phasesMs) {
  if (!startedAt || !phasesMs?.length || phaseIndex < 0 || phaseIndex >= phasesMs.length) {
    return null;
  }
  const base = new Date(startedAt).getTime();
  return new Date(base + phasesMs[phaseIndex]);
}

export function formatPhaseLabels(phasesMs) {
  return phasesMs.map((ms) => {
    if (ms % (24 * 60 * 60 * 1000) === 0) return `${ms / (24 * 60 * 60 * 1000)}d`;
    if (ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)}h`;
    return `${Math.round(ms / 60000)}m`;
  });
}
