import { describe, expect, it } from "vitest";
import {
  createTokenizer,
  exampleNumber,
  pluralCategories,
  protectTerms,
  restoreTokens,
  swapExampleNumber,
} from "../src/index";

describe("tokens", () => {
  const originals = ["{name}", "<b>"];

  it("restores tokens", () => {
    expect(restoreTokens("Hi LNG0 LNG1", originals)).toEqual({ text: "Hi {name} <b>", ok: true });
  });

  it("is case-insensitive and tolerates an inserted space", () => {
    expect(restoreTokens("Hi lng0 Lng 1", originals)).toEqual({ text: "Hi {name} <b>", ok: true });
  });

  it("flags duplicates, missing and out-of-range tokens", () => {
    expect(restoreTokens("LNG0 LNG0 LNG1", originals).ok).toBe(false);
    expect(restoreTokens("LNG0", originals).ok).toBe(false);
    expect(restoreTokens("LNG0 LNG1 LNG7", originals)).toEqual({
      text: "{name} <b> LNG7",
      ok: false,
    });
  });

  it("protects terms longest first", () => {
    const tokenizer = createTokenizer();
    expect(protectTerms("Lingua API by Lingua", ["Lingua", "Lingua API"], tokenizer)).toBe(
      "LNG0 by LNG1",
    );
    expect(tokenizer.originals).toEqual(["Lingua API", "Lingua"]);
    expect(createTokenizer().token("x")).toBe("LNG0");
  });
});

describe("plurals", () => {
  it("lists categories in canonical order", () => {
    expect(pluralCategories("ru")).toEqual(["one", "few", "many", "other"]);
    expect(pluralCategories("ja")).toEqual(["other"]);
    expect(pluralCategories("en", "ordinal")).toEqual(["one", "two", "few", "other"]);
  });

  it("picks example numbers", () => {
    expect(exampleNumber("ru", "few")).toBe(2);
    expect(exampleNumber("ru", "many")).toBe(5);
    expect(exampleNumber("ru", "other")).toBe(1.5);
    expect(exampleNumber("en", "one")).toBe(1);
    expect(exampleNumber("ar", "zero")).toBe(0);
    expect(exampleNumber("en", "other", "ordinal")).toBe(4);
    expect(() => exampleNumber("ja", "one")).toThrow(/one/);
  });

  it("swaps exactly one standalone occurrence", () => {
    expect(swapExampleNumber("5 items", 5, "#")).toEqual({ text: "# items", ok: true });
    expect(swapExampleNumber("I have 5.", 5, "#")).toEqual({ text: "I have #.", ok: true });
    expect(swapExampleNumber("1.5 items", 1.5, "#")).toEqual({ text: "# items", ok: true });
    expect(swapExampleNumber("15 items", 5, "#").ok).toBe(false);
    expect(swapExampleNumber("1.5 items", 5, "#").ok).toBe(false);
    expect(swapExampleNumber("1,5 items", 1, "#").ok).toBe(false);
    expect(swapExampleNumber("5 of 5", 5, "#")).toEqual({ text: "5 of 5", ok: false });
    expect(swapExampleNumber("five items", 5, "#").ok).toBe(false);
    expect(swapExampleNumber("LNG5 has 5", 5, "#")).toEqual({ text: "LNG5 has #", ok: true });
  });
});
