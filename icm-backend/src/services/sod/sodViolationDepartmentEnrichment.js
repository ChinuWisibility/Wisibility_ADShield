import mongoose from "mongoose";
import SodPolicy from "../../models/sod/SodPolicy.js";
import Application from "../../models/application/Application.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import { sodTenantFilter } from "../../utils/sod/sodTenant.js";
import {
  pickSodUserKeyFromAppUser,
  resolveDepartmentForAppUser,
  resolveManagerForAppUser,
  resolveDisplayNameForAppUser,
  resolveEmailForAppUser,
  isLikelyMongoObjectId,
} from "../../utils/sod/sodAppUserEntitlements.js";
import Identity from "../../models/identity/Identity.js";

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

/**
 * Map normalized user keys (email, login, user_id) → department from application user rows.
 */
export async function buildDepartmentLookupForPolicy(
  scopedTenantId,
  policyMongoId,
) {
  const userLookup = await buildUserLookupForPolicy(
    scopedTenantId,
    policyMongoId,
  );
  const deptByKey = new Map();
  for (const [k, v] of userLookup.entries()) {
    const d = String(v?.department || "").trim();
    if (d) deptByKey.set(k, d);
  }
  return deptByKey;
}

/**
 * Map normalized user keys (email, login, user_id, mongo id) -> user context used for enrichment.
 */
