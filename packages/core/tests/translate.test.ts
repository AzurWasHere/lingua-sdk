import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  LinguaApiError,
  type TranslateBatchParams,
  type TranslateBatchResult,
} from "@lingua-api/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FormatDriver,
  type LinguaConfig,
  type ProgressEvent,
  resolveConfig,
  translate,
} from "../src/index";

const fake = vi.hoisted(() => ({ driver: undefined as FormatDriver | undefined }));
vi.mock("../src/formats/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/formats/index")>();
  return {
    ...actual,
    getDriver: (name: Parameters<typeof actual.getDriver>[0]) =>
      fake.driver ?? actual.getDriver(name),
  };
});

function fakeClient(codes = ["en", "es", "fr", "pt"]) {
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
    languages: vi.fn(async () => codes.map((code) => ({ code, name: code }))),
    batchSupported: true,
  };
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "lingua-translate-"));
  fake.driver = undefined;
});
afterEach(() => rm(root, { recursive: true, force: true }));

const config = (
  extra: Partial<LinguaConfig> = {},
  env: NodeJS.ProcessEnv = { LINGUA_API_KEY: "test" },
) =>
  resolveConfig(
    { runtime: "next-intl", sourceLocale: "en", targetLocales: ["es", "fr"], ...extra },
    root,
    env,
  );
const put = async (file: string, data: unknown) => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), JSON.stringify(data, null, 2));
};
const text = (file: string) => readFile(join(root, file), "utf8");
const json = async (file: string) => JSON.parse(await text(file));
const exists = (file: string) =>
  text(file).then(
    () => true,
    () => false,
  );
const textsSent = (client: ReturnType<typeof fakeClient>) =>
  client.translateBatch.mock.calls.map(([params]) => [params.target, params.texts]);

const source = { greeting: "Hello {name}", nav: { home: "Home" }, count: 3 };
const firstRun = async (extra: Partial<LinguaConfig> = {}) => {
  await put("messages/en.json", source);
  return translate({ config: config(extra), client: fakeClient() });
};

