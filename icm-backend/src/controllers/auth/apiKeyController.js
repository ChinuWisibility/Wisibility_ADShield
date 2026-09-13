import * as apiKeyService from "../../services/auth/apiKeyService.js";

export async function createApiKey(req, res, next) {
  try {
    const result = await apiKeyService.createApiKey(
      req.body,
      req.user.id,
      req.user,
    );
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function listApiKeys(req, res, next) {
  try {
    const { page, limit } = req.query;
    const result = await apiKeyService.listApiKeys({ page, limit }, req.user);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function revokeApiKey(req, res, next) {
  try {
    const result = await apiKeyService.revokeApiKey(req.params.id, req.user);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function rotateApiKey(req, res, next) {
  try {
    const result = await apiKeyService.rotateApiKey(
      req.params.id,
      req.user.id,
      req.user,
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
