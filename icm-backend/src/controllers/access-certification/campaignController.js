import mongoose from "mongoose";
import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import Application from "../../models/application/Application.js";
import User from "../../models/platform/User.js";
import CertificationProfile from "../../models/certification/CertificationProfile.js";
import CertificationProfileSnapshot from "../../models/certification/CertificationProfileSnapshot.js";
import { AppError } from "../../middleware/errorHandler.js";
import { resolveCertificationAccessTenantId as resolveUserTenantId } from "../../utils/access-certification/resolveCertificationAccessTenantId.js";
import { getTenantCampaignScopeQuery } from "../../utils/access-certification/certificationTenantScope.js";
import {
  generateReviewItems,
  countReviewItemsForCampaign,
  countEntitlementsInReviewItems,
  mergeReviewItemsIntoScopeData,
  buildEntitlementProgressMaps,
  enrichReviewerNamesForReviewItems,
  getReviewItemsByCampaign,
} from "../../services/access-certification/reviewItemService.js";
import { generateReviewerToken } from "../../services/access-certification/certificationTokenService.js";
import { buildCertificationAssignmentEmail } from "../../services/email/appEmailService.js";
import { enqueueCertificationEmail } from "../../services/email/emailJobService.js";
import { buildReviewerAssignmentMap, buildReviewerEmailTokens, loadScopeRowsForCampaign } from "../../services/access-certification/certificationScopeService.js";
import { ingestRevokeAccessFromCampaign } from "../../services/remediation/remediationQueueIngestionService.js";
import {
  asObjectId, getUserId, normalizeText, assertTenantForCampaign, assertTenantForApplication,
  normalizeCampaignApplication, resolveAndApplyCertificationProfileDefaults, computeCampaignAnalytics,
  resolveCertificationUserModel, getApplicationTenantId, getTenantApplicationIds,
  FINAL_DECISIONS_SET, PROFILE_LEVEL_SUPPORTED_CATEGORIES,
} from "./certificationControllerHelpers.js";
import IdentityProfile from "../../models/identity/IdentityProfile.js";
import Identity from "../../models/identity/Identity.js";
import { getDynamicEntitlementModelForTenantId } from "../../models/application/Entitlements.js";
import { tokenizeAndNormalize } from "../../utils/accessMemberOfTokens.js";
import { resolveMappedUserModel } from "../../utils/access-certification/mappedUserResolver.js";
import { pickFromRawData } from "../../utils/access-certification/certificationUserDisplay.js";
import { applicationIdInClause } from "../../services/application/applicationUserIngestService.js";
import { getAppCorrelationCollectionName } from "../../utils/applicationDynamicCollections.js";
import { extractEntitlementTokensFromAppUser } from "../../utils/sod/sodAppUserEntitlements.js";

/**
 * Per-entitlement assigned-user counts for Access Scope.
 * Correlation-first (same as catalog insights), then token scan of loaded users.
 * @returns {Map<string, number>} keyed by String(entitlement._id)
 */
async function buildEntitlementAssignedUserCounts({
  application,
  appId,
  entitlements,
  users,
}) {
  const assignedByEntId = new Map();
  const list = Array.isArray(entitlements) ? entitlements : [];
  if (!list.length) return assignedByEntId;

  const appOid =
    appId instanceof mongoose.Types.ObjectId
      ? appId
      : mongoose.Types.ObjectId.isValid(String(appId))
        ? new mongoose.Types.ObjectId(String(appId))
        : null;

  // 1) Correlation aggregate
  if (application?.name && appOid) {
    try {
      const db = mongoose.connection.db;
      const corrColl = getAppCorrelationCollectionName(application.name);
      const entIds = list
        .map((e) => e._id)
        .filter(Boolean)
        .map((id) =>
          id instanceof mongoose.Types.ObjectId
            ? id
            : mongoose.Types.ObjectId.isValid(String(id))
              ? new mongoose.Types.ObjectId(String(id))
              : null,
        )
        .filter(Boolean);
      const entIdStrs = entIds.map((id) => String(id));
      if (entIds.length) {
        const agg = await db
          .collection(corrColl)
          .aggregate([
            {
              $match: {
                applicationId: applicationIdInClause(appOid),
                entitlementId: { $in: [...entIds, ...entIdStrs] },
              },
            },
            {
              $group: {
                _id: { $toString: "$entitlementId" },
                users: { $addToSet: "$userId" },
              },
            },
            { $project: { count: { $size: "$users" } } },
          ])
          .toArray();
        for (const row of agg || []) {
          assignedByEntId.set(String(row._id), Number(row.count) || 0);
        }
      }
    } catch {
      // correlation collection may not exist for delimited apps
    }
  }

  // 2) Fallback: scan already-loaded users with SoD/catalog token extractor
  const needsScan = list.some(
    (e) => e._id != null && !assignedByEntId.get(String(e._id)),
  );
  if (needsScan && Array.isArray(users) && users.length) {
    const tokenToEntIds = new Map();
    for (const e of list) {
      if (e._id == null) continue;
      const eid = String(e._id);
      if (assignedByEntId.get(eid)) continue;
      const raw = e.rawData && typeof e.rawData === "object" ? e.rawData : {};
      const tokens = [
        e.entitlement_name,
        e.entitlement_id,
        e.displayName,
        e.display_name,
        e.name,
        e.entitlementName,
        raw.entitlement_name,
        raw.entitlement_id,
        raw.name,
        eid,
      ]
        .map((t) => String(t || "").trim().toLowerCase())
        .filter(Boolean);
      for (const t of tokens) {
        if (!tokenToEntIds.has(t)) tokenToEntIds.set(t, new Set());
        tokenToEntIds.get(t).add(eid);
      }
    }

    const holderSets = new Map();
    for (const e of list) {
      if (e._id == null) continue;
      const eid = String(e._id);
      if (!assignedByEntId.get(eid)) holderSets.set(eid, new Set());
    }

    const maxScan = Math.min(users.length, 50000);
    for (let i = 0; i < maxScan; i += 1) {
      const user = users[i];
      const raw =
        user?.rawData && typeof user.rawData === "object" ? user.rawData : {};
      const tokens = extractEntitlementTokensFromAppUser(user, raw);
      const uid = String(user?._id ?? i);
      for (const tok of tokens) {
        const entIdsForTok = tokenToEntIds.get(
          String(tok).trim().toLowerCase(),
        );
        if (!entIdsForTok) continue;
        for (const eid of entIdsForTok) {
          if (!assignedByEntId.get(eid)) holderSets.get(eid)?.add(uid);
        }
      }
    }

    for (const [eid, set] of holderSets) {
      if (!assignedByEntId.get(eid) && set.size) {
        assignedByEntId.set(eid, set.size);
      }
    }
  }

  return assignedByEntId;
}

async function computeNoAccessAnalytics(campaignId) {
  if (!campaignId) {
    return { totalIdentities: 0, withAccess: 0, withoutAccess: 0, pendingReview: 0 };
  }

  const [rows, pendingReview] = await Promise.all([
    ReviewItem.aggregate([
      { $match: { campaignId } },
      {
        $group: {
          _id: "$reviewItemType",
          identities: { $addToSet: "$userId" },
        },
      },
      { $project: { _id: 1, identityCount: { $size: "$identities" } } },
    ]),
    ReviewItem.countDocuments({ campaignId, status: "PENDING" }),
  ]);

  const byType = new Map((rows || []).map((r) => [String(r._id || ""), r]));
  const withAccess = Number(byType.get("ENTITLEMENT")?.identityCount || 0);
  const withoutAccess = Number(byType.get("NO_ACCESS")?.identityCount || 0);
  return {
    totalIdentities: withAccess + withoutAccess,
    withAccess,
    withoutAccess,
    pendingReview: Number(pendingReview || 0),
  };
}