describe("translate", () => {
  it("writes target catalogs in source order and records the lockfile", async () => {
    const client = fakeClient();
    await put("messages/en.json", source);
    const report = await translate({ config: config(), client });

    expect(await text("messages/es.json")).toBe(
      `${JSON.stringify({ greeting: "[es] Hello {name}", nav: { home: "[es] Home" }, count: 3 }, null, 2)}\n`,
    );
    expect(await json("messages/fr.json")).toEqual({
      greeting: "[fr] Hello {name}",
      nav: { home: "[fr] Home" },
      count: 3,
    });
    expect(textsSent(client)).toEqual([
      ["es", ["Hello LNG0", "Home"]],
      ["fr", ["Hello LNG0", "Home"]],
    ]);
    const lock = await json("lingua.lock.json");
    expect(lock.entries["|/greeting"].targets.es).toEqual({
      source: "Hello {name}",
      text: "[es] Hello {name}",
      engine: "libre",
      manual: false,
    });
    expect(lock.entries["|/nav/home"].targets.fr.manual).toBe(false);
    expect(report.locales.map(({ translated }) => translated)).toEqual([2, 2]);
    expect(report).toMatchObject({ dryRun: false, requests: 2, characters: 28, warnings: [] });
  });

  it("reuses everything on a second run", async () => {
    await firstRun();
    const client = fakeClient();
    const report = await translate({ config: config(), client });
    expect(client.translateBatch).not.toHaveBeenCalled();
    expect(report.locales.map(({ reused, translated }) => [reused, translated])).toEqual([
      [2, 0],
      [2, 0],
    ]);
  });

  it("keeps hand edits and records them as manual", async () => {
    await firstRun();
    await put("messages/es.json", {
      greeting: "Hola {name}",
      nav: { home: "[es] Home" },
      count: 3,
    });
    const client = fakeClient();
    const report = await translate({ config: config(), client });

    expect(client.translateBatch).not.toHaveBeenCalled();
    expect((await json("messages/es.json")).greeting).toBe("Hola {name}");
    expect((await json("lingua.lock.json")).entries["|/greeting"].targets.es).toEqual({
      source: "Hello {name}",
      text: "Hola {name}",
      engine: "libre",
      manual: true,
    });
    expect(report.locales[0]).toMatchObject({ locale: "es", manual: 1, reused: 1 });
  });

  it("reports stale manual overrides and retranslates machine keys when the source changes", async () => {
    await firstRun();
    await put("messages/es.json", {
      greeting: "Hola {name}",
      nav: { home: "[es] Home" },
      count: 3,
    });
    await translate({ config: config(), client: fakeClient() });
    await put("messages/en.json", { ...source, greeting: "Hi {name}" });
    const client = fakeClient();
    const report = await translate({ config: config(), client });

    expect(textsSent(client)).toEqual([["fr", ["Hi LNG0"]]]);
    expect(report.locales[0]?.staleManual).toEqual(["|/greeting"]);
    expect((await json("messages/es.json")).greeting).toBe("Hola {name}");
    expect((await json("messages/fr.json")).greeting).toBe("[fr] Hi {name}");
  });

  it("prunes removed keys from catalogs and lockfile", async () => {
    await firstRun();
    await put("messages/en.json", { greeting: source.greeting, count: 3 });
    const report = await translate({ config: config(), client: fakeClient() });

    expect(await json("messages/es.json")).toEqual({ greeting: "[es] Hello {name}", count: 3 });
    expect(await json("messages/fr.json")).toEqual({ greeting: "[fr] Hello {name}", count: 3 });
    expect((await json("lingua.lock.json")).entries["|/nav/home"]).toBeUndefined();
    expect(report.locales[0]).toMatchObject({ pruned: ["|/nav/home"], prunedManual: [] });
  });

  it("keeps unused keys at the end with keepUnused", async () => {
    await firstRun();
    await put("messages/en.json", { greeting: source.greeting, count: 3 });
    await translate({ config: config(), client: fakeClient(), keepUnused: true });

    expect(await text("messages/es.json")).toBe(
      `${JSON.stringify({ greeting: "[es] Hello {name}", count: 3, nav: { home: "[es] Home" } }, null, 2)}\n`,
    );
    expect((await json("lingua.lock.json")).entries["|/nav/home"]).toBeDefined();
  });

  it("dry run calls nothing and writes nothing", async () => {
    await put("messages/en.json", source);
    const client = fakeClient();
    const report = await translate({ config: config(), client, dryRun: true });

    expect(client.languages).not.toHaveBeenCalled();
    expect(client.translateBatch).not.toHaveBeenCalled();
    expect(report.characters).toBe(("Hello LNG0".length + "Home".length) * 2);
    expect(report.locales.map(({ translated }) => translated)).toEqual([2, 2]);
    expect(await exists("messages/es.json")).toBe(false);
    expect(await exists("lingua.lock.json")).toBe(false);
  });

  it("force retranslates machine keys only", async () => {
    await firstRun();
    await put("messages/es.json", {
      greeting: "Hola {name}",
      nav: { home: "[es] Home" },
      count: 3,
    });
    const client = fakeClient();
    await translate({ config: config(), client, force: true });

    expect(textsSent(client)).toEqual([
      ["es", ["Home"]],
      ["fr", ["Hello LNG0", "Home"]],
    ]);
    expect((await json("messages/es.json")).greeting).toBe("Hola {name}");
  });

  it("rejects unsupported locales before translating", async () => {
    await put("messages/en.json", source);
    const client = fakeClient(["en", "es"]);
    await expect(translate({ config: config(), client })).rejects.toMatchObject({
      code: "config",
      message: expect.stringContaining("fr"),
    });
    expect(client.translateBatch).not.toHaveBeenCalled();
  });

  it("requires an API key unless dry run", async () => {
    await put("messages/en.json", source);
    await expect(translate({ config: config({}, {}) })).rejects.toMatchObject({
      code: "auth",
      message: expect.stringContaining("LINGUA_API_KEY"),
    });
    await expect(translate({ config: config({}, {}), dryRun: true })).resolves.toBeDefined();
  });

  it("persists completed batches before rethrowing a failure", async () => {
    const keys = Array.from({ length: 150 }, (_, i) => [`k${i}`, `Text ${i}`] as const);
    await put("messages/en.json", Object.fromEntries(keys));
    const client = fakeClient();
    const ok = client.translateBatch.getMockImplementation();
    client.translateBatch
      .mockImplementationOnce(ok as NonNullable<typeof ok>)
      .mockRejectedValueOnce(
        new LinguaApiError({ status: 402, code: "quota_exceeded", message: "x" }),
      );

    await expect(translate({ config: config(), client })).rejects.toMatchObject({
      code: "quota_exceeded",
    });
    const es = await json("messages/es.json");
    expect(Object.keys(es)).toHaveLength(100);
    expect(es.k99).toBe("[es] Text 99");
    expect(es.k100).toBeUndefined();
    const lock = await json("lingua.lock.json");
    expect(Object.keys(lock.entries)).toHaveLength(100);
    expect(lock.entries["|/k0"].targets.es.text).toBe("[es] Text 0");
  });

  it("runs a second round for driver fallbacks", async () => {
    fake.driver = {
      name: "icu",
      planTargets: (entries) =>
        entries.map(({ path, value }) => ({ path, sourcePath: path, source: value })),
      prepare: (message) => ({
        segments: [message],
        restore: ([translated]) => ({
          text: translated ?? "",
          needsReview: true,
          fallback: {
            segments: [`frag ${message}`],
            restore: ([fragment]) => ({ text: `fb:${fragment}`, needsReview: true }),
          },
        }),
      }),
    };
    await put("messages/en.json", { a: "Hello" });
    const client = fakeClient();
    const report = await translate({ config: config(), client, locales: ["es"] });

    expect(textsSent(client)).toEqual([
      ["es", ["Hello"]],
      ["es", ["frag Hello"]],
    ]);
    expect(await json("messages/es.json")).toEqual({ a: "fb:[es] frag Hello" });
    expect((await json("lingua.lock.json")).entries["|/a"].targets.es).toMatchObject({
      text: "fb:[es] frag Hello",
      needsReview: true,
    });
    expect(report.locales[0]?.needsReview).toEqual(["|/a"]);
  });

  it("writes every namespace for {ns} patterns", async () => {
    await put("locales/en/common.json", { hi: "Hi" });
    await put("locales/en/auth.json", { login: "Log in" });
    await translate({
      config: config({ catalog: { pattern: "locales/{locale}/{ns}.json" } }),
      client: fakeClient(),
    });

    expect(await json("locales/es/common.json")).toEqual({ hi: "[es] Hi" });
    expect(await json("locales/fr/auth.json")).toEqual({ login: "[fr] Log in" });
    expect(Object.keys((await json("lingua.lock.json")).entries)).toEqual([
      "auth|/login",
      "common|/hi",
    ]);
  });

  it("does not send token-only segments", async () => {
    await put("messages/en.json", { only: "{name}", hi: "Hi" });
    const client = fakeClient();
    await translate({ config: config(), client, locales: ["es"] });

    expect(textsSent(client)).toEqual([["es", ["Hi"]]]);
    expect(await json("messages/es.json")).toEqual({ only: "{name}", hi: "[es] Hi" });
  });

  it("reports progress and the included quota", async () => {
    await put("messages/en.json", source);
    const events: ProgressEvent[] = [];
    const report = await translate({
      config: config(),
      client: fakeClient(),
      onProgress: (event) => events.push(event),
    });

    expect(events.map(({ type }) => type)).toEqual([
      "locale-start",
      "batch",
      "locale-done",
      "locale-start",
      "batch",
      "locale-done",
    ]);
    expect(events[0]).toEqual({
      type: "locale-start",
      locale: "es",
      toTranslate: 2,
      characters: 14,
    });
    expect(report.includedRemaining).toBe(1000);
  });
});
