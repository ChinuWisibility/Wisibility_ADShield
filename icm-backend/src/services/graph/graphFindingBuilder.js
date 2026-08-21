import {
  deriveFindingSignals,
  resolvePrimaryFindingType,
} from "../../constants/findingSignals.js";

/**
 * Build a graph-based discovery finding (no hardcoded risk).
 */
export function buildGraphDiscoveryFinding({
  scanId,
  feature,
  objectType,
  objectName,
  dn = "",
  status = "",
  attributes = {},
  evidence = {},
  metadata = {},
  relationships = [],
  findingSignals: explicitSignals,
}) {
  const mergedEvidence =
    evidence && Object.keys(evidence).length
      ? evidence
      : metadata && typeof metadata === "object"
        ? metadata
        : {};

  const draft = {
    scanId,
    feature,
    objectType,
    objectName: objectName || "—",
    dn,
    status,
    attributes: attributes && typeof attributes === "object" ? attributes : {},
    evidence: mergedEvidence,
    relationships: Array.isArray(relationships) ? relationships : [],
  };

  const findingSignals =
    Array.isArray(explicitSignals) && explicitSignals.length > 0
      ? [...new Set(explicitSignals.map(String))]
      : deriveFindingSignals(draft);
  const findingType = resolvePrimaryFindingType({ ...draft, findingSignals });

  return {
    ...draft,
    findingType,
    findingSignals,
  };
}

/** @deprecated riskLevel/recommendation ignored — use buildGraphDiscoveryFinding */
export function buildGraphRiskFinding(params) {
  const {
    riskLevel: _riskLevel,
    recommendation: _recommendation,
    metadata = {},
    findingSignals,
    ...rest
  } = params;
  return buildGraphDiscoveryFinding({ ...rest, evidence: metadata, findingSignals });
}
