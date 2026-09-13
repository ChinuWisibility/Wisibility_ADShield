import mongoose from "mongoose";
import ComplianceFramework from "../../models/compliance/ComplianceFramework.js";
import ComplianceEvidence from "../../models/compliance/ComplianceEvidence.js";
import { AppError } from "../../middleware/errorHandler.js";

function isPlatformPlaneActor(actor) {
  return (
    actor?.role === "superAdmin" ||
    (actor?.role === "admin" && !actor?.tenantId)
  );
}

function buildTenantScope(actor) {
  if (!actor)
    throw new AppError("Authentication required", 401, "AUTH_REQUIRED");
  if (isPlatformPlaneActor(actor)) return {};
  if (!actor.tenantId)
    throw new AppError("Tenant context required", 403, "TENANT_SCOPE_REQUIRED");
  return { tenantId: actor.tenantId };
}

const DEFAULT_FRAMEWORKS = [
  {
    frameworkCode: "SOX",
    frameworkName: "Sarbanes-Oxley (SOX)",
    frameworkVersion: "2002",
    description:
      "Financial reporting and internal control requirements for public companies.",
    controls: [
      {
        controlId: "SOX-302",
        title: "Executive Certification",
        description:
          "Executives certify the accuracy of financial statements and controls.",
        category: "Reporting",
      },
      {
        controlId: "SOX-404",
        title: "Internal Controls Assessment",
        description:
          "Management and auditors assess internal control effectiveness.",
        category: "Internal Controls",
      },
      {
        controlId: "SOX-409",
        title: "Real-Time Disclosure",
        description:
          "Material changes in financial condition must be disclosed rapidly.",
        category: "Disclosure",
      },
    ],
    isActive: true,
  },
  {
    frameworkCode: "GDPR",
    frameworkName: "General Data Protection Regulation (GDPR)",
    frameworkVersion: "2018",
    description:
      "EU privacy regulation for personal data protection and accountability.",
    controls: [
      {
        controlId: "GDPR-5",
        title: "Data Processing Principles",
        description:
          "Personal data must be processed lawfully, fairly, and transparently.",
        category: "Data Governance",
      },
      {
        controlId: "GDPR-25",
        title: "Privacy by Design",
        description: "Privacy controls are embedded into systems by default.",
        category: "Security and Design",
      },
      {
        controlId: "GDPR-32",
        title: "Security of Processing",
        description:
          "Technical and organizational safeguards protect personal data.",
        category: "Security",
      },
    ],
    isActive: true,
  },
  {
    frameworkCode: "HIPAA",
    frameworkName:
      "Health Insurance Portability and Accountability Act (HIPAA)",
    frameworkVersion: "Security Rule",
    description:
      "US healthcare safeguards for protected health information (PHI).",
    controls: [
      {
        controlId: "HIPAA-164.308",
        title: "Administrative Safeguards",
        description: "Security management processes and workforce controls.",
        category: "Administrative",
      },
      {
        controlId: "HIPAA-164.310",
        title: "Physical Safeguards",
        description: "Facility and workstation controls to protect PHI.",
        category: "Physical",
      },
      {
        controlId: "HIPAA-164.312",
        title: "Technical Safeguards",
        description:
          "Access control, audit controls, and transmission security.",
        category: "Technical",
      },
    ],
    isActive: true,
  },
  {
    frameworkCode: "PCI-DSS",
    frameworkName: "Payment Card Industry Data Security Standard (PCI-DSS)",
    frameworkVersion: "4.0",
    description:
      "Security requirements for environments handling payment card data.",
    controls: [
      {
        controlId: "PCI-1",
        title: "Network Security Controls",
        description: "Install and maintain network security controls.",
        category: "Network Security",
      },
      {
        controlId: "PCI-7",
        title: "Restrict Access by Need-to-Know",
        description: "Limit access to system components and cardholder data.",
        category: "Access Control",
      },
      {
        controlId: "PCI-10",
        title: "Log and Monitor Access",
        description:
          "Track and monitor all access to network resources and cardholder data.",
        category: "Monitoring",
      },
    ],
    isActive: true,
  },
];

function normalizeControls(controls = []) {
  if (!Array.isArray(controls)) {
    throw new AppError("controls must be an array", 400, "VALIDATION_ERROR");
  }

  return controls.map((control, index) => {
    const controlId = String(control.controlId || "").trim();
    const title = String(control.title || "").trim();

    if (!controlId || !title) {
      throw new AppError(
        `controls[${index}] requires controlId and title`,
        400,
        "VALIDATION_ERROR",
      );
    }

    return {
      controlId,
      title,
      description: control.description
        ? String(control.description).trim()
        : undefined,
      category: control.category ? String(control.category).trim() : undefined,
      severity: control.severity
        ? String(control.severity).trim().toUpperCase()
        : undefined,
      isRequired: control.isRequired !== false,
    };
  });
}

