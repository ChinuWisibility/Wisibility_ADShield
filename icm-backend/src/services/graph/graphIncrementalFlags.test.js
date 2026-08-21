/**
 * Feature-flag checks for Iteration #1.
 * Note: if icm-backend/.data/DISABLE_INCREMENTAL_GRAPH_UPDATES exists, enabled() is always false.
 */
import fs from "fs";
import {
  isIncrementalGraphUpdatesEnabled,
  incrementalGraphKillSwitchPath,
} from "./graphIncrementalFlags.js";

describe("isIncrementalGraphUpdatesEnabled", () => {
  const prev = process.env.ENABLE_INCREMENTAL_GRAPH_UPDATES;
  const killPath = incrementalGraphKillSwitchPath();
  const hadKill = fs.existsSync(killPath);

  afterEach(() => {
    if (prev === undefined) delete process.env.ENABLE_INCREMENTAL_GRAPH_UPDATES;
    else process.env.ENABLE_INCREMENTAL_GRAPH_UPDATES = prev;
  });

  test("defaults to true when env unset (unless kill-switch file present)", () => {
    delete process.env.ENABLE_INCREMENTAL_GRAPH_UPDATES;
    if (hadKill) {
      expect(isIncrementalGraphUpdatesEnabled()).toBe(false);
    } else {
      expect(isIncrementalGraphUpdatesEnabled()).toBe(true);
    }
  });

  test("env false disables when kill-switch absent", () => {
    process.env.ENABLE_INCREMENTAL_GRAPH_UPDATES = "false";
    expect(isIncrementalGraphUpdatesEnabled()).toBe(false);
  });

  test("env true enables when kill-switch absent", () => {
    process.env.ENABLE_INCREMENTAL_GRAPH_UPDATES = "true";
    if (hadKill) {
      expect(isIncrementalGraphUpdatesEnabled()).toBe(false);
    } else {
      expect(isIncrementalGraphUpdatesEnabled()).toBe(true);
    }
  });
});
