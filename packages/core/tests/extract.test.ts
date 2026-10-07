import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TranslateBatchParams, TranslateBatchResult } from "@lingua-api/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkExtraction,
  extract,
  type LinguaConfig,
  messageId,
  resolveConfig,
  translate,
} from "../src/index";

function fakeClient() {
  return {
    translate: vi.fn(),
    translateBatch: vi.fn(
      async ({ texts, target }: TranslateBatchParams): Promise<TranslateBatchResult> => ({
        translations: texts.map((text) => ({
          text: `[${target}] ${text}`,
          detected: "en",
          confidence: 1,
          engine: "libre",
          characters: text.length,
        })),
        engine: "libre",
        characters: texts.reduce((sum, text) => sum + text.length, 0),
        rateLimit: { limit: 10, remaining: 9, resetAt: 0, includedRemaining: 1000 },
      }),
    ),
    languages: vi.fn(async () => ["en", "es"].map((code) => ({ code, name: code }))),
    batchSupported: true,
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "lingua-extract-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const config = (extra: Partial<LinguaConfig> = {}) =>
  resolveConfig(
    {
      runtime: "next-intl",
      sourceLocale: "en",
      targetLocales: ["es"],
      include: ["src/**/*.{ts,tsx}"],
      ...extra,
    },
    root,
    {},
  );
const put = async (file: string, content: string | string[]) => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), Array.isArray(content) ? content.join("\n") : content);
};
const json = async (file: string) => JSON.parse(await readFile(join(root, file), "utf8"));
const exists = (file: string) =>
  readFile(join(root, file)).then(
    () => true,
    () => false,
  );

const hello = messageId("Hello");
const save = messageId("Save", "button");
const bye = messageId("Bye");

async function writeSources() {
  await put("src/a.tsx", [
    'import { useTranslations } from "@lingua-api/next-intl";',
    "export function A() {",
    "  const t = useTranslations();",
    '  return <p>{t("Hello")}{t({ message: "Save", context: "button" })}</p>;',
    "}",
  ]);
  await put("src/b.ts", [
    'import { getTranslations } from "@lingua-api/next-intl/server";',
    'export const b = async () => (await getTranslations())("Ignored dynamic callee");',
    "export async function c() {",
    "  const t = await getTranslations();",
    '  return t("Bye");',
    "}",
  ]);
  await put("src/plain.ts", 'export const t = (s: string) => s;\nt("Nope");\n');
}

