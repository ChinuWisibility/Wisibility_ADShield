import { jest } from "@jest/globals";

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

async function loadModules() {
  jest.resetModules();
  const client = await import("./adShieldClient.js");
  const adapter = await import("./adShieldAclAdapter.js");
  const acl = await import("../aclIntelligence/aclIntelligenceService.js");
  return { client, adapter, acl };
}

function baseCtx(overrides = {}) {
  return {
    scanId: "scan-test-1",
    tenantId: "tenant-1",
    applicationId: "app-1",
    queryOverrides: {},
    ldapCfg: { baseDn: "DC=example,DC=com" },
    adConfig: {
      url: "ldap://dc.example.com",
      bindDn: "CN=svc,DC=example,DC=com",
      bindPassword: "SuperSecretPass!",
      baseDn: "DC=example,DC=com",
      maxUsers: 1000,
    },
    analysisCtx: {
      users: [
        {
          user_id: "alice",
          rawData: {
            objectSid: "S-1-5-21-1-2-3-1001",
            distinguishedName: "CN=alice,DC=example,DC=com",
          },
        },
      ],
      entitlements: [
        {
          entitlement_id: "group1",
          entitlement_name: "Domain Admins",
          rawData: {
            objectSid: "S-1-5-21-1-2-3-512",
            distinguishedName: "CN=Domain Admins,DC=example,DC=com",
            sAMAccountName: "Domain Admins",
          },
        },
      ],
      privilegedGroupsReachable: () => [],
    },
    scanGraph: { privilegeGroupIds: new Set(), privilegedGroupsReachable: () => [] },
    application: { connectionConfig: { ad: { baseDn: "DC=example,DC=com" } } },
    ...overrides,
  };
}

