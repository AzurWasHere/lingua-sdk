import { describe, expect, it } from "vitest";
import {
  type Catalog,
  detectShape,
  flattenCatalog,
  icuDriver,
  type LockEntry,
  planLocale,
  toPointer,
} from "../src/index";

const catalog = (raw: Record<string, unknown>): Catalog => {
  const shape = detectShape(raw);
  return {
    file: "x.json",
    exists: true,
    shape,
    indent: "  ",
    newline: "\n",
    raw,
    entries: flattenCatalog(raw, shape),
  };
};

const plan = (
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  entries: Record<string, LockEntry> = {},
  force = false,
) =>
  planLocale({
    locale: "es",
    sourceCatalogs: new Map([["", catalog(source)]]),
    targetCatalogs: new Map([["", catalog(target)]]),
    lock: { version: 1, entries },
    driver: icuDriver,
    force,
  });

const locked = (source: string, text: string, manual = false): LockEntry => ({
  targets: { es: { source, text, manual } },
});

const actions = (result: ReturnType<typeof plan>) =>
  Object.fromEntries(result.keys.map((key) => [toPointer(key.path), key.action]));

describe("planLocale", () => {
  it("treats a target value without a lock entry as a pre-existing manual translation", () => {
    const result = plan({ a: "Hi" }, { a: "Hola" });
    expect(result.keys).toEqual([
      {
        namespace: "",
        path: ["a"],
        sourcePath: ["a"],
        source: "Hi",
        action: "manual",
        existing: "Hola",
      },
    ]);
  });

  it("treats a target value that differs from the lock as hand-edited", () => {
    expect(actions(plan({ a: "Hi" }, { a: "Hola" }, { "|/a": locked("Hi", "[es] Hi") }))).toEqual({
      "/a": "manual",
    });
  });

  it("keeps manual lock entries and flags them stale when the source changed", () => {
    const entries = { "|/a": locked("Hi", "Hola", true), "|/b": locked("Bye", "Adiós", true) };
    const result = plan({ a: "Hello", b: "Bye" }, { a: "Hola" }, entries);
    expect(actions(result)).toEqual({ "/a": "stale-manual", "/b": "manual" });
    expect(result.keys.map((key) => key.existing)).toEqual(["Hola", "Adiós"]);
  });

  it("translates missing keys and keys whose source changed", () => {
    const result = plan(
      { a: "Hello", b: "New" },
      { a: "[es] Hi" },
      { "|/a": locked("Hi", "[es] Hi") },
    );
    expect(actions(result)).toEqual({ "/a": "translate", "/b": "translate" });
    expect(result.keys[0]?.existing).toBe("[es] Hi");
  });

  it("reuses unchanged machine translations", () => {
    expect(
      actions(plan({ a: "Hi" }, { a: "[es] Hi" }, { "|/a": locked("Hi", "[es] Hi") })),
    ).toEqual({ "/a": "reuse" });
  });

  it("force retranslates machine translations but never manual ones", () => {
    const entries = { "|/a": locked("Hi", "[es] Hi"), "|/b": locked("Bye", "Adiós", true) };
    const result = plan(
      { a: "Hi", b: "Bye", c: "Edit" },
      { a: "[es] Hi", b: "Adiós", c: "Mine" },
      entries,
      true,
    );
    expect(actions(result)).toEqual({ "/a": "translate", "/b": "manual", "/c": "manual" });
  });

  it("prunes unexpected target strings and tells manual from machine ones", () => {
    const result = plan(
      { a: "Hi", n: 1 },
      { a: "Hola", old: "[es] Old", hand: "Mano", edited: "Mine", n: 2, flag: true },
      { "|/old": locked("Old", "[es] Old"), "|/edited": locked("E", "[es] E") },
    );
    expect(result.pruned).toEqual([
      { namespace: "", path: ["old"], text: "[es] Old", manual: false },
      { namespace: "", path: ["hand"], text: "Mano", manual: true },
      { namespace: "", path: ["edited"], text: "Mine", manual: true },
    ]);
    expect(result.keys.map((key) => key.path)).toEqual([["a"]]);
  });
});
