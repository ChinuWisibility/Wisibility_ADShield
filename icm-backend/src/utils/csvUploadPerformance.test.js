import { describe, expect, test, jest } from "@jest/globals";
import { bulkWriteChunkedParallel } from "./csvUploadPerformance.js";

describe("bulkWriteChunkedParallel (unit)", () => {
  test("empty ops is a no-op", async () => {
    const bulkWrite = jest.fn();
    const res = await bulkWriteChunkedParallel({ bulkWrite }, []);
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(res.chunkCount).toBe(0);
  });

  test("rejects when a chunk fails (no retry)", async () => {
    const bulkWrite = jest
      .fn()
      .mockResolvedValueOnce({ upsertedCount: 1, modifiedCount: 0 })
      .mockRejectedValueOnce(new Error("boom"));
    await expect(
      bulkWriteChunkedParallel(
        { bulkWrite },
        [
          { updateOne: { filter: { a: 1 }, update: { $set: { a: 1 } }, upsert: true } },
          { updateOne: { filter: { a: 2 }, update: { $set: { a: 2 } }, upsert: true } },
        ],
        { chunkSize: 1, concurrency: 1 },
      ),
    ).rejects.toThrow("boom");
    expect(bulkWrite).toHaveBeenCalledTimes(2);
  });
});
