import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import Application from "../../models/application/Application.js";
import Identity from "../../models/identity/Identity.js";
import User from "../../models/platform/User.js";
import Tenant from "../../models/platform/Tenant.js";
import GlobalSettings from "../../models/certification/EmailReminderSettings.js";
import { AppError } from "../../middleware/errorHandler.js";
import { resolveCertificationAccessTenantId as resolveUserTenantId } from "../../utils/access-certification/resolveCertificationAccessTenantId.js";
import { getTenantCampaignScopeQuery } from "../../utils/access-certification/certificationTenantScope.js";
import { generateReviewerToken } from "../../services/access-certification/certificationTokenService.js";
import { buildCertificationReminderEmail } from "../../services/email/appEmailService.js";
import {
  enqueueCertificationEmail,
  resolveEffectiveFreqForCampaign,
} from "../../services/email/emailJobService.js";
import { computeReminderWindow } from "../../services/email/reminderWindow.js";
import { deliverEmailJobNow } from "../../services/email/deliverEmailJobNow.js";
import { buildReviewerEmailTokens } from "../../services/access-certification/certificationScopeService.js";
import { countPendingEntitlementsByReviewerForCampaign } from "../../services/access-certification/reviewItemService.js";
import { pickFromRawData, resolveUserName } from "../../utils/access-certification/certificationUserDisplay.js";
import { resolveMappedManagerEmail } from "../../utils/access-certification/mappedUserResolver.js";
import {
  asObjectId, getUserId, assertTenantForCampaign, getOrCreateGlobalSettings,
  computeCampaignAnalytics, deriveReviewersFromPendingReviewItems, FINAL_DECISIONS_SET,
  getTenantApplicationIds,
} from "./certificationControllerHelpers.js";
import { resolveMappedUserModel } from "../../utils/access-certification/mappedUserResolver.js";

function normalizeText(value) {
  const text = String(value || "").trim();
  return text || "";
}

