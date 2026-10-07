import { parse } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { escapeIcu, icuDriver, type PreparedMessage } from "../src/index";

const ast = (message: string) =>
  JSON.parse(
    JSON.stringify(parse(message), (key, value) => (key === "location" ? undefined : value)),
  );
const ctx = (targetLocale = "de", doNotTranslate: string[] = []) => ({
  sourceLocale: "en",
  targetLocale,
  doNotTranslate,
});
const prepare = (text: string, targetLocale?: string, terms?: string[]) =>
  icuDriver.prepare(text, ctx(targetLocale, terms));
const identity = (prepared: PreparedMessage) => prepared.restore(prepared.segments);
const upper = (segment: string) => segment.replace(/[a-z]+/g, (word) => word.toUpperCase());

describe("icu driver: simple messages", () => {
  it("plans targets as identity", () => {
    expect(icuDriver.planTargets([{ path: ["a", 0], value: "Hi" }], "fr")).toEqual([
      { path: ["a", 0], sourcePath: ["a", 0], source: "Hi" },
    ]);
  });

  it.each([
    "Hello {name}",
    "{n, number, ::currency/USD} due {d, date, short}",
    "<b>Bold</b> and <a>link</a>",
    "It''s {x}",
    "Price: '{'not an arg'}'",
    "Braces '{}' and '{'' '}' quote",
  ])("round trips %s", (message) => {
    const prepared = prepare(message);
    expect(prepared.segments).toHaveLength(1);
    const result = identity(prepared);
    expect(result.needsReview).toBe(false);
    expect(ast(result.text)).toEqual(ast(message));
  });

  it("tokenizes arguments and tags", () => {
    expect(prepare("<b>Hi</b> {name}").segments).toEqual(["LNG0HiLNG1 LNG2"]);
  });

  it("restores tokens after an uppercasing translation", () => {
    const prepared = prepare("Hello <b>{name}</b>, it's {n, number}");
    const result = prepared.restore(prepared.segments.map(upper));
    expect(result).toEqual({ text: "HELLO <b>{name}</b>, IT''S {n, number}", needsReview: false });
  });

  it("falls back to per-literal translation when a token is lost", () => {
    const prepared = prepare("Hello {name}, welcome to <b>our site</b>");
    const result = prepared.restore([prepared.segments[0]?.replace("LNG0", "") ?? ""]);
    expect(result.needsReview).toBe(true);
    expect(result.fallback?.segments).toEqual(["Hello", ", welcome to", "our site"]);
    const fallback = result.fallback?.restore(["Hallo", ", willkommen auf", "unserer Seite"]);
    expect(fallback).toEqual({
      text: "Hallo {name}, willkommen auf <b>unserer Seite</b>",
      needsReview: true,
    });
    expect(fallback?.fallback).toBeUndefined();
  });

  it("protects doNotTranslate terms", () => {
    const prepared = prepare("Welcome to lingua by Lingua, {name}", "de", ["Lingua"]);
    expect(prepared.restore(prepared.segments.map(upper)).text).toBe(
      "WELCOME TO LINGUA BY Lingua, {name}",
    );
  });

  it("escapes ICU syntax in translations", () => {
    expect(escapeIcu("it's {x} <b>")).toBe("it''s '{'x'}' '<'b>");
    expect(escapeIcu("{}'{")).toBe("'{}''{'");
    expect(escapeIcu("#1", true)).toBe("'#'1");
    expect(escapeIcu("#1")).toBe("#1");
    expect(ast(`a ${escapeIcu("}'{ it's '")} b`)).toEqual(ast("a '}''{' it''s '' b"));
    expect(parse(escapeIcu("}'{ it's '"))).toEqual([{ type: 0, value: "}'{ it's '" }]);
  });

  it("passes unparseable messages through as plain text", () => {
    const prepared = prepare("Broken {name", "de", ["Lingua"]);
    expect(prepared.segments).toEqual(["Broken {name"]);
    expect(identity(prepared)).toEqual({ text: "Broken {name", needsReview: false });
  });
});

