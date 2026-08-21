/**
 * Extracts audit metadata (IP address + User-Agent) from an Express request.
 * Handles reverse-proxy scenarios via x-forwarded-for.
 * Returns undefined when neither value is present so callers can skip storing empty objects.
 */
export function auditMetadataFromRequest(req) {
  const xf = req.headers["x-forwarded-for"];
  const fromForwarded =
    typeof xf === "string" ? xf.split(",")[0]?.trim() : "";
  const ip =
    fromForwarded ||
    req.ip ||
    req.socket?.remoteAddress ||
    undefined;
  const userAgent = req.headers["user-agent"] || undefined;
  if (!ip && !userAgent) return undefined;
  return { ip, userAgent };
}
