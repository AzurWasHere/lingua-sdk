import { describe, expect, it } from "vitest";
import {
  i18nextDriver,
  type PrepareContext,
  type PreparedMessage,
  type SourceEntry,
} from "../src/index";

const ctx = (targetLocale = "de", extra: Partial<PrepareContext> = {}): PrepareContext => ({
  sourceLocale: "en",
  targetLocale,
  doNotTranslate: [],
  ...extra,
});
const prepare = (text: string, context = ctx()) => i18nextDriver.prepare(text, context);
const identity = (prepared: PreparedMessage) => prepared.restore(prepared.segments);
const upper = (segment: string) => segment.replace(/[a-z]+/g, (word) => word.toUpperCase());
const paths = (entries: SourceEntry[], locale: string) =>
  i18nextDriver.planTargets(entries, locale).map(({ path }) => path);

const items: SourceEntry[] = [
  { path: ["item_one"], value: "{{count}} item" },
  { path: ["item_other"], value: "{{count}} items" },
];

describe("i18next driver: planTargets", () => {
  it("expands a cardinal group to the target locale's categories", () => {
    const one = { sourcePath: ["item_one"], source: "{{count}} item", ordinal: false };
    const other = { sourcePath: ["item_other"], source: "{{count}} items", ordinal: false };
    expect(i18nextDriver.planTargets(items, "ru")).toEqual([
      { path: ["item_one"], pluralCategory: "one", ...one },
      { path: ["item_few"], pluralCategory: "few", ...other },
      { path: ["item_many"], pluralCategory: "many", ...other },
      { path: ["item_other"], pluralCategory: "other", ...other },
    ]);
    expect(paths(items, "ja")).toEqual([["item_other"]]);
    expect(paths(items, "ar")).toEqual([
      ["item_zero"],
      ["item_one"],
      ["item_two"],
      ["item_few"],
      ["item_many"],
      ["item_other"],
    ]);
  });

  it("expands ordinal groups with ordinal categories", () => {
    const targets = i18nextDriver.planTargets(
      [
        { path: ["place_ordinal_one"], value: "{{count}}st place" },
        { path: ["place_ordinal_other"], value: "{{count}}th place" },
      ],
      "en",
    );
    expect(targets.map(({ path }) => path)).toEqual([
      ["place_ordinal_one"],
      ["place_ordinal_two"],
      ["place_ordinal_few"],
      ["place_ordinal_other"],
    ]);
    expect(targets[1]).toMatchObject({
      sourcePath: ["place_ordinal_other"],
      pluralCategory: "two",
      ordinal: true,
    });
  });

  it("keeps source order with groups at their first entry", () => {
    const entries: SourceEntry[] = [
      { path: ["title"], value: "Cart" },
      items[0] as SourceEntry,
      { path: ["footer"], value: "Bye" },
      items[1] as SourceEntry,
    ];
    expect(paths(entries, "en")).toEqual([["title"], ["item_one"], ["item_other"], ["footer"]]);
  });

  it("preserves the parent path", () => {
    const targets = i18nextDriver.planTargets(
      [
        { path: ["cart", "item_one"], value: "{{count}} item" },
        { path: ["cart", "item_other"], value: "{{count}} items" },
      ],
      "ru",
    );
    expect(targets[1]).toMatchObject({
      path: ["cart", "item_few"],
      sourcePath: ["cart", "item_other"],
    });
  });

  it("leaves context keys and array items untouched", () => {
    const entries: SourceEntry[] = [
      { path: ["friend_male"], value: "A boyfriend" },
      { path: ["list", 0], value: "First" },
    ];
    expect(i18nextDriver.planTargets(entries, "ru")).toEqual([
      { path: ["friend_male"], sourcePath: ["friend_male"], source: "A boyfriend" },
      { path: ["list", 0], sourcePath: ["list", 0], source: "First" },
    ]);
  });
});

describe("i18next driver: prepare", () => {
  it("tokenizes interpolations", () => {
    const message = "Hello {{name}}, you have {{- html}} and {{val, currency}}";
    const prepared = prepare(message);
    expect(prepared.segments).toEqual(["Hello LNG0, you have LNG1 and LNG2"]);
    expect(identity(prepared)).toEqual({ text: message, needsReview: false });
    expect(prepared.restore(prepared.segments.map(upper))).toEqual({
      text: "HELLO {{name}}, YOU HAVE {{- html}} AND {{val, currency}}",
      needsReview: false,
    });
  });

  it("tokenizes nesting and tags", () => {
    expect(prepare('$t(other.key, {"x": 1}) rest').segments).toEqual(["LNG0 rest"]);
    const prepared = prepare("<0>Click</0> <strong>here</strong><br/>");
    expect(prepared.segments).toEqual(["LNG0ClickLNG1 LNG2hereLNG3LNG4"]);
    expect(prepared.restore(prepared.segments.map(upper)).text).toBe(
      "<0>CLICK</0> <strong>HERE</strong><br/>",
    );
  });

  it("replaces {{count}} with the category's example number", () => {
    const prepared = prepare("{{count}} items", ctx("ru", { pluralCategory: "few" }));
    expect(prepared.segments).toEqual(["2 items"]);
    expect(identity(prepared)).toEqual({ text: "{{count}} items", needsReview: false });
  });

  it("does not confuse the example number with digits inside tokens", () => {
    const prepared = prepare("<1>{{count}}</1> item", ctx("en", { pluralCategory: "one" }));
    expect(prepared.segments).toEqual(["LNG01LNG1 item"]);
    expect(identity(prepared)).toEqual({ text: "<1>{{count}}</1> item", needsReview: false });
  });

  it("keeps {{count}} as a token without a small example number", () => {
    const prepared = prepare("{{count}} items", ctx("fr", { pluralCategory: "many" }));
    expect(prepared.segments).toEqual(["LNG0 items"]);
  });

  it("retries with {{count}} protected when the number is spelled out", () => {
    const prepared = prepare("{{count}} items", ctx("ru", { pluralCategory: "few" }));
    const result = prepared.restore(["два предмета"]);
    expect(result.needsReview).toBe(true);
    const fallback = result.fallback as PreparedMessage;
    expect(fallback.segments).toEqual(["LNG0 items"]);
    const retried = fallback.restore(["LNG0 предмета"]);
    expect(retried).toEqual({ text: "{{count}} предмета", needsReview: false });
    expect(fallback.restore(["предмета"]).fallback).toBeUndefined();
  });

  it("falls back to per-literal translation when a token is lost", () => {
    const prepared = prepare("Hello {{name}}, welcome to <b>our site</b>");
    const result = prepared.restore([prepared.segments[0]?.replace("LNG0", "") ?? ""]);
    expect(result.needsReview).toBe(true);
    expect(result.fallback?.segments).toEqual(["Hello", ", welcome to", "our site"]);
    const fallback = result.fallback?.restore(["Hallo", ", willkommen auf", "unserer Seite"]);
    expect(fallback).toEqual({
      text: "Hallo {{name}}, willkommen auf <b>unserer Seite</b>",
      needsReview: true,
    });
    expect(fallback?.fallback).toBeUndefined();
  });

  it("protects doNotTranslate terms", () => {
    const prepared = prepare(
      "Welcome to Lingua, {{name}}",
      ctx("de", { doNotTranslate: ["Lingua"] }),
    );
    expect(prepared.restore(prepared.segments.map(upper)).text).toBe("WELCOME TO Lingua, {{name}}");
  });
});
