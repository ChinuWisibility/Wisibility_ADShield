/**
 * Trust Level for uncorrelated (orphan) accounts — calculation + explainability.
 *
 * Scenarios (fixed evaluation):
 *   INACTIVE_ACCOUNT            — Uncorrelated + Inactive
 *   ACTIVE_WITH_PRIVILEGED      — Uncorrelated + Active + privileged entitlement(s)
 *   ACTIVE_WITHOUT_PRIVILEGED   — Uncorrelated + Active + no privileged entitlements
 *
 * Default mapping (overridable via Global Rule Set Trust Mapping):
 *   INACTIVE_ACCOUNT          → LOW
 *   ACTIVE_WITH_PRIVILEGED    → HIGH
 *   ACTIVE_WITHOUT_PRIVILEGED → MEDIUM
 *
 * Reuses account-status helpers and privilege detection patterns used elsewhere
 * (privilegeMatchFilter flags, catalog is_privilege, name-token heuristics).
 */

import mongoose from "mongoose";
import { getDynamicEntitlementModelForTenantId } from "../../models/application/Entitlements.js";
import { matchPrivilegedForApplication } from "../privilegeMatchFilter.js";
import { extractEntitlementTokensFromAppUser } from "../sod/sodAppUserEntitlements.js";
import { classifyAccountStatusRaw } from "../../services/application/applicationUserStatusCountsService.js";
import { isAppUserInactiveForHygiene } from "./appUserInactiveWithAccess.js";
import { PRIVILEGED_NAME_TOKENS } from "../../services/graph/graphConstants.js";
import {
  DEFAULT_TRUST_MAPPING,
  TRUST_SCENARIO_LABELS,
  TRUST_SCENARIOS,
} from "../../services/datahygine/uncorrelatedTrustMappingDefaults.js";

export {
  DEFAULT_TRUST_MAPPING,
  TRUST_SCENARIO_LABELS,
  TRUST_SCENARIOS,
};

const PRIVILEGE_STRING_TOKENS = new Set(["true", "yes", "1", "y", "privileged"]);

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isPrivilegedFlag(raw) {
  if (raw === true) return true;
  return PRIVILEGE_STRING_TOKENS.has(String(raw ?? "").trim().toLowerCase());
}

function readRawData(doc) {
  return doc?.rawData && typeof doc.rawData === "object" ? doc.rawData : {};
}

function entitlementDisplayName(ent) {
  for (const field of [
    ent?.entitlement_name,
    ent?.displayName,
    ent?.display_name,
    ent?.name,
    ent?.entitlementName,
    ent?.entitlement_id,
  ]) {
    const s = field != null ? String(field).trim() : "";
    if (s) return s;
  }
  return ent?._id != null ? String(ent._id) : "";
}

/**
 * Normalize privileged catalog input: Set of tokens or `{ tokenSet, byToken }`.
 * @param {Set<string>|{ tokenSet?: Set<string>, byToken?: Map<string, { id: string, name: string }>}|null|undefined} input
 */
function normalizePrivilegedCatalog(input) {
  if (!input) {
    return { tokenSet: new Set(), byToken: new Map() };
  }
  if (input instanceof Set) {
    return { tokenSet: input, byToken: new Map() };
  }
  if (typeof input === "object") {
    const tokenSet = input.tokenSet instanceof Set ? input.tokenSet : new Set();
    const byToken = input.byToken instanceof Map ? input.byToken : new Map();
    if (tokenSet.size === 0 && byToken.size > 0) {
      for (const k of byToken.keys()) tokenSet.add(k);
    }
    return { tokenSet, byToken };
  }
  return { tokenSet: new Set(), byToken: new Map() };
}

/**
 * User-level privilege flags (Discovery "Mark Privileged", CSV is_privileged, etc.).
 * @param {object|null|undefined} accountDoc
 */
