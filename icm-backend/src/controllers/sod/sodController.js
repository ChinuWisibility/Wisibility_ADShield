import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import Entitlement from "../../models/access/Entitlement.js";
import SodPolicy from "../../models/sod/SodPolicy.js";
import SodViolation from "../../models/sod/SodViolation.js";
import SodException from "../../models/sod/SodException.js";
import SodRemediationAction from "../../models/sod/SodRemediationAction.js";
import SodAuditLog from "../../models/sod/SodAuditLog.js";
import SodEntitlement from "../../models/sod/SodEntitlement.js";
import SodUserIdentity from "../../models/sod/SodUserIdentity.js";
import { sodTenantFilter, sodWithTenant } from "../../utils/sod/sodTenant.js";
import {
  escapeMongoRegex,
  normalizeEntitlementForBuilder,
  resolveApplicationName,
  sanitizeName,
  sanitizePolicyPayload,
} from "../../utils/sod/sodPolicyUtils.js";
import { logSodAudit } from "../../services/sod/sodAuditService.js";
import {
  nextPolicyIdForTenant,
  runSodEvaluationForPolicies,
} from "../../services/sod/sodEvaluationService.js";
import {
  buildUserLookupForPolicy,
  buildDepartmentLookupForPolicy,
  enrichViolationRows,
  hydrateViolationIdentityLabels,
  groupViolationCountsByKey,
  groupViolationCountsByDepartment,
  resolveDepartmentForViolationRow,
} from "../../services/sod/sodViolationDepartmentEnrichment.js";
import {
  getAppEntitlementsCollectionName,
  resolveTenantSlugFromTenantId,
} from "../../utils/applicationDynamicCollections.js";

function sodCtx(req) {
  return { scopedTenantId: req.scopedTenantId, user: req.user };
}

/** Tenant-scoped case-insensitive name collision check. */
async function policyNameExists(tenantId, name, { excludeId } = {}) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return false;
  const filter = {
    ...sodTenantFilter(tenantId),
    name: { $regex: `^${escapeMongoRegex(trimmed)}$`, $options: "i" },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  const existing = await SodPolicy.findOne(filter).select("_id").lean();
  return Boolean(existing);
}

// ── Policies ───────────────────────────────────────────────────────────────

