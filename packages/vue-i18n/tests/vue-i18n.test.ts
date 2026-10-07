import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createI18n } from "vue-i18n";
import { createTranslations, messageId, T, useTranslations } from "../src/index";

const makeI18n = (locale = "es") =>
  createI18n({
    legacy: false,
    locale,
    fallbackLocale: "en",
    messages: {
      es: {
        [messageId("Hello {name}")]: "Hola {name}",
        [messageId("car | cars")]: "coche | coches",
        "greeting.hello": "Hola explícito {name}",
      },
    },
  });

const withTranslator = (run: (t: ReturnType<typeof useTranslations>) => string) => {
  const Probe = defineComponent({ setup: () => () => run(useTranslations()) });
  return mount(Probe, { global: { plugins: [makeI18n()] } }).text();
};

describe("useTranslations", () => {
  it("uses the catalog translation when present", () => {
    expect(withTranslator((t) => t("Hello {name}", { name: "Ada" }))).toBe("Hola Ada");
  });

  it("formats the inline message with rt when absent", () => {
    expect(withTranslator((t) => t("Bye {name}", { name: "Ada" }))).toBe("Bye Ada");
  });

  it("selects plural forms by count, inline and from the catalog", () => {
    expect(withTranslator((t) => t("bike | bikes", { count: 2 }))).toBe("bikes");
    expect(withTranslator((t) => t("bike | bikes", { count: 1 }))).toBe("bike");
    expect(withTranslator((t) => t("car | cars", { count: 2 }))).toBe("coches");
    expect(withTranslator((t) => t("car | cars", { count: 1 }))).toBe("coche");
  });

  it("reports presence and locale", () => {
    expect(withTranslator((t) => String(t.has("Hello {name}")))).toBe("true");
    expect(withTranslator((t) => String(t.has("Bye {name}")))).toBe("false");
    expect(withTranslator((t) => t.locale)).toBe("es");
  });

  it("honours explicit id and context", () => {
    const values = { name: "Ada" };
    expect(
      withTranslator((t) => t({ message: "Hello {name}", id: "greeting.hello" }, values)),
    ).toBe("Hola explícito Ada");
    expect(withTranslator((t) => t({ message: "Hello {name}", context: "email" }, values))).toBe(
      "Hello Ada",
    );
    expect(
      withTranslator((t) => String(t.has({ message: "Hello {name}", context: "email" }))),
    ).toBe("false");
  });
});

describe("<T>", () => {
  it("renders a bare text node", () => {
    const Parent = defineComponent({
      render: () => h("p", [h(T, { message: "Hello {name}", values: { name: "Ada" } })]),
    });
    const wrapper = mount(Parent, { global: { plugins: [makeI18n()] } });
    expect(wrapper.html()).toBe("<p>Hola Ada</p>");
  });

  it("passes count as the plural argument", () => {
    const wrapper = mount(T, {
      props: { message: "car | cars", count: 2 },
      global: { plugins: [makeI18n()] },
    });
    expect(wrapper.text()).toBe("coches");
  });
});

describe("createTranslations", () => {
  it("works with i18n.global without mounting", () => {
    const t = createTranslations(makeI18n().global);
    expect(t("Hello {name}", { name: "Ada" })).toBe("Hola Ada");
    expect(t("Bye {name}", { name: "Ada" })).toBe("Bye Ada");
  });

  it("accepts the I18n instance", () => {
    const t = createTranslations(makeI18n());
    expect(t("Hello {name}", { name: "Ada" })).toBe("Hola Ada");
    expect(t.locale).toBe("es");
  });

  it("rejects legacy mode", () => {
    expect(() => createTranslations(createI18n({ legacy: true }))).toThrow(/legacy: false/);
  });
});

describe("SSR", () => {
  it("does not leak locale between sequential apps", async () => {
    const Page = defineComponent({
      setup: () => () => h("p", [h(T, { message: "Hello {name}", values: { name: "Ada" } })]),
    });
    const render = (locale: string) => {
      const app = createSSRApp(Page);
      app.use(makeI18n(locale));
      return renderToString(app);
    };
    const es = await render("es");
    const en = await render("en");
    expect(es).toContain("Hola Ada");
    expect(en).toContain("Hello Ada");
  });
});

describe("dist", () => {
  it("bundles @lingua-api/shared", () => {
    ["index.js", "index.cjs"].forEach((file) => {
      const code = readFileSync(join(import.meta.dirname, "../dist", file), "utf8");
      expect(code).not.toContain("@lingua-api/shared");
    });
  });
});
