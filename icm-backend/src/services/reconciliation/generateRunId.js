import crypto from "crypto";

/**
 * @returns {string}
 */
export function generateRunId() {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const rand = crypto.randomBytes(3).toString("hex");
  return `R${ts}_${rand}`;
}
