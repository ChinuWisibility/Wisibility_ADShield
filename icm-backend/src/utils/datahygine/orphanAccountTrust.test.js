import {
  accountHasPrivilegedEntitlement,
  buildOrphanTrustExplanation,
  calculateOrphanTrustLevel,
  classifyAccountEntitlements,
  determineOrphanTrustScenario,
  entitlementLabelLooksPrivileged,
  isPrivilegedAccountDoc,
  resolveOrphanAccountLifecycleStatus,
  resolveOrphanTrustFromAccountDoc,
  TRUST_SCENARIOS,
} from "./orphanAccountTrust.js";
import {
  DEFAULT_TRUST_MAPPING,
  getEffectiveTrustMapping,
  mergeUncorrelatedTrustMappingWithDefaults,
} from "../../services/datahygine/uncorrelatedTrustMappingDefaults.js";

describe("calculateOrphanTrustLevel", () => {
  test("Inactive → LOW regardless of privileges", () => {
    expect(
      calculateOrphanTrustLevel({ accountStatus: "Inactive", hasPrivilegedEntitlement: true }),
    ).toBe("LOW");
    expect(
      calculateOrphanTrustLevel({ accountStatus: "Inactive", hasPrivilegedEntitlement: false }),
    ).toBe("LOW");
  });

  test("Active + privileged → HIGH", () => {
    expect(
      calculateOrphanTrustLevel({ accountStatus: "Active", hasPrivilegedEntitlement: true }),
    ).toBe("HIGH");
  });

  test("Active + no privileged → MEDIUM", () => {
    expect(
      calculateOrphanTrustLevel({ accountStatus: "Active", hasPrivilegedEntitlement: false }),
    ).toBe("MEDIUM");
  });

  test("custom trust mapping overrides defaults for any scenario combo", () => {
    const custom = {
      [TRUST_SCENARIOS.INACTIVE_ACCOUNT]: "MEDIUM",
      [TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED]: "MEDIUM",
      [TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED]: "HIGH",
    };
    expect(
      calculateOrphanTrustLevel({
        accountStatus: "Inactive",
        hasPrivilegedEntitlement: false,
        trustMapping: custom,
      }),
    ).toBe("MEDIUM");
    expect(
      calculateOrphanTrustLevel({
        accountStatus: "Active",
        hasPrivilegedEntitlement: true,
        trustMapping: custom,
      }),
    ).toBe("MEDIUM");
    expect(
      calculateOrphanTrustLevel({
        accountStatus: "Active",
        hasPrivilegedEntitlement: false,
        trustMapping: custom,
      }),
    ).toBe("HIGH");
  });

  test("all scenarios may map to the same Trust Level", () => {
    const allHigh = {
      [TRUST_SCENARIOS.INACTIVE_ACCOUNT]: "HIGH",
      [TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED]: "HIGH",
      [TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED]: "HIGH",
    };
    expect(
      calculateOrphanTrustLevel({
        accountStatus: "Inactive",
        hasPrivilegedEntitlement: false,
        trustMapping: allHigh,
      }),
    ).toBe("HIGH");
    expect(
      calculateOrphanTrustLevel({
        accountStatus: "Active",
        hasPrivilegedEntitlement: true,
        trustMapping: allHigh,
      }),
    ).toBe("HIGH");
    expect(
      calculateOrphanTrustLevel({
        accountStatus: "Active",
        hasPrivilegedEntitlement: false,
        trustMapping: allHigh,
      }),
    ).toBe("HIGH");
  });
});

describe("determineOrphanTrustScenario", () => {
  test("maps lifecycle + privilege to fixed scenario keys", () => {
    expect(
      determineOrphanTrustScenario({
        accountStatus: "Inactive",
        hasPrivilegedEntitlement: true,
      }),
    ).toBe(TRUST_SCENARIOS.INACTIVE_ACCOUNT);
    expect(
      determineOrphanTrustScenario({
        accountStatus: "Active",
        hasPrivilegedEntitlement: true,
      }),
    ).toBe(TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED);
    expect(
      determineOrphanTrustScenario({
        accountStatus: "Active",
        hasPrivilegedEntitlement: false,
      }),
    ).toBe(TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED);
  });
});

