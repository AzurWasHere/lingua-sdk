import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig, PRESETS, type RuntimeName, resolveConfig } from "../src/index";

const base = { runtime: "next-intl", sourceLocale: "en", targetLocales: ["es", "fr", "es"] };
const root = resolve("/project");

describe("resolveConfig", () => {
  it.each(Object.keys(PRESETS) as RuntimeName[])("resolves defaults for %s", (runtime) => {
    const config = resolveConfig({ ...base, runtime }, root, {});
    const preset = PRESETS[runtime];
    expect(config).toMatchObject({
      root,
      configFile: null,
      runtime,
      format: preset.format,
      pattern: preset.pattern,
      targetLocales: ["es", "fr"],
      apiKeyEnv: "LINGUA_API_KEY",
      apiKey: undefined,
      baseUrl: "https://api.lingua-api.com",
      doNotTranslate: [],
      concurrency: 4,
      lockfile: join(root, "lingua.lock.json"),
      wrapperMode: false,
      include: [],
      functionNames: ["t"],
      componentNames: ["T"],
      extractNamespace: preset.defaultNamespace,
    });
    expect(config.exclude).toContain("**/node_modules/**");
  });

  it("applies overrides", () => {
    const config = resolveConfig(
      {
        ...base,
        engine: "deepl",
        catalog: { pattern: "i18n\\{locale}.json" },
        api: { keyEnv: "MY_KEY", baseUrl: "http://localhost:3000/" },
        include: ["src/**/*.tsx"],
        exclude: ["**/legacy/**"],
        concurrency: 2,
      },
      root,
      { MY_KEY: "  secret  " },
    );
    expect(config).toMatchObject({
      engine: "deepl",
      pattern: "i18n/{locale}.json",
      apiKey: "secret",
      baseUrl: "http://localhost:3000",
      wrapperMode: true,
      include: ["src/**/*.tsx"],
      concurrency: 2,
    });
    expect(config.exclude).toEqual(expect.arrayContaining(["**/dist/**", "**/legacy/**"]));
  });

  it.each([
    ["missing runtime", { sourceLocale: "en", targetLocales: ["es"] }, /runtime/],
    ["source in targets", { ...base, targetLocales: ["en", "es"] }, /source locale/],
    ["pattern without {locale}", { ...base, catalog: { pattern: "messages.json" } }, /\{locale\}/],
    ["bad engine", { ...base, engine: "google" }, /engine/],
    ["literal API key", { ...base, api: { keyEnv: "lk_live_abc" } }, /environment/],
    ["empty targets", { ...base, targetLocales: [] }, /targetLocales/],
    ["bad concurrency", { ...base, concurrency: 0 }, /concurrency/],
    ["non-object", "nope", /object/],
  ])("rejects %s", (_name, raw, message) => {
    expect(() => resolveConfig(raw, root, {})).toThrow(ConfigError);
    expect(() => resolveConfig(raw, root, {})).toThrow(message);
  });
});

describe("loadConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lingua-config-"));
  });
  afterEach(async () => {
    delete process.env.LINGUA_TEST_KEY;
    delete process.env.LINGUA_TEST_ONLY_ENV;
    await rm(dir, { recursive: true, force: true });
  });

  it("loads lingua.config.ts", async () => {
    await writeFile(
      join(dir, "lingua.config.ts"),
      `const config: { runtime: string; sourceLocale: string; targetLocales: string[] } = ${JSON.stringify(base)};\nexport default config;\n`,
    );
    const config = await loadConfig(dir);
    expect(config.configFile).toBe(join(dir, "lingua.config.ts"));
    expect(config.root).toBe(resolve(dir));
    expect(config.targetLocales).toEqual(["es", "fr"]);
  });

  it("loads lingua.config.json", async () => {
    await writeFile(
      join(dir, "lingua.config.json"),
      JSON.stringify({ ...base, runtime: "i18next" }),
    );
    expect((await loadConfig(dir)).format).toBe("i18next");
  });

  it("fails without a config file", async () => {
    await expect(loadConfig(dir)).rejects.toThrow(/lingua init/);
  });

  it("lets .env.local win over .env", async () => {
    await writeFile(
      join(dir, "lingua.config.json"),
      JSON.stringify({ ...base, api: { keyEnv: "LINGUA_TEST_KEY" } }),
    );
    await writeFile(join(dir, ".env.local"), "LINGUA_TEST_KEY=from-local\n");
    await writeFile(join(dir, ".env"), "LINGUA_TEST_KEY=from-env\nLINGUA_TEST_ONLY_ENV=yes\n");
    const config = await loadConfig(dir);
    expect(process.env.LINGUA_TEST_KEY).toBe("from-local");
    expect(process.env.LINGUA_TEST_ONLY_ENV).toBe("yes");
    expect(config.apiKey).toBe("from-local");
  });
});
