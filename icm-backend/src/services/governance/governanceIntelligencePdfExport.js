/**
 * Governance PDF aligned with Iso2007Report.jsx: banner, KPI row, posture card, tab order.
 */
import PDFDocument from "pdfkit";
import {
  UI_COPY,
  controlStatusUiLabel,
  riskPostureTierLabel,
  accountLifecycleTotal,
  controlComplianceSummary,
  buildPostureProgressRows,
  riskBandRowsForExport,
} from "../utils/governanceReportUiPresentation.js";

const BRAND_NAVY = "#0f3380";
const BRAND_BLUE = "#2563eb";
const MUTED = "#64748b";

/**
 * Draw a simple table with wrapped cells and row heights that fit content
 * (avoids overlapping when Description / long labels wrap).
 */
function drawTable(doc, { headers, rows, startX, startY, colWidths }) {
  let y = startY;
  const padding = 4;
  const minLineH = 12;
  const pageBottom = () => doc.page.height - 56;

  const ensureSpace = (needed) => {
    if (y + needed > pageBottom()) {
      doc.addPage();
      y = 48;
    }
  };

  const measureRowHeight = (cells, fontName, fontSize) => {
    doc.font(fontName).fontSize(fontSize);
    let maxH = minLineH;
    cells.forEach((cell, i) => {
      const w = Math.max(8, colWidths[i] - padding * 2);
      const h = doc.heightOfString(String(cell ?? ""), { width: w });
      if (h > maxH) maxH = h;
    });
    return maxH + 4;
  };

  const paintRow = (cells, fontName, fontSize, rowH) => {
    ensureSpace(rowH + 2);
    doc.font(fontName).fontSize(fontSize).fillColor("#0f172a");
    let x = startX;
    cells.forEach((cell, i) => {
      const w = Math.max(8, colWidths[i] - padding * 2);
      // Absolute x/y so wrapped cells in the same row do not shift the next column.
      doc.text(String(cell ?? ""), x + padding, y, {
        width: w,
        height: rowH,
        lineBreak: true,
        ellipsis: true,
      });
      x += colWidths[i];
    });
    // Keep our own cursor — PDFKit otherwise leaves doc.y at the last cell's end.
    doc.x = startX;
    doc.y = y + rowH;
    y += rowH;
  };

  const headerH = measureRowHeight(headers, "Helvetica-Bold", 7.5);
  paintRow(headers, "Helvetica-Bold", 7.5, headerH);
  y += 2;

  for (const row of rows) {
    const rowH = measureRowHeight(row, "Helvetica", 7.5);
    paintRow(row, "Helvetica", 7.5, rowH);
  }

  doc.fillColor("#0f172a");
  return y + 12;
}

function drawBanner(doc, meta, overview) {
  const pageW = doc.page.width;
  const bannerH = 78;
  const y0 = doc.y;
  doc.save();
  doc.rect(0, y0, pageW, bannerH).fill(BRAND_NAVY);
  doc.fillColor("#ffffff").font("Helvetica-Bold");
  doc.fontSize(8).text(UI_COPY.platformLine, 40, y0 + 14, {
    width: pageW - 80,
    align: "center",
  });
  doc.fontSize(17).text(UI_COPY.reportTitle, 40, y0 + 28, {
    width: pageW - 80,
    align: "center",
  });
  const ctx = `${meta.applicationName || "—"} · ${meta.tenantName || meta.tenantId || "—"}`;
  doc.font("Helvetica").fontSize(9).opacity(0.92).text(ctx, 40, y0 + 52, {
    width: pageW - 80,
    align: "center",
  });
  doc.opacity(1);
  const k = overview.kpis;
  const activePct =
    k.totalUsers > 0 ? Math.round((k.activeUsers / k.totalUsers) * 100) : 0;
  doc
    .fontSize(8)
    .text(
      `Generated: ${meta.asOf} · Active rate ${activePct}% (${k.activeUsers} of ${k.totalUsers} users)`,
      40,
      y0 + 66,
      { width: pageW - 80, align: "center" },
    );
  doc.restore();
  doc.fillColor("#0f172a");
  doc.y = y0 + bannerH + 18;
}

