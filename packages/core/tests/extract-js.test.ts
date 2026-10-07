import { describe, expect, it } from "vitest";
import { extractFromSource } from "../src/extract/js";
import { messageId } from "../src/index";

const options = { functionNames: ["t"], componentNames: ["T"] };
const run = (lines: string[], file = "src/a.tsx", opts = options) =>
  extractFromSource(lines.join("\n"), file, opts);
const summary = (result: Awaited<ReturnType<typeof run>>) =>
  result.messages.map(({ id, message, context, plural, locations }) => ({
    id,
    message,
    context,
    plural,
    at: locations.map(({ line, column }) => `${line}:${column}`),
  }));

describe("extractFromSource", () => {
  it("extracts calls, descriptors, plural objects and <T> elements", async () => {
    const result = await run([
      'import { T, useTranslations } from "@lingua-api/next-intl";',
      'const a = t("Hello {name}", { name });',
      "const b = t(`Save`);",
      'const c = t.rich("Click <b>here</b>", { b: (chunks) => chunks });',
      'const d = t({ message: "Delete", context: "verb" });',
      'const e = t({ message: "x", id: "custom.id" });',
      'const f = t({ one: "{{count}} item", other: "{{count}} items" }, { count });',
      'const g = <T message="Welcome" />;',
      'const h = <T message={"Bye"} context="farewell" />;',
      "const i = <T message={`Tpl`} />;",
    ]);
    expect(result.warnings).toEqual([]);
    expect(summary(result)).toEqual([
      { id: messageId("Hello {name}"), message: "Hello {name}", at: ["2:10"] },
      { id: messageId("Save"), message: "Save", at: ["3:10"] },
      { id: messageId("Click <b>here</b>"), message: "Click <b>here</b>", at: ["4:10"] },
      { id: messageId("Delete", "verb"), message: "Delete", context: "verb", at: ["5:10"] },
      { id: "custom.id", message: "x", at: ["6:10"] },
      {
        id: messageId("{{count}} items"),
        message: "{{count}} items",
        plural: { one: "{{count}} item", other: "{{count}} items" },
        at: ["7:10"],
      },
      { id: messageId("Welcome"), message: "Welcome", at: ["8:10"] },
      { id: messageId("Bye", "farewell"), message: "Bye", context: "farewell", at: ["9:10"] },
      { id: messageId("Tpl"), message: "Tpl", at: ["10:10"] },
    ]);
  });

  it("warns about dynamic messages at the argument position", async () => {
    const result = await run([
      "t(name);",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source code under test
      "t(`Hi ${name}`);",
      't("a" + b);',
      "const x = <T message={label} />;",
    ]);
    expect(result.messages).toEqual([]);
    expect(result.warnings.map(({ line, column, message }) => [line, column, message])).toEqual([
      [1, 2, "Dynamic message passed to t() cannot be extracted"],
      [2, 2, "Dynamic message passed to t() cannot be extracted"],
      [3, 2, "Dynamic message passed to t() cannot be extracted"],
      [4, 22, "Dynamic message passed to <T> cannot be extracted"],
    ]);
  });

  it("ignores other functions and honors custom names", async () => {
    expect(await run(['other("x");', 'i18n.t("key");'])).toEqual({ messages: [], warnings: [] });
    const custom = await run(
      ['tr("A");', 't("B");', '<Trans message="C" />;', '<T message="D" />;'],
      "src/a.tsx",
      { functionNames: ["tr"], componentNames: ["Trans"] },
    );
    expect(custom.messages.map(({ message }) => message)).toEqual(["A", "C"]);
  });

  it("extracts from awaited server translators", async () => {
    const result = await run([
      "export async function Page() {",
      "  const t = await getTranslations();",
      '  return t("Server");',
      "}",
    ]);
    expect(summary(result)).toEqual([{ id: messageId("Server"), message: "Server", at: ["3:9"] }]);
  });

  it("parses TypeScript syntax and JSX in .js files", async () => {
    const result = await run([
      "interface Props { label: string }",
      "enum Color { Red }",
      "const id = <T,>(x: T) => x;",
      "const conf = { a: 1 } satisfies Record<string, number>;",
      "@decorator class Foo { @prop() x = 1 }",
      'export function C(props: Props) { return <T message="Typed" /> }',
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.messages.map(({ message }) => message)).toEqual(["Typed"]);
    expect((await run(['const x = <T message="Js" />;'], "src/a.js")).messages).toHaveLength(1);
  });

  it("reports columns in UTF-16 code units after multi-byte characters", async () => {
    const result = await run(["// é😀", 'const s = "é😀"; t("After");']);
    expect(summary(result)[0]?.at).toEqual(["2:17"]);
  });

  it("turns a syntax error into one warning", async () => {
    const result = await run(['t("ok");', "const = ;"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ file: "src/a.tsx", line: 2 });
    expect(result.warnings[0]?.message).toMatch(/^Parse error/);
  });

  it("merges repeated ids into one message", async () => {
    const result = await run(['t("Twice");', 'const x = t("Twice");']);
    expect(summary(result)).toEqual([
      { id: messageId("Twice"), message: "Twice", at: ["1:0", "2:10"] },
    ]);
  });
});
