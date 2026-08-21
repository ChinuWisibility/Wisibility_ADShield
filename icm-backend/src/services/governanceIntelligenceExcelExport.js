/**
 * Excel workbook aligned with Iso2007Report.jsx tab order and labels.
 */
import ExcelJS from "exceljs";
import {
  UI_COPY,
  controlStatusUiLabel,
  riskPostureTierLabel,
  accountLifecycleTotal,
  controlComplianceSummary,
  buildPostureProgressRows,
  riskBandRowsForExport,
} from "../utils/governanceReportUiPresentation.js";

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFEFF4FF" },
  };
}

function styleSectionRow(row) {
  row.font = { bold: true, size: 11, color: { argb: "FF1A4FBA" } };
}

function addSheetWithRows(workbook, name, headers, dataRows, { autofilter = false } = {}) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.addRow(headers);
  styleHeaderRow(sheet.getRow(1));
  for (const r of dataRows) {
    sheet.addRow(r);
  }
  if (autofilter && sheet.rowCount > 1) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rowCount, column: headers.length },
    };
  }
  sheet.columns.forEach((col) => {
    col.width = Math.min(52, Math.max(10, (col.header?.length || 10) + 2));
  });
  return sheet;
}

function addBannerRows(sheet, meta, overview) {
  const k = overview.kpis;
  const activePct = k.totalUsers > 0 ? Math.round((k.activeUsers / k.totalUsers) * 100) : 0;
  sheet.addRow([UI_COPY.platformLine]).getCell(1).font = { italic: true, color: { argb: "FF64748B" } };
  sheet.addRow([UI_COPY.reportTitle]).getCell(1).font = { bold: true, size: 14, color: { argb: "FF0F3380" } };
  sheet.addRow([
    `${meta.applicationName || "—"} · ${meta.tenantName || meta.tenantId || "—"} · Generated ${meta.asOf}`,
  ]);
  sheet.addRow([
    `Active rate ${activePct}% (${k.activeUsers} of ${k.totalUsers} users)`,
  ]).getCell(1).font = { size: 10 };
  sheet.addRow([]);
}

/**
 * @param {Awaited<ReturnType<import('./governanceIntelligenceSnapshotService.js').buildGovernanceIntelligenceSnapshot>>} snapshot
 */
