import { AppError } from "../middleware/errorHandler.js";
import { validateTicketReviewToken } from "../services/remediation/remediationTicketTokenService.js";
import {
  listApplicationCampaignsPaginated,
  getRevokedUsersForCampaigns,
  createRemediationTicket,
  listRemediationTickets,
  getRemediationTicketDetail,
  getTicketForItsmReview,
  submitItsmTicketResponses,
  assertTenantTicketAccess,
} from "../services/remediation/remediationTicketService.js";
import { executeTicketRemediation } from "../services/remediation/remediationExecutionService.js";

export async function listCampaignsV2(req, res, next) {
  try {
    const data = await listApplicationCampaignsPaginated(req);
    res.json({ success: true, data: data.items, pagination: data.pagination });
  } catch (e) {
    next(e);
  }
}

export async function fetchRevokedUsers(req, res, next) {
  try {
    const data = await getRevokedUsersForCampaigns(req);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function createTicket(req, res, next) {
  try {
    const result = await createRemediationTicket(req);
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
}

export async function listTickets(req, res, next) {
  try {
    const data = await listRemediationTickets(req);
    res.json({ success: true, data: data.items, pagination: data.pagination });
  } catch (e) {
    next(e);
  }
}

export async function getTicketDetail(req, res, next) {
  try {
    const data = await getRemediationTicketDetail(req, req.params.ticketId);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function runTicketExecution(req, res, next) {
  try {
    await assertTenantTicketAccess(req, req.params.ticketId);
    const result = await executeTicketRemediation(req.params.ticketId, req);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
}

export async function getTicketReviewPortal(req, res, next) {
  try {
    const token = req.query.token;
    if (!token) throw new AppError("Review token is required", 401);
    const payload = validateTicketReviewToken(token);
    if (String(payload.ticketId).toLowerCase() !== String(req.params.ticketId).toLowerCase()) {
      throw new AppError("Invalid review token for this ticket", 403);
    }
    const data = await getTicketForItsmReview(req.params.ticketId, payload);
    res.json({ success: true, data, reviewer: { email: payload.itsmEmail } });
  } catch (e) {
    if (e.name === "TokenExpiredError") {
      return next(new AppError("Review link has expired", 401));
    }
    if (e.name === "JsonWebTokenError") {
      return next(new AppError("Invalid review token", 401));
    }
    next(e);
  }
}

export async function submitTicketReviewPortal(req, res, next) {
  try {
    const token = req.body?.token || req.query.token;
    if (!token) throw new AppError("Review token is required", 401);
    const payload = validateTicketReviewToken(token);
    if (String(payload.ticketId).toLowerCase() !== String(req.params.ticketId).toLowerCase()) {
      throw new AppError("Invalid review token for this ticket", 403);
    }
    const result = await submitItsmTicketResponses(
      req,
      req.params.ticketId,
      payload,
    );
    res.json({ success: true, data: result });
  } catch (e) {
    if (e.name === "TokenExpiredError") {
      return next(new AppError("Review link has expired", 401));
    }
    if (e.name === "JsonWebTokenError") {
      return next(new AppError("Invalid review token", 401));
    }
    if (e.name === "BSONError" || e.name === "CastError") {
      return next(new AppError("Invalid ticket or item identifier", 400));
    }
    next(e);
  }
}

export async function submitTicketReviewAuthenticated(req, res, next) {
  try {
    const result = await submitItsmTicketResponses(
      req,
      req.params.ticketId,
      null,
    );
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
}
