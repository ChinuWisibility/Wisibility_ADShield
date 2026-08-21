/**
 * Client-side CSV/JSON export for AD Security Posture findings.
 * Pattern aligned with certification notificationCsvUtils.
 */

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function findingsToCsv(rows = []) {
  const headers = [
    "severity",
    "findingType",
    "feature",
    "objectName",
    "objectType",
    "dn",
    "matchedPolicy",
    "recommendation",
    "scanId",
    "scannedAt",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.severity,
        r.findingType,
        r.feature,
        r.objectName,
        r.objectType,
        r.dn,
        r.matchedPolicyName,
        r.recommendation,
        r.scanId,
        r.scannedAt,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function downloadFindingsCsv(rows, filename = "security-findings.csv") {
  downloadBlob(filename, new Blob([findingsToCsv(rows)], { type: "text/csv;charset=utf-8" }));
}

export function downloadFindingsJson(rows, filename = "security-findings.json") {
  downloadBlob(
    filename,
    new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }),
  );
}
