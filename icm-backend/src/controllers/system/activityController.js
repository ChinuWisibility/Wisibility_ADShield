import * as activityService from "../services/activityService.js";

export async function logActivity(req, res, next) {
  try {
    const userId = req.user?.id;
    const tenantId = req.user?.tenantId || null;
    const activity = await activityService.logActivity({
      userId,
      tenantId,
      ...req.body,
    });
    res.status(201).json({ success: true, data: activity });
  } catch (err) {
    next(err);
  }
}

export async function getActivityFeed(req, res, next) {
  try {
    const { page, limit, type, userId, startDate, endDate } = req.query;
    const result = await activityService.getActivityFeed({
      page,
      limit,
      type,
      userId,
      startDate,
      endDate,
      actor: req.user,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getMyActivity(req, res, next) {
  try {
    const { page, limit } = req.query;
    const result = await activityService.getMyActivity(req.user.id, {
      page,
      limit,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getEntityActivity(req, res, next) {
  try {
    const { page, limit } = req.query;
    const result = await activityService.getEntityActivity(
      req.params.id,
      { page, limit },
      req.user,
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