async function ensureDefaultCatalog(tenantScope = {}) {
  const total = await ComplianceFramework.countDocuments(tenantScope);
  if (total > 0) return;
  const payload = DEFAULT_FRAMEWORKS.map((f) => ({ ...f, ...tenantScope }));
  await ComplianceFramework.insertMany(payload);
}

function toCatalogRow(framework) {
  return {
    _id: framework._id,
    frameworkCode: framework.frameworkCode,
    frameworkName: framework.frameworkName,
    frameworkVersion: framework.frameworkVersion,
    description: framework.description,
    isActive: framework.isActive,
    controlCount: Array.isArray(framework.controls)
      ? framework.controls.length
      : 0,
    createdAt: framework.createdAt,
    updatedAt: framework.updatedAt,
  };
}

export async function listFrameworks(req, res, next) {
  try {
    const tenantScope = buildTenantScope(req.user);
    await ensureDefaultCatalog(tenantScope);

    const includeInactive = req.query.includeInactive === "true";
    const query = includeInactive
      ? { ...tenantScope }
      : { ...tenantScope, isActive: true };
    const frameworks = await ComplianceFramework.find(query).sort({
      frameworkCode: 1,
      frameworkName: 1,
    });

    res.json({
      success: true,
      data: frameworks.map(toCatalogRow),
    });
  } catch (err) {
    next(err);
  }
}

export async function getFrameworkById(req, res, next) {
  try {
    const tenantScope = buildTenantScope(req.user);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid framework id", 400, "VALIDATION_ERROR");
    }

    const framework = await ComplianceFramework.findOne({
      _id: req.params.id,
      ...tenantScope,
    });
    if (!framework) {
      throw new AppError("ComplianceFramework not found", 404, "NOT_FOUND");
    }

    res.json({
      success: true,
      data: {
        ...toCatalogRow(framework),
        controls: framework.controls || [],
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function createFramework(req, res, next) {
  try {
    const tenantScope = buildTenantScope(req.user);
    const frameworkName = String(req.body.frameworkName || "").trim();
    if (!frameworkName) {
      throw new AppError("frameworkName is required", 400, "VALIDATION_ERROR");
    }

    const frameworkCode = req.body.frameworkCode
      ? String(req.body.frameworkCode).trim().toUpperCase()
      : frameworkName
          .toUpperCase()
          .replace(/[^A-Z0-9-]+/g, "-")
          .replace(/(^-|-$)/g, "")
          .slice(0, 30);

    const controls = normalizeControls(req.body.controls || []);

    const item = await ComplianceFramework.create({
      ...tenantScope,
      frameworkCode,
      frameworkName,
      frameworkVersion: req.body.frameworkVersion
        ? String(req.body.frameworkVersion).trim()
        : undefined,
      description: req.body.description
        ? String(req.body.description).trim()
        : undefined,
      controls,
      isActive: req.body.isActive !== false,
      createdBy: req.user?.id,
      updatedBy: req.user?.id,
    });

    res.status(201).json({
      success: true,
      data: {
        ...toCatalogRow(item),
        controls: item.controls,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getFrameworkCoverage(req, res, next) {
  try {
    const tenantScope = buildTenantScope(req.user);
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      throw new AppError("Invalid framework id", 400, "VALIDATION_ERROR");
    }

    const framework = await ComplianceFramework.findOne({
      _id: req.params.id,
      ...tenantScope,
    }).lean();
    if (!framework) {
      throw new AppError("ComplianceFramework not found", 404, "NOT_FOUND");
    }

    const controlIds = (framework.controls || [])
      .map((c) => (c?.controlId ? String(c.controlId).trim() : null))
      .filter(Boolean);
    const uniqueControlIds = [...new Set(controlIds)];
    const totalControls = uniqueControlIds.length;

    let coveredControlIds = [];
    if (totalControls > 0) {
      coveredControlIds = await ComplianceEvidence.distinct("controlId", {
        ...tenantScope,
        frameworkId: framework._id,
        controlId: { $in: uniqueControlIds },
        status: { $in: ["SUBMITTED", "ACCEPTED"] },
      });
    }

    const coveredSet = new Set(coveredControlIds.map((id) => String(id)));
    const uncoveredControlIds = uniqueControlIds.filter(
      (id) => !coveredSet.has(id),
    );
    const coveredControls = coveredSet.size;
    const coveragePercent =
      totalControls === 0
        ? 0
        : Number(((coveredControls / totalControls) * 100).toFixed(2));

    res.json({
      success: true,
      data: {
        frameworkId: framework._id,
        frameworkCode: framework.frameworkCode,
        frameworkName: framework.frameworkName,
        totalControls,
        coveredControls,
        uncoveredControls: uncoveredControlIds.length,
        coveragePercent,
        coveredControlIds: [...coveredSet],
        uncoveredControlIds,
      },
    });
  } catch (err) {
    next(err);
  }
}
