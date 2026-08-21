/**
 * Multi-dimensional performance grades for Framework v2.
 *
 * Letter order (best → worst): A+ A B B+ C D Critical N/A
 * Overall uses the worst of database/api/payload (frontend cannot alone drag Overall below B
 * when the other three are A/A+).
 */

const RANK = {
  "A+": 0,
  A: 1,
  "B+": 2,
  B: 3,
  C: 4,
  D: 5,
  Critical: 6,
  "N/A": -1,
};

export function gradeRank(grade) {
  return RANK[grade] ?? 99;
}

export function worseGrade(a, b) {
  if (a === "N/A") return b;
  if (b === "N/A") return a;
  return gradeRank(a) >= gradeRank(b) ? a : b;
}

export function betterGrade(a, b) {
  if (a === "N/A") return b;
  if (b === "N/A") return a;
  return gradeRank(a) <= gradeRank(b) ? a : b;
}

/**
 * Legacy single-score helper (v1 compatibility).
 */
export function gradeFromMs(ms, { payloadBytes = 0 } = {}) {
  if (ms == null) return { grade: "N/A", band: "N/A" };
  if (ms >= 5000) return { grade: "Critical", band: "Critical" };
  if (ms >= 1500 || payloadBytes > 200000) return { grade: "D", band: "Needs optimization" };
  if (ms >= 500 || payloadBytes > 50000) return { grade: "C", band: "Needs optimization" };
  if (ms >= 250) return { grade: "B", band: "Average" };
  if (ms >= 100) return { grade: "A", band: "Good" };
  return { grade: "A+", band: "Excellent" };
}

export function gradeDatabase(db, { pageSize = 10 } = {}) {
  if (!db || (db.execMs == null && db.docsExamined == null)) {
    return { grade: "N/A", reason: "No explain stats" };
  }
  const docs = db.docsExamined ?? 0;
  const execMs = db.execMs ?? 0;
  const limit = Math.max(1, pageSize);

  if (db.hasCollectionScan && docs > limit * 5) {
    return { grade: "D", reason: "Collection scan on list path" };
  }
  if (db.hasBlockingSort && docs > limit * 5) {
    return { grade: "C", reason: `Blocking SORT examining ${docs} docs for page ${limit}` };
  }
  if (docs > limit * 50 || execMs >= 500) {
    return { grade: "D", reason: `Heavy examine (${docs} docs, ${execMs} ms)` };
  }
  if (docs > limit * 10 || execMs >= 150) {
    return { grade: "C", reason: `Elevated examine/latency (${docs} docs, ${execMs} ms)` };
  }
  if (docs > limit * 3 || execMs >= 50) {
    return { grade: "B", reason: `Moderate examine (${docs} docs, ${execMs} ms)` };
  }
  if (docs <= limit * 1.5 && execMs < 20 && !db.hasBlockingSort) {
    return { grade: "A+", reason: `Index-backed page read (${docs} docs, ${execMs} ms)` };
  }
  return { grade: "A", reason: `Healthy index path (${docs} docs, ${execMs} ms)` };
}

export function gradeApi(api) {
  if (!api || api.p50Ms == null) {
    return { grade: "N/A", reason: "API path not measured" };
  }
  const ms = api.p50Ms;
  if (ms >= 5000) return { grade: "Critical", reason: `API p50 ${ms} ms` };
  if (ms >= 1500) return { grade: "D", reason: `API p50 ${ms} ms` };
  if (ms >= 500) return { grade: "C", reason: `API p50 ${ms} ms` };
  if (ms >= 250) return { grade: "B", reason: `API p50 ${ms} ms` };
  if (ms >= 150) return { grade: "B+", reason: `API p50 ${ms} ms` };
  if (ms >= 100) return { grade: "A", reason: `API p50 ${ms} ms` };
  return { grade: "A+", reason: `API p50 ${ms} ms` };
}

export function gradePayload(payload) {
  const bytes = payload?.apiBytes ?? payload?.rawBytes;
  if (bytes == null) return { grade: "N/A", reason: "No payload bytes" };
  if (bytes >= 500000) return { grade: "Critical", reason: `${bytes} bytes` };
  if (bytes >= 200000) return { grade: "D", reason: `${bytes} bytes` };
  if (bytes >= 50000) return { grade: "C", reason: `${bytes} bytes` };
  if (bytes >= 25000) return { grade: "B", reason: `${bytes} bytes` };
  if (bytes >= 15000) return { grade: "B+", reason: `${bytes} bytes` };
  if (bytes >= 8000) return { grade: "A", reason: `${bytes} bytes` };
  return { grade: "A+", reason: `${bytes} bytes` };
}

export function gradeFrontend(fe) {
  if (!fe) return { grade: "N/A", reason: "No FE metadata" };
  let score = 0; // lower is better
  if (fe.reactQuery === true || fe.reactQuery === "Yes") score -= 1;
  else if (fe.reactQuery === false || fe.reactQuery === "No") score += 1;
  if ((fe.mountApiCalls || 0) >= 4) score += 2;
  else if ((fe.mountApiCalls || 0) >= 3) score += 1;
  if (fe.duplicateRisk === "high") score += 2;
  else if (fe.duplicateRisk === "medium") score += 1;
  if ((fe.estParseMs || 0) >= 30) score += 2;
  else if ((fe.estParseMs || 0) >= 10) score += 1;

  if (score <= -1) return { grade: "A+", reason: "Query cache + light mount" };
  if (score <= 0) return { grade: "A", reason: "Healthy client readiness" };
  if (score === 1) return { grade: "B+", reason: "Minor FE friction" };
  if (score === 2) return { grade: "B", reason: "Moderate FE cost" };
  if (score === 3) return { grade: "C", reason: "Duplicate/heavy client work" };
  return { grade: "D", reason: "High client readiness risk" };
}

