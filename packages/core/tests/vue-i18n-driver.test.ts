import { describe, expect, it } from "vitest";
import { type PreparedMessage, vueI18nDriver } from "../src/index";

const prepare = (text: string, doNotTranslate: string[] = []) =>
  vueI18nDriver.prepare(text, { sourceLocale: "en", targetLocale: "de", doNotTranslate });
const identity = (prepared: PreparedMessage) => prepared.restore(prepared.segments);
const upper = (segment: string) => segment.replace(/[a-z]+/g, (word) => word.toUpperCase());

describe("vue-i18n driver", () => {
  it("plans targets as identity", () => {
    expect(vueI18nDriver.planTargets([{ path: ["a", 0], value: "Hi" }], "ru")).toEqual([
      { path: ["a", 0], sourcePath: ["a", 0], source: "Hi" },
    ]);
  });

  it.each([
    ["car | cars", ["car", "cars"]],
    ["no apples | one apple | {count} apples", ["no apples", "one apple", "LNG0 apples"]],
    ["{'@'}{account} | {'|'} pipe", ["LNG0LNG1", "LNG0 pipe"]],
    ["hello {name}", ["hello LNG0"]],
    ["{count}", ["LNG0"]],
  ])("splits forms and round trips %s", (message, segments) => {
    const prepared = prepare(message);
    expect(prepared.segments).toEqual(segments);
    expect(identity(prepared)).toEqual({ text: message, needsReview: false });
  });

  it("joins forms with ' | '", () => {
    expect(identity(prepare("car|cars")).text).toBe("car | cars");
  });

  it.each([
    ["@:message.hello world", "LNG0 world"],
    ["@.upper:msg", "LNG0"],
    ["@:(message.hello)", "LNG0"],
    ["Hi %{name}", "Hi LNG0"],
    ["a<br/>b", "aLNG0b"],
  ])("tokenizes %s", (message, segment) => {
    expect(prepare(message).segments).toEqual([segment]);
  });

  it("restores tokens after an uppercasing translation", () => {
    const prepared = prepare("Hello {name} | Hi @:user.name and %{n}, <b>Lingua</b>", ["Lingua"]);
    expect(prepared.restore(prepared.segments.map(upper))).toEqual({
      text: "HELLO {name} | HI @:user.name AND %{n}, <b>Lingua</b>",
      needsReview: false,
    });
  });

  it("falls back to per-literal translation across forms when a token is lost", () => {
    const prepared = prepare("{n} apple | {n} apples");
    const result = prepared.restore(["LNG0 apple", " apples"]);
    expect(result.needsReview).toBe(true);
    const fallback = result.fallback as PreparedMessage;
    expect(fallback.segments).toEqual(["apple", "apples"]);
    expect(fallback.restore(["Apfel", "Äpfel"])).toEqual({
      text: "{n} Apfel | {n} Äpfel",
      needsReview: true,
    });
  });
});
