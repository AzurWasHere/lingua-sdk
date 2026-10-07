/// <reference lib="dom" />
import { act, cleanup, render } from "@testing-library/react";
import i18next from "i18next";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { messageId } from "../src/index";
import { T, useTranslations } from "../src/react";

const items = messageId("{{count}} items");

async function setup() {
  const i18n = i18next.createInstance().use(initReactI18next);
  await i18n.init({
    lng: "es",
    fallbackLng: false,
    react: { useSuspense: false },
    resources: {
      es: {
        translation: {
          [messageId("Hello {{name}}")]: "Hola {{name}}",
          [`${items}_one`]: "{{count}} artículo",
          [`${items}_other`]: "{{count}} artículos",
        },
      },
    },
  });
  return i18n;
}

function Greeting() {
  const t = useTranslations();
  return (
    <p>
      {t("Hello {{name}}", { name: "Ada" })} {t.locale}
    </p>
  );
}

describe("react", () => {
  let i18n: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    i18n = await setup();
  });
  afterEach(cleanup);

  const view = (ui: ReactNode) =>
    render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>).container;

  it("useTranslations renders catalog text and re-renders on language change", async () => {
    const container = view(<Greeting />);
    expect(container.textContent).toBe("Hola Ada es");
    await act(() => i18n.changeLanguage("en"));
    expect(container.textContent).toBe("Hello Ada en");
  });

  it("<T> renders plain, rich and plural messages", () => {
    expect(view(<T message="Hello {{name}}" values={{ name: "Ada" }} />).textContent).toBe(
      "Hola Ada",
    );
    cleanup();
    expect(view(<T message="Click <b>here</b>" components={{ b: <b /> }} />).innerHTML).toBe(
      "Click <b>here</b>",
    );
    cleanup();
    expect(
      view(<T message={{ one: "{{count}} item", other: "{{count}} items" }} count={1} />)
        .textContent,
    ).toBe("1 artículo");
    cleanup();
    expect(
      view(<T message={{ one: "{{count}} file", other: "{{count}} files" }} count={1} />)
        .textContent,
    ).toBe("1 file");
  });

  it("renders to string", () => {
    expect(
      renderToString(
        <I18nextProvider i18n={i18n}>
          <Greeting />
        </I18nextProvider>,
      ),
    ).toContain("Hola Ada");
  });
});