export async function listPolicies(req, res, next) {
  try {
    const filter = sodTenantFilter(req.scopedTenantId);
    const q = String(req.query.q || "").trim();
    if (q) {
      const safe = escapeMongoRegex(q);
      filter.$or = [
        { name: { $regex: safe, $options: "i" } },
        { description: { $regex: safe, $options: "i" } },
        { policyId: { $regex: safe, $options: "i" } },
      ];
    }
    const sev = String(req.query.severity || "")
      .trim()
      .toUpperCase();
    if (sev && ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(sev)) {
      filter.severity = sev;
    }
    const st = String(req.query.status || "")
      .trim()
      .toLowerCase();
    if (st && ["draft", "active", "disabled"].includes(st)) {
      filter.status = st;
    }

    const sortFieldRaw = String(req.query.sortField || "createdAt");
    const sortDirNum =
      String(req.query.sortDir || "desc").toLowerCase() === "asc" ? 1 : -1;
    const allowedSort = new Set([
      "createdAt",
      "name",
      "severity",
      "status",
      "policyId",
      "totalViolations",
      "openViolations",
      "updatedAt",
    ]);
    const sf = allowedSort.has(sortFieldRaw) ? sortFieldRaw : "createdAt";
    const sort = { [sf]: sortDirNum };

    const rawPage = req.query.page;
    if (rawPage === undefined || rawPage === null || rawPage === "") {
      const policies = await SodPolicy.find(filter).sort(sort).lean();
      return res.json({ success: true, data: policies });
    }

    const page = Math.max(1, parseInt(String(rawPage), 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.limit || "25"), 10) || 25),
    );
    const skip = (page - 1) * limit;
    const [policies, total] = await Promise.all([
      SodPolicy.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      SodPolicy.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: policies,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function getPolicyStats(req, res, next) {
  try {
    const base = sodTenantFilter(req.scopedTenantId);
    const [total, active, bySeverity, totalViolations, openViolations] =
      await Promise.all([
        SodPolicy.countDocuments(base),
        SodPolicy.countDocuments({ ...base, status: "active" }),
        SodPolicy.aggregate([
          { $match: base },
          { $group: { _id: "$severity", count: { $sum: 1 } } },
        ]),
        SodViolation.countDocuments(base),
        SodViolation.countDocuments({ ...base, status: "open" }),
      ]);
    res.json({
      success: true,
      data: { total, active, bySeverity, totalViolations, openViolations },
    });
  } catch (e) {
    next(e);
  }
}

export async function getNextPolicyId(req, res, next) {
  try {
    const policyId = await nextPolicyIdForTenant(req.scopedTenantId);
    res.json({ success: true, data: { policyId } });
  } catch (e) {
    next(e);
  }
}

export async function getPolicyViolationSummary(req, res, next) {
  try {
    const id = req.params.id;
    if (!mongoose.isValidObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid policy id" });
    }
    const policyObjectId = new mongoose.Types.ObjectId(id);
    const groupByRaw = String(req.query.groupBy || "department")
      .trim()
      .toLowerCase();
    const groupBy = groupByRaw === "manager" ? "manager" : "department";
    const deptFilter = String(req.query.department || "")
      .trim()
      .toLowerCase();
    const managerFilter = String(req.query.manager || "")
      .trim()
      .toLowerCase();
    const base = {
      ...sodTenantFilter(req.scopedTenantId),
      policy: policyObjectId,
    };

    const rowsRaw = await SodViolation.find(base)
      .select(
        "status department identityEmail leftEntitlements rightEntitlements manager managerName managerEmail",
      )
      .lean();

    const [deptLookup, userLookup] = await Promise.all([
      buildDepartmentLookupForPolicy(req.scopedTenantId, policyObjectId),
      buildUserLookupForPolicy(req.scopedTenantId, policyObjectId),
    ]);

    let rows = await hydrateViolationIdentityLabels(
      enrichViolationRows(rowsRaw, deptLookup, userLookup),
    );

    if (deptFilter) {
      rows = rows.filter(
        (v) =>
          String(v.department || "")
            .trim()
            .toLowerCase() === deptFilter,
      );
    }
    if (managerFilter) {
      rows = rows.filter((v) => {
        const mgr = String(v.manager || v.managerName || "")
          .trim()
          .toLowerCase();
        const mgrEmail = String(v.managerEmail || "")
          .trim()
          .toLowerCase();
        return mgr === managerFilter || mgrEmail === managerFilter;
      });
    }

    const total = rows.length;
    const open = rows.filter((r) => r.status === "open").length;
    const remediated = rows.filter((r) => r.status === "remediated").length;
    const exceptionGranted = rows.filter(
      (r) => r.status === "exception_granted",
    ).length;
    const falsePositive = rows.filter(
      (r) => r.status === "false_positive",
    ).length;

    const byStatus = rows.reduce((acc, r) => {
      const k = String(r.status || "unknown");
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

    const byDepartment = groupViolationCountsByDepartment(
      rows.map((v) => ({
        department:
          String(v.department || "").trim() ||
          resolveDepartmentForViolationRow(v, deptLookup) ||
          "Unknown",
      })),
    );

    const byManager = groupViolationCountsByKey(
      rows.map((v) => ({
        manager:
          String(v.manager || v.managerName || "").trim() ||
          String(v.managerEmail || "").trim() ||
          "Unknown",
      })),
      "manager",
    );

    const countTop = (sideKey) => {
      const m = new Map();
      for (const r of rows) {
        const ent = Array.isArray(r?.[sideKey]) ? r[sideKey][0] : null;
        const name = String(ent?.name || ent?.id || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const hit = m.get(key) || { name, count: 0 };
        hit.count += 1;
        m.set(key, hit);
      }
      return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 10);
    };

    const topLeftEntitlements = countTop("leftEntitlements");
    const topRightEntitlements = countTop("rightEntitlements");

    const distinctUsers = new Set(
      rows
        .filter((r) => r.status === "open")
        .map((r) =>
          String(r.identityEmail || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );

    const availableDepartments = [
      ...new Set(
        rows.map((r) => String(r.department || "").trim()).filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b));
    const availableManagers = [
      ...new Set(
        rows
          .map((r) =>
            String(r.manager || r.managerName || r.managerEmail || "").trim(),
          )
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b));

    res.json({
      success: true,
      data: {
        total,
        open,
        remediated,
        exceptionGranted,
        falsePositive,
        affectedUsers: distinctUsers.size,
        byDepartment,
        byManager,
        byGroup: groupBy === "manager" ? byManager : byDepartment,
        groupBy,
        statusBreakdown: byStatus,
        availableDepartments,
        availableManagers,
        topLeftEntitlements,
        topRightEntitlements,
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function getPolicyById(req, res, next) {
  try {
    const p = await SodPolicy.findOne({
      ...sodTenantFilter(req.scopedTenantId),
      _id: req.params.id,
    }).lean();
    if (!p)
      return res
        .status(404)
        .json({ success: false, message: "Policy not found" });
    res.json({ success: true, data: p });
  } catch (e) {
    next(e);
  }
}

export async function createPolicy(req, res, next) {
  try {
    const parsed = sanitizePolicyPayload(req.body, {
      requireName: true,
      requireApplication: true,
    });
    if (!parsed.ok)
      return res.status(400).json({ success: false, message: parsed.message });
    const policyId = await nextPolicyIdForTenant(req.scopedTenantId);
    const name = parsed.value.name.trim();
    if (await policyNameExists(req.scopedTenantId, name)) {
      return res
        .status(409)
        .json({ success: false, message: "Policy name already exists" });
    }
    const created = await SodPolicy.create(
      sodWithTenant(req.scopedTenantId, {
        ...parsed.value,
        policyId,
        name,
        createdBy: req.user?.id,
      }),
    );
    await logSodAudit(sodCtx(req), {
      entityType: "POLICY",
      entityId: created._id,
      action: "CREATE",
      newValue: created,
    });
    res.status(201).json({ success: true, data: created });
  } catch (e) {
    next(e);
  }
}

export async function updatePolicy(req, res, next) {
  try {
    const parsed = sanitizePolicyPayload(req.body, {
      requireName: "name" in (req.body || {}),
      requireApplication: "applications" in (req.body || {}),
    });
    if (!parsed.ok)
      return res.status(400).json({ success: false, message: parsed.message });
    const nextName = parsed.value.name?.trim();
    if (
      nextName &&
      (await policyNameExists(req.scopedTenantId, nextName, {
        excludeId: req.params.id,
      }))
    ) {
      return res
        .status(409)
        .json({ success: false, message: "Policy name already exists" });
    }
    const before = await SodPolicy.findOne({
      ...sodTenantFilter(req.scopedTenantId),
      _id: req.params.id,
    }).lean();
    const updated = await SodPolicy.findOneAndUpdate(
      { ...sodTenantFilter(req.scopedTenantId), _id: req.params.id },
      { ...parsed.value, updatedBy: req.user?.id },
      { new: true, runValidators: true },
    );
    if (!updated)
      return res
        .status(404)
        .json({ success: false, message: "Policy not found" });
    await logSodAudit(sodCtx(req), {
      entityType: "POLICY",
      entityId: updated._id,
      action: "UPDATE",
      oldValue: before,
      newValue: updated,
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
}

export async function deletePolicy(req, res, next) {
  try {
    const policy = await SodPolicy.findOne({
      ...sodTenantFilter(req.scopedTenantId),
      _id: req.params.id,
    });
    if (!policy)
      return res
        .status(404)
        .json({ success: false, message: "Policy not found" });
    const oldValue = policy.toObject();
    await SodViolation.deleteMany({
      ...sodTenantFilter(req.scopedTenantId),
      policy: policy._id,
    });
    await SodException.deleteMany({
      ...sodTenantFilter(req.scopedTenantId),
      violationId: { $in: [] },
    }).catch(() => {});
    await policy.deleteOne();
    await logSodAudit(sodCtx(req), {
      entityType: "POLICY",
      entityId: policy._id,
      action: "DELETE",
      oldValue,
    });
    res.json({ success: true, message: "Policy deleted" });
  } catch (e) {
    next(e);
  }
}

export async function clonePolicy(req, res, next) {
  try {
    const orig = await SodPolicy.findOne({
      ...sodTenantFilter(req.scopedTenantId),
      _id: req.params.id,
    }).lean();
    if (!orig)
      return res
        .status(404)
        .json({ success: false, message: "Policy not found" });
    delete orig._id;
    delete orig.policyId;
    delete orig.lastScanDate;
    const policyId = await nextPolicyIdForTenant(req.scopedTenantId);
    let cloneName = `${orig.name} (Copy)`;
    let suffix = 2;
    while (await policyNameExists(req.scopedTenantId, cloneName)) {
      cloneName = `${orig.name} (Copy ${suffix})`;
      suffix += 1;
      if (suffix > 100) {
        return res
          .status(409)
          .json({ success: false, message: "Policy name already exists" });
      }
    }
    const clone = await SodPolicy.create(
      sodWithTenant(req.scopedTenantId, {
        ...orig,
        policyId,
        name: cloneName,
        status: "draft",
        totalViolations: 0,
        openViolations: 0,
        createdBy: req.user?.id,
      }),
    );
    await logSodAudit(sodCtx(req), {
      entityType: "POLICY",
      entityId: clone._id,
      action: "CREATE",
      newValue: clone,
    });
    res.status(201).json({ success: true, data: clone });
  } catch (e) {
    next(e);
  }
}

// ── Violations ─────────────────────────────────────────────────────────────

export async function listViolations(req, res, next) {
  try {
    const base = sodTenantFilter(req.scopedTenantId);
    const {
      page = 1,
      limit = 50,
      status,
      policyId,
      hasCertification,
      q: qRaw,
      department,
      manager,
      sortField,
      sortDir,
    } = req.query;
    const skip =
      (Math.max(1, parseInt(page, 10)) - 1) *
      Math.min(500, Math.max(1, parseInt(limit, 10)));
    const cap = Math.min(500, Math.max(1, parseInt(limit, 10)));

    const filter = { ...base };
    if (status) filter.status = status;
    if (policyId) {
      const pid = String(policyId).trim();
      if (mongoose.isValidObjectId(pid)) {
        filter.policy = new mongoose.Types.ObjectId(pid);
      } else if (/^POL-\d+$/i.test(pid)) {
        const pol = await SodPolicy.findOne({
          ...base,
          policyId: new RegExp(`^${pid}$`, "i"),
        })
          .select("_id")
          .lean();
        if (pol) filter.policy = pol._id;
        else filter.policyName = { $regex: pid, $options: "i" };
      } else {
        filter.policyName = { $regex: pid, $options: "i" };
      }
    }
    const q = String(qRaw || "").trim();
    if (q) {
      const safe = escapeMongoRegex(q);
      const textOr = [
        { identityName: { $regex: safe, $options: "i" } },
        { identityEmail: { $regex: safe, $options: "i" } },
        { department: { $regex: safe, $options: "i" } },
        { ruleName: { $regex: safe, $options: "i" } },
      ];
      filter.$and = [...(filter.$and || []), { $or: textOr }];
    }
    if (hasCertification === "true")
      filter.certificationId = { $exists: true, $ne: null };
    if (hasCertification === "false") {
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [
            { certificationId: { $exists: false } },
            { certificationId: null },
          ],
        },
      ];
    }

    const sortFieldRaw = String(sortField || "detectedAt");
    const sortDirNum =
      String(sortDir || "desc").toLowerCase() === "asc" ? 1 : -1;
    const allowedSort = new Set([
      "detectedAt",
      "identityName",
      "identityEmail",
      "department",
      "status",
    ]);
    const sf = allowedSort.has(sortFieldRaw) ? sortFieldRaw : "detectedAt";
    const sort = { [sf]: sortDirNum };

    let rows;
    let total;

    const needsEnrichedFiltering = Boolean(
      String(department || "").trim() || String(manager || "").trim(),
    );

    if (
      needsEnrichedFiltering &&
      filter.policy &&
      mongoose.isValidObjectId(String(filter.policy))
    ) {
      const [rowsAllRaw, deptLookup, userLookup] = await Promise.all([
        SodViolation.find(filter).sort(sort).lean(),
        buildDepartmentLookupForPolicy(req.scopedTenantId, filter.policy),
        buildUserLookupForPolicy(req.scopedTenantId, filter.policy),
      ]);

      const rowsEnriched = await hydrateViolationIdentityLabels(
        enrichViolationRows(rowsAllRaw, deptLookup, userLookup),
      );
      const dep = String(department || "")
        .trim()
        .toLowerCase();
      const mgr = String(manager || "")
        .trim()
        .toLowerCase();
      const filteredRows = rowsEnriched.filter((r) => {
        const depOk =
          !dep ||
          String(r.department || "")
            .trim()
            .toLowerCase() === dep;
        const mgrName = String(r.manager || r.managerName || "")
          .trim()
          .toLowerCase();
        const mgrEmail = String(r.managerEmail || "")
          .trim()
          .toLowerCase();
        const mgrOk = !mgr || mgrName === mgr || mgrEmail === mgr;
        return depOk && mgrOk;
      });

      total = filteredRows.length;
      rows = filteredRows.slice(skip, skip + cap);
    } else {
      const [rowsRaw, baseTotal] = await Promise.all([
        SodViolation.find(filter).sort(sort).skip(skip).limit(cap).lean(),
        SodViolation.countDocuments(filter),
      ]);
      total = baseTotal;
      rows = rowsRaw;
      if (filter.policy && mongoose.isValidObjectId(String(filter.policy))) {
        const [deptLookup, userLookup] = await Promise.all([
          buildDepartmentLookupForPolicy(req.scopedTenantId, filter.policy),
          buildUserLookupForPolicy(req.scopedTenantId, filter.policy),
        ]);
        rows = await hydrateViolationIdentityLabels(
          enrichViolationRows(rowsRaw, deptLookup, userLookup),
        );
      }
    }

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page, 10),
        limit: cap,
        total,
        pages: Math.ceil(total / cap),
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function getViolationById(req, res, next) {
  try {
    const v = await SodViolation.findOne({
      ...sodTenantFilter(req.scopedTenantId),
      _id: req.params.id,
    }).lean();
    if (!v)
      return res
        .status(404)
        .json({ success: false, message: "Violation not found" });
    const [exceptions, remediations] = await Promise.all([
      SodException.find({
        ...sodTenantFilter(req.scopedTenantId),
        violationId: v._id,
      }).lean(),
      SodRemediationAction.find({
        ...sodTenantFilter(req.scopedTenantId),
        violationId: v._id,
      }).lean(),
    ]);
    res.json({ success: true, data: { ...v, exceptions, remediations } });
  } catch (e) {
    next(e);
  }
}

export async function patchViolationStatus(req, res, next) {
  try {
    const { status, comment } = req.body || {};
    const before = await SodViolation.findOne({
      ...sodTenantFilter(req.scopedTenantId),
      _id: req.params.id,
    }).lean();
    const updated = await SodViolation.findOneAndUpdate(
      { ...sodTenantFilter(req.scopedTenantId), _id: req.params.id },
      { status, remediationNotes: comment || undefined },
      { new: true },
    );
    if (!updated)
      return res
        .status(404)
        .json({ success: false, message: "Violation not found" });
    await logSodAudit(sodCtx(req), {
      entityType: "VIOLATION",
      entityId: updated._id,
      action: "UPDATE",
      oldValue: before,
      newValue: updated,
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
}

export async function bulkUpdateViolations(req, res, next) {
  try {
    const { violationIds, status, comment } = req.body || {};
    const ids = Array.isArray(violationIds) ? violationIds.filter(Boolean) : [];
    const result = await SodViolation.updateMany(
      {
        ...sodTenantFilter(req.scopedTenantId),
        _id: {
          $in: ids
            .map((x) => (mongoose.isValidObjectId(x) ? x : null))
            .filter(Boolean),
        },
      },
      { $set: { status, remediationNotes: comment || undefined } },
    );
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (e) {
    next(e);
  }
}

// ── Exceptions ───────────────────────────────────────────────────────────────

export async function listExceptions(req, res, next) {
  try {
    const base = sodTenantFilter(req.scopedTenantId);
    const { violationId, status, page = 1, limit = 50 } = req.query;
    const filter = { ...base };
    if (violationId && mongoose.isValidObjectId(violationId))
      filter.violationId = violationId;
    if (status) filter.exceptionStatus = status;
    const skip =
      (Math.max(1, parseInt(page, 10)) - 1) *
      Math.min(500, Math.max(1, parseInt(limit, 10)));
    const cap = Math.min(500, Math.max(1, parseInt(limit, 10)));
    const [rows, total] = await Promise.all([
      SodException.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(cap)
        .lean(),
      SodException.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page, 10),
        limit: cap,
        total,
        pages: Math.ceil(total / cap),
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function createException(req, res, next) {
  try {
    const {
      violationId,
      exceptionReason,
      compensatingControl,
      validFrom,
      validTo,
    } = req.body || {};
    if (!violationId || !mongoose.isValidObjectId(violationId)) {
      return res
        .status(400)
        .json({ success: false, message: "violationId is required" });
    }
    const exception = await SodException.create(
      sodWithTenant(req.scopedTenantId, {
        violationId,
        exceptionReason,
        compensatingControl: compensatingControl || "",
        approvedBy: req.user?.email || req.user?.id || "api",
        validFrom: validFrom ? new Date(validFrom) : new Date(),
        validTo: validTo
          ? new Date(validTo)
          : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      }),
    );
    await logSodAudit(sodCtx(req), {
      entityType: "EXCEPTION",
      entityId: exception._id,
      action: "CREATE",
      newValue: exception,
    });
    await SodViolation.updateOne(
      { ...sodTenantFilter(req.scopedTenantId), _id: violationId },
      { $set: { status: "exception_granted" } },
    ).catch(() => {});
    res.status(201).json({ success: true, data: exception });
  } catch (e) {
    next(e);
  }
}

export async function revokeException(req, res, next) {
  try {
    const ex = await SodException.findOne({
      ...sodTenantFilter(req.scopedTenantId),
      _id: req.params.id,
    });
    if (!ex)
      return res
        .status(404)
        .json({ success: false, message: "Exception not found" });
    ex.exceptionStatus = "REVOKED";
    await ex.save();
    await logSodAudit(sodCtx(req), {
      entityType: "EXCEPTION",
      entityId: ex._id,
      action: "UPDATE",
      newValue: ex,
    });
    res.json({ success: true, data: ex });
  } catch (e) {
    next(e);
  }
}

export async function extendException(req, res, next) {
  try {
    const { validTo } = req.body || {};
    const ex = await SodException.findOne({
      ...sodTenantFilter(req.scopedTenantId),
      _id: req.params.id,
    });
    if (!ex)
      return res
        .status(404)
        .json({ success: false, message: "Exception not found" });
    ex.validTo = new Date(validTo);
    ex.exceptionStatus = "ACTIVE";
    await ex.save();
    await logSodAudit(sodCtx(req), {
      entityType: "EXCEPTION",
      entityId: ex._id,
      action: "UPDATE",
      newValue: ex,
    });
    res.json({ success: true, data: ex });
  } catch (e) {
    next(e);
  }
}

// ── Remediations ─────────────────────────────────────────────────────────────

export async function listRemediations(req, res, next) {
  try {
    const base = sodTenantFilter(req.scopedTenantId);
    const { violationId, status, page = 1, limit = 50 } = req.query;
    const filter = { ...base };
    if (violationId && mongoose.isValidObjectId(violationId))
      filter.violationId = violationId;
    if (status) filter.actionStatus = status;
    const skip =
      (Math.max(1, parseInt(page, 10)) - 1) *
      Math.min(500, Math.max(1, parseInt(limit, 10)));
    const cap = Math.min(500, Math.max(1, parseInt(limit, 10)));
    const [rows, total] = await Promise.all([
      SodRemediationAction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(cap)
        .lean(),
      SodRemediationAction.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page, 10),
        limit: cap,
        total,
        pages: Math.ceil(total / cap),
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function createRemediation(req, res, next) {
  try {
    const { violationId, remediationType, assignedTo, targetDate } =
      req.body || {};
    if (!violationId || !mongoose.isValidObjectId(violationId)) {
      return res
        .status(400)
        .json({ success: false, message: "violationId is required" });
    }
    const action = await SodRemediationAction.create(
      sodWithTenant(req.scopedTenantId, {
        violationId,
        remediationType,
        assignedTo: assignedTo || req.user?.email || "unassigned",
        targetDate: targetDate
          ? new Date(targetDate)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        actionStatus: "OPEN",
      }),
    );
    await SodViolation.updateOne(
      { ...sodTenantFilter(req.scopedTenantId), _id: violationId },
      { $set: { status: "remediated" } },
    ).catch(() => {});
    await logSodAudit(sodCtx(req), {
      entityType: "REMEDIATION",
      entityId: action._id,
      action: "CREATE",
      newValue: action,
    });
    res.status(201).json({ success: true, data: action });
  } catch (e) {
    next(e);
  }
}

export async function patchRemediation(req, res, next) {
  try {
    const before = await SodRemediationAction.findOne({
      ...sodTenantFilter(req.scopedTenantId),
      _id: req.params.id,
    }).lean();
    const updated = await SodRemediationAction.findOneAndUpdate(
      { ...sodTenantFilter(req.scopedTenantId), _id: req.params.id },
      req.body || {},
      { new: true },
    );
    if (!updated)
      return res
        .status(404)
        .json({ success: false, message: "Remediation not found" });
    await logSodAudit(sodCtx(req), {
      entityType: "REMEDIATION",
      entityId: updated._id,
      action: "UPDATE",
      oldValue: before,
      newValue: updated,
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboard(req, res, next) {
  try {
    const base = sodTenantFilter(req.scopedTenantId);
    const [
      totalPolicies,
      activePolicies,
      totalViolations,
      openViolations,
      mitigatedViolations,
      exceptionsGranted,
      pendingRemediations,
      violationsByRisk,
      violationsByPolicy,
      recentViolations,
      exceptionStats,
    ] = await Promise.all([
      SodPolicy.countDocuments(base),
      SodPolicy.countDocuments({ ...base, status: "active" }),
      SodViolation.countDocuments(base),
      SodViolation.countDocuments({ ...base, status: "open" }),
      SodViolation.countDocuments({ ...base, status: "remediated" }),
      SodViolation.countDocuments({ ...base, status: "exception_granted" }),
      SodRemediationAction.countDocuments({
        ...base,
        actionStatus: { $in: ["OPEN", "IN_PROGRESS"] },
      }),
      SodViolation.aggregate([
        { $match: base },
        { $group: { _id: "$severity", count: { $sum: 1 } } },
      ]),
      SodViolation.aggregate([
        { $match: base },
        { $group: { _id: "$policyName", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      SodViolation.find(base).sort({ detectedAt: -1 }).limit(10).lean(),
      SodException.aggregate([
        { $match: base },
        { $group: { _id: "$exceptionStatus", count: { $sum: 1 } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        summary: {
          totalPolicies,
          activePolicies,
          totalViolations,
          openViolations,
          mitigatedViolations,
          exceptionsGranted,
          pendingRemediations,
        },
        violationsByRisk: violationsByRisk.reduce(
          (acc, v) => ({ ...acc, [v._id || "Unknown"]: v.count }),
          {},
        ),
        topViolatingPolicies: violationsByPolicy.map((v) => ({
          policyId: v._id,
          policyName: v._id,
          count: v.count,
        })),
        recentViolations,
        exceptionStats: exceptionStats.reduce(
          (acc, v) => ({ ...acc, [v._id]: v.count }),
          {},
        ),
      },
    });
  } catch (e) {
    next(e);
  }
}

// ── Certification helpers ───────────────────────────────────────────────────

export async function getCertificationApplications(req, res, next) {
  try {
    const policies = await SodPolicy.find(
      sodTenantFilter(req.scopedTenantId),
    ).lean();
    const appIds = new Set();
    for (const p of policies) {
      for (const id of p.applications || []) appIds.add(String(id));
    }
    const apps = await Application.find({
      _id: { $in: [...appIds].filter((x) => mongoose.isValidObjectId(x)) },
    })
      .select("_id applicationName name displayName")
      .lean();
    const appNameById = new Map(
      apps.map((a) => [String(a._id), resolveApplicationName(a)]),
    );

    const grouped = new Map();
    for (const p of policies) {
      const ids = (p.applications || []).map((x) => String(x));
      const key = ids[0] || "unknown";
      const appName =
        appNameById.get(key) || p.applicationNames?.[0] || "Unknown";
      if (!grouped.has(key))
        grouped.set(key, {
          applicationId: key,
          applicationName: appName,
          policies: [],
        });
      grouped.get(key).policies.push({
        _id: p._id,
        name: p.name,
        description: p.description,
        severity: p.severity,
        status: p.status,
      });
    }

    res.json({ success: true, data: [...grouped.values()] });
  } catch (e) {
    next(e);
  }
}

export async function getCertificationPoliciesByApp(req, res, next) {
  try {
    const appId = req.params.appId;
    const filter = { ...sodTenantFilter(req.scopedTenantId) };
    if (mongoose.isValidObjectId(appId)) {
      filter.applications = new mongoose.Types.ObjectId(appId);
    } else {
      filter.applicationNames = { $in: [appId] };
    }
    const policies = await SodPolicy.find(filter).lean();
    res.json({
      success: true,
      data: { applicationId: appId, policies, totalPolicies: policies.length },
    });
  } catch (e) {
    next(e);
  }
}

export async function getCertificationViolations(req, res, next) {
  try {
    const { policyIds } = req.body || {};
    const ids = Array.isArray(policyIds)
      ? policyIds.filter((x) => mongoose.isValidObjectId(x))
      : [];
    const policies = await SodPolicy.find({
      ...sodTenantFilter(req.scopedTenantId),
      _id: { $in: ids },
    })
      .select("_id name")
      .lean();
    const nameById = new Map(policies.map((p) => [String(p._id), p.name]));
    const violations = await SodViolation.find({
      ...sodTenantFilter(req.scopedTenantId),
      policy: { $in: ids },
    }).lean();
    const enriched = violations.map((v) => ({
      ...v,
      policyName: v.policyName || nameById.get(String(v.policy)) || "Policy",
    }));
    res.json({ success: true, data: enriched, count: enriched.length });
  } catch (e) {
    next(e);
  }
}

export async function getCertificationManagers(req, res, next) {
  try {
    const rows = await SodUserIdentity.find({
      ...sodTenantFilter(req.scopedTenantId),
      email: { $exists: true, $ne: "" },
      status: "Active",
    })
      .select(
        "userId displayName email department title isManager managerName managerEmail",
      )
      .limit(500)
      .lean();
    res.json({ success: true, data: rows, count: rows.length });
  } catch (e) {
    next(e);
  }
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export async function runEvaluation(req, res, next) {
  try {
    const base = sodTenantFilter(req.scopedTenantId);
    const { policyMongoId, includeDrafts } = req.body || {};
    let policies = [];
    let skippedDraftPolicies = 0;

    if (policyMongoId && mongoose.isValidObjectId(String(policyMongoId))) {
      const p = await SodPolicy.findOne({ ...base, _id: policyMongoId }).lean();
      if (!p)
        return res
          .status(404)
          .json({ success: false, message: "Policy not found" });
      if (!["active", "draft"].includes(p.status)) {
        return res.status(400).json({
          success: false,
          message: "Only active or draft policies can be evaluated.",
        });
      }
      policies = [p];
    } else {
      const statusQ = includeDrafts ? { $in: ["active", "draft"] } : "active";
      policies = await SodPolicy.find({ ...base, status: statusQ }).lean();
      if (!includeDrafts) {
        skippedDraftPolicies = await SodPolicy.countDocuments({
          ...base,
          status: "draft",
        });
      }
    }

    const { created, scannedPolicies, autoResolved } =
      await runSodEvaluationForPolicies(sodCtx(req), policies);

    let postEvalStats = {};
    if (policyMongoId && mongoose.isValidObjectId(String(policyMongoId))) {
      const policyOid = new mongoose.Types.ObjectId(String(policyMongoId));
      const [totalViolations, openViolations] = await Promise.all([
        SodViolation.countDocuments({ ...base, policy: policyOid }),
        SodViolation.countDocuments({
          ...base,
          policy: policyOid,
          status: "open",
        }),
      ]);
      postEvalStats = { totalViolations, openViolations };
    }

    res.json({
      success: true,
      message: "SoD evaluation completed",
      stats: {
        scannedPolicies,
        violationsCreated: created,
        violationsAutoResolved: autoResolved,
        skippedDraftPolicies,
        evaluatedPolicyCount: policies.length,
        ...postEvalStats,
      },
    });
  } catch (e) {
    next(e);
  }
}

// ── App entitlements (policy builder) ───────────────────────────────────────

export async function getApplicationEntitlementsForSod(req, res, next) {
  try {
    const { appId } = req.params;
    if (!mongoose.isValidObjectId(appId)) {
      return res.status(400).json({ success: false, message: "Invalid appId" });
    }
    const appObjectId = new mongoose.Types.ObjectId(appId);
    const app = await Application.findById(appObjectId)
      .select("_id name applicationName displayName")
      .lean();
    const appName = resolveApplicationName(app) || "";

    const sodFilter = {
      ...sodTenantFilter(req.scopedTenantId),
      applicationId: appObjectId,
    };
    const sodRows = await SodEntitlement.find(sodFilter).limit(5000).lean();
    if (sodRows.length) {
      const normalized = sodRows
        .map((row) => normalizeEntitlementForBuilder(row, appName))
        .filter(Boolean);
      return res.json({
        success: true,
        count: normalized.length,
        data: normalized,
      });
    }

    const tenantIdRaw = req.scopedTenantId ? String(req.scopedTenantId) : null;
    const entitlementFilter = { applicationId: appObjectId };
    if (tenantIdRaw) {
      entitlementFilter.$or = [{ tenantId: tenantIdRaw }];
      if (mongoose.isValidObjectId(tenantIdRaw)) {
        entitlementFilter.$or.push({
          tenantId: new mongoose.Types.ObjectId(tenantIdRaw),
        });
      }
    }
    const coreRows = await Entitlement.find(entitlementFilter)
      .limit(5000)
      .lean();
    if (coreRows.length) {
      const normalized = coreRows
        .map((row) => normalizeEntitlementForBuilder(row, appName))
        .filter(Boolean);
      return res.json({
        success: true,
        count: normalized.length,
        data: normalized,
      });
    }

    const tenantSlug = await resolveTenantSlugFromTenantId(req.scopedTenantId);
    const collectionName = getAppEntitlementsCollectionName(
      appName,
      tenantSlug,
    );
    const db = mongoose.connection?.db;
    if (db && appName) {
      const exists = await db
        .listCollections({ name: collectionName })
        .hasNext();
      if (exists) {
        const rows = await db
          .collection(collectionName)
          .find({})
          .limit(5000)
          .toArray();
        const normalized = rows
          .map((row) => normalizeEntitlementForBuilder(row, appName))
          .filter(Boolean);
        return res.json({
          success: true,
          count: normalized.length,
          data: normalized,
        });
      }
    }

    res.json({ success: true, count: 0, data: [] });
  } catch (e) {
    next(e);
  }
}

// ── Audit logs ───────────────────────────────────────────────────────────────

export async function listSodAuditLogs(req, res, next) {
  try {
    const { page = 1, limit = 100 } = req.query;
    const skip =
      (Math.max(1, parseInt(page, 10)) - 1) *
      Math.min(1000, Math.max(1, parseInt(limit, 10)));
    const cap = Math.min(1000, Math.max(1, parseInt(limit, 10)));
    const filter = sodTenantFilter(req.scopedTenantId);
    const [rows, total] = await Promise.all([
      SodAuditLog.find(filter)
        .sort({ performedAt: -1 })
        .skip(skip)
        .limit(cap)
        .lean(),
      SodAuditLog.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page, 10),
        limit: cap,
        total,
        pages: Math.ceil(total / cap),
      },
    });
  } catch (e) {
    next(e);
  }
}

export function sodHealth(_req, res) {
  res.json({
    status: "ok",
    service: "sod",
    timestamp: new Date().toISOString(),
  });
}
