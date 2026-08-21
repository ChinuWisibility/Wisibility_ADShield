import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import Entitlement from "../../models/access/Entitlement.js";
import Identity from "../../models/identity/Identity.js";
import IdentityAccountLink from "../../models/identity/IdentityAccountLink.js";
import SodPolicy from "../../models/sod/SodPolicy.js";
import SodViolation from "../../models/sod/SodViolation.js";
import SodEntitlement from "../../models/sod/SodEntitlement.js";
import SodUserEntitlement from "../../models/sod/SodUserEntitlement.js";
import SodUserIdentity from "../../models/sod/SodUserIdentity.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import { sodTenantFilter, sodWithTenant } from "../../utils/sod/sodTenant.js";
import {
  extractEntitlementTokensFromAppUser,
  humanizeLocalPartFromEmail,
  isLikelyMongoObjectId,
  normalizeSodToken,
  pickSodUserKeyFromAppUser,
  resolveDepartmentForAppUser,
  resolveDisplayNameForAppUser,
  resolveEmailForAppUser,
} from "../../utils/sod/sodAppUserEntitlements.js";
import { logSodAudit } from "./sodAuditService.js";

export async function nextPolicyIdForTenant(scopedTenantId) {
  const filter = sodTenantFilter(scopedTenantId);
  const rows = await SodPolicy.find({
    ...filter,
    policyId: { $regex: /^POL-\d+$/i },
  })
    .select("policyId")
    .lean();
  let max = 99;
  for (const r of rows) {
    const m = String(r.policyId || "").match(/^POL-(\d+)$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `POL-${max + 1}`;
}

export async function refreshPolicyViolationCounts(scopedTenantId, policyMongoId) {
  const tf = sodTenantFilter(scopedTenantId);
  const match = { ...tf, policy: policyMongoId };
  const [totalViolations, openViolations] = await Promise.all([
    SodViolation.countDocuments(match),
    SodViolation.countDocuments({ ...match, status: "open" }),
  ]);
  await SodPolicy.updateOne(
    { ...tf, _id: policyMongoId },
    { $set: { totalViolations, openViolations } },
  ).catch(() => {});
}

async function resolveEntitlementLabelById(entitlementId) {
  const id = String(entitlementId || "").trim();
  if (!mongoose.isValidObjectId(id)) return "";
  const oid = new mongoose.Types.ObjectId(id);
  const se = await SodEntitlement.findById(oid)
    .select("entitlementName sourceValue name value")
    .lean();
  if (se) {
    return String(se.entitlementName || se.sourceValue || se.name || se.value || "").trim();
  }
  const ce = await Entitlement.findById(oid).select("entitlementName name displayName value sourceValue").lean();
  if (ce) {
    return String(ce.entitlementName || ce.name || ce.displayName || ce.value || ce.sourceValue || "").trim();
  }
  return "";
}

async function buildRuleTokenSet(values, ids) {
  const normSet = new Set();
  for (const v of values || []) {
    const n = normalizeSodToken(v);
    if (n) normSet.add(n);
  }
  for (const rawId of ids || []) {
    const label = await resolveEntitlementLabelById(rawId);
    const n = normalizeSodToken(label);
    if (n) normSet.add(n);
  }
  return normSet;
}

/**
 * Builds a lookup map from "<appOid>_<accountKey>" → identity metadata using
 * IdentityAccountLink. This enables SailPoint-style identity-centric conflict
 * detection: the same identity may have accounts with different usernames in
 * different apps, but they all resolve to one stable identity key (identity email).
 * @returns {Map<string, { identityId, email, displayName, department }>}
 */
async function buildIdentityCorrelationMap(appIds) {
  if (!appIds.length) return new Map();

  const links = await IdentityAccountLink.find({
    applicationId: { $in: appIds },
    isActive: true,
    correlationStatus: "correlated",
  })
    .select("identityId applicationId accountId")
    .lean();

  if (!links.length) return new Map();

  const identityIds = [...new Set(links.map((l) => l.identityId?.toString()).filter(Boolean))];
  const identities = await Identity.find({ _id: { $in: identityIds } })
    .select("_id email displayName firstName lastName department")
    .lean();

  const identityMap = new Map(identities.map((i) => [i._id.toString(), i]));
  const corrMap = new Map();

  for (const link of links) {
    const identity = identityMap.get(link.identityId?.toString());
    if (!identity) continue;
    const appKey = link.applicationId?.toString() || "";
    const accountKey = String(link.accountId || "").trim().toLowerCase();
    if (!appKey || !accountKey) continue;
    corrMap.set(`${appKey}_${accountKey}`, {
      identityId: identity._id,
      email: String(identity.email || "").trim().toLowerCase(),
      displayName:
        String(identity.displayName || "").trim() ||
        [identity.firstName, identity.lastName].filter(Boolean).join(" ").trim() ||
        "",
      department: String(identity.department || "").trim(),
    });
  }
  return corrMap;
}

/**
 * Per identity: normalized token -> display token (original casing for violations).
 * Uses IdentityAccountLink to unify accounts across applications under one identity key,
 * so cross-app SoD conflicts are detected correctly.
 * @returns {Map<string, { identityId, userDisplayName, department, identityEmail, tokens }>}
 */
async function buildUserEntitlementIndex(ctx, policy) {
  const base = sodTenantFilter(ctx.scopedTenantId);
  const index = new Map();

  const add = (userKey, identityId, displayName, tokenRaw, department = "", resolvedEmail = "") => {
    const t = String(tokenRaw || "").trim();
    if (!userKey || !t) return;
    const norm = normalizeSodToken(t);
    if (!norm) return;
    const dept = String(department || "").trim();
    const em = String(resolvedEmail || "").trim().toLowerCase();
    const emailNorm = em.includes("@") ? em : "";

    if (!index.has(userKey)) {
      const dn0 = String(displayName || "").trim();
      index.set(userKey, {
        identityId: identityId || null,
        userDisplayName:
          (dn0 && !isLikelyMongoObjectId(dn0) ? dn0 : "") ||
          (!isLikelyMongoObjectId(userKey) ? String(userKey) : "") ||
          "",
        department: dept,
        identityEmail: emailNorm || (String(userKey).includes("@") ? String(userKey).trim().toLowerCase() : ""),
        tokens: new Map(),
      });
    } else {
      const entry = index.get(userKey);
      if (identityId && !entry.identityId) entry.identityId = identityId;
      if (dept && !entry.department) entry.department = dept;
      if (emailNorm && !entry.identityEmail) entry.identityEmail = emailNorm;
      const dn = String(displayName || "").trim();
      if (dn && !dn.includes("@") && !isLikelyMongoObjectId(dn)) {
        const cur = entry.userDisplayName;
        if (
          !cur ||
          cur === userKey ||
          String(cur).includes("@") ||
          isLikelyMongoObjectId(cur)
        ) {
          entry.userDisplayName = dn;
        }
      }
    }
    const entry = index.get(userKey);
    if (!entry.tokens.has(norm)) entry.tokens.set(norm, t);
  };

  const appRefs = Array.isArray(policy.applications) ? policy.applications : [];
  const appIds = appRefs
    .map((id) => {
      try {
        return id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // Build the identity correlation map once for all apps in this policy.
  // When a match is found, the account's native key (email / username) is
  // replaced by the correlated identity's email so that accounts across
  // different apps belonging to the same person are merged under one key.
  const corrMap = await buildIdentityCorrelationMap(appIds);

  const resolveIdentityKey = (appOid, nativeKey) => {
    const corr = corrMap.get(`${appOid.toString()}_${nativeKey.toLowerCase()}`);
    if (!corr) return { key: nativeKey, identityId: null, email: "", displayName: "", department: "" };
    return {
      key: corr.email || nativeKey,
      identityId: corr.identityId,
      email: corr.email,
      displayName: corr.displayName,
      department: corr.department,
    };
  };

  for (const appOid of appIds) {
    const sodRows = await SodUserEntitlement.find({ ...base, applicationId: appOid })
      .select("userId userDisplayName entitlementValue entitlementId")
      .lean();
    for (const r of sodRows) {
      const nativeKey = String(r.userId || "").trim().toLowerCase();
      const { key, identityId, email, displayName, department } = resolveIdentityKey(appOid, nativeKey);
      const em = email || (nativeKey.includes("@") ? nativeKey : "");
      const dn = displayName || r.userDisplayName || humanizeLocalPartFromEmail(em || nativeKey);
      add(key, identityId, dn, r.entitlementValue, department, em);
      if (r.entitlementId) {
        const label = await resolveEntitlementLabelById(r.entitlementId);
        if (label) add(key, identityId, dn, label, department, em);
      }
    }

    const app = await Application.findById(appOid).select("name tenantId userMappings csvImportMapping").lean();
    if (!app?.name) continue;

    // Find the CSV column name that was mapped to member_of_entitlements during import.
    // That field is stripped from the top-level user doc (stays only in rawData under the
    // original CSV column name), so we must look it up precisely rather than using a broad scan.
    const allMappings = [
      ...(app.userMappings || []),
      ...(app.csvImportMapping?.mappings || []),
    ];
    const entMapping = allMappings.find((m) => m.standardField === "member_of_entitlements");
    const entRawKey = entMapping?.csvColumn || null;

    const UserModel = await getDynamicUserModelForTenantId(app.name, app.tenantId);
    let users = await UserModel.find({ applicationId: appOid }).lean();
    if (users.length === 0) {
      users = await UserModel.find({}).lean();
    }

    for (const u of users) {
      const raw = u.rawData && typeof u.rawData === "object" ? u.rawData : {};
      const appSchema = {
        userMappings: app.userMappings || [],
        csvImportMapping: app.csvImportMapping || null,
      };
      const nativeKey = pickSodUserKeyFromAppUser(u, raw, appSchema);
      if (!nativeKey) continue;
      const { key, identityId, email: corrEmail, displayName: corrDisplay, department: corrDept } = resolveIdentityKey(appOid, nativeKey);
      const display = corrDisplay || resolveDisplayNameForAppUser(u, raw, nativeKey, appSchema);
      const dept = corrDept || resolveDepartmentForAppUser(u, raw, appSchema);
      const emailResolved = corrEmail || resolveEmailForAppUser(u, raw, nativeKey, appSchema);
      for (const tok of extractEntitlementTokensFromAppUser(u, raw)) {
        add(key, identityId, display, tok, dept, emailResolved);
      }
      // Also pull from the specific rawData field mapped to member_of_entitlements,
      // since the import strips it from the top-level doc.
      const rawEntVal = entRawKey ? String(raw[entRawKey] || "").trim() : "";
      if (rawEntVal) {
        for (const tok of rawEntVal.split(/[|;,]+|\r?\n+/).map((x) => x.trim()).filter(Boolean)) {
          add(key, identityId, display, tok, dept, emailResolved);
        }
      }
    }
  }

  return index;
}

/**
 * @param {{ scopedTenantId?: string | null, user?: object }} ctx
 * @param {object[]} policies - lean SodPolicy docs
 */
export async function runSodEvaluationForPolicies(ctx, policies) {
  let created = 0;
  let autoResolved = 0;
  let scannedPolicies = 0;

  for (const p of policies) {
    scannedPolicies += 1;
    const rules = Array.isArray(p.rules) ? p.rules : [];
    const policyDisplayName = p.name || p.policyId || "Policy";

    if (rules.length === 0) {
      await SodPolicy.updateOne({ _id: p._id }, { $set: { lastScanDate: new Date() } }).catch(() => {});
      await refreshPolicyViolationCounts(ctx.scopedTenantId, p._id);
      continue;
    }

    const userIndex = await buildUserEntitlementIndex(ctx, p);

    for (const rule of rules.filter((r) => r?.isActive !== false)) {
      const leftIds = (rule.leftEntitlements || []).map((x) => String(x.id || "").trim()).filter(Boolean);
      const rightIds = (rule.rightEntitlements || []).map((x) => String(x.id || "").trim()).filter(Boolean);
      const leftValues = (rule.leftEntitlements || []).map((x) => String(x.name || "").trim()).filter(Boolean);
      const rightValues = (rule.rightEntitlements || []).map((x) => String(x.name || "").trim()).filter(Boolean);

      const leftNormSet = await buildRuleTokenSet(leftValues, leftIds);
      const rightNormSet = await buildRuleTokenSet(rightValues, rightIds);
      if (!leftNormSet.size || !rightNormSet.size) continue;

      const currentlyConflicting = new Set();

      for (const [userKey, { identityId: entryIdentityId, userDisplayName, department: userDept, identityEmail: entryEmail, tokens }] of userIndex) {
        const userNorms = new Set(tokens.keys());
        const hasLeft = [...leftNormSet].some((x) => userNorms.has(x));
        const hasRight = [...rightNormSet].some((x) => userNorms.has(x));
        if (!hasLeft || !hasRight) continue;

        let leftDisp = "";
        let rightDisp = "";
        outer: for (const ln of leftNormSet) {
          if (!userNorms.has(ln)) continue;
          for (const rn of rightNormSet) {
            if (!userNorms.has(rn)) continue;
            leftDisp = tokens.get(ln) || ln;
            rightDisp = tokens.get(rn) || rn;
            break outer;
          }
        }
        if (!leftDisp || !rightDisp) continue;

        const base = sodTenantFilter(ctx.scopedTenantId);
        const department = String(userDept || "").trim();
        let identityEmailNorm = String(entryEmail || "").trim().toLowerCase();
        if (!identityEmailNorm.includes("@")) {
          if (String(userKey).includes("@")) {
            identityEmailNorm = String(userKey).trim().toLowerCase();
          } else if (!isLikelyMongoObjectId(userKey)) {
            identityEmailNorm = String(userKey).trim().toLowerCase();
          } else {
            identityEmailNorm = "";
          }
        }
        // Stable conflict key even when email is missing (legacy / sparse HR rows)
        const conflictKey = identityEmailNorm || String(userKey).trim().toLowerCase();
        if (!conflictKey) continue;

        currentlyConflicting.add(conflictKey);

        let identityNameOut = String(userDisplayName || "").trim();
        if (isLikelyMongoObjectId(identityNameOut)) identityNameOut = "";
        if (
          !identityNameOut ||
          identityNameOut.includes("@") ||
          (identityEmailNorm.includes("@") &&
            identityNameOut.toLowerCase() === identityEmailNorm)
        ) {
          identityNameOut = humanizeLocalPartFromEmail(
            identityEmailNorm || (!isLikelyMongoObjectId(userKey) ? userKey : ""),
          );
        }
        if (!identityNameOut && !isLikelyMongoObjectId(userKey)) {
          identityNameOut = String(userKey).trim();
        }
        if (!identityNameOut) identityNameOut = "Unknown user";

        await SodUserIdentity.updateOne(
          { ...base, userId: String(userKey) },
          {
            $setOnInsert: sodWithTenant(ctx.scopedTenantId, {
              userId: String(userKey),
              displayName: identityNameOut,
            }),
          },
          { upsert: true },
        ).catch(() => {});

        const exists = await SodViolation.findOne({
          ...base,
          policy: p._id,
          identityEmail: conflictKey,
          ruleName: rule.name || "",
          "leftEntitlements.name": leftDisp,
          "rightEntitlements.name": rightDisp,
        }).lean();
        if (exists) continue;

        const violation = await SodViolation.create(
          sodWithTenant(ctx.scopedTenantId, {
            policy: p._id,
            policyName: policyDisplayName,
            ruleName: rule.name || "",
            ...(entryIdentityId ? { identity: entryIdentityId } : {}),
            identityName: identityNameOut,
            identityEmail: conflictKey,
            department,
            leftEntitlements: [{ name: leftDisp, applicationName: "" }],
            rightEntitlements: [{ name: rightDisp, applicationName: "" }],
            severity: p.severity || "MEDIUM",
            status: "open",
            detectedAt: new Date(),
          }),
        );
        created += 1;
        await logSodAudit(ctx, {
          entityType: "VIOLATION",
          entityId: violation._id,
          action: "CREATE",
          newValue: violation,
        });
      }

      const staleResult = await SodViolation.updateMany(
        {
          ...sodTenantFilter(ctx.scopedTenantId),
          policy: p._id,
          ruleName: rule.name || "",
          status: "open",
          identityEmail: { $nin: [...currentlyConflicting] },
        },
        {
          $set: {
            status: "remediated",
            remediatedBy: "system",
            remediatedAt: new Date(),
            remediationNotes: "Auto-resolved: conflicting access no longer detected",
          },
        },
      ).catch(() => ({ modifiedCount: 0 }));
      autoResolved += staleResult.modifiedCount ?? 0;
    }

    await SodPolicy.updateOne({ _id: p._id }, { $set: { lastScanDate: new Date() } }).catch(() => {});
    await refreshPolicyViolationCounts(ctx.scopedTenantId, p._id);
  }

  return { created, scannedPolicies, autoResolved };
}