function drawSection(doc, title) {
  doc.moveDown(0.35);
  doc.fontSize(11).fillColor(BRAND_BLUE).font("Helvetica-Bold").text(title);
  doc.fillColor("#0f172a").font("Helvetica").fontSize(9).moveDown(0.25);
}

function drawRiskScale(doc, riskExposure10, x, y, totalW) {
  if (riskExposure10 == null || Number.isNaN(Number(riskExposure10))) return y + 20;
  const re = Math.min(10, Math.max(0, Number(riskExposure10)));
  const segW = (totalW - 9 * 2) / 10;
  const segH = 8;
  for (let i = 0; i < 10; i += 1) {
    const sx = x + i * (segW + 2);
    let fill = "#cbd5e1";
    if (i < 2) fill = "#22c55e";
    else if (i < 6) fill = "#f59e0b";
    doc.save().rect(sx, y, segW, segH).fill(fill).restore();
  }
  const markerX = x + (re / 10) * totalW - 4;
  doc.save().fillColor("#0f172a").font("Helvetica-Bold").fontSize(7).text(re.toFixed(1), markerX, y + segH + 2, { width: 24, align: "center" }).restore();
  doc.fillColor(MUTED).font("Helvetica").fontSize(6.5);
  doc.text("Lower exposure", x, y + segH + 14, { width: 80 });
  doc.text("Higher exposure", x + totalW - 80, y + segH + 14, { width: 80, align: "right" });
  doc.fillColor("#0f172a");
  return y + segH + 32;
}

/**
 * @param {Awaited<ReturnType<import('./governanceIntelligenceSnapshotService.js').buildGovernanceIntelligenceSnapshot>>} snapshot
 */
