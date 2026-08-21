import crypto from "crypto";
import Logo from "../models/branding/Logo.js";
import Branding from "../models/branding/Branding.js";
import { AppError } from "../middleware/errorHandler.js";

export async function listLogos() {
  return Logo.find().sort({ createdAt: -1 });
}

export async function getLogo(id) {
  const logo = await Logo.findById(id);
  if (!logo) throw new AppError("Logo not found", 404, "LOGO_NOT_FOUND");
  return logo;
}

export async function uploadLogo(file, logoType) {
  if (!file) throw new AppError("File is required", 400, "MISSING_FILE");
  if (!String(file.mimetype || "").startsWith("image/")) {
    throw new AppError(
      "Only image files are allowed for logos",
      400,
      "INVALID_FILE_TYPE",
    );
  }

  const validTypes = ["PLATFORM", "APPLICATION", "FAVICON"];
  if (!validTypes.includes(logoType)) {
    throw new AppError(
      "logoType must be PLATFORM, APPLICATION, or FAVICON",
      400,
      "INVALID_LOGO_TYPE",
    );
  }

  const ext =
    file.originalname && file.originalname.includes(".")
      ? file.originalname.substring(file.originalname.lastIndexOf("."))
      : ".png";
  const filename = `${crypto.randomUUID()}${ext}`;

  let logo = await Logo.create({
    logoType,
    fileName: file.originalname || filename,
    mimeType: file.mimetype,
    data: file.buffer,
  });

  // Expose a URL that can be used by the frontend to fetch the image blob
  logo.fileUrl = `/api/logos/${logo._id}/image`;
  await logo.save();

  return logo;
}

export async function deleteLogo(id) {
  const logo = await Logo.findById(id);
  if (!logo) throw new AppError("Logo not found", 404, "LOGO_NOT_FOUND");

  await Logo.findByIdAndDelete(id);

  await Branding.updateMany({ logoId: id }, { $unset: { logoId: "" } });
  await Branding.updateMany({ faviconId: id }, { $unset: { faviconId: "" } });

  return { message: "Logo deleted" };
}

export async function getLogoImage(id) {
  const logo = await Logo.findById(id);
  if (!logo || !logo.data) {
    throw new AppError("Logo image not found", 404, "LOGO_IMAGE_NOT_FOUND");
  }
  return logo;
}

export async function setDefaultLogo(id, { target = "logo" }) {
  const logo = await Logo.findById(id);
  if (!logo) throw new AppError("Logo not found", 404, "LOGO_NOT_FOUND");

  let branding = await Branding.findOne();
  if (!branding) {
    branding = await Branding.create({
      companyName: "ADSecurity",
      primaryColor: "#2563EB",
      secondaryColor: "#7C3AED",
    });
  }

  if (target === "favicon") {
    branding.faviconId = id;
  } else {
    branding.logoId = id;
  }
  await branding.save();

  return branding.populate("logoId faviconId");
}
