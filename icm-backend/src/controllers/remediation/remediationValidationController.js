import { AppError } from "../../middleware/errorHandler.js";
import { listValidations, respondToValidation } from "../../services/remediation/remediationValidationService.js";

export async function listValidationsHandler(req, res, next) {
  try {
    const data = await listValidations(req.scopedTenantId, {
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, data: data.items, pagination: data.pagination });
  } catch (e) {
    next(e);
  }
}

export async function respondValidation(req, res, next) {
  try {
    const { passed, comments } = req.body || {};
    if (typeof passed !== "boolean") {
      throw new AppError("passed (boolean) is required", 400);
    }
    const validation = await respondToValidation(req.params.id, req.scopedTenantId, {
      passed,
      comments,
    });
    res.json({ success: true, data: validation });
  } catch (e) {
    if (e.message === "Validation not found") {
      return next(new AppError(e.message, 404));
    }
    next(e);
  }
}
