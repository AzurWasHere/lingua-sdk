import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import i18next from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { createTranslations, messageId, resolveAnyMessage } from "../src/index";

const items = messageId("{{count}} items");
const i18n = i18next.createInstance();

beforeAll(async () => {
  await i18n.init({
    lng: "es",
    fallbackLng: false,
    ns: ["translation", "other"],
    resources: {
      es: {
        translation: {
          [messageId("Hello {{name}}")]: "Hola {{name}}",
          [`${items}_one`]: "{{count}} artículo",
          [`${items}_other`]: "{{count}} artículos",
          custom: "Personalizado",
          [messageId("Save", "button")]: "Guardar",
        },
        other: { [messageId("Hello {{name}}")]: "Hola desde other, {{name}}" },
      },
    },
  });
});

describe("createTranslations", () => {
  it("uses the catalog when present and the inline message otherwise", () => {
    const t = createTranslations(i18n);
    expect(t("Hello {{name}}", { name: "Ada" })).toBe("Hola Ada");
    expect(t("Bye {{name}}", { name: "Ada" })).toBe("Bye Ada");
    expect(t({ message: "Hello {{name}}" }, { name: "Ada" })).toBe("Hola Ada");
  });

  it("falls back to the inline plural forms by count", () => {
    const t = createTranslations(i18n);
    const files = { one: "{{count}} file", other: "{{count}} files" };
    expect(t(files, { count: 1 })).toBe("1 file");
    expect(t(files, { count: 5 })).toBe("5 files");
  });

  it("uses catalog plural keys when present", () => {
    const t = createTranslations(i18n);
    const msg = { one: "{{count}} item", other: "{{count}} items" };
    expect(t(msg, { count: 1 })).toBe("1 artículo");
    expect(t(msg, { count: 5 })).toBe("5 artículos");
  });

  it("has() is count-aware", () => {
    const t = createTranslations(i18n);
    expect(t.has("Hello {{name}}")).toBe(true);
    expect(t.has("Missing")).toBe(false);
    expect(t.has({ other: "{{count}} items" }, { count: 2 })).toBe(true);
    expect(t.has({ other: "{{count}} items" })).toBe(false);
  });

  it("honours explicit id and context", () => {
    const t = createTranslations(i18n);
    expect(t({ message: "Custom", id: "custom" })).toBe("Personalizado");
    expect(t({ other: "Custom", id: "custom" })).toBe("Personalizado");
    expect(t({ message: "Save", context: "button" })).toBe("Guardar");
    expect(t("Save")).toBe("Save");
    expect(resolveAnyMessage({ other: "Save", context: "button" }).id).toBe(
      messageId("Save", "button"),
    );
  });

  it("forwards ns and exposes locale", () => {
    const t = createTranslations(i18n, { ns: "other" });
    expect(t("Hello {{name}}", { name: "Ada" })).toBe("Hola desde other, Ada");
    expect(t.has("Hello {{name}}")).toBe(true);
    expect(t.locale).toBe("es");
  });

  it("resolves plural defaults", () => {
    expect(resolveAnyMessage({ one: "a", other: "b" })).toEqual({
      id: messageId("b"),
      defaults: { defaultValue: "b", defaultValue_one: "a", defaultValue_other: "b" },
      message: "b",
    });
  });
});

describe("dist", () => {
  const dist = join(import.meta.dirname, "../dist");
  const files = readdirSync(dist).map((name) => ({
    name,
    text: readFileSync(join(dist, name), "utf8"),
  }));

  it("keeps react out of the framework-free entry and bundles shared", () => {
    expect(files.length).toBeGreaterThan(0);
    files
      .filter(({ name }) => !name.startsWith("react."))
      .forEach(({ text }) => {
        expect(text).not.toMatch(/["']react(-i18next)?["']/);
      });
    files.forEach(({ text }) => {
      expect(text).not.toContain("@lingua-api/shared");
    });
  });
});
