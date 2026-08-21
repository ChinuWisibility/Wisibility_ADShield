import mongoose from "mongoose";
import ApplicationIcon from "../../models/application/ApplicationIcon.js";
import Application from "../../models/application/Application.js";
import { AppError } from "../../middleware/errorHandler.js";
import { BUILTIN_APPLICATION_ICONS, BUILTIN_ICON_PACK_VERSION } from "./builtinApplicationIcons.js";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Compact lowercase name for matching (e.g. "GIT HUB" → "github"). */
export function normalizeAppNameForIcon(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Map application display names to builtin pack keys.
 * Longer / more specific aliases are checked first.
 */
const BUILTIN_NAME_ALIASES = [
  { key: "aad", aliases: ["azuread", "azureactivedirectory", "microsoftentra", "entra", "entraid", "activedirectory"] },
  { key: "azure", aliases: ["azure", "microsoftazure"] },
  { key: "aws", aliases: ["aws", "amazonwebservices", "amazonaws", "amazonaws"] },
  { key: "github", aliases: ["github", "gh"] },
  { key: "salesforce", aliases: ["salesforce", "sfdc", "forcecom"] },
  { key: "servicenow", aliases: ["servicenow", "snow"] },
  { key: "microsoft", aliases: ["microsoft", "office365", "o365", "ms365", "microsoft365"] },
  { key: "google", aliases: ["google", "googleworkspace", "gsuite", "gcp", "googlecloud"] },
  { key: "okta", aliases: ["okta"] },
  { key: "slack", aliases: ["slack"] },
  { key: "jira", aliases: ["jira", "atlassianjira"] },
  { key: "oracle", aliases: ["oracle"] },
  { key: "sap", aliases: ["sap"] },
  { key: "tableau", aliases: ["tableau"] },
  { key: "workday", aliases: ["workday"] },
  { key: "authoritative", aliases: ["authoritative", "authorative", "authoritativeapp", "authorativeapp", "hrms"] },
];

export function matchBuiltinIconKey(appName) {
  const compact = normalizeAppNameForIcon(appName);
  if (!compact) return null;

  let bestKey = null;
  let bestLen = 0;
  for (const row of BUILTIN_NAME_ALIASES) {
    for (const alias of row.aliases) {
      const a = normalizeAppNameForIcon(alias);
      if (!a || a.length < 2) continue;
      if (compact === a || compact.includes(a)) {
        if (a.length > bestLen) {
          bestKey = row.key;
          bestLen = a.length;
        }
      }
    }
  }
  if (bestKey) return bestKey;

  for (const pack of BUILTIN_APPLICATION_ICONS) {
    const k = normalizeAppNameForIcon(pack.key);
    const n = normalizeAppNameForIcon(pack.name);
    if (compact === k || compact === n) return pack.key;
  }
  return null;
}

export function applicationIconImageUrl(iconId) {
  if (!iconId) return null;
  return `/api/application-icons/${iconId}/image`;
}

function toImageBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value.length ? value : null;
  if (value?.type === "Buffer" && Array.isArray(value.data)) {
    const buf = Buffer.from(value.data);
    return buf.length ? buf : null;
  }
  if (value instanceof Uint8Array) {
    const buf = Buffer.from(value);
    return buf.length ? buf : null;
  }
  // MongoDB BSON Binary (lean docs)
  if (value.buffer) {
    if (Buffer.isBuffer(value.buffer)) {
      return value.buffer.length ? value.buffer : null;
    }
    if (value.buffer instanceof ArrayBuffer) {
      const buf = Buffer.from(value.buffer);
      return buf.length ? buf : null;
    }
    if (value.buffer instanceof Uint8Array) {
      const buf = Buffer.from(value.buffer);
      return buf.length ? buf : null;
    }
  }
  try {
    const buf = Buffer.from(value);
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

function toPublicIcon(doc, usageCount = 0) {
  if (!doc) return null;
  const id = String(doc._id);
  const cacheKey = doc.updatedAt
    ? `${new Date(doc.updatedAt).getTime()}-p${BUILTIN_ICON_PACK_VERSION}`
    : `p${BUILTIN_ICON_PACK_VERSION}`;
  return {
    _id: id,
    id,
    tenantId: doc.tenantId ? String(doc.tenantId) : null,
    name: doc.name,
    key: doc.key || null,
    source: doc.source,
    mimeType: doc.mimeType,
    color: doc.color || null,
    imageUrl: `${applicationIconImageUrl(id)}?v=${cacheKey}`,
    usageCount,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function resolveTenantObjectId(tenantId) {
  if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
    throw new AppError("Valid tenantId is required", 400, "INVALID_TENANT_ID");
  }
  return new mongoose.Types.ObjectId(String(tenantId));
}

const seededTenants = new Set(); // tenantIds that have been checked this process

export async function seedBuiltinIcons(tenantId, { force = false } = {}) {
  const tid = resolveTenantObjectId(tenantId);
  const tidKey = String(tid);
  if (!force && seededTenants.has(tidKey)) {
    return { created: 0, updated: 0, skipped: true, total: BUILTIN_APPLICATION_ICONS.length };
  }

  const existing = await ApplicationIcon.find({
    tenantId: tid,
    key: { $in: BUILTIN_APPLICATION_ICONS.map((p) => p.key) },
  })
    .select("key")
    .lean();
  const have = new Set(existing.map((d) => d.key));

  let created = 0;
  const missing = BUILTIN_APPLICATION_ICONS.filter((p) => !have.has(p.key));
  if (missing.length) {
    await ApplicationIcon.insertMany(
      missing.map((pack) => ({
        tenantId: tid,
        key: pack.key,
        name: pack.name,
        source: "builtin",
        mimeType: pack.mimeType,
        data: pack.data,
        color: pack.color,
      })),
      { ordered: false },
    );
    created = missing.length;
  }

  // Refresh metadata for existing builtins (artwork is always served from pack).
  let updated = 0;
  if (force || created > 0) {
    for (const pack of BUILTIN_APPLICATION_ICONS) {
      if (!have.has(pack.key)) continue;
      const res = await ApplicationIcon.updateOne(
        { tenantId: tid, key: pack.key, source: "builtin" },
        {
          $set: {
            name: pack.name,
            mimeType: pack.mimeType,
            color: pack.color,
            data: pack.data,
          },
        },
      );
      if (res.modifiedCount) updated += 1;
    }
  }

  seededTenants.add(tidKey);
  return {
    created,
    updated,
    existing: have.size,
    total: BUILTIN_APPLICATION_ICONS.length,
    packVersion: BUILTIN_ICON_PACK_VERSION,
  };
}

/**
 * Assign matching builtin pack icons to applications by name.
 * @param {{ onlyMissing?: boolean }} [options] onlyMissing=true skips apps that already have iconId
 */
export async function applyBuiltinPackIconsToApplications(tenantId, { onlyMissing = true } = {}) {
  const tid = resolveTenantObjectId(tenantId);
  await seedBuiltinIcons(tid, { force: true });

  const icons = await ApplicationIcon.find({
    tenantId: tid,
    source: "builtin",
    key: { $in: BUILTIN_APPLICATION_ICONS.map((p) => p.key) },
  })
    .select("_id key color")
    .lean();
  const byKey = new Map(icons.map((d) => [d.key, d]));

  const query = { tenantId: tid };
  if (onlyMissing) {
    query.$or = [{ iconId: null }, { iconId: { $exists: false } }];
  }

  const apps = await Application.find(query).select("_id name iconId").lean();
  let assigned = 0;
  let skipped = 0;

  for (const app of apps) {
    const key = matchBuiltinIconKey(app.name);
    if (!key) {
      skipped += 1;
      continue;
    }
    const icon = byKey.get(key);
    if (!icon) {
      skipped += 1;
      continue;
    }
    if (onlyMissing && app.iconId) {
      skipped += 1;
      continue;
    }
    await Application.updateOne(
      { _id: app._id },
      {
        $set: {
          iconId: icon._id,
          icon: applicationIconImageUrl(icon._id),
          color: icon.color || null,
        },
      },
    );
    assigned += 1;
  }

  return {
    assigned,
    skipped,
    scanned: apps.length,
    packVersion: BUILTIN_ICON_PACK_VERSION,
  };
}

export async function listApplicationIcons(tenantId) {
  const tid = resolveTenantObjectId(tenantId);
  await seedBuiltinIcons(tid);

  const icons = await ApplicationIcon.find({ tenantId: tid })
    .select("-data")
    .sort({ source: 1, name: 1 })
    .lean();

  const usage = await Application.aggregate([
    { $match: { tenantId: tid, iconId: { $ne: null } } },
    { $group: { _id: "$iconId", count: { $sum: 1 } } },
  ]);
  const usageMap = new Map(usage.map((row) => [String(row._id), row.count]));

  return icons.map((doc) => toPublicIcon(doc, usageMap.get(String(doc._id)) || 0));
}

export async function uploadApplicationIcon(tenantId, file, options = {}) {
  const tid = resolveTenantObjectId(tenantId);
  if (!file?.buffer?.length) {
    throw new AppError("Icon file is required", 400, "FILE_REQUIRED");
  }
  if (file.buffer.length > MAX_UPLOAD_BYTES) {
    throw new AppError("Icon file must be 2 MB or smaller", 400, "FILE_TOO_LARGE");
  }
  const mimeType = String(file.mimetype || "").toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new AppError(
      "Only JPEG, PNG, WebP, GIF, or SVG images are allowed",
      400,
      "INVALID_MIME_TYPE",
    );
  }

  const name =
    String(options.name || file.originalname || "Custom icon")
      .replace(/\.[^.]+$/, "")
      .trim()
      .slice(0, 80) || "Custom icon";
  const color = options.color ? String(options.color).trim().slice(0, 32) : null;

  const doc = await ApplicationIcon.create({
    tenantId: tid,
    name,
    key: null,
    source: "upload",
    mimeType,
    data: file.buffer,
    color,
  });

  return toPublicIcon(doc, 0);
}

export async function getApplicationIconImage(iconId) {
  if (!mongoose.Types.ObjectId.isValid(String(iconId))) {
    throw new AppError("Invalid icon ID", 400, "INVALID_ICON_ID");
  }
  const doc = await ApplicationIcon.findById(iconId).select("mimeType data key source").lean();
  if (!doc) {
    throw new AppError("Icon not found", 404, "ICON_NOT_FOUND");
  }

  // Always prefer current pack artwork for builtins so logo fixes apply immediately.
  if (doc.key) {
    const pack = BUILTIN_APPLICATION_ICONS.find((p) => p.key === doc.key);
    if (pack?.data?.length) {
      return { mimeType: pack.mimeType || "image/svg+xml", data: pack.data };
    }
  }

  const data = toImageBuffer(doc.data);
  if (!data) {
    throw new AppError("Icon image data missing", 404, "ICON_DATA_MISSING");
  }
  return { mimeType: doc.mimeType || "application/octet-stream", data };
}

export async function deleteApplicationIcon(tenantId, iconId) {
  const tid = resolveTenantObjectId(tenantId);
  if (!mongoose.Types.ObjectId.isValid(String(iconId))) {
    throw new AppError("Invalid icon ID", 400, "INVALID_ICON_ID");
  }

  const doc = await ApplicationIcon.findOne({ _id: iconId, tenantId: tid });
  if (!doc) {
    throw new AppError("Icon not found", 404, "ICON_NOT_FOUND");
  }
  if (doc.source === "builtin") {
    throw new AppError("Built-in icons cannot be deleted", 400, "BUILTIN_PROTECTED");
  }

  const inUse = await Application.countDocuments({ tenantId: tid, iconId: doc._id });
  if (inUse > 0) {
    throw new AppError(
      `Icon is used by ${inUse} application${inUse === 1 ? "" : "s"}`,
      409,
      "ICON_IN_USE",
    );
  }

  await ApplicationIcon.deleteOne({ _id: doc._id });
  return { deleted: true, id: String(doc._id) };
}

/**
 * Prefer a custom library icon named "Authoritative App" / "Authorative App",
 * otherwise the built-in `authoritative` pack icon.
 */
export async function findAuthoritativeAppIcon(tenantId, { seed = true } = {}) {
  const tid = resolveTenantObjectId(tenantId);
  if (seed) await seedBuiltinIcons(tid);

  const custom = await ApplicationIcon.findOne({
    tenantId: tid,
    source: "upload",
    name: { $regex: /authorit?ative/i },
  })
    .select("-data")
    .lean();
  if (custom) return custom;

  let builtin = await ApplicationIcon.findOne({ tenantId: tid, key: "authoritative" })
    .select("-data")
    .lean();
  if (!builtin && seed) {
    await seedBuiltinIcons(tid);
    builtin = await ApplicationIcon.findOne({ tenantId: tid, key: "authoritative" })
      .select("-data")
      .lean();
  }
  return builtin;
}

/**
 * Assign matching builtin pack icons to applications missing iconId.
 * Safe to call on list endpoints (only fills gaps).
 */
export async function ensureBuiltinPackIconsForApplications(applications) {
  if (!Array.isArray(applications) || !applications.length) return applications;

  const needing = applications.filter((app) => app?._id && !app.iconId && app.name);
  if (!needing.length) return applications;

  const byTenant = new Map();
  for (const app of needing) {
    const tid = String(app.tenantId?._id || app.tenantId || "");
    if (!tid) continue;
    if (!byTenant.has(tid)) byTenant.set(tid, []);
    byTenant.get(tid).push(app);
  }

  const assignmentByAppId = new Map();
  for (const [tid, apps] of byTenant.entries()) {
    try {
      await seedBuiltinIcons(tid);
      const icons = await ApplicationIcon.find({
        tenantId: resolveTenantObjectId(tid),
        source: "builtin",
        key: { $in: BUILTIN_APPLICATION_ICONS.map((p) => p.key) },
      })
        .select("_id key color")
        .lean();
      const byKey = new Map(icons.map((d) => [d.key, d]));

      for (const app of apps) {
        const key = matchBuiltinIconKey(app.name);
        const icon = key ? byKey.get(key) : null;
        if (!icon) continue;
        const fields = {
          iconId: icon._id,
          icon: applicationIconImageUrl(icon._id),
          color: icon.color || null,
        };
        await Application.updateOne({ _id: app._id }, { $set: fields });
        assignmentByAppId.set(String(app._id), fields);
      }
    } catch (err) {
      console.warn("[ensureBuiltinPackIconsForApplications]", tid, err.message);
    }
  }

  if (!assignmentByAppId.size) return applications;
  return applications.map((app) => {
    const fields = assignmentByAppId.get(String(app._id));
    return fields ? { ...app, ...fields } : app;
  });
}

/**
 * Assign authoritative default icon to many apps in one pass (list endpoint).
 */
export async function ensureAuthoritativeIconsForApplications(applications) {
  if (!Array.isArray(applications) || !applications.length) return applications;

  const needing = applications.filter(
    (app) => app?.authoritativeSource && !app.iconId,
  );
  if (!needing.length) return applications;

  const byTenant = new Map();
  for (const app of needing) {
    const tid = String(app.tenantId?._id || app.tenantId || "");
    if (!tid) continue;
    if (!byTenant.has(tid)) byTenant.set(tid, []);
    byTenant.get(tid).push(app);
  }

  const assignmentByAppId = new Map();
  for (const [tid, apps] of byTenant.entries()) {
    const icon = await findAuthoritativeAppIcon(tid);
    if (!icon) continue;
    const assignment = {
      iconId: icon._id,
      icon: applicationIconImageUrl(icon._id),
      color: icon.color || "#059669",
    };
    const ids = apps.map((a) => a._id);
    await Application.updateMany(
      {
        _id: { $in: ids },
        $or: [{ iconId: null }, { iconId: { $exists: false } }],
      },
      { $set: assignment },
    );
    for (const app of apps) {
      assignmentByAppId.set(String(app._id), {
        ...assignment,
        color: app.color || assignment.color,
      });
    }
  }

  return applications.map((app) => {
    const patch = assignmentByAppId.get(String(app._id));
    if (!patch) return app;
    if (typeof app.toObject === "function") {
      return Object.assign(app, patch);
    }
    return { ...app, ...patch };
  });
}

/**
 * If app is authoritative and has no icon, assign Authoritative App icon fields.
 */
export async function applyAuthoritativeDefaultIcon(tenantId, fields = {}) {
  const isAuth = fields.authoritativeSource === true || fields.authoritativeSource === "true";
  if (!isAuth) return null;

  const hasIcon =
    fields.iconId != null
    && String(fields.iconId).trim() !== ""
    && String(fields.iconId) !== "null";
  if (hasIcon) return null;

  const icon = await findAuthoritativeAppIcon(tenantId);
  if (!icon) return null;

  return {
    iconId: icon._id,
    icon: applicationIconImageUrl(icon._id),
    color: fields.color || icon.color || "#059669",
  };
}

/**
 * Persist default authoritative icon on existing apps that are missing one.
 */
export async function ensureApplicationAuthoritativeIcon(application) {
  if (!application?.authoritativeSource || application.iconId) {
    return application;
  }
  const tenantId = application.tenantId?._id || application.tenantId;
  if (!tenantId) return application;

  const assignment = await applyAuthoritativeDefaultIcon(tenantId, {
    authoritativeSource: true,
    iconId: null,
    color: application.color,
  });
  if (!assignment) return application;

  const updated = await Application.findByIdAndUpdate(
    application._id,
    { $set: assignment },
    { new: true },
  );
  return updated || Object.assign(application, assignment);
}

/**
 * Validate iconId for tenant and return fields to set on Application.
 * Pass iconId null/'' to clear.
 */
export async function resolveApplicationIconAssignment(tenantId, iconId, colorOverride) {
  if (iconId === null || iconId === "" || iconId === undefined) {
    if (iconId === undefined) return null;
    return {
      iconId: null,
      icon: null,
      ...(colorOverride !== undefined ? { color: colorOverride || null } : { color: null }),
    };
  }

  if (!mongoose.Types.ObjectId.isValid(String(iconId))) {
    throw new AppError("Invalid iconId", 400, "INVALID_ICON_ID");
  }

  const tid = resolveTenantObjectId(tenantId);
  const doc = await ApplicationIcon.findOne({ _id: iconId, tenantId: tid }).lean();
  if (!doc) {
    throw new AppError("Icon not found for this tenant", 404, "ICON_NOT_FOUND");
  }

  const color =
    colorOverride !== undefined && colorOverride !== null && String(colorOverride).trim() !== ""
      ? String(colorOverride).trim()
      : doc.color || null;

  return {
    iconId: doc._id,
    icon: applicationIconImageUrl(doc._id),
    color,
  };
}