export async function buildUserLookupForPolicy(scopedTenantId, policyMongoId) {
  const byKey = new Map();
  const filter = { ...sodTenantFilter(scopedTenantId), _id: policyMongoId };
  const policy = await SodPolicy.findOne(filter).select("applications").lean();
  const appRefs = Array.isArray(policy?.applications)
    ? policy.applications
    : [];

  const appIds = appRefs
    .map((id) => {
      try {
        return id instanceof mongoose.Types.ObjectId
          ? id
          : new mongoose.Types.ObjectId(String(id));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  for (const appOid of appIds) {
    const app = await Application.findById(appOid)
      .select("name tenantId userMappings csvImportMapping")
      .lean();
    if (!app?.name) continue;
    const appSchema = {
      userMappings: app.userMappings || [],
      csvImportMapping: app.csvImportMapping || null,
    };
    const UserModel = await getDynamicUserModelForTenantId(
      app.name,
      app.tenantId,
    );
    let users = await UserModel.find({ applicationId: appOid }).lean();
    if (users.length === 0) {
      users = await UserModel.find({}).lean();
    }
    for (const u of users) {
      const raw = u.rawData && typeof u.rawData === "object" ? u.rawData : {};
      const dept = resolveDepartmentForAppUser(u, raw, appSchema);
      const manager = resolveManagerForAppUser(u, raw);
      const managerEmail = String(
        u.manager_email ||
          u.managerEmail ||
          raw.managerEmail ||
          raw.manager_email ||
          raw["Manager Email"] ||
          raw["Manager Email Address"] ||
          "",
      )
        .trim()
        .toLowerCase();
      const primaryKey = pickSodUserKeyFromAppUser(u, raw, appSchema);
      const displayName = resolveDisplayNameForAppUser(u, raw, primaryKey, appSchema);
      const email = resolveEmailForAppUser(u, raw, primaryKey, appSchema);

      const payload = {
        department: String(dept || "").trim(),
        manager: String(manager || "").trim(),
        managerEmail,
        displayName: String(displayName || "").trim(),
        email: String(email || "").trim().toLowerCase(),
      };

      const put = (key) => {
        const k = norm(key);
        if (!k) return;
        const prev = byKey.get(k) || {};
        byKey.set(k, {
          department: payload.department || prev.department || "",
          manager: payload.manager || prev.manager || "",
          managerEmail: payload.managerEmail || prev.managerEmail || "",
          displayName: payload.displayName || prev.displayName || "",
          email:
            (payload.email && payload.email.includes("@")
              ? payload.email
              : "") ||
            (prev.email && String(prev.email).includes("@") ? prev.email : "") ||
            prev.email ||
            "",
        });
      };

      put(primaryKey);
      if (payload.email.includes("@")) put(payload.email);

      const login = norm(
        u.username ||
          raw.username ||
          raw.UserName ||
          u.user_id ||
          raw.user_id ||
          raw.userid ||
          "",
      );
      if (login && !isLikelyMongoObjectId(login)) put(login);

      // Allow resolving legacy violations keyed by application-user Mongo _id
      const mongoId = u._id?.toString?.();
      if (mongoId) put(mongoId);
    }
  }
  return byKey;
}

export function resolveDepartmentForViolationRow(row, deptByKey) {
  const k = norm(row.identityEmail);
  if (!k) return "";
  return deptByKey.get(k) || "";
}

export function resolveManagerForViolationRow(row, userByKey) {
  const k = norm(row.identityEmail);
  if (!k || !(userByKey instanceof Map)) return "";
  const hit = userByKey.get(k);
  return String(hit?.manager || "").trim();
}

export function enrichViolationRows(rows, deptByKey, userByKey = null) {
  return rows.map((row) => {
    const existingDept = String(row.department || "").trim();
    const d = existingDept || resolveDepartmentForViolationRow(row, deptByKey);
    const existingMgr = String(row.manager || row.managerName || "").trim();
    const m = existingMgr || resolveManagerForViolationRow(row, userByKey);
    const mgrEmail =
      String(row.managerEmail || "").trim() ||
      String(
        userByKey instanceof Map
          ? userByKey.get(norm(row.identityEmail))?.managerEmail || ""
          : "",
      ).trim();

    let identityName = String(row.identityName || "").trim();
    let identityEmail = String(row.identityEmail || "").trim();
    const nameLooksBad =
      !identityName ||
      isLikelyMongoObjectId(identityName) ||
      (identityEmail &&
        identityName.toLowerCase() === identityEmail.toLowerCase() &&
        !identityName.includes("@"));
    const emailLooksBad =
      !identityEmail ||
      isLikelyMongoObjectId(identityEmail) ||
      !identityEmail.includes("@");

    if (userByKey instanceof Map && (nameLooksBad || emailLooksBad)) {
      const hit =
        userByKey.get(norm(row.identityEmail)) ||
        userByKey.get(norm(row.identityName)) ||
        null;
      if (hit) {
        if (nameLooksBad && hit.displayName && !isLikelyMongoObjectId(hit.displayName)) {
          identityName = hit.displayName;
        }
        if (emailLooksBad && hit.email && String(hit.email).includes("@")) {
          identityEmail = String(hit.email).trim().toLowerCase();
        }
      }
    }

    const patch = {};
    if (d) patch.department = d;
    if (m) {
      patch.manager = m;
      patch.managerName = m;
    }
    if (mgrEmail) patch.managerEmail = mgrEmail;
    if (identityName && identityName !== String(row.identityName || "").trim()) {
      patch.identityName = identityName;
    }
    if (identityEmail && identityEmail !== String(row.identityEmail || "").trim()) {
      patch.identityEmail = identityEmail;
    }

    if (!Object.keys(patch).length) return row;
    return { ...row, ...patch };
  });
}

/**
 * When violations store Identity refs but blank/ObjectId names, hydrate from Identity docs.
 * Call after enrichViolationRows for remaining bad labels.
 */
export async function hydrateViolationIdentityLabels(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const needIds = [];
  for (const row of list) {
    const name = String(row.identityName || "").trim();
    const email = String(row.identityEmail || "").trim();
    const bad =
      isLikelyMongoObjectId(name) ||
      !name ||
      isLikelyMongoObjectId(email) ||
      (email && !email.includes("@") && isLikelyMongoObjectId(email));
    const id = row.identity?._id || row.identity;
    if (bad && id && mongoose.isValidObjectId(String(id))) {
      needIds.push(String(id));
    }
  }
  if (!needIds.length) return list;

  const identities = await Identity.find({
    _id: { $in: [...new Set(needIds)] },
  })
    .select("_id email displayName firstName lastName")
    .lean();
  const byId = new Map(identities.map((i) => [String(i._id), i]));

  return list.map((row) => {
    const id = row.identity?._id || row.identity;
    if (!id) return row;
    const identity = byId.get(String(id));
    if (!identity) return row;
    const composed = [identity.firstName, identity.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    const dn =
      String(identity.displayName || "").trim() || composed;
    const em = String(identity.email || "").trim().toLowerCase();
    const patch = {};
    const name = String(row.identityName || "").trim();
    const email = String(row.identityEmail || "").trim();
    if (dn && (!name || isLikelyMongoObjectId(name))) patch.identityName = dn;
    if (em.includes("@") && (!email || isLikelyMongoObjectId(email) || !email.includes("@"))) {
      patch.identityEmail = em;
    }
    if (!Object.keys(patch).length) return row;
    return { ...row, ...patch };
  });
}

/** @param {{ department?: string }[]} violations */
export function groupViolationCountsByDepartment(violations) {
  const m = new Map();
  for (const v of violations) {
    const label = String(v.department || "").trim() || "Unknown";
    m.set(label, (m.get(label) || 0) + 1);
  }
  return [...m.entries()]
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

/** @param {{ key?: string }[]} violations */
export function groupViolationCountsByKey(violations, key = "department") {
  const m = new Map();
  for (const v of violations) {
    const label = String(v?.[key] || "").trim() || "Unknown";
    m.set(label, (m.get(label) || 0) + 1);
  }
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}
