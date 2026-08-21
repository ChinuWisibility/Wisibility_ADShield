import { describe, expect, test } from "@jest/globals";
import {
  isAdObjectInSearchScope,
  resolveGraphFeatureSearchBase,
  resolveUserAdDn,
  SEARCH_BASE_SCOPED_GRAPH_FEATURES,
} from "./graphSearchBaseScope.js";
import { resolveFeatureSearchBase } from "./postureFeatureLdap.js";
import { isDnUnderSearchBase } from "./groupAnalysisCatalog.js";

describe("graphSearchBaseScope", () => {
  test("privileged features are registered for search-base scoping", () => {
    expect(SEARCH_BASE_SCOPED_GRAPH_FEATURES.has("privilege_escalation_paths")).toBe(true);
    expect(SEARCH_BASE_SCOPED_GRAPH_FEATURES.has("shadow_admins")).toBe(true);
    expect(SEARCH_BASE_SCOPED_GRAPH_FEATURES.has("nested_privileged_access")).toBe(false);
  });

  test("no override uses application base DN via resolveFeatureSearchBase", () => {
    const cfg = { baseDn: "DC=wisibility,DC=lcl" };
    expect(resolveFeatureSearchBase("privilege_escalation_paths", {}, cfg)).toBe(
      "DC=wisibility,DC=lcl",
    );
    expect(
      resolveGraphFeatureSearchBase("privilege_escalation_paths", {
        queryOverrides: {},
        ldapCfg: cfg,
      }).searchBaseDn,
    ).toBe("DC=wisibility,DC=lcl");
  });

  test("override search base wins", () => {
    const cfg = { baseDn: "DC=wisibility,DC=lcl" };
    const override = "OU=Security,OU=Groups,OU=wisibility,DC=wisibility,DC=lcl";
    const resolved = resolveGraphFeatureSearchBase("privilege_escalation_paths", {
      queryOverrides: {
        privilege_escalation_paths: { searchBase: override },
      },
      ldapCfg: cfg,
    });
    expect(resolved.searchBaseDn).toBe(override);
    expect(resolved.overrideUsed).toBe(true);
  });

  test("isAdObjectInSearchScope mirrors isDnUnderSearchBase", () => {
    const base = "OU=Security,DC=corp,DC=local";
    const inScope = "CN=Target,OU=Security,DC=corp,DC=local";
    const outScope = "CN=Other,OU=Users,DC=corp,DC=local";
    const resolved = { searchBaseDn: base, overrideUsed: true };
    expect(isDnUnderSearchBase(inScope, base)).toBe(true);
    expect(isAdObjectInSearchScope(inScope, resolved)).toBe(true);
    expect(isAdObjectInSearchScope(outScope, resolved)).toBe(false);
  });

  test("missing DN with no override remains in scope", () => {
    expect(
      isAdObjectInSearchScope("", {
        searchBaseDn: "DC=corp,DC=local",
        overrideUsed: false,
      }),
    ).toBe(true);
  });

  test("missing DN with explicit override is out of scope", () => {
    expect(
      isAdObjectInSearchScope("", {
        searchBaseDn: "OU=Security,DC=corp,DC=local",
        overrideUsed: true,
      }),
    ).toBe(false);
  });

  test("resolveUserAdDn reads distinguishedName", () => {
    expect(
      resolveUserAdDn({
        rawData: { distinguishedName: "CN=Alice,DC=corp,DC=local" },
      }),
    ).toBe("CN=Alice,DC=corp,DC=local");
  });
});