export function isPrivilegedAccountDoc(accountDoc) {
  if (!accountDoc || typeof accountDoc !== "object") return false;
  const raw = readRawData(accountDoc);
  if (
    [
      accountDoc.isPrivileged,
      accountDoc.is_privileged,
      accountDoc.is_privilege,
      accountDoc.privileged,
      raw.isPrivileged,
      raw.is_privileged,
      raw.is_privilege,
      raw.privileged,
    ].some(isPrivilegedFlag)
  ) {
    return true;
  }
  const accountType = String(accountDoc.accountType || raw.accountType || "")
    .trim()
    .toLowerCase();
  return accountType === "privileged" || accountType === "admin";
}

/**
 * Whether an entitlement label matches privileged name heuristics.
 * @param {string} label
 */
export function entitlementLabelLooksPrivileged(label) {
  const n = normalizeToken(label);
  if (!n) return false;
  return PRIVILEGED_NAME_TOKENS.some((t) => n.includes(t));
}

/**
 * Resolve Active / Inactive lifecycle for an application user document.
 * Prefers AD userAccountControl when present; otherwise string status fields.
 * Unknown (missing) status is treated as Active so trust is not understated.
 *
 * @param {object|null|undefined} accountDoc
 * @returns {'Active'|'Inactive'}
 */
export function resolveOrphanAccountLifecycleStatus(accountDoc) {
  if (!accountDoc || typeof accountDoc !== "object") return "Active";
  const raw = readRawData(accountDoc);

  const uacRaw =
    raw.userAccountControl ??
    raw.useraccountcontrol ??
    accountDoc.userAccountControl ??
    accountDoc.useraccountcontrol;

  if (uacRaw != null && String(uacRaw).trim() !== "") {
    const uacClass = classifyAccountStatusRaw(uacRaw);
    if (uacClass === "inactive") return "Inactive";
    if (uacClass === "active") return "Active";
  }

  if (isAppUserInactiveForHygiene(accountDoc)) return "Inactive";

  const statusCandidates = [
    accountDoc.status,
    raw.status,
    accountDoc.account_status,
    raw.account_status,
    accountDoc.user_status,
    raw.user_status,
    accountDoc.enabled,
    raw.enabled,
    accountDoc.active,
    raw.active,
    accountDoc.isActive,
    raw.isActive,
  ];
  for (const v of statusCandidates) {
    if (v == null || String(v).trim() === "") continue;
    const classified = classifyAccountStatusRaw(v);
    if (classified === "inactive") return "Inactive";
    if (classified === "active") return "Active";
  }

  return "Active";
}

/**
 * Determine which fixed trust scenario an account matches.
 * Scenario evaluation does NOT change; only mapped Trust Levels are configurable.
 *
 * @param {{ accountStatus: 'Active'|'Inactive', hasPrivilegedEntitlement: boolean }} input
 * @returns {typeof TRUST_SCENARIOS[keyof typeof TRUST_SCENARIOS]}
 */
export function determineOrphanTrustScenario({ accountStatus, hasPrivilegedEntitlement }) {
  if (String(accountStatus || "").toLowerCase() === "inactive") {
    return TRUST_SCENARIOS.INACTIVE_ACCOUNT;
  }
  if (hasPrivilegedEntitlement) {
    return TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED;
  }
  return TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED;
}

/**
 * @param {{
 *   accountStatus: 'Active'|'Inactive',
 *   hasPrivilegedEntitlement: boolean,
 *   trustMapping?: Record<string, 'LOW'|'MEDIUM'|'HIGH'>|null,
 * }} input
 * @returns {'LOW'|'MEDIUM'|'HIGH'}
 */
export function calculateOrphanTrustLevel({
  accountStatus,
  hasPrivilegedEntitlement,
  trustMapping = null,
}) {
  const scenario = determineOrphanTrustScenario({ accountStatus, hasPrivilegedEntitlement });
  const mapping =
    trustMapping && typeof trustMapping === "object"
      ? { ...DEFAULT_TRUST_MAPPING, ...trustMapping }
      : DEFAULT_TRUST_MAPPING;
  return mapping[scenario] || DEFAULT_TRUST_MAPPING[scenario];
}

