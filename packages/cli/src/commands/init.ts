import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CONFIG_FILENAMES,
  detectRuntime,
  PRESETS,
  type RuntimeName,
  resolveConfig,
} from "@lingua-api/core";
import { UsageError } from "../errors";
import { type Context, c, log } from "../output";

export interface InitOptions {
  runtime?: string;
  source?: string;
  targets?: string[];
  pattern?: string;
  force?: boolean;
}

const RUNTIMES = Object.keys(PRESETS).join(", ");

const readJson = (file: string) =>
  readFile(file, "utf8").then(
    (text) => JSON.parse(text),
    () => ({}),
  );

// `.env*` style lines count; negations and comments don't.
const ignores = (gitignore: string, name: string) =>
  gitignore
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\//, ""))
    .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("!"))
    .some((line) =>
      new RegExp(
        `^${line
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replaceAll("*", ".*")
          .replaceAll("?", ".")}$`,
      ).test(name),
    );

export async function init(ctx: Context, options: InitOptions = {}): Promise<number> {
  if (options.runtime !== undefined && !Object.hasOwn(PRESETS, options.runtime)) {
    throw new UsageError(`Unknown runtime "${options.runtime}". Supported: ${RUNTIMES}.`);
  }
  const runtime =
    (options.runtime as RuntimeName | undefined) ??
    detectRuntime(await readJson(join(ctx.cwd, "package.json")));
  if (!runtime) {
    throw new UsageError(
      `Could not detect the i18n runtime from package.json. Pass --runtime <name> (one of: ${RUNTIMES}).`,
    );
  }

  const existing = CONFIG_FILENAMES.find((name) => existsSync(join(ctx.cwd, name)));
  if (existing && !options.force) {
    throw new UsageError(`${existing} already exists. Use --force to overwrite it.`);
  }

  const preset = PRESETS[runtime];
  const sourceLocale = options.source ?? "en";
  const targetLocales = options.targets ?? ["es", "fr", "de"];
  // Same validation as loading the config later, so a bad flag fails now.
  resolveConfig(
    {
      runtime,
      sourceLocale,
      targetLocales,
      ...(options.pattern ? { catalog: { pattern: options.pattern } } : {}),
    },
    ctx.cwd,
    {},
  );
  const q = (value: string) => JSON.stringify(value);
  const catalogLine = `catalog: { pattern: ${q(options.pattern ?? preset.pattern)} },`;
  await writeFile(
    join(ctx.cwd, "lingua.config.ts"),
    [
      'import { defineConfig } from "@lingua-api/cli";',
      "",
      "export default defineConfig({",
      `  runtime: ${q(runtime)},`,
      `  sourceLocale: ${q(sourceLocale)},`,
      `  targetLocales: [${targetLocales.map(q).join(", ")}],`,
      options.pattern ? `  ${catalogLine}` : `  // ${catalogLine}`,
      '  // engine: "deepl",',
      `  // include: [${preset.include.map(q).join(", ")}],  // uncomment to enable inline messages + \`lingua extract\``,
      "});",
      "",
    ].join("\n"),
  );

  const gitignore = await readFile(join(ctx.cwd, ".gitignore"), "utf8").catch(() => undefined);
  log(
    ctx,
    `${c.green("✓")} Created lingua.config.ts (runtime: ${runtime}, catalogs: ${options.pattern ?? preset.pattern})`,
    "",
    "Next steps:",
    "  1. Put your API key in .env.local (and keep .env.local in .gitignore):",
    c.cyan("       LINGUA_API_KEY=lk_live_…"),
    `  2. Optional, inline messages: install @lingua-api/${runtime} and uncomment \`include\`.`,
    `  3. Run ${c.cyan("lingua translate")}`,
    ...(gitignore !== undefined && !ignores(gitignore, ".env.local")
      ? [
          "",
          c.yellow(
            "! .gitignore does not cover .env.local — add it so the API key is never committed.",
          ),
        ]
      : []),
  );
  return 0;
}