describe("ADShield ACL integration", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  test("sanitizeAdShieldErrorMessage redacts bind passwords", async () => {
    const { client } = await loadModules();
    const msg = client.sanitizeAdShieldErrorMessage(
      'Bind failed bindPassword=SuperSecretPass! password=also-secret',
    );
    expect(msg).not.toContain("SuperSecretPass");
    expect(msg).not.toContain("also-secret");
    expect(msg).toMatch(/\[redacted\]/);
  });

  test("mapAdShieldFinding rejects malformed findings", async () => {
    const { adapter } = await loadModules();
    expect(adapter.mapAdShieldFinding(null, "s1")).toBeNull();
    expect(
      adapter.mapAdShieldFinding(
        { feature: "broken_acls", status: "x" },
        "s1",
      ),
    ).toBeNull();
    expect(
      adapter.mapAdShieldFinding(
        {
          feature: "orphan_sids",
          objectType: "user",
          objectName: "u",
          status: "orphan_sid",
          findingSignals: ["ORPHAN_SID"],
          findingType: "ORPHAN_SID",
        },
        "s1",
      ),
    ).toBeNull();
  });

  test("mapAdShieldFinding accepts valid broken_acls finding", async () => {
    const { adapter } = await loadModules();
    const mapped = adapter.mapAdShieldFinding(
      {
        feature: "broken_acls",
        objectType: "group",
        objectName: "Domain Admins",
        dn: "CN=Domain Admins,DC=example,DC=com",
        status: "orphan_acl_principal",
        evidence: { orphanSid: "S-1-5-21-1-2-3-9999" },
        findingType: "BROKEN_ACL",
        findingSignals: ["BROKEN_ACL"],
      },
      "scan-1",
    );
    expect(mapped).toMatchObject({
      scanId: "scan-1",
      feature: "broken_acls",
      findingType: "BROKEN_ACL",
      findingSignals: expect.arrayContaining(["BROKEN_ACL"]),
      evidence: { orphanSid: "S-1-5-21-1-2-3-9999" },
    });
    expect(mapped.riskLevel).toBeUndefined();
  });

  test("ADShield disabled keeps Node broken_acls runner", async () => {
    process.env.ADSHIELD_ENABLED = "false";
    const { acl } = await loadModules();
    const result = await acl.runAclIntelligence(baseCtx(), [
      "broken_acls",
      "orphan_sids",
    ]);
    const sources = result.results.map((r) => ({ feature: r.feature, source: r.source }));
    expect(sources).toEqual(
      expect.arrayContaining([
        { feature: "orphan_sids", source: "node" },
        { feature: "broken_acls", source: "node" },
      ]),
    );
    expect(result.results.find((r) => r.feature === "broken_acls")?.source).toBe(
      "node",
    );
    expect(global.fetch).toBe(originalFetch);
  });

  test("ADShield enabled delegates broken_acls and unknown_sid_bindings", async () => {
    process.env.ADSHIELD_ENABLED = "true";
    process.env.ADSHIELD_BASE_URL = "http://adshield.test";
    global.fetch = jest.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.features).toEqual(
        expect.arrayContaining(["broken_acls", "unknown_sid_bindings"]),
      );
      expect(body.connection.bindPassword).toBe("SuperSecretPass!");
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            findings: [
              {
                feature: "broken_acls",
                objectType: "group",
                objectName: "Domain Admins",
                dn: "CN=Domain Admins,DC=example,DC=com",
                status: "orphan_acl_principal",
                evidence: { orphanSid: "S-1-5-21-9-9-9-9" },
                findingType: "BROKEN_ACL",
                findingSignals: ["BROKEN_ACL"],
              },
              {
                feature: "unknown_sid_bindings",
                objectType: "user",
                objectName: "alice",
                dn: "CN=alice,DC=example,DC=com",
                status: "unknown_ace_trustee",
                evidence: { unresolvedSid: "S-1-5-21-9-9-9-8" },
                findingType: "UNKNOWN_SID_BINDING",
                findingSignals: ["UNKNOWN_SID_BINDING"],
              },
            ],
            results: [
              { feature: "broken_acls", count: 1, durationMs: 10 },
              { feature: "unknown_sid_bindings", count: 1, durationMs: 11 },
            ],
            diagnostics: { objectsScanned: 2, descriptorsRead: 2 },
            errors: [],
          }),
      };
    });

    const { acl } = await loadModules();
    const result = await acl.runAclIntelligence(baseCtx(), [
      "broken_acls",
      "unknown_sid_bindings",
      "orphan_sids",
    ]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.results.find((r) => r.feature === "orphan_sids")?.source).toBe(
      "node",
    );
    expect(result.results.find((r) => r.feature === "broken_acls")?.source).toBe(
      "adshield",
    );
    expect(
      result.results.find((r) => r.feature === "unknown_sid_bindings")?.source,
    ).toBe("adshield");
    expect(result.findings.filter((f) => f.feature === "broken_acls")).toHaveLength(
      1,
    );
    expect(
      result.findings.filter((f) => f.feature === "unknown_sid_bindings"),
    ).toHaveLength(1);
    // No duplicate Node SD findings for delegated features
    expect(
      result.results.filter((r) => r.feature === "broken_acls"),
    ).toHaveLength(1);
  });

  test("ADShield failure returns controlled error without password leakage", async () => {
    process.env.ADSHIELD_ENABLED = "true";
    process.env.ADSHIELD_BASE_URL = "http://adshield.test";
    global.fetch = jest.fn(async () => {
      throw new Error("connect ECONNREFUSED bindPassword=SuperSecretPass!");
    });

    const { acl } = await loadModules();
    const result = await acl.runAclIntelligence(baseCtx(), ["broken_acls"]);
    expect(result.findings).toHaveLength(0);
    const broken = result.results.find((r) => r.feature === "broken_acls");
    expect(broken.source).toBe("adshield");
    expect(broken.error).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("SuperSecretPass");
    expect(broken.error).not.toContain("SuperSecretPass");
  });

  test("malformed ADShield findings are rejected", async () => {
    process.env.ADSHIELD_ENABLED = "true";
    process.env.ADSHIELD_BASE_URL = "http://adshield.test";
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          findings: [
            { feature: "broken_acls", status: "only-status" },
            {
              feature: "broken_acls",
              objectType: "group",
              objectName: "ok",
              dn: "CN=ok,DC=example,DC=com",
              status: "orphan_acl_principal",
              findingType: "BROKEN_ACL",
              findingSignals: ["BROKEN_ACL"],
              evidence: {},
            },
          ],
          results: [{ feature: "broken_acls", count: 2, durationMs: 1 }],
          errors: [],
        }),
    }));

    const { acl } = await loadModules();
    const result = await acl.runAclIntelligence(baseCtx(), ["broken_acls"]);
    expect(result.findings).toHaveLength(1);
    expect(result.errors?.some((e) => /Rejected 1/.test(e))).toBe(true);
  });

  test("ADShield disabled: shadow_admins runs graph + Node ACL (no fetch)", async () => {
    process.env.ADSHIELD_ENABLED = "false";
    const detectAcl = jest.fn(async () => ({
      feature: "shadow_admins_acl",
      count: 1,
      findings: [
        {
          scanId: "scan-test-1",
          feature: "shadow_admins",
          objectType: "user",
          objectName: "alice",
          status: "acl_derived_shadow_admin",
          findingType: "SHADOW_ADMIN",
          findingSignals: ["SHADOW_ADMIN", "PRIVILEGED_USER"],
          evidence: { detection: "acl_derived_privilege_path" },
          relationships: [],
          attributes: {},
          dn: "CN=alice,DC=example,DC=com",
        },
      ],
    }));
    jest.resetModules();
    await jest.unstable_mockModule(
      "../aclIntelligence/detectAclShadowAdminRights.js",
      () => ({
        detectAclShadowAdminRights: detectAcl,
        detectGraphShadowAdmins: async () => [
          {
            scanId: "scan-test-1",
            feature: "shadow_admins",
            objectType: "user",
            objectName: "alice",
            status: "indirect_admin_capability",
            findingType: "SHADOW_ADMIN",
            findingSignals: ["SHADOW_ADMIN", "PRIVILEGED_USER"],
            evidence: { detection: "nested_privileged_path" },
            relationships: [],
            attributes: {},
            dn: "CN=alice,DC=example,DC=com",
          },
        ],
      }),
    );
    const acl = await import("../aclIntelligence/aclIntelligenceService.js");
    const result = await acl.runAclIntelligence(baseCtx(), ["shadow_admins"]);
    expect(detectAcl).toHaveBeenCalledTimes(1);
    expect(global.fetch).toBe(originalFetch);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.status).sort()).toEqual([
      "acl_derived_shadow_admin",
      "indirect_admin_capability",
    ]);
    const shadow = result.results.find((r) => r.feature === "shadow_admins");
    expect(shadow?.aclSource).toBe("node");
  });

  test("ADShield enabled: graph runs, Node ACL skipped, ADShield ACL called", async () => {
    process.env.ADSHIELD_ENABLED = "true";
    process.env.ADSHIELD_BASE_URL = "http://adshield.test";
    const detectAcl = jest.fn(async () => {
      throw new Error("Node ACL must not run");
    });
    global.fetch = jest.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.features).toEqual(["shadow_admins_acl"]);
      expect(Array.isArray(body.options?.privilegedSids)).toBe(true);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            findings: [
              {
                feature: "shadow_admins",
                objectType: "user",
                objectName: "alice",
                dn: "CN=alice,DC=example,DC=com",
                status: "acl_derived_shadow_admin",
                findingType: "SHADOW_ADMIN",
                findingSignals: ["SHADOW_ADMIN", "PRIVILEGED_USER"],
                evidence: {
                  detection: "acl_derived_privilege_path",
                  trusteeSid: "S-1-5-21-1-2-3-1001",
                },
                relationships: [
                  {
                    type: "ACL_GRANT",
                    source: "alice",
                    target: "Domain Admins",
                    rights: ["GenericAll"],
                  },
                ],
              },
            ],
            results: [{ feature: "shadow_admins_acl", count: 1, durationMs: 5 }],
            diagnostics: { shadowAdminAclHits: 1, privilegedTargetsResolved: 1 },
            errors: [],
          }),
      };
    });

    jest.resetModules();
    await jest.unstable_mockModule(
      "../aclIntelligence/detectAclShadowAdminRights.js",
      () => ({
        detectAclShadowAdminRights: detectAcl,
        detectGraphShadowAdmins: async () => [
          {
            scanId: "scan-test-1",
            feature: "shadow_admins",
            objectType: "user",
            objectName: "alice",
            status: "indirect_admin_capability",
            findingType: "SHADOW_ADMIN",
            findingSignals: ["SHADOW_ADMIN", "PRIVILEGED_USER"],
            evidence: { detection: "nested_privileged_path" },
            relationships: [],
            attributes: {},
            dn: "CN=alice,DC=example,DC=com",
          },
        ],
      }),
    );
    const acl = await import("../aclIntelligence/aclIntelligenceService.js");
    const result = await acl.runAclIntelligence(baseCtx(), ["shadow_admins"]);

    expect(detectAcl).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.findings).toHaveLength(2);
    expect(
      result.findings.filter((f) => f.status === "indirect_admin_capability"),
    ).toHaveLength(1);
    expect(
      result.findings.filter((f) => f.status === "acl_derived_shadow_admin"),
    ).toHaveLength(1);
    expect(result.findings.every((f) => f.feature === "shadow_admins")).toBe(true);
    const shadow = result.results.find((r) => r.feature === "shadow_admins");
    expect(shadow?.aclSource).toBe("adshield");
  });

  test("ADShield unavailable: graph survives, ACL error soft-fails", async () => {
    process.env.ADSHIELD_ENABLED = "true";
    process.env.ADSHIELD_BASE_URL = "http://adshield.test";
    global.fetch = jest.fn(async () => {
      throw new Error("ECONNREFUSED bindPassword=SuperSecretPass!");
    });

    jest.resetModules();
    await jest.unstable_mockModule(
      "../aclIntelligence/detectAclShadowAdminRights.js",
      () => ({
        detectAclShadowAdminRights: async () => {
          throw new Error("should not run");
        },
        detectGraphShadowAdmins: async () => [
          {
            scanId: "scan-test-1",
            feature: "shadow_admins",
            objectType: "user",
            objectName: "alice",
            status: "indirect_admin_capability",
            findingType: "SHADOW_ADMIN",
            findingSignals: ["SHADOW_ADMIN", "PRIVILEGED_USER"],
            evidence: { detection: "nested_privileged_path" },
            relationships: [],
            attributes: {},
            dn: "",
          },
        ],
      }),
    );
    const acl = await import("../aclIntelligence/aclIntelligenceService.js");
    const result = await acl.runAclIntelligence(baseCtx(), ["shadow_admins"]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].status).toBe("indirect_admin_capability");
    expect(result.errors?.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("SuperSecretPass");
  });

  test("mapAdShieldFinding maps shadow_admins finding contract", async () => {
    const { adapter } = await loadModules();
    const mapped = adapter.mapAdShieldFinding(
      {
        feature: "shadow_admins",
        objectType: "user",
        objectName: "bob",
        dn: "CN=bob,DC=example,DC=com",
        status: "acl_derived_shadow_admin",
        findingType: "SHADOW_ADMIN",
        findingSignals: ["SHADOW_ADMIN"],
        evidence: { detection: "acl_derived_privilege_path" },
        relationships: [],
      },
      "scan-1",
    );
    expect(mapped).toMatchObject({
      feature: "shadow_admins",
      status: "acl_derived_shadow_admin",
      findingType: "SHADOW_ADMIN",
    });
    expect(mapped.findingSignals).toEqual(
      expect.arrayContaining(["SHADOW_ADMIN", "PRIVILEGED_USER"]),
    );
  });
});
