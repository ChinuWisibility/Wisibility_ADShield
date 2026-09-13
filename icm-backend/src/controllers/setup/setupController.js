import { initializeSetup } from "../services/setup/setupInitializeService.js";
import { AppError } from "../middleware/errorHandler.js";

export async function postInitialize(req, res, next) {
  try {
    const { admin, licensePath } = req.body || {};
    if (!admin || typeof admin !== "object") {
      throw new AppError("admin object is required", 400, "INVALID_SETUP_BODY");
    }
    if (!licensePath || typeof licensePath !== "string") {
      throw new AppError("licensePath is required", 400, "INVALID_SETUP_BODY");
    }

    const data = await initializeSetup({ admin, licensePath });
    res.status(201).json({
      success: true,
      message: "Setup initialized",
      data,
    });
  } catch (err) {
    next(err);
  }
}