describe("uncorrelatedTrustMappingDefaults", () => {
  test("missing config falls back to system defaults", () => {
    const merged = mergeUncorrelatedTrustMappingWithDefaults(null);
    expect(merged.useDefaultTrustMapping).toBe(true);
    expect(merged.mapping).toEqual(DEFAULT_TRUST_MAPPING);
    expect(getEffectiveTrustMapping(null)).toEqual(DEFAULT_TRUST_MAPPING);
  });

  test("useDefaultTrustMapping ignores custom stored values at evaluation time", () => {
    const effective = getEffectiveTrustMapping({
      useDefaultTrustMapping: true,
      mapping: {
        [TRUST_SCENARIOS.INACTIVE_ACCOUNT]: "HIGH",
        [TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED]: "LOW",
        [TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED]: "LOW",
      },
    });
    expect(effective).toEqual(DEFAULT_TRUST_MAPPING);
  });

  test("custom mapping is used when Use Default is off", () => {
    const custom = {
      useDefaultTrustMapping: false,
      mapping: {
        [TRUST_SCENARIOS.INACTIVE_ACCOUNT]: "HIGH",
        [TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED]: "LOW",
        [TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED]: "HIGH",
      },
    };
    expect(getEffectiveTrustMapping(custom)).toEqual(custom.mapping);
  });
});

describe("resolveOrphanAccountLifecycleStatus", () => {
  test("string inactive / disabled", () => {
    expect(resolveOrphanAccountLifecycleStatus({ status: "Inactive" })).toBe("Inactive");
    expect(resolveOrphanAccountLifecycleStatus({ status: "disabled" })).toBe("Inactive");
    expect(resolveOrphanAccountLifecycleStatus({ status: "Active" })).toBe("Active");
  });

  test("AD userAccountControl ACCOUNTDISABLE bit", () => {
    expect(
      resolveOrphanAccountLifecycleStatus({
        rawData: { userAccountControl: 514 },
      }),
    ).toBe("Inactive");
    expect(
      resolveOrphanAccountLifecycleStatus({
        rawData: { userAccountControl: 512 },
      }),
    ).toBe("Active");
  });

  test("missing status defaults to Active", () => {
    expect(resolveOrphanAccountLifecycleStatus({})).toBe("Active");
    expect(resolveOrphanAccountLifecycleStatus(null)).toBe("Active");
  });
});

describe("privilege detection helpers", () => {
  test("isPrivilegedAccountDoc reads Discovery-style flags", () => {
    expect(isPrivilegedAccountDoc({ is_privileged: "TRUE" })).toBe(true);
    expect(isPrivilegedAccountDoc({ status: "Active" })).toBe(false);
  });

  test("entitlementLabelLooksPrivileged uses name tokens", () => {
    expect(entitlementLabelLooksPrivileged("Domain Admins")).toBe(true);
    expect(entitlementLabelLooksPrivileged("SAP_FI_DISPLAY")).toBe(false);
  });

  test("accountHasPrivilegedEntitlement via member_of tokens", () => {
    const doc = {
      status: "Active",
      member_of_entitlements: "SAP_FI_DISPLAY|Domain Admins",
    };
    expect(accountHasPrivilegedEntitlement(doc, new Set())).toBe(true);
  });

  test("accountHasPrivilegedEntitlement via catalog token set", () => {
    const doc = {
      status: "Active",
      member_of_entitlements: "PRIV_ROLE_X",
    };
    expect(accountHasPrivilegedEntitlement(doc, new Set(["priv_role_x"]))).toBe(true);
    expect(accountHasPrivilegedEntitlement(doc, new Set(["other"]))).toBe(false);
  });
});

describe("classifyAccountEntitlements", () => {
  test("splits privileged vs normal tokens", () => {
    const byToken = new Map([
      ["sap_all", { id: "ent1", name: "SAP_ALL" }],
    ]);
    const { privilegedEntitlements, normalEntitlements } = classifyAccountEntitlements(
      { member_of_entitlements: "SAP_ALL|Employee|Finance Read" },
      byToken,
    );
    expect(privilegedEntitlements).toEqual([{ id: "ent1", name: "SAP_ALL" }]);
    expect(normalEntitlements.map((e) => e.name)).toEqual(["Employee", "Finance Read"]);
  });
});