export function gradeOverall(grades) {
  const core = worseGrade(worseGrade(grades.database, grades.api), grades.payload);
  if (core === "N/A") {
    return grades.frontend !== "N/A" ? grades.frontend : "N/A";
  }
  // FE alone cannot collapse a strong core below B
  if (gradeRank(grades.frontend) >= gradeRank("C") && gradeRank(core) <= gradeRank("A")) {
    return worseGrade(core, "B");
  }
  return worseGrade(core, grades.frontend === "N/A" ? core : betterGrade(grades.frontend, core) === core
    ? core
    : worseGrade(core, gradeRank(grades.frontend) >= gradeRank("D") ? "B" : core));
}

/** Simpler overall: max severity among DB, API, Payload; FE soft. */
export function computeOverallGrade({ database, api, payload, frontend }) {
  let overall = worseGrade(worseGrade(database, api), payload);
  if (overall === "N/A") overall = frontend;
  else if (gradeRank(frontend) >= gradeRank("C") && gradeRank(overall) <= gradeRank("A")) {
    overall = worseGrade(overall, "B");
  }
  return overall || "N/A";
}

export function pickPrimaryBottleneck({ grades, layers }) {
  const candidates = [
    { layer: "database", grade: grades.database, weight: layers?.database?.execMs ?? 0 },
    { layer: "api", grade: grades.api, weight: layers?.api?.p50Ms ?? 0 },
    { layer: "payload", grade: grades.payload, weight: (layers?.payload?.apiBytes ?? layers?.payload?.rawBytes ?? 0) / 1000 },
    { layer: "frontend", grade: grades.frontend, weight: layers?.frontend?.estParseMs ?? 0 },
  ].filter((c) => c.grade && c.grade !== "N/A");

  if (!candidates.length) return "none";
  candidates.sort((a, b) => {
    const g = gradeRank(b.grade) - gradeRank(a.grade);
    if (g !== 0) return g;
    return b.weight - a.weight;
  });
  // Only surface a bottleneck when a layer is actually weak (C+).
  if (gradeRank(candidates[0].grade) < gradeRank("C")) return "none";
  return candidates[0].layer;
}

export function timeSharePct({ dbMs, appMs, serializeMs }) {
  const parts = {
    database: Math.max(0, dbMs || 0),
    application: Math.max(0, appMs || 0),
    serialization: Math.max(0, serializeMs || 0),
  };
  const total = parts.database + parts.application + parts.serialization;
  if (total <= 0) return { database: null, application: null, serialization: null, totalMs: 0 };
  const pct = (n) => Math.round((n / total) * 1000) / 10;
  return {
    database: pct(parts.database),
    application: pct(parts.application),
    serialization: pct(parts.serialization),
    totalMs: Math.round(total * 100) / 100,
  };
}

export function bandForGrade(grade) {
  if (grade === "A+" || grade === "A") return "Good / Excellent";
  if (grade === "B+" || grade === "B") return "Average";
  if (grade === "C" || grade === "D") return "Needs optimization";
  if (grade === "Critical") return "Critical";
  return "N/A";
}

/**
 * Grade long-running actions from completion / execution timing.
 * @param {{ completionMs?: number|null, executionMs?: number|null, successRate?: number|null, status?: string }} action
 */
export function gradeAction(action) {
  if (!action || (action.completionMs == null && action.executionMs == null)) {
    return { grade: "N/A", reason: "Action not measured" };
  }
  const ms = action.completionMs ?? action.executionMs ?? 0;
  const rate = action.successRate;
  if (rate != null && rate < 0.5) {
    return { grade: "Critical", reason: `Success rate ${(rate * 100).toFixed(0)}%` };
  }
  if (rate != null && rate < 0.8) {
    return { grade: "D", reason: `Success rate ${(rate * 100).toFixed(0)}% · ${ms} ms` };
  }
  if (ms >= 300000) return { grade: "Critical", reason: `Completion ${ms} ms` };
  if (ms >= 120000) return { grade: "D", reason: `Completion ${ms} ms` };
  if (ms >= 60000) return { grade: "C", reason: `Completion ${ms} ms` };
  if (ms >= 30000) return { grade: "B", reason: `Completion ${ms} ms` };
  if (ms >= 15000) return { grade: "B+", reason: `Completion ${ms} ms` };
  if (ms >= 5000) return { grade: "A", reason: `Completion ${ms} ms` };
  return { grade: "A+", reason: `Completion ${ms} ms` };
}

/** Overall including optional action dimension. */
export function computeOverallGradeWithAction(grades) {
  const base = computeOverallGrade(grades);
  if (!grades.action || grades.action === "N/A") return base;
  return worseGrade(base, grades.action);
}
