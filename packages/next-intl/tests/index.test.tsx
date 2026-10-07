import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { type LinguaTranslator, messageId, T, useTranslations } from "../src/index";

const messages = {
  [messageId("Hello {name}")]: "Hola {name}",
  [messageId("Hello <b>{name}</b>")]: "Hola <b>{name}</b>",
  [messageId("Open", "menu")]: "Abrir (menú)",
  greeting: "Saludos",
};

const bold = (chunks: ReactNode) => <b>{chunks}</b>;

function wrap(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="es" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

function getT(): LinguaTranslator {
  let t: LinguaTranslator | undefined;
  function Probe() {
    t = useTranslations();
    return null;
  }
  render(wrap(<Probe />));
  if (!t) throw new Error("translator not captured");
  return t;
}

it("uses the catalog translation when present", () => {
  expect(getT()("Hello {name}", { name: "Ada" })).toBe("Hola Ada");
});

it("formats the inline message when the translation is absent", () => {
  const t = getT();
  expect(t("Hello {name}!", { name: "Ada" })).toBe("Hello Ada!");
  expect(t("{count, plural, one {# item} other {# items}}", { count: 2 })).toBe("2 items");
  expect(t("{count, plural, one {# item} other {# items}}", { count: 1 })).toBe("1 item");
});

it("renders rich text in both paths", () => {
  const t = getT();
  const present = render(t.rich("Hello <b>{name}</b>", { name: "Ada", b: bold }));
  expect(present.container.textContent).toBe("Hola Ada");
  expect(present.container.querySelector("b")?.textContent).toBe("Ada");
  const absent = render(t.rich("Bye <b>{name}</b>", { name: "Ada", b: bold }));
  expect(absent.container.textContent).toBe("Bye Ada");
  expect(absent.container.querySelector("b")?.textContent).toBe("Ada");
});

it("returns markup strings in both paths", () => {
  const t = getT();
  const b = (chunks: string) => `<b>${chunks}</b>`;
  expect(t.markup("Hello <b>{name}</b>", { name: "Ada", b })).toBe("Hola <b>Ada</b>");
  expect(t.markup("Bye <b>{name}</b>", { name: "Ada", b })).toBe("Bye <b>Ada</b>");
});

it("reports whether the catalog has the message", () => {
  const t = getT();
  expect(t.has("Hello {name}")).toBe(true);
  expect(t.has("Nope")).toBe(false);
});

it("prefers an explicit id over the hash", () => {
  const t = getT();
  expect(t({ id: "greeting", message: "Greetings" })).toBe("Saludos");
  expect(t({ id: "missing.nested", message: "Fallback {n}" }, { n: 1 })).toBe("Fallback 1");
});

it("includes context in the id", () => {
  const t = getT();
  expect(messageId("Open", "menu")).not.toBe(messageId("Open"));
  expect(t({ message: "Open", context: "menu" })).toBe("Abrir (menú)");
  expect(t("Open")).toBe("Open");
});

it("exposes the provider locale", () => {
  expect(getT().locale).toBe("es");
});

it("renders <T> as plain and rich text", () => {
  const plain = render(wrap(<T message="Hello {name}" values={{ name: "Ada" }} />));
  expect(plain.container.textContent).toBe("Hola Ada");
  const rich = render(wrap(<T message="Hello <b>{name}</b>" values={{ name: "Ada", b: bold }} />));
  expect(rich.container.querySelector("b")?.textContent).toBe("Ada");
  const ctx = render(wrap(<T message="Open" context="menu" />));
  expect(ctx.container.textContent).toBe("Abrir (menú)");
});

it("renders on the server", () => {
  function Greeting() {
    const t = useTranslations();
    return <p>{t("Hello {name}", { name: "Ada" })}</p>;
  }
  expect(renderToString(wrap(<Greeting />))).toContain("Hola Ada");
});
