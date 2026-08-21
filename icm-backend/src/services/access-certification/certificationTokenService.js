import jwt from "jsonwebtoken";
import CertificationReviewerPortalSession from "../../models/certification/CertificationReviewerPortalSession.js";
import env from "../../config/env.js";

/**
 * JWT `expiresIn` value: env can be hours as a number (e.g. 48) or a duration string (e.g. 48h, 2d).
 * Defaults to 48h when unset or invalid.
 */
export function getReviewerJwtExpiresIn() {
  const raw = process.env.CERTIFICATION_REVIEWER_JWT_TTL_HOURS;
  if (raw == null || !String(raw).trim()) return "48h";
  const compact = String(raw).trim().replace(/\s+/g, "");
  if (/^\d+[smhd]$/i.test(compact)) return compact;
  const n = parseInt(compact, 10);
  if (!Number.isNaN(n) && n > 0) return `${n}h`;
  return "48h";
}

function jwtSecret() {
  return env.portalSecrets.certification;
}

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * Compute absolute expiry Date from an expiresIn string like "48h" or "2d".
 * Falls back to 48 hours when the string cannot be parsed.
 */
function expiresAtFromDuration(expiresIn) {
  const match = String(expiresIn ?? "").trim().match(/^(\d+)([smhd])$/i);
  if (match) {
    const millis = parseInt(match[1], 10) * (UNIT_MS[match[2].toLowerCase()] || 0);
    if (millis > 0) return new Date(Date.now() + millis);
  }
  return new Date(Date.now() + 48 * 60 * 60 * 1000);
}

/**
 * One JWT per reviewer for the no-login review portal.
 * Query-string tokens can appear in browser history and logs — use a short TTL
 * via `CERTIFICATION_REVIEWER_JWT_TTL_HOURS` (hours as a number, e.g. 24, or a
 * duration string for `expiresIn`, e.g. 48h or 2d). Default 48h.
 *
 * Also upserts a CertificationReviewerPortalSession document so we have a persistent
 * record of when access was granted (for compliance audit trails).
 */
export function generateReviewerToken(campaignId, reviewerEmail, { tenantId, dueDate, reviewerId } = {}) {
  const email = String(reviewerEmail ?? "")
    .trim()
    .toLowerCase();
  if (!email) throw new Error("reviewerEmail is required");
  const payload = {
    typ: "cert_reviewer",
    reviewerEmail: email,
    campaignId: String(campaignId),
    // sub = stable identity — queryable even after an email rename
    ...(reviewerId ? { sub: String(reviewerId) } : {}),
  };

  // Prefer campaign due date + a short grace period over the fixed env TTL
  // so the link stays valid for the review window, without staying valid
  // indefinitely long past it (WIS-021 — was a 7-day grace period, an
  // unnecessarily long bearer-token exposure window for an unauthenticated
  // link; 24h comfortably covers timezone/end-of-day slack). Floor at 48h.
  let expiresIn = getReviewerJwtExpiresIn();
  if (dueDate) {
    const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
    if (!isNaN(due.getTime())) {
      const bufMs  = 24 * 3600 * 1000;      // 24h grace period after due date
      const minMs  = 48 * 3600 * 1000;       // minimum 48 h
      const ttlMs  = Math.max(due.getTime() + bufMs - Date.now(), minMs);
      expiresIn = `${Math.floor(ttlMs / 1000)}s`;
    }
  }

  const token = jwt.sign(payload, jwtSecret(), { expiresIn });

  const now = new Date();
  const tokenExpiresAt = expiresAtFromDuration(expiresIn);

  // Fire-and-forget — never block token issuance on a DB write.
  CertificationReviewerPortalSession.findOneAndUpdate(
    { campaignId: String(campaignId), reviewerEmail: email },
    {
      $set: {
        tokenIssuedAt: now,
        tokenExpiresAt,
        sessionStatus: "ACTIVE",
      },
      $setOnInsert: {
        ...(tenantId ? { tenantId } : {}),
        decisionsCount: 0,
        ipAddresses: [],
        userAgents: [],
      },
    },
    { upsert: true, new: false },
  ).catch((e) =>
    console.warn("[generateReviewerToken] PortalSession upsert failed:", e?.message),
  );

  return token;
}

export function validateReviewerToken(rawToken) {
  const token = String(rawToken ?? "").trim();
  if (!token) throw new Error("Missing token");
  try {
    const decoded = jwt.verify(token, jwtSecret(), { algorithms: ["HS256"] });
    if (decoded.typ !== "cert_reviewer") {
      throw new Error("Invalid token type");
    }
    const result = {
      reviewerEmail: String(decoded.reviewerEmail || "").toLowerCase(),
      campaignId: decoded.campaignId,
    };

    // Fire-and-forget — update firstAccessedAt (only on first access) and lastActivityAt.
    CertificationReviewerPortalSession.findOneAndUpdate(
      { campaignId: result.campaignId, reviewerEmail: result.reviewerEmail },
      [
        {
          $set: {
            lastActivityAt: new Date(),
            sessionStatus: "ACTIVE",
            firstAccessedAt: {
              $ifNull: ["$firstAccessedAt", new Date()],
            },
          },
        },
      ],
    ).catch(() => {});

    return result;
  } catch (e) {
    const msg =
      e?.name === "TokenExpiredError"
        ? "Link expired; request a new certification email."
        : "Invalid token";
    throw new Error(msg);
  }
}
