import { describe, expect, it } from "vitest";
import { fromPointer, pathEquals, toPointer } from "../src/index";

describe("JSON pointer", () => {
  it("round trips and escapes ~ and /", () => {
    const path = ["a", "b/c", "d~e", "~1"];
    expect(toPointer(path)).toBe("/a/b~1c/d~0e/~01");
    expect(fromPointer(toPointer(path))).toEqual(path);
  });

  it("encodes numeric segments as strings", () => {
    expect(toPointer(["list", 0])).toBe("/list/0");
    expect(fromPointer("/list/0")).toEqual(["list", "0"]);
  });

  it("handles the empty path and empty keys", () => {
    expect(toPointer([])).toBe("");
    expect(fromPointer("")).toEqual([]);
    expect(fromPointer(toPointer([""]))).toEqual([""]);
  });

  it("compares paths", () => {
    expect(pathEquals(["a", 0], ["a", 0])).toBe(true);
    expect(pathEquals(["a", 0], ["a", "0"])).toBe(false);
    expect(pathEquals(["a"], ["a", "b"])).toBe(false);
  });
});