function composeUserDisplayName(user = {}) {
  const firstName = normalizeText(user.firstName);
  const lastName = normalizeText(user.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;

  const directName = normalizeText(
    user.displayName || user.name || user.reviewerName || user.createdByDisplay,
  );
  if (directName) return directName;

  return normalizeText(user.email || user.reviewerEmail);
}

function mapReviewerAssignment(reviewer = {}) {
  const reviewerId = reviewer?.reviewerId?._id || reviewer?.reviewerId || null;
  const reviewerEmail = normalizeText(
    reviewer?.reviewerEmail || reviewer?.email || reviewer?.reviewerId?.email,
  );

  const reviewerName =
    composeUserDisplayName({
      firstName: reviewer?.reviewerId?.firstName,
      lastName: reviewer?.reviewerId?.lastName,
      email: reviewer?.reviewerId?.email || reviewerEmail,
      name: reviewer?.name || reviewer?.reviewerName,
    }) ||
    reviewerEmail ||
    "Unknown";

  return {
    ...reviewer,
    reviewerId,
    reviewerType: reviewer?.reviewerType || null,
    reviewerEmail: reviewerEmail || null,
    reviewerName,
  };
}

function resolveUserEmail(user, raw) {
  return (
    user?.email ||
    raw["Email Address"] ||
    raw.email ||
    raw.mail ||
    pickFromRawData(raw, "email", "mail") ||
    ""
  );
}

function resolveUserManager(user, raw) {
  return (
    raw.Manager ||
    raw.manager ||
    user?.manager_name ||
    user?.manager ||
    raw["Manager Distinguished Name"] ||
    pickFromRawData(
      raw,
      "manager",
      "supervisor_name",
      "supervisor",
      "mgr",
      "reports_to",
      "parent_user",
      "parent",
    ) ||
    ""
  );
}

function resolveUserManagerEmail(user, raw) {
  return (
    raw["Manager Email Address"] ||
    user?.manager_email ||
    raw.managerEmail ||
    user?.managerEmail ||
    pickFromRawData(
      raw,
      "manager_email",
      "manager_mail",
      "supervisor_email",
      "mgr_email",
    ) ||
    ""
  );
}

function pickRawManagerForeignKey(raw) {
  const r = raw || {};
  return (
    pickFromRawData(
      r,
      "manager_id",
      "managerid",
      "reports_to",
      "supervisor_id",
      "mgr_id",
      "manager_uid",
      "parent_user",
    ) ||
    r.manager_uid ||
    r.ManagerId ||
    r.ReportsToId ||
    ""
  );
}

function collectIdentityPoolKeys(user, raw) {
  const r = raw || {};
  const set = new Set(
    [
      user._id?.toString(),
      user.user_id,
      user.primaryKey,
      user.email,
      user.display_name,
      resolveUserEmail(user, r),
      r["Employee ID"],
      r.employee_id,
      r.Id,
      r.UserId,
      r.FederationIdentifier,
      pickFromRawData(r, "email", "mail"),
      pickFromRawData(
        r,
        "username",
        "user_name",
        "oracle_user",
        "tableau_user",
        "account_id",
        "account",
        "login",
        "samaccount",
        "federation",
        "alias",
        "nickname",
        "external_id",
      ),
    ]
      .map((v) => String(v || "").trim())
      .filter(Boolean),
  );
  return [...set].filter(Boolean);
}

function findAppUserEmailByRecordId(appUsers, token) {
  const t = String(token || "")
    .trim()
    .toLowerCase();
  if (!t) return "";
  for (const cand of appUsers || []) {
    const cr = cand.rawData || {};
    const ids = [
      cand._id?.toString(),
      cr.Id,
      cr.UserId,
      cr.id,
      cr.User_ID,
      pickFromRawData(cr, "userid", "sf_id", "external_id"),
    ]
      .map((x) =>
        String(x || "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean);
    if (!ids.includes(t)) continue;
    const em = String(resolveUserEmail(cand, cr) || cand.email || "")
      .trim()
      .toLowerCase();
    if (em.includes("@")) return em;
  }
  return "";
}

function cleanManagerName(value) {
  if (!value) return "";
  const v = String(value).trim();
  const dnMatch = v.match(/CN=([^,]+)/i);
  if (dnMatch) return dnMatch[1].trim();
  if (v.includes(",") && v.split(",").length === 2) {
    const [last, first] = v.split(",").map((s) => s.trim());
    if (first && last) return `${first} ${last}`;
  }
  return v;
}

function resolveUserTitle(raw) {
  return (
    raw.Title ||
    raw.title ||
    raw["Job Title"] ||
    raw.job_title ||
    raw.Role ||
    raw.role ||
    pickFromRawData(raw, "title", "position", "job", "designation", "role") ||
    ""
  );
}

function resolveUserDepartment(raw) {
  return (
    raw.Department ||
    raw.department ||
    pickFromRawData(
      raw,
      "department",
      "dept",
      "division",
      "kostl",
      "org",
      "operating_unit",
      "unit",
      "business_unit",
    ) ||
    ""
  );
}

function extractManagersFromUsers(users, allUsersForPool) {
  const mgrMap = new Map();
  const keyFor = (name) => (name || "").trim().toLowerCase();

  const poolSource =
    allUsersForPool && allUsersForPool.length > 0 ? allUsersForPool : users;
  const userEmailByKey = new Map();
  for (const u of poolSource || []) {
    const raw = u.rawData || u._originalData || {};
    const email = String(resolveUserEmail(u, raw) || "")
      .trim()
      .toLowerCase();
    if (!email || !email.includes("@")) continue;
    for (const key of collectIdentityPoolKeys(u, raw)) {
      const kk = String(key).trim().toLowerCase();
      if (kk) userEmailByKey.set(kk, email);
    }
  }

  for (const u of users || []) {
    const raw = u.rawData || u._originalData || {};

    const rawManager = resolveUserManager(u, raw);
    const mgrName = cleanManagerName(rawManager);
    if (!mgrName) continue;

    let mgrEmail = resolveUserManagerEmail(u, raw);

    if (!mgrEmail) {
      const mgrIdRaw = pickRawManagerForeignKey(raw) || u?.manager_id || "";
      const mgrIdKey = mgrIdRaw.trim().toLowerCase();
      if (mgrIdKey) {
        mgrEmail =
          userEmailByKey.get(mgrIdKey) ||
          findAppUserEmailByRecordId(poolSource, mgrIdKey) ||
          "";
      }
    }
    if (!mgrEmail) {
      const mgrNameKey = mgrName.toLowerCase().replace(/\s+/g, ".");
      mgrEmail = userEmailByKey.get(mgrNameKey) || "";
    }

    const key = mgrEmail
      ? `email::${mgrEmail.toLowerCase()}`
      : `name::${keyFor(mgrName)}`;

    if (!mgrMap.has(key)) {
      mgrMap.set(key, {
        id: `mgr_${key.replace(/[^a-z0-9]/g, "_")}`,
        name: mgrName,
        emails: new Set(),
        titles: new Set(),
        departments: new Set(),
        companies: new Set(),
        directReportsCount: 0,
        reports: [],
      });
    }
    const mgr = mgrMap.get(key);
    if (mgrEmail) mgr.emails.add(mgrEmail);
    const userTitle = resolveUserTitle(raw);
    const userDept = resolveUserDepartment(raw);
    if (userTitle) mgr.titles.add(userTitle);
    if (userDept) mgr.departments.add(userDept);
    if (raw.Company) mgr.companies.add(raw.Company);
    mgr.directReportsCount++;
  }

  return Array.from(mgrMap.values())
    .map((m) => ({
      ...m,
      emails: Array.from(m.emails).filter(Boolean),
      titles: Array.from(m.titles).filter(Boolean),
      departments: Array.from(m.departments).filter(Boolean),
      companies: Array.from(m.companies).filter(Boolean),
    }))
    .sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", undefined, {
        sensitivity: "base",
      }),
    );
}

async function enrichManagerEmailsFromIdentities(managers, knownDomain, tenantId) {
  const needsEmail = managers.filter((m) => m.emails.length === 0 && m.name);
  if (needsEmail.length === 0) return managers;

  const tenantFilter = tenantId ? { tenantId } : {};

  try {
    let domain = knownDomain || "";
    if (!domain) {
      for (const m of managers) {
        const e = m.emails?.[0];
        if (e && e.includes("@")) {
          domain = e.split("@")[1];
          break;
        }
      }
    }
    if (!domain) {
      const sampleIdentity = await Identity.findOne({
        ...tenantFilter,
        email: { $exists: true, $ne: null },
      })
        .select("email")
        .lean();
      if (sampleIdentity?.email)
        domain = sampleIdentity.email.split("@")[1] || "";
    }

    const candidateEmails = [];
    const candidateToMgr = new Map();
    for (const m of needsEmail) {
      const name = (m.name || "").trim();
      if (!name) continue;
      const dotKey = name.toLowerCase().replace(/\s+/g, ".");
      const candidates = domain
        ? [
            `${dotKey}@${domain}`,
            `${name.toLowerCase().replace(/\s+/g, "_")}@${domain}`,
          ]
        : [];
      for (const c of candidates) {
        candidateEmails.push(c);
        candidateToMgr.set(c.toLowerCase(), m);
      }
    }

    if (candidateEmails.length > 0) {
      const identities = await Identity.find({
        ...tenantFilter,
        email: { $in: candidateEmails },
      })
        .select("email")
        .limit(200)
        .lean();

      for (const id of identities) {
        if (!id.email) continue;
        const mgr = candidateToMgr.get(id.email.toLowerCase());
        if (mgr && mgr.emails.length === 0) {
          mgr.emails.push(id.email.toLowerCase());
        }
      }
    }

    const stillNeeding = needsEmail.filter(
      (m) => m.emails.length === 0 && m.name,
    );
    if (stillNeeding.length > 0) {
      const names = stillNeeding.map((m) => m.name);
      const identities = await Identity.find({
        ...tenantFilter,
        displayName: { $in: names },
      })
        .select("email displayName")
        .limit(200)
        .lean();

      const byName = new Map();
      for (const id of identities) {
        if (id.email && id.displayName) {
          byName.set(id.displayName.toLowerCase(), id.email.toLowerCase());
        }
      }
      for (const m of stillNeeding) {
        const email = byName.get((m.name || "").toLowerCase());
        if (email) m.emails.push(email);
      }
    }
  } catch {
    // Identity lookup is best-effort
  }

  return managers;
}

function normalizeEntitlementItem(entitlement) {
  const raw = entitlement?.rawData || {};
  const id =
    entitlement?.entitlement_id ||
    entitlement?._id?.toString?.() ||
    raw.entitlement_id ||
    raw.ENTITLEMENT_ID ||
    raw.id ||
    null;
  const name =
    entitlement?.entitlement_name ||
    raw.entitlement_name ||
    raw.ENTITLEMENT_NAME ||
    raw.name ||
    id ||
    "";

  return {
    id: String(id || name),
    name: String(name || id || "").trim(),
  };
}

