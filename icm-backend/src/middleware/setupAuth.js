import { SETUP_TOKEN_HEADER, assertValidSetupToken } from "../services/setup/setupTokenService.js";

/**
 * Require a valid one-time setup token header for first-run APIs.
 */
export async function requireSetupToken(req, res, next) {
  try {
    const presented =
      req.get(SETUP_TOKEN_HEADER) ||
      req.get("X-ADSecurity-Setup-Token") ||
      req.headers[SETUP_TOKEN_HEADER];
    await assertValidSetupToken(presented);
    next();
  } catch (err) {
    next(err);
  }
}