export async function buildGovernanceIntelligenceExcelBuffer(snapshot, { includeAppendix = true } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Wisibility IGA";
  wb.created = new Date();

  const { meta, overview, controls, certifications, sod, accounts, riskBands } = snapshot;
  const k = overview.kpis;
  const ac = overview.accountLifecycleCounts || {};
  const donutTotal = accountLifecycleTotal(ac);
  const ctrlSum = controlComplianceSummary(controls.rows || []);
  const tier = riskPostureTierLabel(overview.riskExposure10);
  const postureRows = buildPostureProgressRows(snapshot);

  /* ── 01_Overview: dashboard + Overview tab content (UI order) ── */
  const dash = wb.addWorksheet("01_Overview", { views: [{ state: "frozen", ySplit: 1 }] });
  addBannerRows(dash, meta, overview);

  styleSectionRow(dash.addRow(["At a glance (dashboard KPIs)"]));
  dash.addRow(["KPI", "Value", "Notes"]);
  styleHeaderRow(dash.getRow(dash.rowCount));
  dash.addRow(["Total Users", k.totalUsers, ""]);
  dash.addRow(["Active Users", k.activeUsers, ""]);
  dash.addRow(["Inactive Users", k.inactiveUsers, ""]);
  dash.addRow(["Privileged Users", k.privilegedAccounts, "Warehouse privileged / admin accounts"]);
  dash.addRow([
    "Orphan / uncorrelated",
    k.orphanUncorrelatedLifecycle,
    k.openUncorrelatedQueue > 0 ? `${k.openUncorrelatedQueue} OPEN in uncorrelated queue` : "",
  ]);
  dash.addRow([]);

  styleSectionRow(dash.addRow(["Overall risk posture"]));
  dash.addRow([
    "Summary",
    `Tier: ${tier} · Exposure ${overview.riskExposure10 != null ? overview.riskExposure10.toFixed(1) : "—"}/10 · Health ${overview.governanceHealth ?? "—"}/100`,
  ]);
  dash.addRow([
    "Note",
    "Higher exposure = lower health. Same formula as the live report (inactive, privileged >30%, orphan share).",
  ]);
  dash.addRow(["Metric", "%"]);
  styleHeaderRow(dash.getRow(dash.rowCount));
  postureRows.forEach((r) => dash.addRow([r.label, r.pct]));
  dash.addRow([]);

  styleSectionRow(dash.addRow(["Key findings"]));
  dash.addRow(["Type", "Detail"]);
  styleHeaderRow(dash.getRow(dash.rowCount));
  (overview.keyFindings || []).forEach((f) => dash.addRow([f.type, f.text]));
  dash.addRow([]);

  styleSectionRow(dash.addRow([UI_COPY.accountStatusTitle]));
  dash.addRow([UI_COPY.accountStatusCaption]).getCell(1).font = { size: 9, italic: true };
  dash.addRow(["Slice", "Count", "% of accounts"]);
  styleHeaderRow(dash.getRow(dash.rowCount));
  (overview.lifecycleDonutRows || []).forEach((r) => {
    const pct = donutTotal > 0 ? ((Number(r.value) / donutTotal) * 100).toFixed(1) : "0";
    dash.addRow([r.name, r.value, `${pct}%`]);
  });
  dash.addRow([]);

  styleSectionRow(dash.addRow([UI_COPY.complianceTrendTitle]));
  dash.addRow([UI_COPY.complianceTrendCaption]).getCell(1).font = { size: 9, italic: true };
  dash.addRow(["Point", "Previous review %", "Current review %"]);
  styleHeaderRow(dash.getRow(dash.rowCount));
  (overview.complianceTrend || []).forEach((r) =>
    dash.addRow([
      r.label || r.quarter || "—",
      r.previousReview ?? r.org ?? "",
      r.currentReview ?? r.org ?? "",
    ]),
  );
  dash.addRow([]);

  styleSectionRow(dash.addRow([UI_COPY.departmentTitle]));
  dash.addRow([UI_COPY.departmentCaption]).getCell(1).font = { size: 9, italic: true };
  dash.addRow(["Department", "Std active", "Priv", "Inactive", "Dormant", "Orphan", "Total"]);
  styleHeaderRow(dash.getRow(dash.rowCount));
  (overview.departmentRiskBar || []).forEach((r) =>
    dash.addRow([
      r.name,
      r.standardActive,
      r.privileged,
      r.inactive,
      r.dormant,
      r.orphan,
      r.total,
    ]),
  );

  dash.getColumn(1).width = 36;
  dash.getColumn(2).width = 14;
  dash.getColumn(3).width = 52;

  /* ── 02_Controls ── */
  const ctrlSheet = wb.addWorksheet("02_Controls", { views: [{ state: "frozen", ySplit: 2 }] });
  ctrlSheet.addRow([UI_COPY.controlsHeading]).getCell(1).font = { bold: true, size: 12, color: { argb: "FF0F3380" } };
  ctrlSheet.addRow([
    `Compliant ${ctrlSum.compliant} · Partial ${ctrlSum.partial} · Non-Compliant ${ctrlSum.nonCompliant} · N/A ${ctrlSum.na} · Total ${ctrlSum.total}`,
  ]);
  ctrlSheet.addRow(["Control ID", "Title", "Domain", "Description", "Status"]);
  styleHeaderRow(ctrlSheet.getRow(ctrlSheet.rowCount));
  (controls.rows || []).forEach((c) =>
    ctrlSheet.addRow([c.id, c.title, c.domain, c.desc, controlStatusUiLabel(c.status)]),
  );
  if (ctrlSheet.rowCount > 3) {
    ctrlSheet.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: ctrlSheet.rowCount, column: 5 },
    };
  }
  ctrlSheet.columns.forEach((col, i) => {
    col.width = [12, 28, 14, 44, 14][i] || 18;
  });

  /* ── 03_Certifications ── */
  const certSh = wb.addWorksheet("03_Certifications", { views: [{ state: "frozen", ySplit: 3 }] });
  certSh.addRow([UI_COPY.certificationsHeading]).getCell(1).font = {
    bold: true,
    size: 12,
    color: { argb: "FF0F3380" },
  };
  certSh.addRow([]);
  certSh.addRow([
    "Campaign",
    "Application",
    "Status",
    "Start",
    "End",
    "Completion %",
    "Items",
    "Approved",
    "Revoked",
    "Pending",
    "Overdue",
  ]);
  styleHeaderRow(certSh.getRow(certSh.rowCount));
  (certifications.campaigns || []).forEach((c) => {
    certSh.addRow([
      c.name || "—",
      c.applicationName || "—",
      c.status || "—",
      c.startDate || "",
      c.endDate || "",
      c.completionPercentage ?? "",
      c.totalItems ?? "",
      c.approvedItems ?? "",
      c.revokedItems ?? "",
      c.pendingItems ?? "",
      c.isOverdue ? "Y" : "N",
    ]);
  });
  if (certSh.rowCount > 3) {
    certSh.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: certSh.rowCount, column: 11 },
    };
  }
  certSh.columns.forEach((col, i) => {
    col.width = [26, 20, 12, 12, 12, 10, 8, 10, 10, 10, 8][i] || 14;
  });

  /* ── 04_SOD ── */
  const sodSummary = sod?.summary || {};
  const sodSh = wb.addWorksheet("04_SOD", { views: [{ state: "frozen", ySplit: 4 }] });
  sodSh.addRow([UI_COPY.sodHeading]).getCell(1).font = {
    bold: true,
    size: 12,
    color: { argb: "FF0F3380" },
  };
  sodSh.addRow([UI_COPY.sodCaption]).getCell(1).font = { italic: true, size: 9 };
  sodSh.addRow([
    `Policies: ${sodSummary.policyCount ?? 0} · Violations: ${sodSummary.violationCount ?? 0} · Open: ${sodSummary.openViolationCount ?? 0}`,
  ]);
  sodSh.addRow([]);
  styleSectionRow(sodSh.addRow(["Policies in scope"]));
  sodSh.addRow(["Policy ID", "Name", "Status", "Severity", "Violations"]);
  styleHeaderRow(sodSh.getRow(sodSh.rowCount));
  (sod?.policies || []).forEach((p) =>
    sodSh.addRow([p.policyId || p._id || "", p.name || "", p.status || "", p.severity || "", p.totalViolations ?? ""]),
  );
  sodSh.addRow([]);
  styleSectionRow(sodSh.addRow(["Violations"]));
  sodSh.addRow(["Policy", "Identity", "Email", "Conflict access", "Status", "Severity", "Detected"]);
  styleHeaderRow(sodSh.getRow(sodSh.rowCount));
  (sod?.violations || []).forEach((v) =>
    sodSh.addRow([
      v.policyName || "",
      v.identityName || "",
      v.identityEmail || "",
      v.conflictAccess || "",
      v.status || "",
      v.severity || "",
      v.detectedAt || "",
    ]),
  );
  sodSh.getColumn(1).width = 22;
  sodSh.getColumn(2).width = 22;
  sodSh.getColumn(3).width = 28;
  sodSh.getColumn(4).width = 40;
  sodSh.getColumn(5).width = 14;
  sodSh.getColumn(6).width = 12;
  sodSh.getColumn(7).width = 18;

  /* ── 05_Accounts ── */
  const accSh = wb.addWorksheet("05_Accounts", { views: [{ state: "frozen", ySplit: 3 }] });
  accSh.addRow([UI_COPY.accountsHeading]).getCell(1).font = { bold: true, size: 12, color: { argb: "FF0F3380" } };
  accSh.addRow([
    `Users in scope: ${accounts.summary.userCount} · OPEN queue: ${accounts.summary.openQueueRows} · Privileged appendix rows: ${accounts.privilegedAppendixRows.length}`,
  ]);
  accSh.addRow(["Metric", "Value"]);
  styleHeaderRow(accSh.getRow(accSh.rowCount));
  accSh.addRow(["Users in scope (app collection)", accounts.summary.userCount]);
  accSh.addRow(["OPEN uncorrelated queue", accounts.summary.openQueueRows]);
  accSh.addRow(["Privileged schedule rows (appendix)", accounts.privilegedAppendixRows.length]);
  accSh.addRow([]);
  styleSectionRow(accSh.addRow(["Uncorrelated accounts (top by severity)"]));
  accSh.addRow(["Account", "Risk", "Correlation key"]);
  styleHeaderRow(accSh.getRow(accSh.rowCount));
  (accounts.topOrphans || []).forEach((o) =>
    accSh.addRow([o.accountName || o.accountId || "—", o.riskLevel || "", o.correlationKey || ""]),
  );

  /* ── 06_Thresholds (risk bands) ── */
  const bandRows = riskBandRowsForExport(riskBands);
  const thSh = wb.addWorksheet("06_Thresholds", { views: [{ state: "frozen", ySplit: 4 }] });
  thSh.addRow([UI_COPY.thresholdsHeading]).getCell(1).font = {
    bold: true,
    size: 12,
    color: { argb: "FF0F3380" },
  };
  thSh.addRow([UI_COPY.thresholdsCaption]).getCell(1).font = { italic: true, size: 9 };
  thSh.addRow([]);
  thSh.addRow(["Metric", "Low", "Medium from", "High from", "Critical from", "Band summary"]);
  styleHeaderRow(thSh.getRow(thSh.rowCount));
  bandRows.forEach((r) => thSh.addRow(r));
  if (bandRows.length) {
    thSh.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: thSh.rowCount, column: 6 },
    };
  }
  thSh.getColumn(1).width = 36;
  thSh.getColumn(2).width = 12;
  thSh.getColumn(3).width = 14;
  thSh.getColumn(4).width = 12;
  thSh.getColumn(5).width = 14;
  thSh.getColumn(6).width = 64;

  /* ── Appendix sheets (raw) ── */
  addSheetWithRows(
    wb,
    "Raw_Users",
    ["_id", "email", "username", "nativeIdentity", "department", "status", "lastLogin"],
    accounts.usersSerialized.map((u) => [
      u._id,
      u.email,
      u.username,
      u.nativeIdentity,
      u.department,
      u.status,
      u.lastLogin,
    ]),
    { autofilter: true },
  );

  if (includeAppendix && accounts.fullOrphans?.length) {
    addSheetWithRows(
      wb,
      "Raw_Orphans",
      ["_id", "accountName", "accountId", "riskLevel", "correlationKey", "detectedAt", "updatedAt"],
      accounts.fullOrphans.map((o) => [
        String(o._id),
        o.accountName ?? "",
        o.accountId != null ? String(o.accountId) : "",
        o.riskLevel ?? "",
        o.correlationKey ?? "",
        o.detectedAt ? new Date(o.detectedAt).toISOString() : "",
        o.updatedAt ? new Date(o.updatedAt).toISOString() : "",
      ]),
      { autofilter: true },
    );
  }

  addSheetWithRows(
    wb,
    "Raw_Accounts_Privileged",
    ["id", "displayName"],
    accounts.privilegedAppendixRows.map((r) => [r.id, r.displayName]),
    { autofilter: true },
  );

  if (includeAppendix && certifications.decisionRecords?.length) {
    const dr = certifications.decisionRecords.slice(0, 10000);
    addSheetWithRows(
      wb,
      "Raw_Decisions",
      ["campaignId", "campaignName", "status", "decision", "itemName", "reviewedAt", "reviewerEmail", "comment"],
      dr.map((d) => [
        d.campaignId != null ? String(d.campaignId) : "",
        d.campaignName ?? "",
        d.status ?? "",
        d.decision ?? "",
        d.itemName ?? "",
        d.reviewedAt || "",
        d.reviewerEmail ?? "",
        d.comment ?? "",
      ]),
      { autofilter: true },
    );
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
