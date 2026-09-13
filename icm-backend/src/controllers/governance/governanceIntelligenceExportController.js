/**
 * Governance Intelligence export (PDF / Excel / ZIP).
 *
 * Thresholds tab exports risk bands only (alert / notification UI is hidden).
 * Risk bands are resolved server-side from the tenant/application rule set.
 */
import archiver from "archiver";
import { buildGovernanceIntelligenceSnapshot } from "../../services/governance/governanceIntelligenceSnapshotService.js";
import { buildGovernanceIntelligenceExcelBuffer } from "../../services/governance/governanceIntelligenceExcelExport.js";
import { buildGovernanceIntelligencePdfBuffer } from "../../services/governance/governanceIntelligencePdfExport.js";

function safeFilenamePart(s, fallback = "export") {
  const cleaned = String(s || "")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
  return cleaned || fallback;
}

const EXPORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** e.g. 27-Jul-2026_08-45-12 */
function formatReadableExportStamp(at = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return [
    `${pad(at.getDate())}-${EXPORT_MONTHS[at.getMonth()]}-${at.getFullYear()}`,
    `${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`,
  ].join("_");
}

function resolveOrgAdminDisplayName(user) {
  const full = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (user?.email) return String(user.email).split("@")[0];
  return "OrgAdmin";
}

/** e.g. governance_report_Jane_Doe_HR_System_27-Jul-2026_08-45-12 */
function buildGovernanceReportExportBase(orgAdminName, applicationName, at = new Date()) {
  return [
    "governance_report",
    safeFilenamePart(orgAdminName, "OrgAdmin"),
    safeFilenamePart(applicationName, "Application"),
    formatReadableExportStamp(at),
  ].join("_");
}

export async function postGovernanceIntelligenceExport(req, res) {
  try {
    const {
      tenantId,
      applicationId,
      asOf,
      format = "excel",
      includeCharts = true,
      includeAppendix = true,
    } = req.body || {};

    if (!applicationId) {
      return res.status(400).json({ success: false, message: "applicationId is required" });
    }

    const fmt = String(format).toLowerCase();
    if (!["pdf", "excel", "pack"].includes(fmt)) {
      return res.status(400).json({ success: false, message: "format must be pdf, excel, or pack" });
    }

    void includeCharts;

    const snapshot = await buildGovernanceIntelligenceSnapshot(req, {
      tenantId,
      applicationId,
      asOf,
      includeAppendix: includeAppendix !== false,
    });

    const exportAt = asOf ? new Date(asOf) : new Date();
    const base = buildGovernanceReportExportBase(
      resolveOrgAdminDisplayName(req.user),
      snapshot.meta.applicationName,
      Number.isNaN(exportAt.getTime()) ? new Date() : exportAt,
    );

    if (fmt === "pdf") {
      const buf = await buildGovernanceIntelligencePdfBuffer(snapshot);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.pdf"`);
      return res.send(buf);
    }

    if (fmt === "excel") {
      const buf = await buildGovernanceIntelligenceExcelBuffer(snapshot, {
        includeAppendix: includeAppendix !== false,
      });
      res.setHeader(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${base}.xlsx"`);
      return res.send(buf);
    }

    const pdfBuf = await buildGovernanceIntelligencePdfBuffer(snapshot);
    const xlsBuf = await buildGovernanceIntelligenceExcelBuffer(snapshot, {
      includeAppendix: includeAppendix !== false,
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${base}_pack.zip"`);

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (err) => {
      if (!res.headersSent) res.status(500).end();
      // eslint-disable-next-line no-console
      console.error("[governance export zip]", err);
    });
    archive.pipe(res);
    archive.append(pdfBuf, { name: `${base}.pdf` });
    archive.append(xlsBuf, { name: `${base}.xlsx` });
    await archive.finalize();
    return undefined;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[governanceIntelligenceExport]", err);
    const msg = err?.message || "Export failed";
    const code = msg.includes("not found") ? 404 : msg.includes("scope") ? 403 : 500;
    return res.status(code).json({ success: false, message: msg });
  }
}
