import { buildGraphRiskFinding } from "../../graph/graphFindingBuilder.js";
import { buildAclIntelligenceContext } from "./sidRegistry.js";

function historySids(raw = {}) {
  const history = raw.sIDHistory || raw.sidHistory || raw.sid_history;
  if (Array.isArray(history)) {
    return history.map((s) => String(s || "").trim()).filter(Boolean);
  }
  if (history) return [String(history).trim()];
  return [];
}

/**
 * Detect accounts with sIDHistory and privileged / inherited SID migration risk.
 */
export async function detectSidHistoryAnalysis(ctx) {
  const { scanId, registry, users } = buildAclIntelligenceContext(ctx);
  const findings = [];

  for (const user of users) {
    const raw = user.rawData || {};
    const entries = historySids(raw);
    if (!entries.length) continue;

    const normalizedHistory = entries
      .map((s) => registry.normalizeSidString(s))
      .filter(Boolean);
    const privilegedHistory = normalizedHistory.filter((sid) =>
      registry.isPrivilegedSid(sid),
    );
    const unknownHistory = normalizedHistory.filter((sid) => !registry.isKnown(sid));

    const status = privilegedHistory.length
      ? "migrated_privileged_sid_history"
      : unknownHistory.length
        ? "unresolved_sid_history"
        : "sid_history_present";

    findings.push(
      buildGraphRiskFinding({
        scanId,
        feature: "sid_history_analysis",
        objectType: "user",
        objectName: user.display_name || user.user_id,
        dn: raw.distinguishedName || "",
        status,
        metadata: {
          sidHistory: normalizedHistory,
          privilegedHistorySids: privilegedHistory,
          unknownHistorySids: unknownHistory,
          historyCount: normalizedHistory.length,
        },
        findingSignals: [
          "SID_HISTORY_RISK",
          ...(privilegedHistory.length ? ["PRIVILEGED_USER"] : []),
        ],
      }),
    );
  }

  return { feature: "sid_history_analysis", count: findings.length, findings };
}