export const getCertificationData = async (req, res, next) => {
  try {
    // Support both legacy wizard route param `appId` and API param `id`.
    const appIdRaw = req.params.appId ?? req.params.id;
    const appId = asObjectId(appIdRaw);
    if (!appId) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid app id" });
    }

    await assertTenantForApplication(req, appId.toString(), { notFound: true });

    const [application, campaigns] = await Promise.all([
      Application.findById(appId).lean(),
      Campaign.find({ applicationId: appId })
        .populate("applicationId", "name tenantId")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    if (!application) {
      return res
        .status(404)
        .json({ success: false, message: "Application not found" });
    }

    const UsersModel = await resolveCertificationUserModel(
      application.name,
      application.tenantId,
    );
    const EntitlementsModel = await getDynamicEntitlementModelForTenantId(
      application.name,
      application.tenantId,
    );

    const { users: rawUsers, entitlements } = await loadScopedApplicationDataLocal(
      UsersModel,
      EntitlementsModel,
      appId,
    );

    // ── Apply dynamic schema mapping so wizard shows canonical user fields ──
    // `app_iga_<tenant>_<app>_schema` (legacy: mapped_schema) stores the application-specific source column for each
    // standard field (e.g. schema.department = "operating_unit" for Oracle).
    // normalizeMappedUsers resolves those application keys and injects the
    // canonical values back onto the row so downstream certification code can
    // read display_name / email / department / title consistently.
    let users = rawUsers;
    try {
      const { loadMappedSchema, normalizeMappedUsers } = await import("../../utils/access-certification/mappedUserResolver.js");
      const schema = await loadMappedSchema(application);
      if (schema && Object.keys(schema).length > 0) {
        users = normalizeMappedUsers(rawUsers, schema);
      }
    } catch (schemaErr) {
      console.warn(
        "[getCertificationData] Schema mapping failed:",
        schemaErr.message,
      );
    }

    const assignedByEntId = await buildEntitlementAssignedUserCounts({
      application,
      appId,
      entitlements,
      users,
    });

    const normalizedEntitlements = entitlements
      .map((ent) => {
        const item = normalizeEntitlementItemFull(ent);
        const eid = ent?._id != null ? String(ent._id) : null;
        const userCount = eid ? Number(assignedByEntId.get(eid) || 0) : 0;
        return {
          ...item,
          mongoId: eid || undefined,
          userCount,
        };
      })
      .filter((item) => item.name || item.id);

    const privilegedGroups = normalizedEntitlements
      .filter((item) => item.privileged)
      .map((item) => item.name);

    return res.json({
      success: true,
      data: {
        application,
        campaigns: campaigns.map(normalizeCampaignApplication),
        users: users.map((u) => ({ ...u, _originalData: u.rawData || {} })),
        entitlements: normalizedEntitlements,
        privilegedEntitlements: normalizedEntitlements.filter(
          (item) => item.privileged,
        ),
        privilegedGroups,
      },
    });
  } catch (err) {
    return next(err);
  }
};

async function loadScopedApplicationDataLocal(UsersModel, EntitlementsModel, appId) {
  const strictFilter = appId ? { applicationId: appId } : {};

  let [users, entitlements] = await Promise.all([
    UsersModel.find(strictFilter).sort({ createdAt: -1 }).lean(),
    EntitlementsModel.find(strictFilter).sort({ createdAt: -1 }).lean(),
  ]);

  if (users.length === 0) {
    users = await UsersModel.find({}).sort({ createdAt: -1 }).lean();
  }

  if (entitlements.length === 0) {
    entitlements = await EntitlementsModel.find({})
      .sort({ createdAt: -1 })
      .lean();
  }

  return { users, entitlements };
}

function normalizeEntitlementItemFull(entitlement) {
  const raw = entitlement?.rawData || {};
  const id =
    entitlement?.entitlement_id ||
    entitlement?._id?.toString?.() ||
    raw.entitlement_id ||
    raw.ENTITLEMENT_ID ||
    raw.id ||
    null;
  const name =
    entitlement?.entitlement_name ||
    raw.entitlement_name ||
    raw.ENTITLEMENT_NAME ||
    raw.name ||
    id ||
    "";
  const source = entitlement?.source || raw.source || "Catalog";
  const type = entitlement?.granted_via || raw.granted_via || "entitlement";
  const status = entitlement?.is_active || raw.is_active || "Enabled";

  // Align with Discovery Mark Privileged + privilegeMatchFilter (boolean + string forms).
  const privilegeCandidates = [
    entitlement?.isPrivileged,
    entitlement?.is_privileged,
    entitlement?.is_privilege,
    entitlement?.isPrivilege,
    entitlement?.privileged,
    raw.isPrivileged,
    raw.is_privileged,
    raw.is_privilege,
    raw.isPrivilege,
    raw.privileged,
  ];
  const privileged =
    privilegeCandidates.some((v) => {
      if (v === true) return true;
      return ["true", "yes", "1", "y", "privileged"].includes(
        String(v ?? "")
          .trim()
          .toLowerCase(),
      );
    }) ||
    ["privileged"].includes(
      String(entitlement?.classification ?? raw.classification ?? "")
        .trim()
        .toLowerCase(),
    );

  return {
    id: String(id || name),
    name: String(name || id || "").trim(),
    type: String(type || "entitlement"),
    source: String(source || "Catalog"),
    status: String(status || "Enabled"),
    privileged,
    _originalData: raw,
  };
}

export const getAllCampaigns = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.max(Number(req.query.limit || 20), 1);

    const userTenantId = await resolveUserTenantId(req);
    if (!userTenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }
    const tenantApplicationIds = await getTenantApplicationIds(userTenantId);
    const tenantUsers = await User.find({ tenantId: userTenantId })
      .select("_id")
      .lean();
    const tenantUserIds = (tenantUsers || []).map((u) => u._id);

    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.category) query.category = req.query.category;
    if (req.query.applicationId) {
      const appId = asObjectId(req.query.applicationId);
      if (!appId) {
        throw new AppError("Invalid applicationId", 400, "VALIDATION_ERROR");
      }
      const ok = tenantApplicationIds.some(
        (id) => String(id) === String(appId),
      );
      if (!ok) {
        // Don't leak tenant info; behave like "not found"
        throw new AppError("Campaign not found", 404, "NOT_FOUND");
      }
      query.applicationId = appId;
    } else {
      // Tenant scoping:
      // - application-scoped campaigns: applicationId -> Application.tenantId
      // - org-wide MANAGER campaigns (no applicationId): tenant derived from campaign.createdBy user tenantId
      query.$or = [
        { applicationId: { $in: tenantApplicationIds } },
        // Profile / Governance scoped campaigns store tenantId directly.
        { tenantId: userTenantId },
        {
          category: "MANAGER",
          createdBy: { $in: tenantUserIds },
          $or: [{ applicationId: { $exists: false } }, { applicationId: null }],
        },
      ];
    }

    const [items, total] = await Promise.all([
      Campaign.find(query)
        .populate({
          path: "applicationId",
          select: "name tenantId",
          populate: {
            path: "tenantId",
            select: "name",
          },
        })
        .populate("tenantId", "name")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Campaign.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: {
        items: items.map(normalizeCampaignApplication),
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const getCampaignById = async (req, res, next) => {
  try {
    const scopePage = Math.max(Number(req.query.scopePage || 1), 1);
    const scopeLimit = Math.max(Number(req.query.scopeLimit || 5000), 1);
    const scopeStatus = normalizeText(req.query.scopeStatus || "");
    const scopeQ = normalizeText(req.query.q || req.query.scopeQ || "");
    const scopeType = normalizeText(req.query.scopeType || "");
    const usePagedScope =
      "scopePage" in req.query ||
      "scopeLimit" in req.query ||
      "scopeStatus" in req.query ||
      "scopeQ" in req.query ||
      "q" in req.query ||
      "scopeType" in req.query;
    const includeDashboardMeta =
      String(req.query.includeDashboardMeta || "").trim() === "1" ||
      String(req.query.includeDashboardMeta || "").toLowerCase() === "true";
    const scopeLight =
      usePagedScope ||
      String(req.query.scopeLight || "").trim() === "1" ||
      String(req.query.scopeLight || "").toLowerCase() === "true";

    const campaignQuery = scopeLight
      ? Campaign.findById(req.params.id)
          .select(
            "name status category dueDate endDate totalItems approvedItems revokedItems pendingItems completionPercentage reviewersAssigned applicationId applicationName tenantId createdBy ownerName ownerEmail createdByDisplay createdByEmail reminderFrequency backupManagerReviewerEmail accessFilter selectedIds reviewerRoutingMode escalationConfig currentReview",
          )
          .populate({ path: "applicationId", select: "name tenantId" })
          .populate("reviewersAssigned.reviewerId", "firstName lastName email")
          .lean()
      : Campaign.findById(req.params.id)
          .populate({
            path: "applicationId",
            select: "name tenantId",
            populate: {
              path: "tenantId",
              select: "name",
            },
          })
          .populate("tenantId", "name")
          .populate("createdBy", "firstName lastName email")
          .populate("reviewersAssigned.reviewerId", "firstName lastName email")
          .lean();

    const campaign = await campaignQuery;
    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }

    await assertTenantForCampaign(req, req.params.id, { notFound: true });

    const normalizedCampaign = normalizeCampaignApplication(campaign);

    const resolvedOwnerName =
      normalizeText(normalizedCampaign.ownerName) ||
      composeUserDisplayName(normalizedCampaign.createdBy || {});
    const resolvedOwnerEmail =
      normalizeText(
        normalizedCampaign.ownerEmail ||
          normalizedCampaign.createdBy?.email ||
          normalizedCampaign.createdByEmail,
      ) || null;

    const createdByDisplay =
      normalizeText(normalizedCampaign.createdByDisplay) ||
      resolvedOwnerName ||
      resolvedOwnerEmail ||
      (typeof normalizedCampaign.createdBy === "string"
        ? normalizeText(normalizedCampaign.createdBy)
        : "") ||
      "System Admin";

    const enrichedCampaign = {
      ...normalizedCampaign,
      ownerName: resolvedOwnerName || null,
      ownerEmail: resolvedOwnerEmail,
      createdByDisplay,
      reviewersAssigned: Array.isArray(normalizedCampaign.reviewersAssigned)
        ? normalizedCampaign.reviewersAssigned.map(mapReviewerAssignment)
        : [],
    };

    let scopeData = [];
    let meta = {
      usersInApplication: 0,
      entitlementsInApplication: 0,
      scopedItems: 0,
    };

    let riCount = scopeLight && usePagedScope
      ? 0
      : await countReviewItemsForCampaign(campaign._id);

    // Heal campaigns stuck at "Active" after all review items have been decided.
    // Happens when decisions were made before the getProgress ObjectId fix was applied.
    if (!scopeLight && campaign.status === "Active" && riCount > 0) {
      const stillPending = await ReviewItem.countDocuments({
        campaignId: campaign._id,
        status: "PENDING",
      });
      if (stillPending === 0) {
        await Campaign.updateOne(
          { _id: campaign._id },
          { $set: { status: "Completed", endDate: campaign.endDate || new Date() } },
        );
        campaign.status = "Completed";
        ingestRevokeAccessFromCampaign(campaign._id).catch((e) =>
          console.error("[getCampaign] remediation queue ingest failed:", e.message),
        );
      }
    }

    if (riCount > 0 || (scopeLight && usePagedScope)) {
      let reviewItems = [];
      let scopedTotal = riCount;
      let scopedPage = 1;
      let scopedLimit = riCount;

      if (usePagedScope) {
        const paged = await getReviewItemsByCampaign(campaign._id, {
          status: scopeStatus || undefined,
          q: scopeQ || undefined,
          reviewItemType: scopeType || undefined,
          page: scopePage,
          limit: scopeLimit,
        });
        reviewItems = paged.items || [];
        scopedTotal = Number(paged.total || 0);
        scopedPage = Number(paged.page || scopePage);
        scopedLimit = Number(paged.limit || scopeLimit);
        if (scopeLight) riCount = scopedTotal;
      } else {
        reviewItems = await ReviewItem.find({
          campaignId: campaign._id,
        }).lean();
      }

      const needsReviewerNameEnrichment =
        !scopeLight ||
        reviewItems.some(
          (ri) =>
            ri.reviewerEmail &&
            !String(ri.reviewerName || ri.reviewerSnapshot?.name || "").trim(),
        );
      if (needsReviewerNameEnrichment) {
        reviewItems = await enrichReviewerNamesForReviewItems(
          reviewItems,
          campaign.tenantId,
        );
      }

      scopeData = reviewItems.map((ri) => {
        const decisionStr =
          ri.decision ||
          (ri.status === "REVOKED"
            ? "Revoked"
            : ri.status === "APPROVED"
              ? "Approved"
              : ri.status === "DELEGATED"
                ? "Delegate"
                : ri.status === "EXCEPTION"
                  ? "Exception"
                  : ri.status === "PENDING"
                    ? "Pending"
                    : null);

        return {
          id: String(ri.itemId),
          userId: ri.userId || String(ri.itemId),
          name: ri.itemName || ri.itemEmail || "Unknown User",
          email: ri.itemEmail || "",
          department: ri.itemDepartment || "",
          title: ri.itemTitle || "",
          manager: ri.itemManager || "",
          itemManager: ri.itemManager || "",
          managerEmail: ri.itemManagerEmail || "",
          applicationName:
            ri.itemApplicationName || enrichedCampaign.applicationName || "",
          displayAccess: Array.isArray(ri.itemAccessDetails)
            ? ri.itemAccessDetails
            : [],
          displayGroupsLabel: Array.isArray(ri.itemAccessDetails)
            ? ri.itemAccessDetails
            : [],
          targetIds: [String(ri.itemId)],
          reviewItemId: ri._id,
          reviewItemStatus: ri.status,
          reviewItemKey: String(ri.itemId),
          reviewItemType: ri.reviewItemType || undefined,
          aggregatedDecision: decisionStr,
          entitlementDecisions: Array.isArray(ri.entitlementDecisions)
            ? ri.entitlementDecisions
            : [],
          reviewerEmail: ri.reviewerEmail || "",
          reviewerName: ri.reviewerName || "",
          reviewerSnapshot: ri.reviewerSnapshot || undefined,
          reviewerIdentityId: ri.reviewerIdentityId || undefined,
          entitlementSnapshot: ri.entitlementSnapshot || undefined,
          currentReview: {
            decision: decisionStr,
            reviewerEmail: ri.reviewerEmail,
            reviewerName: ri.reviewerName,
            reviewedAt: ri.reviewedAt,
            comment: ri.comment,
          },
        };
      });
      meta.scopedItems = scopeData.length;
      if (usePagedScope) {
        meta.scopedItemsTotal = Number(scopedTotal || 0);
        meta.scopePage = Number(scopedPage || scopePage);
        meta.scopeLimit = Number(scopedLimit || scopeLimit);
      }

      // --- Runtime enrichment (full campaign load only — skipped for paginated review board) ---
      const needsEnrichment = scopeLight ? [] : reviewItems
        .map((ri, idx) => ({
          ri,
          idx,
          itemIdStr: String(ri.itemId || ""),
        }))
        .filter(
          ({ ri }) =>
            !ri.itemName ||
            !ri.itemEmail ||
            !ri.itemManager ||
            !Array.isArray(ri.itemAccessDetails) ||
            ri.itemAccessDetails.length === 0,
        );

      if (needsEnrichment.length > 0) {
        try {
          const catUpper = String(
            enrichedCampaign.category || "",
          ).toUpperCase();
          const itemIdsByStr = new Map(
            needsEnrichment.map(({ itemIdStr, idx }) => [itemIdStr, idx]),
          );
          const appUserIds = [...itemIdsByStr.keys()];
          const objectIds = [...itemIdsByStr.keys()]
            .map((s) => asObjectId(s))
            .filter(Boolean);

          // Common fields to select from app user model (raw + mapped)
          const APP_USER_SELECT =
            "_id primaryKey display_name name displayName firstName lastName email " +
            "manager manager_name manager_id managerEmail manager_email " +
            "member_of_entitlements memberOf rawData";
          const appUserTenantId =
            enrichedCampaign.tenantId ||
            enrichedCampaign.applicationId?.tenantId;
          const appUserQuery = {
            $or: [
              ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
              ...(appUserIds.length > 0
                ? [
                    { primaryKey: { $in: appUserIds } },
                    { email: { $in: appUserIds } },
                    { display_name: { $in: appUserIds } },
                  ]
                : []),
            ],
          };

          let resolvedDocs = [];
          if (catUpper === "IDENTITY" || catUpper === "PROFILE") {
            // First try the Identity warehouse (PROFILE-scoped IDENTITY campaigns)
            resolvedDocs = await Identity.find({ _id: { $in: objectIds } })
              .select(
                "_id displayName firstName lastName email employeeId manager managerEmail",
              )
              .lean();

            // For APPLICATION-scoped IDENTITY campaigns users live in the
            // dynamic app user collection — fall through if Identity returned nothing.
            if (resolvedDocs.length === 0 && enrichedCampaign.applicationName) {
              try {
                const AppUserModel = await resolveCertificationUserModel(
                  enrichedCampaign.applicationName,
                  appUserTenantId,
                );
                resolvedDocs = await AppUserModel.find(appUserQuery)
                  .select(APP_USER_SELECT)
                  .lean();
              } catch {
                // dynamic model unavailable — skip
              }
            }
          } else if (enrichedCampaign.applicationName) {
            try {
              const AppUserModel = await resolveCertificationUserModel(
                enrichedCampaign.applicationName,
                appUserTenantId,
              );
              resolvedDocs = await AppUserModel.find(appUserQuery)
                .select(APP_USER_SELECT)
                .lean();
            } catch {
              // dynamic model unavailable — skip
            }
          }

          // Build a fast O(1) lookup: idx → enrichment entry
          const idxToEntry = new Map(needsEnrichment.map((e) => [e.idx, e]));

          const dbPatches = [];
          for (const doc of resolvedDocs) {
            const directCandidates = [
              doc._id?.toString?.(),
              doc.primaryKey,
              doc.user_id,
              doc.email,
              doc.display_name,
            ]
              .map((value) => String(value || "").trim())
              .filter(Boolean);
            let idx;
            for (const candidate of directCandidates) {
              idx = itemIdsByStr.get(candidate);
              if (idx !== undefined) break;
            }
            if (idx === undefined) continue;
            const entry = idxToEntry.get(idx);
            if (!entry) continue;
            const riEntry = entry.ri;

            // ── Name / Email ────────────────────────────────────────────────
            const resolvedName =
              doc.display_name ||
              doc.displayName ||
              doc.name ||
              [doc.firstName, doc.lastName].filter(Boolean).join(" ").trim() ||
              doc.email ||
              doc.employeeId ||
              "";
            const resolvedEmail = doc.email || "";

            // ── Manager ─────────────────────────────────────────────────────
            const resolvedManager = doc.manager_name || doc.manager || "";
            const resolvedManagerEmail =
              doc.managerEmail || doc.manager_email || "";

            // ── Access / Role ────────────────────────────────────────────────
            // Prefer existing ReviewItem snapshot; fall back to live user record.
            let resolvedAccess = [];
            if (
              Array.isArray(riEntry.itemAccessDetails) &&
              riEntry.itemAccessDetails.length > 0
            ) {
              resolvedAccess = riEntry.itemAccessDetails;
            } else {
              // Pull raw entitlements from app user doc (mapped or legacy)
              const rawAccess =
                doc.member_of_entitlements ||
                (doc.rawData && doc.rawData.member_of_entitlements) ||
                doc.memberOf ||
                "";
              if (rawAccess) {
                resolvedAccess = tokenizeAndNormalize(rawAccess);
              }
            }

            if (resolvedName || resolvedEmail) {
              // ── Patch in-memory scope row ──────────────────────────────────
              scopeData[idx].name =
                resolvedName || resolvedEmail || "Unknown User";
              scopeData[idx].email = resolvedEmail || scopeData[idx].email;

              if (!scopeData[idx].manager && resolvedManager)
                scopeData[idx].manager = resolvedManager;
              if (!scopeData[idx].managerEmail && resolvedManagerEmail)
                scopeData[idx].managerEmail = resolvedManagerEmail;

              if (
                resolvedAccess.length > 0 &&
                (!scopeData[idx].displayAccess?.length ||
                  !scopeData[idx].displayGroupsLabel?.length)
              ) {
                scopeData[idx].displayAccess = resolvedAccess;
                scopeData[idx].displayGroupsLabel = resolvedAccess;
              }

              // ── Persist back to DB (best-effort, non-blocking) ─────────────
              dbPatches.push(
                ReviewItem.updateOne(
                  { _id: riEntry._id },
                  {
                    $set: {
                      ...(resolvedName && !riEntry.itemName
                        ? { itemName: resolvedName }
                        : {}),
                      ...(resolvedEmail && !riEntry.itemEmail
                        ? { itemEmail: resolvedEmail }
                        : {}),
                      ...(!riEntry.itemManager && resolvedManager
                        ? { itemManager: resolvedManager }
                        : {}),
                      ...(!riEntry.itemManagerEmail && resolvedManagerEmail
                        ? { itemManagerEmail: resolvedManagerEmail }
                        : {}),
                      ...(resolvedAccess.length > 0 &&
                      (!Array.isArray(riEntry.itemAccessDetails) ||
                        riEntry.itemAccessDetails.length === 0)
                        ? { itemAccessDetails: resolvedAccess }
                        : {}),
                    },
                  },
                ),
              );
            }
          }

          if (dbPatches.length > 0) {
            await Promise.all(dbPatches).catch((patchErr) => {
              console.warn(
                "[AccessCert] enrichment DB patch failed:",
                patchErr.message,
              );
            });
          }
        } catch (enrichErr) {
          console.warn("[AccessCert] enrichment failed:", enrichErr.message);
        }
      }
      // --- Supplemental access enrichment from mapped_users (full load only) ---
      if (!scopeLight && enrichedCampaign.applicationId) {
        const noAccess = scopeData
          .map((sd, idx) => ({ sd, idx, ri: reviewItems[idx] }))
          .filter(
            ({ sd, ri }) =>
              ri &&
              (!Array.isArray(sd.displayAccess) ||
                sd.displayAccess.length === 0),
          );

        if (noAccess.length > 0) {
          try {
            const suppApp = await Application.findById(
              enrichedCampaign.applicationId,
            )
              .select("name tenantId")
              .lean();
            if (suppApp) {
              const SuppMappedModel = await resolveMappedUserModel(suppApp);
              const suppCount = await SuppMappedModel.estimatedDocumentCount();
              if (suppCount > 0) {
                // Map email → scopeData index (use scopeData.email which may have
                // been enriched by the name-pass above).
                const emailToIdx = new Map();
                for (const { sd, idx } of noAccess) {
                  const em = (
                    sd.email ||
                    noAccess.find((x) => x.idx === idx)?.ri?.itemEmail ||
                    ""
                  )
                    .toLowerCase()
                    .trim();
                  if (em) emailToIdx.set(em, idx);
                }

                if (emailToIdx.size > 0) {
                  const suppDocs = await SuppMappedModel.find({
                    email: { $in: [...emailToIdx.keys()] },
                  })
                    .select("email member_of_entitlements")
                    .lean();

                  const suppPatches = [];
                  for (const doc of suppDocs) {
                    const em = (doc.email || "").toLowerCase().trim();
                    const idx = emailToIdx.get(em);
                    if (idx === undefined) continue;

                    const rawAccess = doc.member_of_entitlements || "";
                    const labels = tokenizeAndNormalize(rawAccess);
                    if (!labels.length) continue;

                    scopeData[idx].displayAccess = labels;
                    scopeData[idx].displayGroupsLabel = labels;

                    const riRef = noAccess.find((x) => x.idx === idx)?.ri;
                    if (riRef) {
                      suppPatches.push(
                        ReviewItem.updateOne(
                          { _id: riRef._id },
                          { $set: { itemAccessDetails: labels } },
                        ),
                      );
                    }
                  }

                  if (suppPatches.length > 0) {
                    await Promise.all(suppPatches).catch((e) =>
                      console.warn(
                        "[AccessCert] mapped access patch:",
                        e.message,
                      ),
                    );
                  }
                }
              }
            }
          } catch (suppErr) {
            console.warn(
              "[AccessCert] mapped access enrichment:",
              suppErr.message,
            );
          }
        }
      }
      // --- End runtime enrichment ---
    } else {
      const userTenantId = await resolveUserTenantId(req);
      const loaded = await loadScopeRowsForCampaign(enrichedCampaign, {
        userTenantId,
      });
      scopeData = loaded.scopeData;
      meta = loaded.meta;
    }

    const analytics = scopeLight
      ? {
          usersInScope:
            Number(meta.scopedItemsTotal || meta.scopedItems) ||
            Number(enrichedCampaign.totalItems) ||
            scopeData.length,
          managersToEmail: Array.isArray(enrichedCampaign.reviewersAssigned)
            ? enrichedCampaign.reviewersAssigned.length
            : 0,
          usersMissingReviewer: 0,
          totalEntitlements: meta.entitlementsInApplication || 0,
          entitlementsInScope: 0,
          entitlementsNotReviewed: meta.entitlementsInApplication || 0,
        }
      : computeCampaignAnalytics({
          campaign: enrichedCampaign,
          scopeData,
          usersInApplication: meta.usersInApplication,
          entitlementsInApplication: meta.entitlementsInApplication,
        });
    const noAccessAnalytics =
      scopeLight && !includeDashboardMeta
        ? null
        : await computeNoAccessAnalytics(campaign._id).catch(() => null);

    return res.json({
      success: true,
      data: {
        campaign: {
          ...enrichedCampaign,
          analytics: {
            ...analytics,
            ...(noAccessAnalytics ? { noAccess: noAccessAnalytics } : {}),
          },
        },
        scopeData,
        meta: {
          ...meta,
          analytics: {
            ...analytics,
            ...(noAccessAnalytics ? { noAccess: noAccessAnalytics } : {}),
          },
        },
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const createCampaign = async (req, res) => {
  try {
    const payload = { ...req.body };
    const userId = getUserId(req);

    if (payload.category) {
      payload.category = String(payload.category).trim().toUpperCase();
    }
    if (payload.certificationScope) {
      payload.certificationScope = String(payload.certificationScope)
        .trim()
        .toUpperCase();
    } else {
      // Derive scope from category when frontend doesn't send it explicitly
      const catUpper = String(payload.category || "").toUpperCase();
      if (
        [
          "ROLE_COMPOSITION",
          "POLICIES",
          "ROLE_MEMBERSHIP",
          "APPROVAL_OWNERSHIP",
        ].includes(catUpper)
      ) {
        payload.certificationScope = "GOVERNANCE";
      } else if (["LIFECYCLE_STATUS"].includes(catUpper)) {
        payload.certificationScope = "PROFILE";
      } else {
        payload.certificationScope = payload.applicationId
          ? "APPLICATION"
          : "PROFILE";
      }
    }

    await resolveAndApplyCertificationProfileDefaults(req, payload);

    if (payload.applicationId) {
      await assertTenantForApplication(req, payload.applicationId, {
        notFound: true,
      });
      const app = await Application.findById(payload.applicationId).lean();
      if (app) {
        payload.applicationName = app.name;
        if (!payload.tenantId && app.tenantId) payload.tenantId = app.tenantId;
      }
    }

    // Identity profile selection (PROFILE-scope population)
    if (payload.identityProfileId) {
      const userTenantId = await resolveUserTenantId(req);
      const ipId = asObjectId(payload.identityProfileId);
      if (!ipId) {
        return res.status(400).json({
          success: false,
          message: "Invalid identityProfileId",
        });
      }
      const exists = await IdentityProfile.findOne({
        _id: ipId,
        tenantId: userTenantId,
      })
        .select("_id")
        .lean();
      if (!exists) {
        return res.status(404).json({
          success: false,
          message: "Identity Profile not found for this tenant",
        });
      }
      payload.identityProfileId = ipId;
      if (!payload.tenantId && userTenantId) payload.tenantId = userTenantId;
    }

    // ── PROFILE + IDENTITY: respect identityMode (SPECIFIC or ALL) ───────────
    // Admin may certify all identities or pick specific ones from the profile.
    if (
      payload.certificationScope === "PROFILE" &&
      String(payload.category || "").toUpperCase() === "IDENTITY"
    ) {
      const chosenMode = String(payload.identityMode || "ALL").toUpperCase();
      payload.identityMode = chosenMode === "SPECIFIC" ? "SPECIFIC" : "ALL";
      // In ALL mode there is no manual selection — clear any stale selectedIds
      if (payload.identityMode === "ALL") {
        payload.selectedIds = [];
      } else {
        // SPECIFIC: normalise + deduplicate but keep the selected identity IDs
        payload.selectedIds = Array.isArray(payload.selectedIds)
          ? [...new Set(payload.selectedIds.map((id) => String(id || "").trim()).filter(Boolean))]
          : [];
      }
    }

    // ── PROFILE + MANAGER: store scopeFilters, auto-route to managers ─────────
    if (
      payload.certificationScope === "PROFILE" &&
      String(payload.category || "").toUpperCase() === "MANAGER"
    ) {
      // Accept either scopeFilters.managerIds (preferred) or legacy selectedManagerIds
      const rawManagerIds =
        (payload.scopeFilters && payload.scopeFilters.managerIds) ||
        payload.selectedManagerIds ||
        [];

      const managerObjectIds = rawManagerIds
        .map((id) => asObjectId(id))
        .filter(Boolean);

      payload.scopeFilters = {
        managerIds:  managerObjectIds,
        departments: Array.isArray(payload.scopeFilters && payload.scopeFilters.departments)
          ? payload.scopeFilters.departments
          : [],
        locations: Array.isArray(payload.scopeFilters && payload.scopeFilters.locations)
          ? payload.scopeFilters.locations
          : [],
      };

      // Manager is auto-assigned as reviewer — no manual reviewer selection needed
      payload.reviewerRoutingMode = "DEFAULT";
      payload.reviewersAssigned   = [];
      payload.identityMode        = "ALL";
      payload.selectedIds         = [];

      // Clean up any legacy field that may have been sent
      delete payload.selectedManagerIds;
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (userId) payload.createdBy = userId;
    if (userId) payload.updatedBy = userId;

    if (!Array.isArray(payload.selectedIds)) payload.selectedIds = [];
    payload.selectedIds = payload.selectedIds
      .map((id) => String(id || "").trim())
      .filter(Boolean);

    if (Array.isArray(payload.reviewersAssigned)) {
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = [];

      payload.reviewersAssigned = payload.reviewersAssigned
        .map((reviewer) => {
          const reviewerId = asObjectId(reviewer?.reviewerId);
          const reviewerEmail = normalizeText(
            reviewer?.email || reviewer?.reviewerEmail,
          );
          if (reviewerEmail && !EMAIL_RE.test(reviewerEmail)) {
            invalidEmails.push(reviewerEmail);
          }
          const reviewerName =
            normalizeText(reviewer?.name || reviewer?.reviewerName) ||
            reviewerEmail ||
            "";

          const rt = reviewer?.reviewerType
            ? String(reviewer.reviewerType).trim().toUpperCase()
            : "";
          return {
            ...(reviewerId ? { reviewerId } : {}),
            ...(rt ? { reviewerType: rt } : {}),
            ...(reviewerEmail ? { email: reviewerEmail } : {}),
            ...(reviewerName ? { name: reviewerName } : {}),
          };
        })
        .filter(
          (reviewer) => reviewer.reviewerId || reviewer.email || reviewer.name,
        );

      if (invalidEmails.length) {
        return res.status(400).json({
          success: false,
          message: `Invalid reviewer email address(es): ${invalidEmails.join(", ")}`,
        });
      }
    }

    if (
      payload.reviewerRoutingMode != null &&
      payload.reviewerRoutingMode !== ""
    ) {
      const rr = String(payload.reviewerRoutingMode).trim().toUpperCase();
      if (["DEFAULT", "INTERNAL", "EXTERNAL"].includes(rr)) {
        payload.reviewerRoutingMode = rr;
      } else {
        delete payload.reviewerRoutingMode;
      }
    } else {
      delete payload.reviewerRoutingMode;
    }

    // For identity campaigns, default to all app users when none were selected.
    if (
      payload.category === "IDENTITY" &&
      payload.selectedIds.length === 0 &&
      payload.applicationId &&
      payload.applicationName
    ) {
      const appId = asObjectId(payload.applicationId);
      if (appId) {
        const appRow = await Application.findById(appId)
          .select("tenantId")
          .lean();
        const UsersModel = await resolveCertificationUserModel(
          payload.applicationName,
          appRow?.tenantId,
        );
        const users = await UsersModel.find({})
          .select("_id primaryKey email rawData")
          .lean();
        payload.selectedIds = users
          .map((u) =>
            String(
              u?.user_id ||
                u?.primaryKey ||
                u?._id?.toString?.() ||
                u?.email ||
                u?.rawData?.["Employee ID"] ||
                u?.rawData?.employee_id ||
                "",
            ).trim(),
          )
          .filter(Boolean);
      }
    }

    // Reviewer auto-assignment fallback for DEFAULT manager mode:
    // 1) Use application-level configured default reviewers when available.
    // 2) Otherwise derive managers from scoped users in the selected application.
    if (
      payload.applicationId &&
      payload.applicationName &&
      (!Array.isArray(payload.reviewersAssigned) ||
        payload.reviewersAssigned.length === 0)
    ) {
      try {
        let derivedReviewers = [];

        const appWithReviewers = await Application.findById(
          payload.applicationId,
        ).populate(
          "defaultCertificationReviewers.userId",
          "email firstName lastName",
        );

        if (
          appWithReviewers?.defaultCertificationReviewers?.length > 0 &&
          appWithReviewers.autoAssignAppManagersToCertification !== false
        ) {
          derivedReviewers = appWithReviewers.defaultCertificationReviewers
            .map((reviewer) => ({
              reviewerId: reviewer.userId?._id,
              email: reviewer.email || reviewer.userId?.email,
              name:
                reviewer.name ||
                [reviewer.userId?.firstName, reviewer.userId?.lastName]
                  .filter(Boolean)
                  .join(" "),
              reviewerType: reviewer.reviewerType || "manager",
            }))
            .filter((r) => r.email || r.reviewerId || r.name);
        }

        if (derivedReviewers.length === 0) {
          const appId = asObjectId(payload.applicationId);
          if (appId) {
            const appRow = await Application.findById(appId)
              .select("tenantId")
              .lean();
            const UsersModel = await resolveCertificationUserModel(
              payload.applicationName,
              appRow?.tenantId,
            );
            const users = await UsersModel.find({})
              .select(
                "_id primaryKey email manager manager_name manager_id managerEmail manager_email rawData",
              )
              .lean();

            const selectedKeys = new Set(
              (Array.isArray(payload.selectedIds) ? payload.selectedIds : [])
                .map((id) =>
                  String(id || "")
                    .trim()
                    .toLowerCase(),
                )
                .filter(Boolean),
            );

            const scopedUsers = users.filter((u) => {
              if (selectedKeys.size === 0) return true;
              const raw = u?.rawData || {};
              const keys = [
                u?.user_id,
                u?._id?.toString?.(),
                u?.email,
                u?.username,
                raw["Employee ID"],
                raw.employee_id,
                raw.user_id,
                raw.id,
                pickFromRawData(raw, "email", "mail"),
                pickFromRawData(
                  raw,
                  "username",
                  "user_name",
                  "oracle_user",
                  "tableau_user",
                  "account_id",
                  "account",
                  "login",
                  "samaccount",
                ),
              ]
                .map((v) =>
                  String(v || "")
                    .trim()
                    .toLowerCase(),
                )
                .filter(Boolean);
              return keys.some((k) => selectedKeys.has(k));
            });

            const managers = await enrichManagerEmailsFromIdentities(
              extractManagersFromUsers(scopedUsers, users),
              undefined,
              appRow?.tenantId,
            );
            const seenReviewer = new Set();
            derivedReviewers = managers
              .map((m) => {
                const email = normalizeText(m?.emails?.[0]);
                const name = normalizeText(m?.name);
                const uniqueKey = (email || name).toLowerCase();
                if (!uniqueKey || seenReviewer.has(uniqueKey)) return null;
                seenReviewer.add(uniqueKey);
                return {
                  reviewerType: "MANAGER",
                  ...(email ? { email } : {}),
                  ...(name ? { name } : {}),
                };
              })
              .filter(Boolean);
          }
        }

        if (derivedReviewers.length > 0) {
          payload.reviewersAssigned = derivedReviewers;
        }
      } catch (err) {
        console.warn(
          "[AccessCert] reviewer auto-assignment fallback failed:",
          err.message,
        );
      }
    }

    // Campaigns always start as Staged (awaiting explicit activation)
    payload.status = "Staged";

    const campaignName = String(payload.name || "").trim();
    if (!campaignName) {
      return res.status(400).json({
        success: false,
        message: "Campaign name is required",
      });
    }
    if (campaignName.length > 200) {
      return res.status(400).json({
        success: false,
        message: "Campaign name must be 200 characters or fewer",
      });
    }
    payload.name = campaignName;

    if (payload.dueDate) {
      const due = new Date(payload.dueDate);
      if (Number.isNaN(due.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid dueDate",
        });
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (due < today) {
        return res.status(400).json({
          success: false,
          message: "dueDate cannot be in the past",
        });
      }
      payload.dueDate = due;
    }

    const tenantIdForName =
      payload.tenantId || (await resolveUserTenantId(req));
    if (tenantIdForName && !payload.tenantId) {
      payload.tenantId = tenantIdForName;
    }

    const nameRegex = {
      $regex: `^${campaignName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      $options: "i",
    };
    let duplicateNameFilter = { name: nameRegex };
    if (tenantIdForName) {
      const tenantAppIds = await getTenantApplicationIds(tenantIdForName);
      duplicateNameFilter = {
        name: nameRegex,
        $or: [
          { tenantId: tenantIdForName },
          ...(tenantAppIds.length
            ? [{ applicationId: { $in: tenantAppIds } }]
            : []),
        ],
      };
    }

    const existingWithName = await Campaign.findOne(duplicateNameFilter)
      .select("_id")
      .lean();
    if (existingWithName) {
      return res.status(409).json({
        success: false,
        message: "A certification with this name already exists",
      });
    }

    const campaign = await Campaign.create(payload);

    // Snapshot profile defaults at creation time for retrospective compliance audits.
    if (campaign.certificationProfileId) {
      const profile = await CertificationProfile.findById(
        campaign.certificationProfileId,
      ).lean();
      if (profile) {
        CertificationProfileSnapshot.create({
          tenantId: campaign.tenantId,
          campaignId: campaign._id,
          profileId: profile._id,
          snapshotAt: new Date(),
          category: campaign.category,
          snapshotData: profile,
          createdBy: req.user?._id,
        }).catch((e) =>
          console.warn(
            "[createCampaign] ProfileSnapshot create failed:",
            e?.message,
          ),
        );
      }
    }

    // No emails sent here — emails fire when admin activates the campaign (POST /activate)

    return res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A certification with this name already exists",
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /campaigns/:id/activate — Staged → Active, fires assignment emails
export const activateCampaign = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    // Tenant scoping
    await assertTenantForCampaign(req, req.params.id, { notFound: true });

    const allowedFrom = ["Staged", "Draft"]; // allow Draft for backward compat
    if (!allowedFrom.includes(campaign.status)) {
      return res.status(400).json({
        success: false,
        message: `Campaign is already ${campaign.status} and cannot be activated`,
      });
    }

    campaign.status = "Active";
    campaign.startDate = new Date();
    if (req.user?.id) campaign.updatedBy = req.user.id;
    const isProfileIdentityCampaign =
      String(campaign?.certificationScope || "").toUpperCase() === "PROFILE" &&
      String(campaign?.category || "").toUpperCase() === "IDENTITY";
    // Ensure totalItems is set so decision progress is computed correctly
    if (
      !isProfileIdentityCampaign &&
      !campaign.totalItems &&
      !campaign.totalScope &&
      Array.isArray(campaign.selectedIds) &&
      campaign.selectedIds.length > 0
    ) {
      campaign.totalItems = campaign.selectedIds.length;
    }
    await campaign.save();

    let assignmentMap;
    try {
      assignmentMap = await buildReviewerAssignmentMap(campaign);
    } catch (stampErr) {
      console.warn(
        "[AccessCert] buildReviewerAssignmentMap failed:",
        stampErr.message,
      );
      assignmentMap = new Map();
    }

    try {
      const fresh = await Campaign.findById(campaign._id)
        .populate("applicationId", "name tenantId")
        .lean();
      const userTenantId = await resolveUserTenantId(req);
      if (fresh && userTenantId) {
        const isProfileIdentityAll =
          String(fresh?.certificationScope || "").toUpperCase() === "PROFILE" &&
          String(fresh?.category || "").toUpperCase() === "IDENTITY" &&
          String(fresh?.identityMode || "SPECIFIC").toUpperCase() === "ALL" &&
          (!Array.isArray(fresh?.selectedIds) ||
            fresh.selectedIds.length === 0);

        if (isProfileIdentityAll) {
          const profileId = asObjectId(fresh.identityProfileId);
          if (profileId) {
            const applyIdentityFilter = (filter) => {
              const f = String(fresh?.identityFilter || "ALL")
                .trim()
                .toUpperCase();
              if (f === "NHI") {
                filter.$or = [
                  { isNHI: true },
                  { identityType: { $in: ["nhi", "service"] } },
                ];
              } else if (f === "CONTRACTOR") {
                filter.identityType = "contractor";
              }
            };

            const baseFilter = {
              tenantId: userTenantId,
              identityProfileId: profileId,
            };
            applyIdentityFilter(baseFilter);

            const cursor = Identity.find(baseFilter)
              .select(
                "_id displayName firstName lastName email employeeId department title manager managerId managerEmail managerEmployeeId lifecycleState identityType isActive isNHI",
              )
              .sort({ _id: 1 })
              .cursor({ batchSize: 500 });

            const CHUNK = 500;
            let buffer = [];

            const flush = async () => {
              if (buffer.length === 0) return;

              const managerIds = new Set();
              const managerEmpIds = new Set();
              for (const d of buffer) {
                if (d?.managerId) managerIds.add(String(d.managerId));
                const me = String(d?.managerEmployeeId || "").trim();
                if (!d?.managerId && me) managerEmpIds.add(me);
              }

              const [mgrDocs, mgrEmpDocs] = await Promise.all([
                managerIds.size
                  ? Identity.find({
                      tenantId: userTenantId,
                      _id: {
                        $in: [...managerIds]
                          .map((x) => asObjectId(x))
                          .filter(Boolean),
                      },
                    })
                      .select("_id email displayName firstName lastName")
                      .lean()
                  : [],
                managerEmpIds.size
                  ? Identity.find({
                      tenantId: userTenantId,
                      employeeId: { $in: [...managerEmpIds] },
                    })
                      .select("employeeId email displayName firstName lastName")
                      .lean()
                  : [],
              ]);

              const mgrNameById  = new Map();   // managerId hex → display name
              const mgrEmailById = new Map();   // managerId hex → email
              for (const m of mgrDocs || []) {
                const idStr = String(m._id);
                const name  =
                  m?.displayName ||
                  [m?.firstName, m?.lastName].filter(Boolean).join(" ");
                if (idStr && name)      mgrNameById.set(idStr, name);
                if (idStr && m?.email)  mgrEmailById.set(idStr, m.email.toLowerCase().trim());
              }
              const mgrNameByEmp  = new Map();  // managerEmployeeId → display name
              const mgrEmailByEmp = new Map();  // managerEmployeeId → email
              for (const m of mgrEmpDocs || []) {
                const emp  = String(m?.employeeId || "").trim();
                const name =
                  m?.displayName ||
                  [m?.firstName, m?.lastName].filter(Boolean).join(" ");
                if (emp && name)      mgrNameByEmp.set(emp, name);
                if (emp && m?.email)  mgrEmailByEmp.set(emp, m.email.toLowerCase().trim());
              }

              const scopeRows = buffer.map((i) => {
                const identityType = String(
                  i?.identityType || "",
                ).toLowerCase();
                const mgrName =
                  (i?.managerId
                    ? mgrNameById.get(String(i.managerId))
                    : mgrNameByEmp.get(
                        String(i?.managerEmployeeId || "").trim(),
                      )) ||
                  i?.manager ||
                  "";
                return {
                  id: String(i?._id || ""),
                  userId: i?.employeeId || i?.email || String(i?._id || ""),
                  name:
                    i?.displayName ||
                    [i?.firstName, i?.lastName]
                      .filter(Boolean)
                      .join(" ")
                      .trim() ||
                    i?.email ||
                    "",
                  email: i?.email || "",
                  title: i?.title || "",
                  department: i?.department || "",
                  manager: mgrName,
                  managerEmail:
                    i?.managerEmail ||
                    mgrEmailById.get(String(i?.managerId || "")) ||
                    mgrEmailByEmp.get(String(i?.managerEmployeeId || "").trim()) ||
                    "",
                  status: i?.isActive === false ? "inactive" : "active",
                  lifecycleState: i?.lifecycleState || "",
                  identityType: i?.identityType || "",
                  isNHI: Boolean(
                    i?.isNHI ||
                    identityType === "nhi" ||
                    identityType === "service",
                  ),
                  isContractor: Boolean(identityType === "contractor"),
                  employeeId: i?.employeeId || "",
                };
              });

              buffer = [];
              await generateReviewItems(fresh, scopeRows, assignmentMap);
            };

            for await (const doc of cursor) {
              buffer.push(doc);
              if (buffer.length >= CHUNK) await flush();
            }
            await flush();
          }
        } else {
          const { scopeData } = await loadScopeRowsForCampaign(fresh, {
            userTenantId,
          });
          await generateReviewItems(fresh, scopeData, assignmentMap);
        }
      }
    } catch (riErr) {
      console.warn("[AccessCert] generateReviewItems failed:", riErr.message);
    }

    // PROFILE + IDENTITY progress is per-entitlement, not per-identity.
    try {
      const reviewItems = await ReviewItem.find({ campaignId: campaign._id })
        .select("entitlementDecisions")
        .lean();
      if (reviewItems.length > 0) {
        const entitlementTotal = countEntitlementsInReviewItems(reviewItems);
        campaign.totalItems = entitlementTotal;
        campaign.totalScope = entitlementTotal;
        await campaign.save();
      }
    } catch (totalErr) {
      console.warn("[AccessCert] totalItems sync failed:", totalErr.message);
    }

    // Enrich reviewer emails from Identity warehouse before sending
    const reviewers = Array.isArray(campaign.reviewersAssigned)
      ? campaign.reviewersAssigned
      : [];
    const reviewersNeedingEmail = reviewers.filter((r) => !r.email && r.name);
    if (reviewersNeedingEmail.length > 0) {
      try {
        const enriched = await enrichManagerEmailsFromIdentities(
          reviewersNeedingEmail.map((r) => ({
            name: r.name,
            emails: [],
          })),
          undefined,
          userTenantId,
        );
        const enrichedMap = new Map();
        for (const e of enriched) {
          if (e.emails.length > 0) enrichedMap.set(e.name, e.emails[0]);
        }
        for (const r of reviewersNeedingEmail) {
          const email = enrichedMap.get(r.name);
          if (email) r.email = email;
        }
        // Persist enriched emails
        if (enrichedMap.size > 0) {
          campaign.markModified("reviewersAssigned");
          await campaign.save();
        }
      } catch {
        // best-effort
      }
    }

    // Collect ALL distinct reviewer emails from review items (handles manager-routed
    // campaigns where managers are derived per-user and may not all be in reviewersAssigned).
    const reviewerEmailsToNotify = new Set(
      reviewers
        .map((r) => (r.email || "").trim().toLowerCase())
        .filter(Boolean),
    );
    try {
      const distinctRiEmails = await ReviewItem.distinct("reviewerEmail", {
        campaignId: campaign._id,
      });
      for (const e of distinctRiEmails) {
        const clean = String(e || "")
          .trim()
          .toLowerCase();
        if (clean) reviewerEmailsToNotify.add(clean);
      }
    } catch {
      // best-effort
    }

    // Build a name lookup from reviewersAssigned for the email greeting
    const reviewerNameByEmail = new Map();
    for (const r of reviewers) {
      const e = (r.email || "").trim().toLowerCase();
      if (e && r.name) reviewerNameByEmail.set(e, r.name);
    }

    for (const to of reviewerEmailsToNotify) {
      try {
        const {
          itemDecisions,
          approveAllToken,
          revokeAllToken,
          scopeItems,
          reviewerJwt,
        } = await buildReviewerEmailTokens(campaign, to);
        if (scopeItems.length === 0) continue;
        const reviewerName = reviewerNameByEmail.get(to) || to.split("@")[0];
        const { subject, html } = await buildCertificationAssignmentEmail({
          reviewerName,
          campaignName: campaign.name,
          campaignId: campaign._id.toString(),
          dueDate: campaign.dueDate,
          itemDecisions,
          approveAllToken,
          revokeAllToken,
          scopeItems,
          reviewerJwt,
          category: campaign.category || "",
        });
        await enqueueCertificationEmail({
          type: "LAUNCH",
          campaignId: campaign._id,
          tenantId: campaign.tenantId,
          recipientEmail: to,
          subject,
          html,
          metadata: { reviewerEmail: to, campaignId: campaign._id.toString() },
        });
      } catch (emailErr) {
        console.error(
          `[AccessCert] Activation email failed for ${to}:`,
          emailErr.message,
        );
      }
    }

    return res.json({ success: true, data: campaign });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteCampaigns = async (req, res) => {
  try {
    // Accept body `{ ids }` (preferred) or query `?ids=a,b` (axios DELETE fallback).
    let ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length && req.query?.ids != null) {
      const raw = Array.isArray(req.query.ids)
        ? req.query.ids
        : String(req.query.ids).split(",");
      ids = raw.map((x) => String(x).trim()).filter(Boolean);
    }
    const objectIds = ids.map(asObjectId).filter(Boolean);

    if (!objectIds.length) {
      return res
        .status(400)
        .json({ success: false, message: "No valid campaign ids provided" });
    }

    const userTenantId = await resolveUserTenantId(req);
    if (!userTenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }

    const campaigns = await Campaign.find({ _id: { $in: objectIds } })
      .select("_id applicationId createdBy tenantId")
      .lean();

    // If any campaign id doesn't exist, treat it as "not found".
    if (campaigns.length !== objectIds.length) {
      throw new AppError("Campaign not found", 404, "NOT_FOUND");
    }

    const appIds = campaigns.map((c) => c.applicationId).filter(Boolean);
    const apps = appIds.length
      ? await Application.find({ _id: { $in: appIds } })
          .select("_id tenantId")
          .lean()
      : [];
    const appTenantById = new Map(
      apps.map((a) => [String(a._id), String(a.tenantId)]),
    );

    const createdByIds = campaigns.map((c) => c.createdBy).filter(Boolean);
    const users = createdByIds.length
      ? await User.find({ _id: { $in: createdByIds } })
          .select("_id tenantId")
          .lean()
      : [];
    const userTenantById = new Map(
      users.map((u) => [String(u._id), String(u.tenantId)]),
    );

    const allowedCampaignIds = [];
    for (const c of campaigns) {
      const tenantCandidates = [];
      if (c.tenantId) tenantCandidates.push(String(c.tenantId));
      if (c.applicationId) {
        const t = appTenantById.get(String(c.applicationId));
        if (t) tenantCandidates.push(t);
      }
      if (c.createdBy) {
        const t = userTenantById.get(String(c.createdBy));
        if (t) tenantCandidates.push(t);
      }

      const ok = tenantCandidates.some((t) => t === String(userTenantId));
      if (!ok) {
        throw new AppError("Campaign not found", 404, "NOT_FOUND");
      }
      allowedCampaignIds.push(c._id);
    }

    const [campaignDelete, reviewItemsDelete] = await Promise.all([
      Campaign.deleteMany({ _id: { $in: allowedCampaignIds } }),
      ReviewItem.deleteMany({
        campaignId: { $in: allowedCampaignIds },
      }),
    ]);

    return res.json({
      success: true,
      data: {
        deletedCampaigns: campaignDelete.deletedCount,
        deletedReviewItems: reviewItemsDelete.deletedCount,
      },
    });
  } catch (err) {
    const status = err?.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: err.message,
      code: err?.code,
    });
  }
};

export const backfillAccessContext = async (req, res) => {
  try {
    const campaignId = asObjectId(req.params.id);
    const userTenantId = await resolveUserTenantId(req);
    if (!userTenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }

    // If a specific campaign is provided, validate and update only that one.
    if (campaignId) {
      await assertTenantForCampaign(req, campaignId, { notFound: true });
      const result = await Campaign.updateMany(
        { _id: campaignId, sourceContext: { $exists: false } },
        {
          $set: {
            sourceContext: {
              backfilledAt: new Date(),
              source: "access-certification-backfill",
            },
          },
        },
      );

      return res.json({
        success: true,
        data: {
          matched: result.matchedCount,
          modified: result.modifiedCount,
        },
      });
    }

    // Tenant scoping for the "backfill all" case.
    const tenantApplicationIds = await getTenantApplicationIds(userTenantId);

    const updateAppScoped = await Campaign.updateMany(
      {
        applicationId: { $in: tenantApplicationIds },
        sourceContext: { $exists: false },
      },
      {
        $set: {
          sourceContext: {
            backfilledAt: new Date(),
            source: "access-certification-backfill",
          },
        },
      },
    );

    // Org-wide MANAGER campaigns (no applicationId) are scoped by campaign.createdBy user's tenant.
    const tenantUsers = await User.find({ tenantId: userTenantId })
      .select("_id")
      .lean();
    const tenantUserIds = tenantUsers.map((u) => u._id);

    const managerCampaignIds = await Campaign.find({
      category: "MANAGER",
      createdBy: { $in: tenantUserIds },
      $or: [{ applicationId: { $exists: false } }, { applicationId: null }],
    })
      .select("_id")
      .lean();

    const managerIds = managerCampaignIds.map((c) => c._id);

    const updateManagerScoped = managerIds.length
      ? await Campaign.updateMany(
          { _id: { $in: managerIds }, sourceContext: { $exists: false } },
          {
            $set: {
              sourceContext: {
                backfilledAt: new Date(),
                source: "access-certification-backfill",
              },
            },
          },
        )
      : { matchedCount: 0, modifiedCount: 0 };

    return res.json({
      success: true,
      data: {
        matched:
          updateAppScoped.matchedCount + updateManagerScoped.matchedCount,
        modified:
          updateAppScoped.modifiedCount + updateManagerScoped.modifiedCount,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
