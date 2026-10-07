import { describe, expect, it } from "vitest";
import { LinguaApiError, MAX_BATCH_ITEMS, packBatches } from "../src/index";

const id = (s: string) => s;

describe("packBatches", () => {
  it("splits by item count and preserves order", () => {
    const items = Array.from({ length: 250 }, (_, i) => `t${i}`);
    const batches = packBatches(items, id);
    expect(batches.map((b) => b.length)).toEqual([MAX_BATCH_ITEMS, MAX_BATCH_ITEMS, 50]);
    expect(batches.flat()).toEqual(items);
  });

  it("splits by total characters", () => {
    const items = Array.from({ length: 5 }, (_, i) => `${i}`.repeat(4500));
    const batches = packBatches(items, id);
    expect(batches.map((b) => b.length)).toEqual([4, 1]);
    expect(batches.flat()).toEqual(items);
  });

  it("uses textOf for non-string items", () => {
    const items = [5_000, 5_000, 5_000, 4_000, 2_000].map((n) => ({ s: "a".repeat(n) }));
    expect(packBatches(items, (i) => i.s)).toEqual([items.slice(0, 4), items.slice(4)]);
  });

  it("returns no batches for no items", () => {
    expect(packBatches([], id)).toEqual([]);
  });

  it("throws invalid_request on an oversize item", () => {
    const error = (() => {
      try {
        packBatches(["ok", "x".repeat(5001)], id);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(LinguaApiError);
    expect(error).toMatchObject({ status: 400, code: "invalid_request" });
  });
});
