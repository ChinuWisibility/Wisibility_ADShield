import { describe, expect, test } from "@jest/globals";
import {
  resolveApplicationStatusFieldSpec,
  buildAccountStatusFilterClause,
  classifyAccountStatusRaw,
} from "../../services/application/applicationUserStatusCountsService.js";

describe("application user status field resolution", () => {
  test("CSV status→status mapping uses string kind, not UAC", () => {
    const app = {
      type: "custom",
      csvImportMapping: {
        mappings: [
          { csvColumn: "status", standardField: "status", isPrimaryKey: false },
        ],
      },
    };
    const spec = resolveApplicationStatusFieldSpec(app);
    expect(spec.kind).toBe("string");
    expect(spec.mapping?.standardField).toBe("status");
  });

  test("AD primary apps resolve to UAC kind", () => {
    const app = {
      connectorType: "ACTIVE_DIRECTORY",
      connectionConfig: { ad: { host: "ldap.example" } },
      userMappings: [
        { csvColumn: "userAccountControl", standardField: "status" },
      ],
    };
    const spec = resolveApplicationStatusFieldSpec(app);
    expect(spec.kind).toBe("uac");
  });

  test("CSV status filter uses canonical status regex, not UAC $expr", () => {
    const app = {
      type: "custom",
      csvImportMapping: {
        mappings: [{ csvColumn: "status", standardField: "status" }],
      },
    };
    const active = buildAccountStatusFilterClause(app, "active");
    expect(active.$expr).toBeUndefined();
    expect(active.status).toEqual({ $regex: /^active$/i });

    const inactive = buildAccountStatusFilterClause(app, "inactive");
    expect(inactive.$expr).toBeUndefined();
    expect(inactive.status.$regex.test("INACTIVE")).toBe(true);
  });

  test("classifyAccountStatusRaw understands ACTIVE/INACTIVE strings", () => {
    expect(classifyAccountStatusRaw("ACTIVE")).toBe("active");
    expect(classifyAccountStatusRaw("INACTIVE")).toBe("inactive");
  });
});