describe("buildOrphanTrustExplanation", () => {
  test("HIGH tooltip and summary with applied mapping", () => {
    const e = buildOrphanTrustExplanation({
      trustLevel: "HIGH",
      accountStatus: "Active",
      hasPrivilegedEntitlement: true,
      applicationName: "SAP",
      trustScenario: TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED,
    });
    expect(e.trustTooltipLines[0]).toBe("Account is Uncorrelated");
    expect(e.trustTooltipLines).toContain("Account Status: Active");
    expect(e.trustTooltipLines).toContain("Privileged entitlement detected");
    expect(e.trustReason).toEqual(["Account is Active", "Privileged entitlement detected"]);
    expect(e.trustSummary).toMatch(/HIGH Trust/i);
    expect(e.appliedTrustMappingLine).toBe(
      "Active Account with Privileged Entitlements → HIGH",
    );
  });

  test("MEDIUM includes application name in summary", () => {
    const e = buildOrphanTrustExplanation({
      trustLevel: "MEDIUM",
      accountStatus: "Active",
      hasPrivilegedEntitlement: false,
      applicationName: "Oracle",
      trustScenario: TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED,
    });
    expect(e.trustSummary).toContain("Oracle");
    expect(e.trustAnalysisLines[0]).toBe("Account is active.");
    expect(e.appliedTrustMappingLine).toContain("→ MEDIUM");
  });

  test("custom configured trust appears in applied mapping line", () => {
    const e = buildOrphanTrustExplanation({
      trustLevel: "LOW",
      accountStatus: "Active",
      hasPrivilegedEntitlement: true,
      trustScenario: TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED,
    });
    expect(e.appliedTrustMappingLine).toBe(
      "Active Account with Privileged Entitlements → LOW",
    );
    expect(e.trustSummary).toMatch(/configured as LOW Trust/i);
  });
});

describe("resolveOrphanTrustFromAccountDoc", () => {
  test("missing account doc stays HIGH (conservative)", () => {
    expect(resolveOrphanTrustFromAccountDoc(null).trustLevel).toBe("HIGH");
    expect(resolveOrphanTrustFromAccountDoc(undefined).trustLevel).toBe("HIGH");
  });

  test("inactive account is LOW even with admin entitlements", () => {
    const r = resolveOrphanTrustFromAccountDoc(
      { status: "Inactive", member_of_entitlements: "administrators" },
      new Set(),
    );
    expect(r.trustLevel).toBe("LOW");
    expect(r.trustScenario).toBe(TRUST_SCENARIOS.INACTIVE_ACCOUNT);
    expect(r.configuredTrustLevel).toBe("LOW");
    expect(r.accountStatus).toBe("Inactive");
    expect(r.hasPrivilegedEntitlement).toBe(false);
    expect(r.trustReason).toEqual(["Account is Inactive", "No privileged entitlement detected"]);
    expect(r.privilegedEntitlements.some((e) => /admin/i.test(e.name))).toBe(true);
  });

  test("active without privilege is MEDIUM", () => {
    const r = resolveOrphanTrustFromAccountDoc(
      { status: "Active", member_of_entitlements: "read_only" },
      new Set(),
      { applicationName: "Github" },
    );
    expect(r.trustLevel).toBe("MEDIUM");
    expect(r.trustScenario).toBe(TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED);
    expect(r.accountStatus).toBe("Active");
    expect(r.hasPrivilegedEntitlement).toBe(false);
    expect(r.normalEntitlements.map((e) => e.name)).toContain("read_only");
    expect(r.trustSummary).toContain("Github");
  });

  test("active with privilege is HIGH", () => {
    const r = resolveOrphanTrustFromAccountDoc(
      { status: "Active", member_of_entitlements: "Backup Operators" },
      new Set(),
    );
    expect(r.trustLevel).toBe("HIGH");
    expect(r.trustScenario).toBe(TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED);
    expect(r.hasPrivilegedEntitlement).toBe(true);
    expect(r.privilegedEntitlements.length).toBeGreaterThan(0);
    expect(r.trustTooltipLines).toContain("Privileged entitlement detected");
  });

  test("custom mapping flips trust while scenario stays the same", () => {
    const custom = {
      [TRUST_SCENARIOS.INACTIVE_ACCOUNT]: "HIGH",
      [TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED]: "LOW",
      [TRUST_SCENARIOS.ACTIVE_WITHOUT_PRIVILEGED]: "HIGH",
    };
    const inactive = resolveOrphanTrustFromAccountDoc(
      { status: "Inactive" },
      new Set(),
      { trustMapping: custom },
    );
    expect(inactive.trustScenario).toBe(TRUST_SCENARIOS.INACTIVE_ACCOUNT);
    expect(inactive.trustLevel).toBe("HIGH");
    expect(inactive.configuredTrustLevel).toBe("HIGH");

    const privileged = resolveOrphanTrustFromAccountDoc(
      { status: "Active", member_of_entitlements: "Domain Admins" },
      new Set(),
      { trustMapping: custom },
    );
    expect(privileged.trustScenario).toBe(TRUST_SCENARIOS.ACTIVE_WITH_PRIVILEGED);
    expect(privileged.trustLevel).toBe("LOW");
    expect(privileged.appliedTrustMappingLine).toContain("→ LOW");
  });
});
