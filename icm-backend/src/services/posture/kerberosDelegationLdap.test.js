import {
  analyzeKerberosFeature,
  detectSpnMisconfigurations,
} from "./kerberosSecurity.js";
import {
  analyzeDelegationFeature,
  detectResourceBasedConstrainedDelegation,
} from "./delegationSecurity.js";

describe("kerberos LDAP feature analyzers", () => {
  test("spn misconfiguration detects trailing-colon malformed SPN on users", () => {
    const findings = detectSpnMisconfigurations(
      [
        {
          userId: "WIS-Sd-BadSpn",
          displayName: "Bad",
          distinguishedName: "CN=Bad,OU=wisibility,DC=wisibility,DC=lcl",
          servicePrincipalNames: ["HTTP/misconfigured-spn.wisibility.lcl:"],
          userAccountControl: 512,
        },
      ],
      [],
      "scan-1",
    );
    expect(findings.some((f) => f.status === "malformed_spn")).toBe(true);
  });

  test("analyzeKerberosFeature uses typed object map", () => {
    const { count } = analyzeKerberosFeature(
      "kerberoastable_accounts",
      {
        user: [
          {
            userId: "svc",
            displayName: "svc",
            distinguishedName: "CN=svc,OU=wisibility,DC=wisibility,DC=lcl",
            servicePrincipalNames: ["HTTP/app.wisibility.lcl"],
            userAccountControl: 512,
          },
        ],
      },
      "scan-1",
    );
    expect(count).toBe(1);
  });
});

describe("delegation LDAP feature analyzers", () => {
  test("RBCD only inspects computers", () => {
    const findings = detectResourceBasedConstrainedDelegation(
      [{ userId: "u", msDSAllowedToActOnBehalfOfOtherIdentity: "x" }],
      [
        {
          computerName: "WIS-Sd-PC-Rbcd",
          distinguishedName: "CN=WIS-Sd-PC-Rbcd,OU=Computers,OU=wisibility,DC=wisibility,DC=lcl",
          msDSAllowedToActOnBehalfOfOtherIdentity: Buffer.from([1, 2, 3]),
          userAccountControl: 4096,
        },
      ],
      "scan-1",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].objectName).toBe("WIS-Sd-PC-Rbcd");
  });

  test("unconstrained uses user and computer object map", () => {
    const { count } = analyzeDelegationFeature(
      "unconstrained_delegation",
      {
        user: [
          {
            userId: "u1",
            displayName: "u1",
            distinguishedName: "CN=u1,OU=wisibility,DC=wisibility,DC=lcl",
            userAccountControl: 524288,
          },
        ],
        computer: [
          {
            computerName: "pc1",
            distinguishedName: "CN=pc1,OU=Computers,OU=wisibility,DC=wisibility,DC=lcl",
            userAccountControl: 524288,
          },
        ],
      },
      "scan-1",
    );
    expect(count).toBe(2);
  });
});
