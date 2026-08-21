import { evaluateFinding } from "../src/services/security/securityPolicyEngine.js";

const policies = [
  {
    name: "Disabled Computer",
    enabled: true,
    riskLevel: "low",
    conditions: ["DISABLED_COMPUTER"],
    conditionMode: "AND",
    recommendation: "Remove stale computer.",
  },
  {
    name: "Dormant Privileged User",
    enabled: true,
    riskLevel: "critical",
    conditions: ["PRIVILEGED_USER", "INACTIVE_OVER:90"],
    conditionMode: "AND",
    recommendation: "Revoke privileged access.",
  },
  {
    name: "Password Never Expires",
    enabled: true,
    riskLevel: "medium",
    conditions: ["PASSWORD_NEVER_EXPIRES"],
    conditionMode: "AND",
    recommendation: "Enforce rotation.",
  },
];

describe("securityPolicyEngine", () => {
  it("assigns low risk for disabled computer discovery", () => {
    const result = evaluateFinding(
      {
        feature: "disabled_computers",
        objectType: "computer",
        objectName: "WS-001",
        status: "disabled",
      },
      policies,
    );
    expect(result.riskLevel).toBe("low");
    expect(result.matchedPolicyName).toBe("Disabled Computer");
    expect(result.findingType).toBe("DISABLED_COMPUTER");
    expect(result.recommendation).toContain("Remove stale");
  });

  it("matches composite privileged dormant policy", () => {
    const result = evaluateFinding(
      {
        feature: "dormant_privileged_users",
        objectType: "user",
        objectName: "admin",
        status: "inactive_120d",
        evidence: { inactiveDays: 120 },
      },
      policies,
    );
    expect(result.riskLevel).toBe("critical");
    expect(result.matchedPolicyName).toBe("Dormant Privileged User");
    expect(result.findingSignals).toContain("PRIVILEGED_USER");
    expect(result.findingSignals).toContain("INACTIVE_USER");
  });

  it("does not assign hardcoded detector risk from discovery payload", () => {
    const result = evaluateFinding(
      {
        feature: "password_never_expires",
        objectType: "user",
        objectName: "user1",
        status: "password_never_expires",
        riskLevel: "critical",
        recommendation: "Should be ignored",
      },
      policies,
    );
    expect(result.riskLevel).toBe("medium");
    expect(result.recommendation).toBe("Enforce rotation.");
  });

  it("matches OR policy when any condition satisfies", () => {
    const orPolicies = [
      {
        name: "Kerberos OR AS-REP",
        enabled: true,
        riskLevel: "critical",
        conditions: ["KERBEROASTABLE_ACCOUNT", "ASREP_ROASTABLE_USER"],
        conditionMode: "OR",
        recommendation: "Harden Kerberos.",
      },
    ];
    const result = evaluateFinding(
      {
        feature: "asrep_roastable_users",
        objectType: "user",
        objectName: "user1",
        status: "dont_require_preauth",
        findingSignals: ["ASREP_ROASTABLE_USER"],
      },
      orPolicies,
    );
    expect(result.riskLevel).toBe("critical");
    expect(result.matchedPolicyName).toBe("Kerberos OR AS-REP");
  });

  it("matches dynamic inactive threshold condition", () => {
    const dynamicPolicies = [
      {
        name: "Inactive > 120 days",
        enabled: true,
        riskLevel: "high",
        conditions: ["INACTIVE_USER", "INACTIVE_OVER:120"],
        conditionMode: "AND",
        recommendation: "Review long-idle accounts.",
      },
    ];
    const match = evaluateFinding(
      {
        feature: "inactive_users",
        objectType: "user",
        objectName: "user1",
        status: "inactive_150d",
        evidence: { inactiveDays: 150 },
      },
      dynamicPolicies,
    );
    expect(match.riskLevel).toBe("high");
    expect(match.matchedPolicyName).toBe("Inactive > 120 days");

    const noMatch = evaluateFinding(
      {
        feature: "inactive_users",
        objectType: "user",
        objectName: "user2",
        status: "inactive_60d",
        evidence: { inactiveDays: 60 },
      },
      dynamicPolicies,
    );
    expect(noMatch.riskLevel).toBe("not defined");
  });

  it("normalizes legacy threshold tokens", () => {
    const legacyPolicies = [
      {
        name: "Legacy 90d",
        enabled: true,
        riskLevel: "medium",
        conditions: ["INACTIVE_USER", "INACTIVE_OVER_90_DAYS"],
        conditionMode: "AND",
        recommendation: "Legacy.",
      },
    ];
    const result = evaluateFinding(
      {
        feature: "inactive_users",
        objectType: "user",
        objectName: "user1",
        status: "inactive_100d",
        evidence: { inactiveDays: 100 },
      },
      legacyPolicies,
    );
    expect(result.riskLevel).toBe("medium");
  });
});
