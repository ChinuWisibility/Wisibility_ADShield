import * as auditService from "../services/auditService.js";

export async function listAuditLogs(req, res, next) {
  try {
    const {
      page,
      limit,
      action,
      userId,
      startDate,
      endDate,
      method,
      path,
      sortField,
      sortDir,
    } = req.query;
    const result = await auditService.listAuditLogs({
      page,
      limit,
      action,
      userId,
      startDate,
      endDate,
      method,
      path,
      sortField,
      sortDir,
      actor: req.user,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getAuditEntry(req, res, next) {
  try {
    const entry = await auditService.getAuditEntry(req.params.id, req.user);
    res.json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
}

export async function getAuditByEntity(req, res, next) {
  try {
    const items = await auditService.getAuditByEntity(
      req.params.type,
      req.params.id,
      req.user,
    );
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
}

export async function exportAuditLog(req, res, next) {
  try {
    const { format, action, userId, startDate, endDate, method, path } = req.body;
    const result = await auditService.exportAuditLog({
      format,
      action,
      userId,
      startDate,
      endDate,
      method,
      path,
      actor: req.user,
    });

    if (result.format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=audit-export.csv",
      );
      return res.send(result.content);
    }

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getLoginHistory(req, res, next) {
  try {
    const { page, limit } = req.query;
    const result = await auditService.getLoginHistory({
      page,
      limit,
      actor: req.user,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getAuditStats(req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const result = await auditService.getAuditStats({
      startDate,
      endDate,
      actor: req.user,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function purgeAuditLogs(req, res, next) {
  try {
    const { retentionDays } = req.body;
    const result = await auditService.purgeAuditLogs({
      retentionDays,
      actor: req.user,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