async function resolveCertificationUserModel(applicationName, tenantId) {
  return resolveMappedUserModel({ name: applicationName, tenantId });
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

async function loadOrgWideUsers(tenantId) {
  const filter = tenantId ? { tenantId } : {};
  const applications = await Application.find(filter)
    .select("_id name tenantId")
    .lean();
  const seen = new Map();
  for (const app of applications || []) {
    try {
      const UsersModel = await resolveCertificationUserModel(
        app.name,
        app.tenantId,
      );
      const users = await UsersModel.find({}).lean();
      for (const u of users) {
        const key =
          u.user_id ||
          u.primaryKey ||
          u.email ||
          u.rawData?.["Employee ID"] ||
          u.rawData?.["Email Address"] ||
          u._id?.toString();
        if (key && !seen.has(key)) {
          seen.set(key, { ...u, rawData: u.rawData || {} });
        }
      }
    } catch {
      // Skip apps with no user collection
    }
  }
  return Array.from(seen.values());
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
    if (!mgrEmail) {
      mgrEmail =
        (poolSource &&
          (() => {
            const t = mgrName.toLowerCase().replace(/\s+/g, ".");
            for (const cand of poolSource) {
              const cr = cand.rawData || {};
              const resolved = String(resolveUserEmail(cand, cr) || cand.email || "")
                .trim()
                .toLowerCase();
              if (resolved && resolved.includes("@")) {
                const local = resolved.split("@")[0];
                if (local === t) return resolved;
              }
            }
            return "";
          })()) ||
        "";
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

export const getOrgWideManagers = async (req, res, next) => {
  try {
    const userTenantId = await resolveUserTenantId(req);
    if (!userTenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }

    const applications = await Application.find({ tenantId: userTenantId })
      .select("_id name tenantId")
      .lean();
    const allUsers = [];
    for (const app of applications || []) {
      try {
        const UsersModel = await resolveCertificationUserModel(
          app.name,
          app.tenantId,
        );
        const users = await UsersModel.find({}).lean();
        for (const u of users) {
          allUsers.push({ ...u, _originalData: u.rawData || {} });
        }
      } catch {
        // Skip apps with no user collection or errors
      }
    }
    const managers = await enrichManagerEmailsFromIdentities(
      extractManagersFromUsers(allUsers),
      undefined,
      userTenantId,
    );
    return res.json({ success: true, data: { managers } });
  } catch (err) {
    return next(err);
  }
};

export const updateReminderSettings = async (req, res) => {
  try {
    const userId = getUserId(req);
    const userTenantId = await resolveUserTenantId(req);
    if (!userTenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }
    const settings = await getOrCreateGlobalSettings(userId, userTenantId);

    settings.frequency = req.body.frequency || settings.frequency;
    if (typeof req.body.dayOfWeek === "number")
      settings.dayOfWeek = req.body.dayOfWeek;
    if (typeof req.body.dayOfMonth === "number")
      settings.dayOfMonth = req.body.dayOfMonth;
    if (typeof req.body.isActive === "boolean")
      settings.isActive = req.body.isActive;

    if (req.body.autoIdentityCertification) {
      settings.autoIdentityCertification = {
        ...(settings.autoIdentityCertification || {}),
        ...req.body.autoIdentityCertification,
      };
    }

    if (req.body.autoPrivilegedCertification) {
      settings.autoPrivilegedCertification = {
        ...(settings.autoPrivilegedCertification || {}),
        ...req.body.autoPrivilegedCertification,
      };
    }

    settings.updatedAt = new Date();
    if (userId) settings.updatedBy = userId;

    await settings.save();
    const tenant = await Tenant.findById(userTenantId).select("name").lean();
    const payload =
      typeof settings.toObject === "function" ? settings.toObject() : settings;
    return res.json({
      success: true,
      data: {
        ...payload,
        tenantId: userTenantId,
        tenantName: tenant?.name || null,
        scope: "tenant",
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getReminderSettings = async (req, res) => {
  try {
    const userId = getUserId(req);
    const userTenantId = await resolveUserTenantId(req);
    if (!userTenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }
    const settings = await getOrCreateGlobalSettings(userId, userTenantId);
    const tenant = await Tenant.findById(userTenantId).select("name").lean();
    const payload =
      typeof settings.toObject === "function" ? settings.toObject() : settings;
    return res.json({
      success: true,
      data: {
        ...payload,
        tenantId: userTenantId,
        tenantName: tenant?.name || null,
        scope: "tenant",
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const runReminderNow = async (req, res) => {
  try {
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
    const tenantUserIds = tenantUsers.map((u) => u._id);

    // Keep Analytics tenant-scoping aligned with "All Campaigns" list semantics.
    // NOTE: we also add back-compat clauses for older records missing tenantId.
    const tenantCampaignBase = {
      $or: [
        // Application-scoped campaigns
        { applicationId: { $in: tenantApplicationIds } },
        // Profile / Governance scoped campaigns store tenantId directly.
        { tenantId: userTenantId },
        // Back-compat: include tenant user's campaigns even if tenantId was not set on the campaign document.
        { createdBy: { $in: tenantUserIds } },
        // Back-compat: some legacy campaigns may only reference tenant users via reviewer assignment metadata.
        { "reviewersAssigned.reviewerId": { $in: tenantUserIds } },
        { "reviewersAssigned.assignedBy.userId": { $in: tenantUserIds } },
        // Org-wide MANAGER campaigns (no applicationId): tenant derived from campaign.createdBy user tenantId
        {
          category: "MANAGER",
          createdBy: { $in: tenantUserIds },
          $or: [{ applicationId: { $exists: false } }, { applicationId: null }],
        },
      ],
    };

    const activeCount = await Campaign.countDocuments({
      ...tenantCampaignBase,
      status: { $in: ["Active", "DecisionPending"] },
    });
    const userId = getUserId(req);
    const settings = await getOrCreateGlobalSettings(userId, userTenantId);
    settings.lastReminderRunAt = new Date();
    await settings.save();

    return res.json({
      success: true,
      data: {
        message: "Reminder run simulated",
        activeCampaigns: activeCount,
        ranAt: settings.lastReminderRunAt,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const triggerCampaignReminder = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }

    await assertTenantForCampaign(req, req.params.id, { notFound: true });

    const pendingByEmail = await countPendingEntitlementsByReviewerForCampaign(
      campaign._id,
    );
    const riCount = await ReviewItem.countDocuments({
      campaignId: campaign._id,
    });

    const currentReviewIsEmpty = riCount === 0;

    const totalSelectedIds = Array.isArray(campaign.selectedIds)
      ? campaign.selectedIds.length
      : 0;
    const fallbackPendingCount =
      currentReviewIsEmpty && totalSelectedIds > 0 ? totalSelectedIds : null;

    const baseReviewers = Array.isArray(campaign.reviewersAssigned)
      ? campaign.reviewersAssigned
      : [];
    const derivedFromCurrent = await deriveReviewersFromPendingReviewItems(
      campaign._id,
    );
    const reviewers = [...baseReviewers];
    for (const r of derivedFromCurrent) {
      const key = String(r?.email || r?.reviewerEmail || "")
        .trim()
        .toLowerCase();
      const hasExisting = reviewers.some(
        (existing) =>
          String(existing?.email || existing?.reviewerEmail || "")
            .trim()
            .toLowerCase() === key,
      );
      if (!hasExisting && key) reviewers.push({ ...r, email: r.email || key });
    }
    // Resolve the campaign's effective reminder cadence once so the manual path
    // computes the exact same frequency window the scheduler uses.
    const effectiveFreq = await resolveEffectiveFreqForCampaign(campaign._id);
    const reminderWindow = computeReminderWindow({
      reminderType: "STANDARD",
      effectiveFreq,
    });
    const nextEligibleAt = reminderWindow.windowEnd;

    let emailsSent = 0;
    let attemptedRecipients = 0;
    let skippedNoPending = 0;
    let skippedDuplicate = 0;
    let failedDeliveries = 0;
    const reviewersWithPending = [];
    const skippedInWindow = [];
    const deliveryErrors = [];

    const shortError = (msg) =>
      String(msg || "Email delivery failed").split("\n")[0].slice(0, 280);

    const deliverManualReminderJob = async (jobId, recipient) => {
      const delivery = await deliverEmailJobNow(jobId);
      if (delivery.ok) {
        emailsSent++;
        return;
      }
      failedDeliveries++;
      deliveryErrors.push({
        to: recipient,
        error: shortError(delivery.error),
        emailJobId: delivery.emailJobId || String(jobId),
        status: delivery.status || "FAILED",
      });
    };

    for (const reviewer of reviewers) {
      const to = String(reviewer.email || reviewer.reviewerEmail || "")
        .trim()
        .toLowerCase();
      if (!to) continue;
      try {
        const {
          itemDecisions,
          approveAllToken,
          revokeAllToken,
          scopeItems,
          reviewerJwt,
        } = await buildReviewerEmailTokens(campaign, to);
        const pendingCount = pendingByEmail[to] ?? fallbackPendingCount;
        const scopeCount = Array.isArray(scopeItems) ? scopeItems.length : 0;
        const tokenCount = Array.isArray(itemDecisions)
          ? itemDecisions.length
          : 0;
        const effectivePending = Math.max(
          pendingCount ?? 0,
          scopeCount,
          tokenCount,
        );
        if (effectivePending <= 0) {
          skippedNoPending++;
          continue;
        }
        reviewersWithPending.push(to);
        attemptedRecipients++;

        const { subject, html } = await buildCertificationReminderEmail({
          reviewerName: reviewer.name || reviewer.email,
          campaignName: campaign.name,
          campaignId: campaign._id.toString(),
          dueDate: campaign.dueDate,
          pendingCount: effectivePending,
          itemDecisions,
          approveAllToken,
          revokeAllToken,
          scopeItems,
          reviewerJwt,
          category: campaign.category || "",
        });
        const job = await enqueueCertificationEmail({
          type: "REMINDER",
          campaignId: campaign._id,
          tenantId: campaign.tenantId,
          recipientEmail: to,
          subject,
          html,
          reminderSubtype: effectiveFreq || campaign.reminderFrequency || "GLOBAL",
          effectiveFreq,
          metadata: { reviewerEmail: to, manual: true, actorId: req.user?.id },
        });

        if (!job) {
          // Reservation guard blocked it: a reminder was already sent or is
          // already reserved for this reviewer in the current frequency window.
          skippedDuplicate++;
          skippedInWindow.push(to);
          continue;
        }

        // Reservation won — deliver immediately (fail-fast with SMTP error).
        await deliverManualReminderJob(job._id, to);
      } catch (emailErr) {
        console.error(
          `[AccessCert] Failed to send reminder email to ${to}:`,
          emailErr.message,
        );
        failedDeliveries++;
        deliveryErrors.push({
          to,
          error: shortError(emailErr.message),
        });
      }
    }

    const primaryError = deliveryErrors[0]?.error || null;

    campaign.history = [
      ...(campaign.history || []),
      {
        at: new Date(),
        by: req.user?.id || "system",
        action: "manual_reminder_triggered",
        emailsSent,
        attemptedRecipients,
        skippedNoPending,
        skippedDuplicate,
        failedDeliveries,
        deliveryError: primaryError || undefined,
      },
    ];
    await campaign.save();

    return res.json({
      success: true,
      data: {
        message:
          failedDeliveries > 0 && emailsSent === 0
            ? "Campaign reminder failed"
            : emailsSent > 0
              ? "Campaign reminder sent"
              : skippedDuplicate > 0
                ? "Already reminded this cycle"
                : "Campaign reminder processed",
        emailsSent,
        attemptedRecipients,
        skippedNoPending,
        skippedDuplicate,
        skippedInWindow,
        nextEligibleAt,
        failedDeliveries,
        reviewersWithPending,
        deliveryErrors,
        lastError: primaryError,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export { updateOwnerAction } from "./campaignOwnerActionController.js";

export const getDashboardStats = async (req, res) => {
  try {
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
    const tenantUserIds = tenantUsers.map((u) => u._id);

    // Tenant scoping must match Access Certification "All Campaigns" list.
    // IMPORTANT: Avoid overly-broad fallbacks (like createdBy-only) because they can
    // pull campaigns from other tenants and cause Analytics count to diverge.
    const tenantCampaignBase = {
      $or: [
        // Application-scoped campaigns
        { applicationId: { $in: tenantApplicationIds } },
        // Profile / Governance scoped campaigns store tenantId directly.
        { tenantId: userTenantId },
        // Org-wide MANAGER campaigns (no applicationId): tenant derived from campaign.createdBy user tenantId
        {
          category: "MANAGER",
          createdBy: { $in: tenantUserIds },
          $or: [{ applicationId: { $exists: false } }, { applicationId: null }],
        },
      ],
    };

    const campaigns = await Campaign.find(tenantCampaignBase)
      .select(
        "name category status certificationScope identityProfileId tenantId applicationName applicationId startDate createdAt dueDate totalScope itemsReviewed completedItems results reviewersAssigned selectedIds",
      )
      .populate("applicationId", "name applicationName")
      .sort({ createdAt: -1 })
      .lean();

    const tenantCampaignIds = campaigns.map((c) => c._id);

    const riProgress =
      tenantCampaignIds.length > 0
        ? await ReviewItem.aggregate([
            { $match: { campaignId: { $in: tenantCampaignIds } } },
            {
              $group: {
                _id: "$campaignId",
                total: { $sum: 1 },
                completed: {
                  $sum: { $cond: [{ $ne: ["$status", "PENDING"] }, 1, 0] },
                },
              },
            },
          ])
        : [];
    const riByCampaign = new Map(
      riProgress.map((x) => [
        String(x._id),
        { total: x.total, completed: x.completed },
      ]),
    );

    const [totalReviewItems, pendingReviewItems] = await Promise.all([
      tenantCampaignIds.length
        ? ReviewItem.countDocuments({
            campaignId: { $in: tenantCampaignIds },
          })
        : Promise.resolve(0),
      tenantCampaignIds.length
        ? ReviewItem.countDocuments({
            campaignId: { $in: tenantCampaignIds },
            status: "PENDING",
          })
        : Promise.resolve(0),
    ]);

    const now = new Date();
    const userProgress = {
      identity: { reviewed: 0, total: 0 },
      manager: { reviewed: 0, total: 0 },
      access: { reviewed: 0, total: 0 },
    };
    const expiredCounts = {
      identity: 0,
      manager: 0,
      access: 0,
    };

    const dashboardCampaigns = campaigns.map((campaign) => {
      const statusRaw = String(campaign.status || "");
      const statusLower = statusRaw.toLowerCase();
      const dueDate = campaign.dueDate ? new Date(campaign.dueDate) : null;
      const isCompleted = ["completed", "closed"].includes(statusLower);
      const isExpired = Boolean(dueDate && dueDate < now && !isCompleted);

      const reviewedFromResults = Array.isArray(campaign.results)
        ? campaign.results.filter((r) =>
            FINAL_DECISIONS_SET.has(String(r?.decision || "")),
          ).length
        : 0;

      const num = (v) =>
        Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
      let itemsReviewed = Math.max(
        num(campaign.completedItems),
        num(campaign.itemsReviewed),
        reviewedFromResults,
        0,
      );

      let totalScope = Math.max(
        Number(campaign.totalScope) || 0,
        Array.isArray(campaign.selectedIds) ? campaign.selectedIds.length : 0,
        Array.isArray(campaign.results) ? campaign.results.length : 0,
        itemsReviewed,
      );

      const ri = riByCampaign.get(String(campaign._id));
      if (ri && ri.total > 0) {
        itemsReviewed = Math.max(itemsReviewed, ri.completed);
        totalScope = Math.max(totalScope, ri.total);
      }

      const categoryUpper = String(
        campaign.category || "ACCESS_ITEMS",
      ).toUpperCase();
      const categoryKey = categoryUpper.includes("IDENTITY")
        ? "identity"
        : categoryUpper.includes("MANAGER")
          ? "manager"
          : "access";

      userProgress[categoryKey].total += totalScope;
      userProgress[categoryKey].reviewed += itemsReviewed;
      if (isExpired) expiredCounts[categoryKey] += 1;

      const scopeUpper = String(campaign.certificationScope || "").toUpperCase();
      const isProfileLevel =
        scopeUpper === "PROFILE" ||
        scopeUpper === "GOVERNANCE" ||
        Boolean(campaign.identityProfileId);
      const appName = isProfileLevel
        ? "Profile Level"
        : (
            campaign.applicationName ||
            campaign.applicationId?.name ||
            campaign.applicationId?.applicationName ||
            "Application Level"
          );

      return {
        _id: campaign._id,
        id: String(campaign._id),
        name: campaign.name,
        category: campaign.category,
        status: campaign.status,
        certificationScope: campaign.certificationScope || undefined,
        identityProfileId: campaign.identityProfileId || undefined,
        appName,
        applicationName: appName,
        createdAt: campaign.createdAt || campaign.startDate || null,
        startDate: campaign.startDate || null,
        dueDate: campaign.dueDate || null,
        totalScope,
        itemsReviewed,
        progressVal: itemsReviewed,
        progressTot: totalScope,
        isExpired,
        isCompleted,
        progress: {
          reviewed: itemsReviewed,
          total: totalScope,
          percentage:
            totalScope > 0 ? Math.round((itemsReviewed / totalScope) * 100) : 0,
        },
      };
    });

    const totalCampaigns = dashboardCampaigns.length;
    const activeCampaigns = dashboardCampaigns.filter((c) =>
      ["active", "decisionpending", "endphase"].includes(
        String(c.status || "").toLowerCase(),
      ),
    ).length;
    const completedCampaigns = dashboardCampaigns.filter((c) =>
      ["completed", "closed"].includes(String(c.status || "").toLowerCase()),
    ).length;

    return res.json({
      success: true,
      data: {
        totalCampaigns,
        activeCampaigns,
        completedCampaigns,
        totalReviewItems,
        pendingReviewItems,
        campaigns: dashboardCampaigns,
        userProgress,
        expiredCounts,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getAutoIdentitySettings = async (req, res) => {
  try {
    const userId = getUserId(req);
    const userTenantId = await resolveUserTenantId(req);
    if (!userTenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }
    const settings = await getOrCreateGlobalSettings(userId, userTenantId);

    return res.json({
      success: true,
      data: settings.autoIdentityCertification || {
        enabled: false,
        defaultDueDays: 7,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateAutoIdentitySettings = async (req, res) => {
  try {
    const userId = getUserId(req);
    const userTenantId = await resolveUserTenantId(req);
    if (!userTenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }
    const settings = await getOrCreateGlobalSettings(userId, userTenantId);

    settings.autoIdentityCertification = {
      ...(settings.autoIdentityCertification || {
        enabled: false,
        defaultDueDays: 7,
      }),
      ...req.body,
    };
    settings.updatedAt = new Date();
    if (userId) settings.updatedBy = userId;

    await settings.save();
    return res.json({
      success: true,
      data: settings.autoIdentityCertification,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const debugAutoIdentity = async (req, res) => {
  try {
    const appId = asObjectId(req.params.appId);
    if (!appId) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid app id" });
    }

    const [application, campaignCount] = await Promise.all([
      Application.findById(appId).lean(),
      Campaign.countDocuments({ applicationId: appId, category: "IDENTITY" }),
    ]);

    return res.json({
      success: true,
      data: {
        application,
        identityCampaignCount: campaignCount,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getAutoPrivilegedSettings = async (req, res) => {
  try {
    const userId = getUserId(req);
    const userTenantId = await resolveUserTenantId(req);
    if (!userTenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }
    const settings = await getOrCreateGlobalSettings(userId, userTenantId);

    return res.json({
      success: true,
      data: settings.autoPrivilegedCertification || {
        enabled: false,
        defaultDueDays: 7,
        notifyTarget: "OWNER",
        includeAllAccessItems: false,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateAutoPrivilegedSettings = async (req, res) => {
  try {
    const userId = getUserId(req);
    const userTenantId = await resolveUserTenantId(req);
    if (!userTenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }
    const settings = await getOrCreateGlobalSettings(userId, userTenantId);

    settings.autoPrivilegedCertification = {
      ...(settings.autoPrivilegedCertification || {
        enabled: false,
        defaultDueDays: 7,
        notifyTarget: "OWNER",
        includeAllAccessItems: false,
      }),
      ...req.body,
    };
    settings.updatedAt = new Date();
    if (userId) settings.updatedBy = userId;

    await settings.save();
    return res.json({
      success: true,
      data: settings.autoPrivilegedCertification,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const debugAutoPrivileged = async (req, res) => {
  try {
    const appId = asObjectId(req.params.appId);
    if (!appId) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid app id" });
    }

    const [application, campaignCount] = await Promise.all([
      Application.findById(appId).lean(),
      Campaign.countDocuments({
        applicationId: appId,
        campaignMode: "PRIVILEGED_ONLY",
      }),
    ]);

    return res.json({
      success: true,
      data: {
        application,
        privilegedCampaignCount: campaignCount,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Tenant-scoped application listing for certification wizard
// ─────────────────────────────────────────────────────────────────────────────
export const getApplicationsList = async (req, res, next) => {
  try {
    const userTenantId = await resolveUserTenantId(req);
    if (!userTenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }
    const apps = await Application.find({ tenantId: userTenantId })
      .select("_id name type")
      .lean();
    return res.json({ success: true, data: apps });
  } catch (err) {
    return next(err);
  }
};
