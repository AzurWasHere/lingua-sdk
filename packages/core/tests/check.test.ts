import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TranslateBatchParams } from "@lingua-api/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { check, resolveConfig, translate } from "../src/index";

const client = () => ({
  translate: vi.fn(),
  translateBatch: vi.fn(async ({ texts, target }: TranslateBatchParams) => ({
    translations: texts.map((text) => ({
      text: `[${target}] ${text}`,
      detected: "en",
      confidence: 1,
      engine: "libre" as const,
      characters: text.length,
    })),
    engine: "libre" as const,
    characters: texts.reduce((sum, text) => sum + text.length, 0),
    rateLimit: { limit: 10, remaining: 9, resetAt: 0, includedRemaining: 1000 },
  })),
  languages: vi.fn(async () => ["en", "es", "fr", "pt"].map((code) => ({ code, name: code }))),
  batchSupported: true,
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "lingua-check-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const config = () =>
  resolveConfig({ runtime: "next-intl", sourceLocale: "en", targetLocales: ["es", "fr"] }, root, {
    LINGUA_API_KEY: "test",
  });
const put = async (file: string, data: unknown) => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), JSON.stringify(data, null, 2));
};
const kinds = async () =>
  (await check({ config: config() })).issues.map(({ kind, locale, key }) => [kind, locale, key]);

describe("check", () => {
  beforeEach(async () => {
    await put("messages/en.json", { greeting: "Hello", count: 3 });
    await translate({ config: config(), client: client() });
  });

  it("is ok after a translate run", async () => {
    expect(await check({ config: config() })).toEqual({
      ok: true,
      issues: [],
      locales: [
        { locale: "es", missing: 0, unused: 0 },
        { locale: "fr", missing: 0, unused: 0 },
      ],
    });
  });

  it("reports keys missing from every locale", async () => {
    await put("messages/en.json", { greeting: "Hello", count: 3, bye: "Bye" });
    const report = await check({ config: config() });
    expect(report.ok).toBe(false);
    expect(report.issues.map(({ kind, locale, key }) => [kind, locale, key])).toEqual([
      ["missing", "es", "|/bye"],
      ["missing", "fr", "|/bye"],
    ]);
  });

  it("reports stale manual overrides", async () => {
    await put("messages/es.json", { greeting: "Hola", count: 3 });
    await translate({ config: config(), client: client() });
    await put("messages/en.json", { greeting: "Hi", count: 3 });
    expect(await kinds()).toEqual([
      ["stale-manual", "es", "|/greeting"],
      ["missing", "fr", "|/greeting"],
    ]);
  });

  it("reports unused target keys", async () => {
    await put("messages/fr.json", { greeting: "[fr] Hello", count: 3, extra: "En trop" });
    expect(await kinds()).toEqual([["unused", "fr", "|/extra"]]);
  });

  it("reports a missing source catalog", async () => {
    await rm(join(root, "messages/en.json"));
    expect(await check({ config: config() })).toEqual({
      ok: false,
      issues: [{ kind: "source-missing", detail: "Source catalog not found: messages/en.json" }],
      locales: [],
    });
  });
});