export async function buildGovernanceIntelligencePdfBuffer(snapshot) {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 36,
    info: {
      Title: UI_COPY.reportTitle,
      Author: "Wisibility IGA",
    },
  });

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const { meta, overview, controls, certifications, sod, accounts, riskBands } = snapshot;
  const k = overview.kpis;
  const ac = overview.accountLifecycleCounts || {};
  const donutTotal = accountLifecycleTotal(ac);
  const ctrlSum = controlComplianceSummary(controls.rows || []);
  const tier = riskPostureTierLabel(overview.riskExposure10);
  const postureRows = buildPostureProgressRows(snapshot);

  doc.y = 36;
  drawBanner(doc, meta, overview);

  drawSection(doc, "At a glance (dashboard KPIs)");
  let y = doc.y;
  y = drawTable(doc, {
    headers: ["KPI", "Value", "Notes"],
    rows: [
      ["Total Users", k.totalUsers, ""],
      ["Active Users", k.activeUsers, ""],
      ["Inactive Users", k.inactiveUsers, ""],
      ["Privileged Users", k.privilegedAccounts, "Warehouse privileged / admin accounts"],
      [
        "Orphan / uncorrelated",
        k.orphanUncorrelatedLifecycle,
        k.openUncorrelatedQueue > 0
          ? `${k.openUncorrelatedQueue} OPEN in uncorrelated queue`
          : "",
      ],
    ],
    startX: 36,
    startY: y,
    colWidths: [200, 70, 420],
  });
  doc.y = y;

  drawSection(doc, "Overall risk posture");
  doc.fontSize(9).font("Helvetica-Bold").text(`Tier: ${tier}`, { continued: true });
  doc.font("Helvetica").text(
    ` · Risk exposure index ${overview.riskExposure10 != null ? overview.riskExposure10.toFixed(1) : "—"} / 10 · Governance health ${overview.governanceHealth ?? "—"} / 100`,
  );
  doc.fontSize(8).fillColor(MUTED).text(
    "Higher = more exposure. Health penalizes inactive share, privileged share > 30%, and orphan / uncorrelated share (same rules as the live report).",
    { width: doc.page.width - 72 },
  );
  doc.fillColor("#0f172a");
  y = doc.y + 6;
  y = drawRiskScale(doc, overview.riskExposure10, 36, y, doc.page.width - 72);
  doc.y = y;
  doc.font("Helvetica-Bold").fontSize(8).text("Posture mix (same bars as UI)");
  doc.y += 4;
  y = drawTable(doc, {
    headers: ["Metric", "% of scope"],
    rows: postureRows.map((r) => [r.label, `${r.pct}%`]),
    startX: 36,
    startY: doc.y,
    colWidths: [320, 80],
  });
  doc.y = y;

  drawSection(doc, "Key findings");
  overview.keyFindings.forEach((f) => {
    doc.font("Helvetica-Bold").fontSize(8.5).text(`${f.type.toUpperCase()}: `, { continued: true });
    doc.font("Helvetica").text(f.text, { width: doc.page.width - 72 });
  });

  doc.addPage();
  drawSection(doc, "Tab: Overview — charts as tables");
  doc.fontSize(7.5).fillColor(MUTED).text(UI_COPY.overviewFootnote, { width: doc.page.width - 72 });
  doc.fillColor("#0f172a").moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(9).text(UI_COPY.accountStatusTitle);
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(UI_COPY.accountStatusCaption, {
    width: doc.page.width - 72,
  });
  doc.fillColor("#0f172a");
  y = doc.y + 4;
  const lifeRows = (overview.lifecycleDonutRows || []).map((r) => {
    const pct = donutTotal > 0 ? ((Number(r.value) / donutTotal) * 100).toFixed(1) : "0";
    return [r.name, r.value, `${pct}%`];
  });
  y = drawTable(doc, {
    headers: ["Slice", "Count", "% of accounts"],
    rows: lifeRows.length ? lifeRows : [["—", "0", "—"]],
    startX: 36,
    startY: y,
    colWidths: [280, 70, 80],
  });
  doc.y = y;

  doc.font("Helvetica-Bold").fontSize(9).text(UI_COPY.complianceTrendTitle);
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(UI_COPY.complianceTrendCaption, {
    width: doc.page.width - 72,
  });
  doc.fillColor("#0f172a");
  y = doc.y + 4;
  y = drawTable(doc, {
    headers: ["Point", "Previous review %", "Current review %"],
    rows: (overview.complianceTrend || []).map((r) => [
      r.label || r.quarter || "—",
      r.previousReview ?? r.org ?? "",
      r.currentReview ?? r.org ?? "",
    ]),
    startX: 36,
    startY: y,
    colWidths: [160, 120, 120],
  });
  doc.y = y;

  doc.font("Helvetica-Bold").fontSize(9).text(UI_COPY.departmentTitle);
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(UI_COPY.departmentCaption, {
    width: doc.page.width - 72,
  });
  doc.fillColor("#0f172a");
  y = doc.y + 4;
  y = drawTable(doc, {
    headers: ["Department", "Std active", "Priv", "Inactive", "Dormant", "Orphan", "Total"],
    rows: (overview.departmentRiskBar || []).map((r) => [
      r.name,
      r.standardActive,
      r.privileged,
      r.inactive,
      r.dormant,
      r.orphan,
      r.total,
    ]),
    startX: 36,
    startY: y,
    colWidths: [160, 58, 48, 58, 52, 52, 48],
  });
  doc.y = y;

  doc.addPage();
  drawSection(doc, `Tab: Controls — ${UI_COPY.controlsHeading}`);
  doc.font("Helvetica").fontSize(9).text(
    `Compliant ${ctrlSum.compliant} · Partial ${ctrlSum.partial} · Non-Compliant ${ctrlSum.nonCompliant} · N/A ${ctrlSum.na} · Total ${ctrlSum.total}`,
  );
  doc.moveDown(0.4);
  y = doc.y;
  y = drawTable(doc, {
    headers: ["Control ID", "Title", "Domain", "Description", "Status"],
    rows: (controls.rows || []).map((c) => [
      c.id,
      c.title,
      c.domain,
      c.desc,
      controlStatusUiLabel(c.status),
    ]),
    startX: 36,
    startY: y,
    colWidths: [52, 130, 72, 248, 72],
  });
  doc.y = y;

  doc.addPage();
  drawSection(doc, `Tab: Certifications — ${UI_COPY.certificationsHeading}`);
  y = doc.y;
  const campRows = (certifications.campaigns || []).slice(0, 45).map((c) => [
    c.name || "—",
    c.applicationName || "—",
    c.status || "",
    `${c.completionPercentage ?? ""}%`,
    c.totalItems ?? "",
    c.approvedItems ?? "",
    c.revokedItems ?? "",
    c.pendingItems ?? "",
    c.isOverdue ? "Y" : "",
  ]);
  y = drawTable(doc, {
    headers: ["Campaign", "Application", "Status", "Complete %", "Items", "Appr", "Rev", "Pend", "Late"],
    rows: campRows,
    startX: 36,
    startY: y,
    colWidths: [150, 110, 72, 52, 40, 36, 36, 36, 28],
  });
  doc.y = y;

  doc.addPage();
  drawSection(doc, `Tab: SOD — ${UI_COPY.sodHeading}`);
  doc.fontSize(8).fillColor(MUTED).text(UI_COPY.sodCaption, { width: doc.page.width - 72 });
  doc.fillColor("#0f172a");
  const sodSummary = sod?.summary || {};
  doc.fontSize(9).text(
    `Policies: ${sodSummary.policyCount ?? 0} · Violations: ${sodSummary.violationCount ?? 0} · Open: ${sodSummary.openViolationCount ?? 0}`,
  );
  doc.moveDown(0.35);
  doc.font("Helvetica-Bold").fontSize(8.5).text("Policies in scope");
  y = doc.y + 4;
  const sodPolicyRows = (sod?.policies || []).slice(0, 40).map((p) => [
    p.policyId || p._id || "—",
    p.name || "—",
    p.status || "",
    p.severity || "",
    p.totalViolations ?? "",
  ]);
  y = drawTable(doc, {
    headers: ["Policy ID", "Name", "Status", "Severity", "Violations"],
    rows: sodPolicyRows.length ? sodPolicyRows : [["—", "No SoD policies for this application", "", "", ""]],
    startX: 36,
    startY: y,
    colWidths: [90, 280, 70, 70, 70],
  });
  doc.y = y;
  doc.font("Helvetica-Bold").fontSize(8.5).text("Violations (capped for PDF)");
  y = doc.y + 4;
  const sodViolationRows = (sod?.violations || []).slice(0, 60).map((v) => [
    v.policyName || "—",
    v.identityName || v.identityEmail || "—",
    v.conflictAccess || "—",
    v.status || "",
    v.severity || "",
    v.detectedAt ? String(v.detectedAt).slice(0, 10) : "",
  ]);
  y = drawTable(doc, {
    headers: ["Policy", "Identity", "Conflict access", "Status", "Severity", "Detected"],
    rows: sodViolationRows.length ? sodViolationRows : [["—", "No violations", "", "", "", ""]],
    startX: 36,
    startY: y,
    colWidths: [140, 120, 220, 70, 60, 70],
  });
  doc.y = y;

  doc.addPage();
  drawSection(doc, `Tab: Accounts — ${UI_COPY.accountsHeading}`);
  doc.fontSize(9).text(
    `Users in certification/application extract: ${accounts.summary.userCount}. OPEN uncorrelated queue rows: ${accounts.summary.openQueueRows}. Privileged schedule rows (appendix cap): ${accounts.privilegedAppendixRows.length}.`,
  );
  doc.moveDown(0.5);
  y = doc.y;
  const orphanTop = (accounts.topOrphans || []).slice(0, 30).map((o) => [
    o.accountName || o.accountId || "—",
    o.riskLevel || "",
    o.correlationKey || "",
  ]);
  y = drawTable(doc, {
    headers: ["Uncorrelated account (top by severity)", "Risk", "Correlation key"],
    rows: orphanTop.length ? orphanTop : [["—", "", ""]],
    startX: 36,
    startY: y,
    colWidths: [280, 56, 280],
  });
  doc.y = y;

  doc.addPage();
  drawSection(doc, `Tab: Thresholds — ${UI_COPY.thresholdsHeading}`);
  doc.fontSize(8).fillColor(MUTED).text(UI_COPY.thresholdsCaption, {
    width: doc.page.width - 72,
  });
  doc.fillColor("#0f172a");
  y = doc.y + 6;
  // Risk alert thresholds / notification escalation are hidden in the UI — export risk bands only.
  const bandRows = riskBandRowsForExport(riskBands);
  y = drawTable(doc, {
    headers: ["Metric", "Low", "Medium from", "High from", "Critical from", "Band summary"],
    rows: bandRows.length
      ? bandRows
      : [["(no risk bands configured)", "", "", "", "", ""]],
    startX: 36,
    startY: y,
    colWidths: [150, 52, 70, 62, 72, 260],
  });
  doc.y = y;

  doc.end();
  return done;
}