describe("icu driver: plural lifting", () => {
  const items = "{count, plural, one {# item} other {# items}}";

  it("expands to the target locale's categories with example numbers", () => {
    const prepared = prepare(items, "ru");
    expect(prepared.segments).toEqual(["1 item", "2 items", "5 items", "1.5 items"]);
    const result = identity(prepared);
    expect(result.needsReview).toBe(false);
    expect(ast(result.text)).toEqual(
      ast("{count, plural, one {# item} few {# items} many {# items} other {# items}}"),
    );
  });

  it("collapses to other for locales without plural forms", () => {
    const prepared = prepare(items, "ja");
    expect(prepared.segments).toEqual(["1 items"]);
    expect(ast(identity(prepared).text)).toEqual(ast("{count, plural, other {# items}}"));
  });

  it("lifts an embedded plural into full sentences", () => {
    const prepared = prepare(
      "You have {count, plural, one {# message} other {# messages}} waiting",
      "en",
    );
    expect(prepared.segments).toEqual([
      "You have 1 message waiting",
      "You have 2 messages waiting",
    ]);
    expect(ast(identity(prepared).text)).toEqual(
      ast("{count, plural, one {You have # message waiting} other {You have # messages waiting}}"),
    );
  });

  it("treats {count} like #", () => {
    const prepared = prepare("{count, plural, one {{count} file} other {{count} files}}", "en");
    expect(prepared.segments).toEqual(["1 file", "2 files"]);
    expect(ast(identity(prepared).text)).toEqual(
      ast("{count, plural, one {# file} other {# files}}"),
    );
  });

  it("keeps offsets and exact matches", () => {
    const message =
      "{n, plural, offset:1 =0 {Nobody} =1 {Only {name}} one {{name} and # other} other {{name} and # others}}";
    const prepared = prepare(message, "en");
    expect(prepared.segments).toEqual([
      "Nobody",
      "Only LNG0",
      "LNG0 and 1 other",
      "LNG0 and 2 others",
    ]);
    const result = identity(prepared);
    expect(result.needsReview).toBe(false);
    expect(ast(result.text)).toEqual(ast(message));
  });

  it("lifts selectordinal with ordinal example numbers", () => {
    const prepared = prepare(
      "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} place",
      "en",
    );
    expect(prepared.segments).toEqual(["1st place", "2nd place", "3rd place", "4th place"]);
    expect(ast(identity(prepared).text)).toEqual(
      ast("{n, selectordinal, one {#st place} two {#nd place} few {#rd place} other {#th place}}"),
    );
  });

  it("lifts select with the source keys", () => {
    const prepared = prepare("{g, select, male {He} female {She} other {They}} liked it", "ja");
    expect(prepared.segments).toEqual(["He liked it", "She liked it", "They liked it"]);
    expect(ast(identity(prepared).text)).toEqual(
      ast("{g, select, male {He liked it} female {She liked it} other {They liked it}}"),
    );
  });

  it("combines select and plural (select outside)", () => {
    const prepared = prepare(
      "{n, plural, one {# photo} other {# photos}} by {g, select, male {him} other {them}}",
      "en",
    );
    expect(prepared.segments).toEqual([
      "1 photo by him",
      "2 photos by him",
      "1 photo by them",
      "2 photos by them",
    ]);
    expect(ast(identity(prepared).text)).toEqual(
      ast(
        "{g, select, male {{n, plural, one {# photo by him} other {# photos by him}}} other {{n, plural, one {# photo by them} other {# photos by them}}}}",
      ),
    );
  });

  it("escapes a literal # that moves into a plural branch", () => {
    const prepared = prepare("Ticket #7: {n, plural, one {# seat} other {# seats}}", "en");
    expect(prepared.segments).toEqual(["Ticket #7: 1 seat", "Ticket #7: 2 seats"]);
    const result = identity(prepared);
    expect(result.needsReview).toBe(false);
    expect(ast(result.text)).toEqual(
      ast("{n, plural, one {Ticket '#'7: # seat} other {Ticket '#'7: # seats}}"),
    );
  });

  it("renders the outer plural as {x, number} when two plurals nest", () => {
    const message =
      "{a, plural, one {# file} other {# files}} in {b, plural, one {# folder} other {# folders}}";
    const prepared = prepare(message, "en");
    expect(prepared.segments).toEqual([
      "1 file in 1 folder",
      "1 file in 2 folders",
      "2 files in 1 folder",
      "2 files in 2 folders",
    ]);
    const result = identity(prepared);
    // Variants where both plurals share an example number can't be swapped back.
    expect(result.needsReview).toBe(true);
    expect(result.text).toContain("other {{a, number} file in # folders}");
    expect(result.text).toContain("one {{a, number} files in # folder}");
    expect(() => parse(result.text)).not.toThrow();
  });

  it("uses per-literal mode for more than two plural/select elements", () => {
    const message =
      "{a, plural, one {# x} other {# xs}} {b, plural, one {# y} other {# ys}} {c, plural, one {# z} other {# zs}}";
    const prepared = prepare(message, "en");
    expect(prepared.segments).toEqual(["x", "xs", "y", "ys", "z", "zs"]);
    const result = identity(prepared);
    expect(result.needsReview).toBe(true);
    expect(ast(result.text)).toEqual(ast(message));
  });

  it("flags a translation that spells out the example number", () => {
    const prepared = prepare(items, "ru");
    const result = prepared.restore(["один предмет", "2 предмета", "5 предметов", "1,5 предмета"]);
    expect(result.needsReview).toBe(true);
    expect(result.fallback).toBeUndefined();
  });

  it("falls back when a lifted variant loses a tag token", () => {
    const prepared = prepare("{n, plural, one {<b>#</b> item} other {<b>#</b> items}}", "en");
    expect(prepared.segments).toEqual(["LNG01LNG1 item", "LNG02LNG1 items"]);
    const result = prepared.restore(["LNG0 1 item", "LNG0 2 LNG1 items"]);
    expect(result.needsReview).toBe(true);
    const fallback = result.fallback as PreparedMessage;
    expect(fallback.segments).toEqual(["item", "items"]);
    expect(() => parse(fallback.restore(["Stück", "Stücke"]).text)).not.toThrow();
  });
});