/**
 * Batch-load privileged entitlement catalog for one application (tokens + id/name).
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 * @param {string} applicationName
 * @param {unknown} tenantId
 * @returns {Promise<{ tokenSet: Set<string>, byToken: Map<string, { id: string, name: string }> }>}
 */
export async function loadPrivilegedEntitlementCatalog(applicationId, applicationName, tenantId) {
  const tokenSet = new Set();
  const byToken = new Map();
  if (!applicationName || !tenantId || !applicationId) {
    return { tokenSet, byToken };
  }

  try {
    const EntModel = await getDynamicEntitlementModelForTenantId(applicationName, tenantId);
    const appOid = mongoose.Types.ObjectId.isValid(String(applicationId))
      ? new mongoose.Types.ObjectId(String(applicationId))
      : applicationId;
    const privEnts = await EntModel.find(matchPrivilegedForApplication(appOid))
      .select(
        "entitlement_name entitlement_id displayName display_name name entitlementName is_privilege isPrivileged classification",
      )
      .limit(500)
      .lean();

    for (const e of privEnts || []) {
      const id = e._id != null ? String(e._id) : "";
      const name = entitlementDisplayName(e) || id;
      const entry = { id: id || name, name: name || id };
      for (const field of [
        e.entitlement_name,
        e.entitlement_id,
        e.displayName,
        e.display_name,
        e.name,
        e.entitlementName,
        id,
      ]) {
        const t = normalizeToken(field);
        if (!t) continue;
        tokenSet.add(t);
        if (!byToken.has(t)) byToken.set(t, entry);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[orphanAccountTrust] Could not load privileged entitlements for ${applicationName}:`,
      err?.message || err,
    );
  }

  return { tokenSet, byToken };
}

/**
 * Tokens from privileged entitlement catalog rows for one application.
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 * @param {string} applicationName
 * @param {unknown} tenantId
 * @returns {Promise<Set<string>>}
 */
export async function loadPrivilegedEntitlementTokenSet(applicationId, applicationName, tenantId) {
  const { tokenSet } = await loadPrivilegedEntitlementCatalog(applicationId, applicationName, tenantId);
  return tokenSet;
}

/**
 * Split account entitlement tokens into privileged vs normal (for explainability UI).
 * @param {object|null|undefined} accountDoc
 * @param {Map<string, { id: string, name: string }>} [privilegedByToken]
 * @returns {{ privilegedEntitlements: { id: string, name: string }[], normalEntitlements: { id: string, name: string }[] }}
 */
export function classifyAccountEntitlements(accountDoc, privilegedByToken = new Map()) {
  const privilegedEntitlements = [];
  const normalEntitlements = [];
  if (!accountDoc || typeof accountDoc !== "object") {
    return { privilegedEntitlements, normalEntitlements };
  }

  const seenPriv = new Set();
  const seenNorm = new Set();
  const raw = readRawData(accountDoc);
  const tokens = extractEntitlementTokensFromAppUser(accountDoc, raw);

  for (const token of tokens) {
    const name = String(token || "").trim();
    if (!name) continue;
    const norm = normalizeToken(name);
    const catalog = privilegedByToken.get(norm);
    const isPriv = Boolean(catalog) || entitlementLabelLooksPrivileged(name);
    if (isPriv) {
      if (seenPriv.has(norm)) continue;
      seenPriv.add(norm);
      privilegedEntitlements.push({
        id: catalog?.id != null ? String(catalog.id) : norm,
        name: catalog?.name || name,
      });
    } else {
      if (seenNorm.has(norm)) continue;
      seenNorm.add(norm);
      normalEntitlements.push({ id: norm, name });
    }
  }

  return { privilegedEntitlements, normalEntitlements };
}

/**
 * @param {object|null|undefined} accountDoc
 * @param {Set<string>|{ tokenSet?: Set<string>, byToken?: Map<string, { id: string, name: string }>}} [privilegedCatalog]
 * @returns {boolean}
 */
export function accountHasPrivilegedEntitlement(accountDoc, privilegedCatalog = new Set()) {
  if (!accountDoc || typeof accountDoc !== "object") return false;
  if (isPrivilegedAccountDoc(accountDoc)) return true;

  const { tokenSet } = normalizePrivilegedCatalog(privilegedCatalog);
  const raw = readRawData(accountDoc);
  const tokens = extractEntitlementTokensFromAppUser(accountDoc, raw);
  for (const token of tokens) {
    const norm = normalizeToken(token);
    if (!norm) continue;
    if (tokenSet.has(norm)) return true;
    if (entitlementLabelLooksPrivileged(token)) return true;
  }
  return false;
}

/**
 * Human-readable trust explainability (tooltip + expanded Trust Analysis).
 * Reason bullets stay factual (status / privilege). Summary + Applied Trust Mapping
 * reflect the configured scenario → Trust Level mapping.
 *
 * @param {{
 *   trustLevel: string,
 *   accountStatus: 'Active'|'Inactive'|null,
 *   hasPrivilegedEntitlement: boolean,
 *   applicationName?: string|null,
 *   trustScenario?: string|null,
 * }} input
 */
export function buildOrphanTrustExplanation({
  trustLevel,
  accountStatus,
  hasPrivilegedEntitlement,
  applicationName,
  trustScenario = null,
}) {
  const level = String(trustLevel || "HIGH").toUpperCase();
  const statusLabel =
    accountStatus === "Inactive" ? "Inactive" : accountStatus === "Active" ? "Active" : "Unknown";
  const appLabel =
    applicationName && String(applicationName).trim()
      ? String(applicationName).trim()
      : "the application";

  /** @type {string[]} Phase 2 Trust chip tooltip bullets */
  const trustTooltipLines = [
    "Account is Uncorrelated",
    `Account Status: ${statusLabel}`,
  ];
  /** @type {string[]} API / compact reason bullets */
  let trustReason = [];
  /** @type {string[]} Expanded Trust Reason sentences */
  let trustAnalysisLines = [];
  /** @type {string} */
  let trustSummary = "";
  /** @type {string|null} */
  let appliedTrustMappingLabel = null;
  /** @type {string|null} */
  let appliedTrustMappingLine = null;
  /** @type {string|null} */
  let trustScenarioLabel = null;

  if (!accountStatus && level === "HIGH" && !hasPrivilegedEntitlement) {
    trustTooltipLines.push("Account details unavailable — Trust defaulted to HIGH");
    trustReason = ["Account details unavailable", "Trust defaulted to HIGH"];
    trustAnalysisLines = [
      "Live application account details were unavailable.",
      "Trust defaulted to HIGH pending enrichment.",
    ];
    trustSummary =
      "This account is classified as HIGH Trust because live account details were unavailable and Trust was defaulted conservatively.";
    return {
      trustReason,
      trustTooltipLines,
      trustAnalysisLines,
      trustSummary,
      appliedTrustMappingLabel: null,
      appliedTrustMappingLine: null,
      trustScenarioLabel: null,
    };
  }

  const scenarioKey =
    trustScenario ||
    determineOrphanTrustScenario({
      accountStatus: accountStatus === "Inactive" ? "Inactive" : "Active",
      hasPrivilegedEntitlement: Boolean(hasPrivilegedEntitlement),
    });
  trustScenarioLabel = TRUST_SCENARIO_LABELS[scenarioKey] || scenarioKey;
  appliedTrustMappingLabel = trustScenarioLabel;
  appliedTrustMappingLine = `${trustScenarioLabel} → ${level}`;

  if (scenarioKey === TRUST_SCENARIOS.INACTIVE_ACCOUNT) {
    trustTooltipLines.push("No privileged entitlement detected");
    trustReason = ["Account is Inactive", "No privileged entitlement detected"];
    trustAnalysisLines = ["Account is inactive.", "No privileged entitlement detected."];
  } else if (scenarioKey === TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED) {
    trustTooltipLines.push("Privileged entitlement detected");
    trustReason = ["Account is Active", "Privileged entitlement detected"];
    trustAnalysisLines = [
      "Account is active.",
      "One or more privileged entitlements detected.",
    ];
  } else {
    trustTooltipLines.push("No privileged entitlement assigned");
    trustReason = ["Account is Active", "No privileged entitlement assigned"];
    trustAnalysisLines = ["Account is active.", "No privileged entitlement assigned."];
  }

  trustSummary =
    `This account matched the "${trustScenarioLabel}" scenario. ` +
    `Based on the organization's Global Trust Mapping this scenario is configured as ${level} Trust.`;

  // Keep a short legacy-style note for active-without-privilege when app name helps analysts.
  if (scenarioKey === TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED && appLabel !== "the application") {
    trustSummary =
      `This account matched the "${trustScenarioLabel}" scenario in ${appLabel}. ` +
      `Based on the organization's Global Trust Mapping this scenario is configured as ${level} Trust.`;
  }

  return {
    trustReason,
    trustTooltipLines,
    trustAnalysisLines,
    trustSummary,
    appliedTrustMappingLabel,
    appliedTrustMappingLine,
    trustScenarioLabel,
  };
}

/**
 * Full trust resolution for one orphan + its live application user doc.
 * When the account document is unavailable, returns HIGH (conservative).
 *
 * @param {object|null|undefined} accountDoc
 * @param {Set<string>|{ tokenSet?: Set<string>, byToken?: Map<string, { id: string, name: string }>}} [privilegedCatalog]
 * @param {{
 *   applicationName?: string|null,
 *   trustMapping?: Record<string, 'LOW'|'MEDIUM'|'HIGH'>|null,
 * }} [options]
 */
export function resolveOrphanTrustFromAccountDoc(
  accountDoc,
  privilegedCatalog = new Set(),
  options = {},
) {
  const catalog = normalizePrivilegedCatalog(privilegedCatalog);
  const applicationName = options.applicationName ?? null;
  const trustMapping =
    options.trustMapping && typeof options.trustMapping === "object"
      ? { ...DEFAULT_TRUST_MAPPING, ...options.trustMapping }
      : DEFAULT_TRUST_MAPPING;

  if (!accountDoc || typeof accountDoc !== "object") {
    const trustLevel = "HIGH";
    const explanation = buildOrphanTrustExplanation({
      trustLevel,
      accountStatus: null,
      hasPrivilegedEntitlement: false,
      applicationName,
    });
    return {
      trustLevel,
      trustScenario: null,
      configuredTrustLevel: trustLevel,
      accountStatus: null,
      hasPrivilegedEntitlement: false,
      privilegedEntitlements: [],
      normalEntitlements: [],
      ...explanation,
    };
  }

  const accountStatus = resolveOrphanAccountLifecycleStatus(accountDoc);
  const { privilegedEntitlements, normalEntitlements } = classifyAccountEntitlements(
    accountDoc,
    catalog.byToken,
  );
  const hasPrivilegedEntitlement =
    accountStatus === "Active" ? accountHasPrivilegedEntitlement(accountDoc, catalog) : false;
  const trustScenario = determineOrphanTrustScenario({
    accountStatus,
    hasPrivilegedEntitlement,
  });
  const trustLevel = calculateOrphanTrustLevel({
    accountStatus,
    hasPrivilegedEntitlement,
    trustMapping,
  });
  const explanation = buildOrphanTrustExplanation({
    trustLevel,
    accountStatus,
    hasPrivilegedEntitlement,
    applicationName,
    trustScenario,
  });

  return {
    trustLevel,
    trustScenario,
    configuredTrustLevel: trustLevel,
    accountStatus,
    hasPrivilegedEntitlement,
    privilegedEntitlements,
    normalEntitlements,
    ...explanation,
  };
}
