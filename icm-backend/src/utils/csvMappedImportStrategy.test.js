import { describe, expect, test } from "@jest/globals";
import { compileCsvMapper } from "../services/csvImport/compiledCsvMapper.js";
import { runExecutionGraph, CSV_BULK_DEFAULTS } from "../services/csvImport/bulkWritePool.js";
import { parseCsvBufferStreaming } from "./csvUploadPerformance.js";
import { isHashReconciliationEnabled } from "../services/sync/accountHashService.js";
import { CsvMappedReconciliationStrategy } from "../services/reconciliation/strategies/CsvMappedReconciliationStrategy.js";
import { LegacyReconciliationStrategy } from "../services/reconciliation/strategies/LegacyReconciliationStrategy.js";

describe("csv mapped import engine helpers", () => {
  test("compileCsvMapper maps 5k rows quickly with one-pass display name", () => {
    const mappings = [
      { csvColumn: "employee_id", standardField: "employee_id", isPrimaryKey: true },
      { csvColumn: "display_name", standardField: "display_name" },
      { csvColumn: "status", standardField: "status" },
    ];
    const fields = ["employee_id", "display_name", "status"];
    const mapper = compileCsvMapper(mappings, fields, { displayNameMode: "direct" });
    const t0 = Date.now();
    let docs = 0;
    for (let i = 0; i < 5000; i++) {
      const { doc, skippedMissingPk } = mapper.mapRow({
        employee_id: `e${i}`,
        display_name: `User ${i}`,
        status: "ACTIVE",
      });
      expect(skippedMissingPk).toBe(false);
      expect(doc.employee_id).toBe(`e${i}`);
      docs += 1;
    }
    const ms = Date.now() - t0;
    expect(docs).toBe(5000);
    expect(ms).toBeLessThan(500);
  });

  test("compileCsvMapper strips entitlements list attr into rawData", () => {
    const mappings = [
      { csvColumn: "employee_id", standardField: "employee_id", isPrimaryKey: true },
      { csvColumn: "groups", standardField: "member_of_entitlements" },
    ];
    const mapper = compileCsvMapper(mappings, ["employee_id", "groups"], {
      entitlementsStandardField: "member_of_entitlements",
    });
    const { doc } = mapper.mapRow({ employee_id: "1", groups: "a;b" });
    expect(doc.member_of_entitlements).toBeUndefined();
    expect(doc.rawData.member_of_entitlements || doc.rawData.groups).toBeTruthy();
  });

  test("runExecutionGraph respects deps and runs independents", async () => {
    const order = [];
    const nodes = new Map([
      ["a", { deps: [], run: async () => { order.push("a"); return 1; } }],
      ["b", { deps: [], run: async () => { order.push("b"); return 2; } }],
      ["c", { deps: ["a", "b"], run: async () => { order.push("c"); return 3; } }],
    ]);
    const results = await runExecutionGraph(nodes);
    expect(results.get("c")).toBe(3);
    expect(order.indexOf("c")).toBeGreaterThan(order.indexOf("a"));
    expect(order.indexOf("c")).toBeGreaterThan(order.indexOf("b"));
  });

  test("CSV bulk defaults are configured", () => {
    expect(CSV_BULK_DEFAULTS.chunkSize).toBeGreaterThanOrEqual(500);
    expect(CSV_BULK_DEFAULTS.concurrency).toBeGreaterThanOrEqual(1);
  });

  test("hash reconciliation remains enabled for csv_mapped", () => {
    expect(isHashReconciliationEnabled({ source: "csv_mapped" })).toBe(true);
  });

  test("strategies expose lifecycle methods", () => {
    const csv = new CsvMappedReconciliationStrategy();
    const legacy = new LegacyReconciliationStrategy();
    for (const s of [csv, legacy]) {
      expect(typeof s.prepare).toBe("function");
      expect(typeof s.buildExecutionGraph).toBe("function");
      expect(typeof s.execute).toBe("function");
      expect(typeof s.verify).toBe("function");
      expect(typeof s.finalize).toBe("function");
    }
  });

  test("parseCsvBufferStreaming still works", async () => {
    const csv = "employee_id,display_name\n1,A\n2,B\n";
    const { rows, fields } = await parseCsvBufferStreaming(Buffer.from(csv, "utf8"));
    expect(fields[0]).toBe("employee_id");
    expect(rows).toHaveLength(2);
  });
});
