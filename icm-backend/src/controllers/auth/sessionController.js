import * as sessionService from "../../services/auth/sessionService.js";

export async function listActiveSessions(req, res, next) {
  try {
    const sessions = await sessionService.listActiveSessions(req.user.id);
    res.json({ success: true, data: sessions });
  } catch (err) {
    next(err);
  }
}

export async function revokeSession(req, res, next) {
  try {
    const result = await sessionService.revokeSession(
      req.user.id,
      req.params.id,
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function listAllSessions(req, res, next) {
  try {
    const { page, limit, userId } = req.query;
    const result = await sessionService.listAllSessions({
      page,
      limit,
      userId,
      actor: req.user,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
