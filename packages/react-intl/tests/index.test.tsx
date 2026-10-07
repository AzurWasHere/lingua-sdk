import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { createIntl, IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";
import {
  createTranslations,
  type LinguaTranslator,
  messageId,
  T,
  useTranslations,
} from "../src/index";

const messages = { [messageId("Hello {name}")]: "Hola {name}" };
const onError = () => {};
const bold = (chunks: ReactNode[]) => <b>{chunks}</b>;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="es" defaultLocale="en" messages={messages} onError={onError}>
      {children}
    </IntlProvider>
  );
}

function renderWith(use: (t: LinguaTranslator) => ReactNode) {
  function Probe() {
    return <>{use(useTranslations())}</>;
  }
  return render(<Probe />, { wrapper: Wrapper }).container;
}

describe("useTranslations", () => {
  it("uses the catalog translation when present", () => {
    expect(renderWith((t) => t("Hello {name}", { name: "Ada" })).textContent).toBe("Hola Ada");
  });

  it("falls back to the inline message when absent", () => {
    function Probe() {
      return <>{useTranslations()("Hello {name}", { name: "Ada" })}</>;
    }
    const { container } = render(
      <IntlProvider locale="es" defaultLocale="en" messages={{}} onError={onError}>
        <Probe />
      </IntlProvider>,
    );
    expect(container.textContent).toBe("Hello Ada");
    expect(renderWith((t) => t("Bye {name}", { name: "Ada" })).textContent).toBe("Bye Ada");
  });

  it("formats ICU plurals in the inline message", () => {
    const msg = "{n, plural, one {# item} other {# items}}";
    expect(renderWith((t) => `${t(msg, { n: 1 })}|${t(msg, { n: 3 })}`).textContent).toBe(
      "1 item|3 items",
    );
  });

  it("renders rich text for translated and fallback messages", () => {
    const rich = { ...messages, [messageId("Hi <b>{name}</b>")]: "Hola <b>{name}</b>" };
    const container = render(
      <IntlProvider locale="es" defaultLocale="en" messages={rich} onError={onError}>
        <T message="Hi <b>{name}</b>" values={{ name: "Ada", b: bold }} />|
        <T message="Bye <b>{name}</b>" values={{ name: "Ada", b: bold }} />
      </IntlProvider>,
    ).container;
    expect(container.innerHTML).toBe("Hola <b>Ada</b>|Bye <b>Ada</b>");
  });

  it("t.rich renders tags", () => {
    expect(
      renderWith((t) => t.rich("Hello <b>{name}</b>", { name: "Ada", b: bold })).innerHTML,
    ).toBe("Hello <b>Ada</b>");
  });

  it("has reports catalog presence", () => {
    expect(renderWith((t) => `${t.has("Hello {name}")}|${t.has("Bye")}`).textContent).toBe(
      "true|false",
    );
  });

  it("explicit id wins and context changes the id", () => {
    const intl = createIntl({
      locale: "es",
      defaultLocale: "en",
      messages: { greeting: "Saludo", [messageId("Open", "menu")]: "Abrir (menú)" },
      onError,
    });
    const t = createTranslations(intl);
    expect(t({ message: "Hi", id: "greeting" })).toBe("Saludo");
    expect(t({ message: "Open", context: "menu" })).toBe("Abrir (menú)");
    expect(t("Open")).toBe("Open");
    expect(t.locale).toBe("es");
  });

  it("returns a stable translator across renders of the same provider", () => {
    const seen: LinguaTranslator[] = [];
    function Probe() {
      seen.push(useTranslations());
      return null;
    }
    const { rerender } = render(<Probe />, { wrapper: Wrapper });
    rerender(<Probe />);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });
});

describe("<T>", () => {
  it("renders plain messages", () => {
    const container = render(<T message="Hello {name}" values={{ name: "Ada" }} />, {
      wrapper: Wrapper,
    }).container;
    expect(container.innerHTML).toBe("Hola Ada");
  });

  it("renders rich messages with element values", () => {
    const container = render(<T message="Hello {name}" values={{ name: <i>Ada</i> }} />, {
      wrapper: Wrapper,
    }).container;
    expect(container.innerHTML).toBe("Hola <i>Ada</i>");
  });
});

describe("createTranslations", () => {
  it("works without rendering (server use)", () => {
    const t = createTranslations(createIntl({ locale: "es", messages, onError }));
    expect(t("Hello {name}", { name: "Ada" })).toBe("Hola Ada");
    expect(t("Bye {name}", { name: "Ada" })).toBe("Bye Ada");
  });

  it("renders on the server", () => {
    const html = renderToString(
      <Wrapper>
        <T message="Hello <b>{name}</b>" values={{ name: "Ada", b: bold }} />
      </Wrapper>,
    );
    expect(html).toBe("Hello <b>Ada</b>");
  });
});

describe("dist", () => {
  it("bundles @lingua-api/shared", () => {
    const dist = join(fileURLToPath(import.meta.url), "../../dist");
    const files = readdirSync(dist);
    expect(files.length).toBeGreaterThan(0);
    files.forEach((file) => {
      expect(readFileSync(join(dist, file), "utf8")).not.toContain("@lingua-api/shared");
    });
  });
});
