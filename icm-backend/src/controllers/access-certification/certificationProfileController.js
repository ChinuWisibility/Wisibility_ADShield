import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import User from "../../models/platform/User.js";
import Tenant from "../../models/platform/Tenant.js";
import CertificationProfile, {
  SUPPORTED_PROFILE_CATEGORIES,
} from "../../models/certification/CertificationProfile.js";

function asObjectId(value) {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

function getUserObjectId(req) {
  const userId = req.user?.id;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return null;
  return new mongoose.Types.ObjectId(userId);
}

async function resolveUserTenantId(req) {
  if (
    req.scopedTenantId &&
    mongoose.Types.ObjectId.isValid(req.scopedTenantId)
  ) {
    return new mongoose.Types.ObjectId(req.scopedTenantId);
  }

  const userId = req.user?.id;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return null;

  const user = await User.findById(userId).select("tenantId role").lean();
  if (user?.tenantId) return user.tenantId;

  if (user?.role === "admin" || user?.role === "superAdmin") {
    const tenant = await Tenant.findOne({ createdBy: userId, isActive: true })
      .select("_id")
      .lean();
    if (tenant?._id) return tenant._id;
  }

  const app = await Application.findOne({ createdBy: userId })
    .select("tenantId")
    .lean();
  return app?.tenantId || null;
}

function normalizeCategories(value) {
  const input =
    Array.isArray(value) && value.length > 0
      ? value
      : SUPPORTED_PROFILE_CATEGORIES;

  const out = [
    ...new Set(
      input
        .map((cat) =>
          String(cat || "")
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
  ];

  return out.filter((cat) => SUPPORTED_PROFILE_CATEGORIES.includes(cat));
}

function categoriesRequireApplication(categories = []) {
  return categories.some((cat) => cat === "IDENTITY" || cat === "ACCESS_ITEMS");
}

async function validateApplicationTenant(applicationId, tenantId) {
  const appId = asObjectId(applicationId);
  if (!appId) return null;

  const app = await Application.findById(appId).select("_id tenantId").lean();
  if (!app) return { error: "Application not found" };
  if (!app.tenantId || String(app.tenantId) !== String(tenantId)) {
    return { error: "Application does not belong to your tenant" };
  }

  return { applicationId: app._id };
}

export const listCertificationProfiles = async (req, res) => {
  try {
    const tenantId = await resolveUserTenantId(req);
    if (!tenantId) {
      return res
        .status(403)
        .json({ success: false, message: "Tenant is required" });
    }

    const query = { tenantId };
    const status = String(req.query.status || "ACTIVE").toUpperCase();
    if (status !== "ALL") query.status = status;

    const category = String(req.query.category || "")
      .trim()
      .toUpperCase();
    if (SUPPORTED_PROFILE_CATEGORIES.includes(category)) {
      query.supportedCategories = category;
    }

    if (req.query.applicationId) {
      const validated = await validateApplicationTenant(
        req.query.applicationId,
        tenantId,
      );
      if (validated?.error) {
        return res.status(400).json({
          success: false,
          message: validated.error,
        });
      }
      query.applicationId = validated.applicationId;
    }

    const profiles = await CertificationProfile.find(query)
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ success: true, data: profiles });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCertificationProfileById = async (req, res) => {
  try {
    const tenantId = await resolveUserTenantId(req);
    if (!tenantId) {
      return res
        .status(403)
        .json({ success: false, message: "Tenant is required" });
    }

    const profile = await CertificationProfile.findOne({
      _id: req.params.id,
      tenantId,
    }).lean();

    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Certification profile not found" });
    }

    return res.json({ success: true, data: profile });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCertificationProfile = async (req, res) => {
  try {
    const tenantId = await resolveUserTenantId(req);
    if (!tenantId) {
      return res
        .status(403)
        .json({ success: false, message: "Tenant is required" });
    }

    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Profile name is required" });
    }

    const categories = normalizeCategories(req.body?.supportedCategories);
    if (categories.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one supported category is required",
      });
    }

    let applicationId;
    if (req.body?.applicationId) {
      const validated = await validateApplicationTenant(
        req.body.applicationId,
        tenantId,
      );
      if (validated?.error) {
        return res
          .status(400)
          .json({ success: false, message: validated.error });
      }
      applicationId = validated?.applicationId;
    }

    if (categoriesRequireApplication(categories) && !applicationId) {
      return res.status(400).json({
        success: false,
        message:
          "Application binding is required when supported categories include Identity or Access Items",
      });
    }

    const userId = getUserObjectId(req);
    const profile = await CertificationProfile.create({
      tenantId,
      name,
      description: String(req.body?.description || "").trim(),
      supportedCategories: categories,
      defaults: {
        identity: req.body?.defaults?.identity || {},
        manager: req.body?.defaults?.manager || {},
        accessItems: req.body?.defaults?.accessItems || {},
      },
      ...(applicationId ? { applicationId } : {}),
      ...(userId ? { createdBy: userId, updatedBy: userId } : {}),
    });

    return res.status(201).json({ success: true, data: profile });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A profile with this name already exists",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCertificationProfile = async (req, res) => {
  try {
    const tenantId = await resolveUserTenantId(req);
    if (!tenantId) {
      return res
        .status(403)
        .json({ success: false, message: "Tenant is required" });
    }

    const existing = await CertificationProfile.findOne({
      _id: req.params.id,
      tenantId,
    });

    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Certification profile not found" });
    }

    const updates = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (!name) {
        return res
          .status(400)
          .json({ success: false, message: "Profile name cannot be empty" });
      }
      updates.name = name;
    }
    if (req.body?.description !== undefined) {
      updates.description = String(req.body.description || "").trim();
    }
    if (req.body?.supportedCategories !== undefined) {
      const categories = normalizeCategories(req.body.supportedCategories);
      if (categories.length === 0) {
        return res.status(400).json({
          success: false,
          message: "At least one supported category is required",
        });
      }
      updates.supportedCategories = categories;
    }
    if (req.body?.defaults !== undefined) {
      updates.defaults = {
        identity:
          req.body?.defaults?.identity || existing.defaults?.identity || {},
        manager:
          req.body?.defaults?.manager || existing.defaults?.manager || {},
        accessItems:
          req.body?.defaults?.accessItems ||
          existing.defaults?.accessItems ||
          {},
      };
    }
    if (req.body?.status !== undefined) {
      updates.status =
        String(req.body.status || "").toUpperCase() === "ARCHIVED"
          ? "ARCHIVED"
          : "ACTIVE";
    }
    if (req.body?.applicationId !== undefined) {
      if (!req.body.applicationId) {
        updates.applicationId = null;
      } else {
        const validated = await validateApplicationTenant(
          req.body.applicationId,
          tenantId,
        );
        if (validated?.error) {
          return res
            .status(400)
            .json({ success: false, message: validated.error });
        }
        updates.applicationId = validated.applicationId;
      }
    }

    const effectiveCategories =
      updates.supportedCategories || existing.supportedCategories || [];
    const effectiveApplicationId =
      updates.applicationId !== undefined
        ? updates.applicationId
        : existing.applicationId;

    if (
      categoriesRequireApplication(effectiveCategories) &&
      !effectiveApplicationId
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Application binding is required when supported categories include Identity or Access Items",
      });
    }

    const userId = getUserObjectId(req);
    if (userId) updates.updatedBy = userId;

    const profile = await CertificationProfile.findByIdAndUpdate(
      existing._id,
      { $set: updates },
      { new: true, runValidators: true },
    ).lean();

    return res.json({ success: true, data: profile });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A profile with this name already exists",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const archiveCertificationProfile = async (req, res) => {
  try {
    const tenantId = await resolveUserTenantId(req);
    if (!tenantId) {
      return res
        .status(403)
        .json({ success: false, message: "Tenant is required" });
    }

    const profile = await CertificationProfile.findOneAndUpdate(
      { _id: req.params.id, tenantId },
      { $set: { status: "ARCHIVED", updatedBy: getUserObjectId(req) } },
      { new: true },
    ).lean();

    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Certification profile not found" });
    }

    return res.json({ success: true, data: profile });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
