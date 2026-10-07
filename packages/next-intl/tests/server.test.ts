import { getLocale, getTranslations as nextGetTranslations } from "next-intl/server";
import { expect, it, vi } from "vitest";
import { getTranslations } from "../src/server";

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { messageId } = await import("@lingua-api/shared");
  const realT = createTranslator({
    locale: "es",
    messages: { [messageId("Hello {name}")]: "Hola {name}" },
  });
  return { getTranslations: vi.fn(async () => realT), getLocale: vi.fn(async () => "es") };
});

it("wraps next-intl/server getTranslations", async () => {
  const t = await getTranslations();
  expect(t.locale).toBe("es");
  expect(t("Hello {name}", { name: "Ada" })).toBe("Hola Ada");
  expect(t("Bye {name}", { name: "Ada" })).toBe("Bye Ada");
  expect(t.has("Hello {name}")).toBe(true);
  expect(t.has("Bye {name}")).toBe(false);
  expect(t.markup("Bye <b>{name}</b>", { name: "Ada", b: (c) => `<b>${c}</b>` })).toBe(
    "Bye <b>Ada</b>",
  );
  expect(nextGetTranslations).toHaveBeenLastCalledWith();
  expect(getLocale).toHaveBeenCalled();
});

it("forwards an explicit locale", async () => {
  const t = await getTranslations({ locale: "fr" });
  expect(nextGetTranslations).toHaveBeenLastCalledWith({ locale: "fr" });
  expect(t.locale).toBe("fr");
});
