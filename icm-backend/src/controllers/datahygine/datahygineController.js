import mongoose from "mongoose";
import {
  listDataHygieneWidgetItems,
  isValidWidgetKey,
} from "../../services/datahygine/datahygineService.js";
import {
  getDataHygieneSummaryFast,
  getDataHygieneSummaryStatus,
} from "../../services/datahygine/dataHygieneSummaryCacheService.js";
import { resolveDataHygieneTenantId } from "./datahygineRequest.js";

/**
 * GET /api/data-hygiene/summary
 * Query: tenantId (required when logged in as platform admin without tenant scope)
 *        refresh=1 | bypassCache=true — start live recompute; warm snapshots return immediately (SWR)
 */
export async function getDatahygineSummary(req, res, next) {
  try {
    const tid = resolveDataHygieneTenantId(req);
    if (!tid) {
      return res.status(400).json({
        success: false,
        message: "Valid tenant context is required. Pass tenantId when using a platform-scoped account.",
        code: "TENANT_REQUIRED",
      });
    }

    const forceRefresh =
      req.query?.refresh === "1" ||
      req.query?.bypassCache === "true" ||
      req.query?.bypassCache === "1";

    const result = await getDataHygieneSummaryFast(tid, { forceRefresh });
    const data = result?.payload ?? result;
    const meta = result?.meta ?? null;
    res.json({ success: true, data, meta });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/data-hygiene/summary/status
 * Light freshness poll (no full summary payload).
 */
export async function getDataHygieneSummaryStatusHandler(req, res, next) {
  try {
    const tid = resolveDataHygieneTenantId(req);
    if (!tid) {
      return res.status(400).json({
        success: false,
        message: "Valid tenant context is required. Pass tenantId when using a platform-scoped account.",
        code: "TENANT_REQUIRED",
      });
    }
    const data = await getDataHygieneSummaryStatus(tid);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/data-hygiene/widget-items
 * Query: widget (required), applicationId (optional; empty = null bucket), page, limit,
 *        q|search (optional text filter), tenantId (platform admin)
 */
export async function getDataHygieneWidgetItems(req, res, next) {
  try {
    const tid = resolveDataHygieneTenantId(req);
    if (!tid) {
      return res.status(400).json({
        success: false,
        message: "Valid tenant context is required. Pass tenantId when using a platform-scoped account.",
        code: "TENANT_REQUIRED",
      });
    }

    const widget = req.query?.widget;
    if (!widget || !isValidWidgetKey(widget)) {
      return res.status(400).json({
        success: false,
        message:
          "Query `widget` is required and must be one of: orphanedProfiles, missingManagers, missingManagersByApplication, managerMismatches, statusMismatches, unassignedEntitlements, privilegedEntitlements, entitlementsMissingOwner, inactiveUsersWithAccess, accessCertificationCampaigns, sodPoliciesViolations, duplicateAccountsByApplication.",
        code: "INVALID_WIDGET",
      });
    }

    const rawApp = req.query?.applicationId;
    let applicationId = null;
    if (rawApp != null && String(rawApp).trim() !== "") {
      const s = String(rawApp).trim();
      if (!mongoose.Types.ObjectId.isValid(s)) {
        return res.status(400).json({
          success: false,
          message: "Invalid applicationId.",
          code: "INVALID_APPLICATION_ID",
        });
      }
      applicationId = new mongoose.Types.ObjectId(s);
    }

    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 25));
    const search = String(req.query?.q ?? req.query?.search ?? "").trim();

    const data = await listDataHygieneWidgetItems(
      tid,
      widget,
      applicationId,
      page,
      limit,
      search || undefined,
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