describe("extract", () => {
  it("creates the source catalog in location order and owns its keys", async () => {
    await writeSources();
    const report = await extract(config());
    expect(await json("messages/en.json")).toEqual({
      [hello]: "Hello",
      [save]: "Save",
      [bye]: "Bye",
    });
    expect(Object.keys(await json("messages/en.json"))).toEqual([hello, save, bye]);
    expect(report).toMatchObject({
      namespace: "",
      added: [hello, save, bye],
      updated: [],
      removed: [],
      unchanged: 0,
      messages: 3,
      files: 3,
      warnings: [],
    });
    const lock = await json("lingua.lock.json");
    expect(Object.keys(lock.entries)).toEqual([`|/${bye}`, `|/${hello}`, `|/${save}`].sort());
    expect(lock.entries[`|/${hello}`]).toEqual({ extracted: true, targets: {} });
  });

  it("keeps hand-written keys and removes or updates only extracted ones", async () => {
    await writeSources();
    await put("src/c.ts", [
      'import "@lingua-api/next-intl";',
      't({ id: "greeting.custom", message: "Hi" });',
    ]);
    await extract(config());
    const catalog = await json("messages/en.json");
    await put(
      "messages/en.json",
      JSON.stringify({ nav: { home: "Home" }, ...catalog, title: "Title" }, null, 2),
    );

    const second = await extract(config());
    expect(second).toMatchObject({ added: [], updated: [], removed: [], unchanged: 4 });
    expect(Object.keys(await json("messages/en.json"))).toEqual([
      "nav",
      hello,
      save,
      bye,
      "greeting.custom",
      "title",
    ]);

    await put("src/b.ts", 'import "@lingua-api/next-intl";\nexport const b = 1;\n');
    await put("src/a.tsx", [
      'import { useTranslations } from "@lingua-api/next-intl";',
      'const t = useTranslations(); t({ message: "Save", context: "button" });',
      't("Hello there");',
    ]);
    await put("src/c.ts", [
      'import "@lingua-api/next-intl";',
      't({ id: "greeting.custom", message: "Hi!" });',
    ]);
    const third = await extract(config());
    const helloThere = messageId("Hello there");
    expect(third).toMatchObject({
      added: [helloThere],
      updated: ["greeting.custom"],
      removed: [hello, bye],
    });
    expect(await json("messages/en.json")).toEqual({
      nav: { home: "Home" },
      [save]: "Save",
      "greeting.custom": "Hi!",
      title: "Title",
      [helloThere]: "Hello there",
    });
    const lock = await json("lingua.lock.json");
    expect(lock.entries[`|/${hello}`]).toBeUndefined();
    expect(lock.entries[`|/${bye}`]).toBeUndefined();
    expect(lock.entries["|/title"]).toBeUndefined();
    expect(lock.entries[`|/${helloThere}`]).toEqual({ extracted: true, targets: {} });
  });

  it("fails when one id is used for two messages", async () => {
    await put("src/a.ts", 'import "@lingua-api/next-intl";\nt({ id: "same", message: "A" });');
    await put("src/b.ts", 'import "@lingua-api/next-intl";\nt({ id: "same", message: "B" });');
    await expect(extract(config())).rejects.toMatchObject({
      code: "extract",
      message: expect.stringMatching(
        /"same"[\s\S]*"A" at src\/a\.ts:2:1[\s\S]*"B" at src\/b\.ts:2:1/,
      ),
    });
  });

  it("writes formatjs objects for react-intl", async () => {
    await put("src/a.tsx", [
      'import { useTranslations } from "@lingua-api/react-intl";',
      'const t = useTranslations(); t({ message: "Save", context: "button" }); t("Plain");',
    ]);
    await extract(config({ runtime: "react-intl" }));
    expect(await json("lang/en.json")).toEqual({
      [save]: { defaultMessage: "Save", description: "button" },
      [messageId("Plain")]: { defaultMessage: "Plain" },
    });
  });

  it("writes i18next plural keys into the default namespace", async () => {
    await put("src/a.ts", [
      'import { createTranslations } from "@lingua-api/i18next";',
      "const t = createTranslations(i18n);",
      't({ one: "{{count}} item", other: "{{count}} items" }, { count });',
      't("Hi");',
    ]);
    await extract(config({ runtime: "i18next" }));
    const id = messageId("{{count}} items");
    expect(await json("public/locales/en/translation.json")).toEqual({
      [`${id}_one`]: "{{count}} item",
      [`${id}_other`]: "{{count}} items",
      [messageId("Hi")]: "Hi",
    });
    expect(Object.keys((await json("lingua.lock.json")).entries)).toEqual(
      [
        `translation|/${id}_one`,
        `translation|/${id}_other`,
        `translation|/${messageId("Hi")}`,
      ].sort(),
    );
  });

  it("skips plural objects with a warning outside i18next", async () => {
    await put("src/a.ts", [
      'import "@lingua-api/next-intl";',
      't({ one: "# item", other: "# items" });',
    ]);
    const report = await extract(config());
    expect(report.added).toEqual([]);
    expect(report.warnings).toMatchObject([{ file: "src/a.ts", line: 2, column: 0 }]);
  });

  it("writes nothing on a dry run", async () => {
    await writeSources();
    const report = await extract(config(), { dryRun: true });
    expect(report.added).toEqual([hello, save, bye]);
    expect(await exists("messages/en.json")).toBe(false);
    expect(await exists("lingua.lock.json")).toBe(false);
  });

  it("reports a stale source catalog in checkExtraction", async () => {
    await writeSources();
    const issues = await checkExtraction(config());
    expect(issues).toEqual(
      [hello, save, bye].map((id) => ({
        kind: "source-stale",
        key: `|/${id}`,
        detail: "not in source catalog — run lingua extract",
      })),
    );
    await extract(config());
    expect(await checkExtraction(config())).toEqual([]);
  });

  it("feeds translate end to end", async () => {
    await writeSources();
    await extract(config());
    await translate({ config: config(), client: fakeClient() });
    expect(await json("messages/es.json")).toEqual({
      [hello]: "[es] Hello",
      [save]: "[es] Save",
      [bye]: "[es] Bye",
    });

    await extract(config());
    expect((await json("lingua.lock.json")).entries[`|/${hello}`]).toMatchObject({
      extracted: true,
      targets: { es: { text: "[es] Hello" } },
    });
    const client = fakeClient();
    await translate({ config: config(), client });
    expect(client.translateBatch).not.toHaveBeenCalled();
  });

  it("requires wrapper mode", async () => {
    await expect(extract(config({ include: undefined }))).rejects.toMatchObject({
      code: "config",
    });
  });
});
