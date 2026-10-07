import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";
import { ConfigError } from "./errors";
import { type FormatName, PRESETS, type RuntimeName } from "./presets";

export interface LinguaConfig {
  runtime: RuntimeName;
  sourceLocale: string;
  targetLocales: string[];
  engine?: "libre" | "deepl";
  catalog?: { pattern?: string };
  api?: { keyEnv?: string; baseUrl?: string };
  doNotTranslate?: string[];
  concurrency?: number;
  lockfile?: string;
  include?: string[];
  exclude?: string[];
  functionNames?: string[];
  componentNames?: string[];
  extract?: { namespace?: string };
}

export interface ResolvedConfig {
  /** Absolute directory containing the config (or cwd). */
  root: string;
  configFile: string | null;
  runtime: RuntimeName;
  format: FormatName;
  /** Forward slashes, relative to root. */
  pattern: string;
  sourceLocale: string;
  targetLocales: string[];
  engine?: "libre" | "deepl";
  apiKeyEnv: string;
  apiKey: string | undefined;
  baseUrl: string;
  doNotTranslate: string[];
  concurrency: number;
  /** Absolute path. */
  lockfile: string;
  wrapperMode: boolean;
  include: string[];
  exclude: string[];
  functionNames: string[];
  componentNames: string[];
  extractNamespace: string;
}

export const CONFIG_FILENAMES = [
  "lingua.config.ts",
  "lingua.config.mts",
  "lingua.config.js",
  "lingua.config.mjs",
  "lingua.config.json",
];

const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.next/**",
  "**/*.test.*",
  "**/*.spec.*",
];

export function defineConfig(config: LinguaConfig): LinguaConfig {
  return config;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, name: string, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item !== "")) {
    throw new ConfigError(`\`${name}\` must be an array of non-empty strings.`);
  }
  return value;
}

export function resolveConfig(
  raw: unknown,
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  if (!isObject(raw)) {
    throw new ConfigError(
      "The config must export an object (use `export default defineConfig({...})`).",
    );
  }
  if (JSON.stringify(raw).includes("lk_live_")) {
    throw new ConfigError(
      "API keys must come from the environment (api.keyEnv), never from the config file.",
    );
  }
  const config = raw as Partial<LinguaConfig>;

  const runtime = config.runtime;
  if (typeof runtime !== "string" || !Object.hasOwn(PRESETS, runtime)) {
    throw new ConfigError(
      `\`runtime\` must be one of ${Object.keys(PRESETS).join(", ")} (got ${JSON.stringify(runtime)}).`,
    );
  }
  const preset = PRESETS[runtime];

  const sourceLocale = config.sourceLocale;
  if (typeof sourceLocale !== "string" || sourceLocale.trim() === "") {
    throw new ConfigError('`sourceLocale` must be a non-empty string, e.g. "en".');
  }

  const targetLocales = [...new Set(stringArray(config.targetLocales, "targetLocales", []))];
  if (targetLocales.length === 0) {
    throw new ConfigError('`targetLocales` must list at least one locale, e.g. ["es", "fr"].');
  }
  if (targetLocales.includes(sourceLocale)) {
    throw new ConfigError(
      `\`targetLocales\` must not contain the source locale "${sourceLocale}".`,
    );
  }

  if (config.engine !== undefined && config.engine !== "libre" && config.engine !== "deepl") {
    throw new ConfigError('`engine` must be "libre" or "deepl" (or omitted to let the API pick).');
  }

  const pattern = config.catalog?.pattern ?? preset.pattern;
  if (typeof pattern !== "string" || !pattern.includes("{locale}")) {
    throw new ConfigError(
      `\`catalog.pattern\` must contain "{locale}", e.g. "${preset.pattern}" (got ${JSON.stringify(pattern)}).`,
    );
  }

  const concurrency = config.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new ConfigError("`concurrency` must be a positive integer.");
  }

  const apiKeyEnv = config.api?.keyEnv ?? "LINGUA_API_KEY";
  const include = stringArray(config.include, "include", []);

  return {
    root,
    configFile: null,
    runtime,
    format: preset.format,
    pattern: pattern.replaceAll("\\", "/"),
    sourceLocale,
    targetLocales,
    engine: config.engine,
    apiKeyEnv,
    apiKey: env[apiKeyEnv]?.trim() || undefined,
    baseUrl: (config.api?.baseUrl ?? "https://api.lingua-api.com").replace(/\/+$/, ""),
    doNotTranslate: stringArray(config.doNotTranslate, "doNotTranslate", []),
    concurrency,
    lockfile: resolve(root, config.lockfile ?? "lingua.lock.json"),
    wrapperMode: include.length > 0,
    include,
    exclude: [...new Set([...DEFAULT_EXCLUDE, ...stringArray(config.exclude, "exclude", [])])],
    functionNames: stringArray(config.functionNames, "functionNames", ["t"]),
    componentNames: stringArray(config.componentNames, "componentNames", ["T"]),
    extractNamespace: config.extract?.namespace ?? preset.defaultNamespace,
  };
}

function loadEnvFile(file: string): void {
  try {
    process.loadEnvFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function loadConfig(cwd: string = process.cwd()): Promise<ResolvedConfig> {
  const root = resolve(cwd);
  const configFile = CONFIG_FILENAMES.map((name) => join(root, name)).find((file) =>
    existsSync(file),
  );
  if (!configFile) {
    throw new ConfigError(`No lingua.config.* found in ${root}. Run \`lingua init\`.`);
  }

  // Node never overrides existing variables, so the first file loaded wins.
  loadEnvFile(join(root, ".env.local"));
  loadEnvFile(join(root, ".env"));

  let raw: unknown;
  try {
    if (configFile.endsWith(".json")) {
      raw = JSON.parse(await readFile(configFile, "utf8"));
    } else {
      const jiti = createJiti(import.meta.url, { interopDefault: true });
      raw = await jiti.import(configFile, { default: true });
    }
  } catch (error) {
    throw new ConfigError(`Failed to load ${configFile}: ${(error as Error).message}`, error);
  }

  return { ...resolveConfig(raw, root, process.env), configFile };
}
