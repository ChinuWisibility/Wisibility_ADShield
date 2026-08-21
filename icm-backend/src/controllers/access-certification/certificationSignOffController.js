import crypto from "crypto";
import mongoose from "mongoose";
import User from "../../models/platform/User.js";
import CertificationSignOff from "../../models/certification/CertificationSignOff.js";
import CertificationReport from "../../models/certification/CertificationReport.js";
import Campaign from "../../models/certification/Campaign.js";
import { assertTenantForCampaign } from "../../utils/access-certification/certificationTenantScope.js";
import env from "../../config/env.js";

const SECRET = env.portalSecrets.certSignoff;

function asObjectId(value) {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

function computeSignatureHash({
  campaignId,
  signerEmail,
  signedAt,
  ipAddress,
}) {
  const cid = campaignId?.toString?.() ?? String(campaignId || "");
  const email = String(signerEmail || "").toLowerCase();
  const atIso = new Date(signedAt || new Date()).toISOString();
  const ip = String(ipAddress || "");
  const payload = `${SECRET}|${cid}|${email}|${atIso}|${ip}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function requestSignOff(req, res) {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });

    // Create a SIGN_OFF report if it doesn't exist yet.
    let report = await CertificationReport.findOne({
      campaignId,
      reportType: "SIGN_OFF",
    });
    if (!report) {
      report = await CertificationReport.create({
        campaignId,
        tenantId: campaign.tenantId || undefined,
        reportType: "SIGN_OFF",
        format: "CSV",
        stats: { campaign: { name: campaign.name, status: campaign.status } },
        generatedBy: req.user?.id,
        fileLocation: `generated://report/${campaignId}/${Date.now()}`,
        signOffStatus: "PENDING",
        createdBy: req.user?.id,
        updatedBy: req.user?.id,
      });
    } else {
      report.signOffStatus = "PENDING";
      report.signedAt = null;
      report.signedBy = null;
      report.updatedBy = req.user?.id;
      await report.save();
    }

    return res.json({
      success: true,
      data: { reportId: report._id, signOffStatus: report.signOffStatus },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function submitSignOff(req, res) {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const { executivePassword, comments } = req.body || {};
    if (!executivePassword)
      return res
        .status(400)
        .json({ success: false, message: "executivePassword is required" });

    const user = await User.findById(req.user?.id).select("+password");
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const isMatch = await user.comparePassword(executivePassword);
    if (!isMatch)
      return res
        .status(401)
        .json({ success: false, message: "Invalid password" });

    const report = await CertificationReport.findOne({
      campaignId,
      reportType: "SIGN_OFF",
    });
    if (!report) {
      return res.status(400).json({
        success: false,
        message: "SIGN_OFF report not found. Request sign-off first.",
      });
    }

    const signerEmail = user.email;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const signedAt = new Date();
    const signatureHash = computeSignatureHash({
      campaignId,
      signerEmail,
      signedAt,
      ipAddress,
    });

    const signOff = await CertificationSignOff.findOneAndUpdate(
      { campaignId, reportId: report._id },
      {
        campaignId,
        reportId: report._id,
        tenantId: report.tenantId || undefined,
        signerName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
        signerEmail,
        signatureHash,
        ipAddress: ipAddress || undefined,
        signedAt,
        comments: comments ?? "",
        updatedBy: req.user?.id,
        createdBy: req.user?.id,
      },
      { new: true, upsert: true },
    );

    report.signOffStatus = "SIGNED";
    report.signedBy = signerEmail;
    report.signedAt = signedAt;
    report.updatedBy = req.user?.id;
    await report.save();

    return res.json({
      success: true,
      data: {
        signOffId: signOff._id,
        signOffStatus: report.signOffStatus,
        signedAt: report.signedAt,
        signatureHash,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function getSignOffStatus(req, res) {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const report = await CertificationReport.findOne({
      campaignId,
      reportType: "SIGN_OFF",
    }).lean();
    if (!report) {
      return res
        .status(404)
        .json({ success: false, message: "Sign-off report not found" });
    }

    const signOff = await CertificationSignOff.findOne({
      campaignId,
      reportId: report._id,
    }).lean();

    return res.json({
      success: true,
      data: {
        campaignId,
        signOffStatus: report.signOffStatus,
        signer: signOff
          ? { signerName: signOff.signerName, signerEmail: signOff.signerEmail }
          : report.signedBy
            ? { signerEmail: report.signedBy }
            : null,
        signedAt: report.signedAt,
        signatureHash: signOff?.signatureHash ?? null,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function verifySignature(req, res) {
  try {
    const signOffId = asObjectId(req.params.id);
    if (!signOffId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid sign-off id" });

    const signOff = await CertificationSignOff.findById(signOffId).lean();
    if (!signOff)
      return res
        .status(404)
        .json({ success: false, message: "Sign-off not found" });

    await assertTenantForCampaign(req, signOff.campaignId, { notFound: true });

    const expectedHash = computeSignatureHash({
      campaignId: signOff.campaignId,
      signerEmail: signOff.signerEmail,
      signedAt: signOff.signedAt,
      ipAddress: signOff.ipAddress,
    });

    const valid = expectedHash === signOff.signatureHash;
    return res.json({
      success: true,
      data: {
        valid,
        expectedHash,
        storedHash: signOff.signatureHash,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// Exported for unit tests
export { computeSignatureHash };
