import { type FSWatcher, watch } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  createClientFromConfig,
  extract,
  loadConfig,
  resolveCatalogFiles,
  translate,
} from "@lingua-api/core";
import { UsageError } from "../errors";
import {
  type Context,
  c,
  formatExtract,
  formatReport,
  formatWarnings,
  log,
  logErr,
  printError,
  progress,
} from "../output";

export interface WatchOptions {
  /** Default true; false = extract only. */
  translate?: boolean;
  /** Milliseconds, default 300. */
  debounce?: number;
}

const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx|vue)$/;
const IGNORED = /(?:^|\/)(?:node_modules|\.git|dist|\.next)\//;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Directory part of a glob before its first wildcard segment: "src/**/*.ts" → "src/".
function globPrefix(glob: string): string {
  const parts = glob.replace(/^\.\//, "").split("/");
  const wild = parts.findIndex((part) => /[*?{[]/.test(part));
  if (wild === -1) return parts.join("/");
  return wild === 0 ? "" : `${parts.slice(0, wild).join("/")}/`;
}

export async function runWatch(ctx: Context, options: WatchOptions = {}): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const wantsTranslate = options.translate !== false;
  if (!config.wrapperMode) {
    if (!wantsTranslate) {
      throw new UsageError("Nothing to watch: --no-translate needs `include` (wrapper mode).");
    }
    createClientFromConfig(config); // Throws the missing-key error: without it there is nothing to do.
  }
  const client = wantsTranslate && config.apiKey ? createClientFromConfig(config) : undefined;
  if (wantsTranslate && !client) {
    logErr(
      ctx,
      c.yellow(`! ${config.apiKeyEnv} is not set — extracting only, nothing will be translated.`),
    );
  }

  // libuv aborts on Windows 8.3 short paths (C:\Users\BIGG~1\…); watch the long form.
  const root = await realpath(config.root);
  const rel = (file: string) => relative(root, file).replaceAll("\\", "/");
  const sourcePattern = new RegExp(
    `^${escapeRegExp(
      config.pattern.replace(/^\.\//, "").replaceAll("{locale}", config.sourceLocale),
    ).replaceAll("\\{ns\\}", "[^/]+")}$`,
  );
  const prefixes = config.include.map(globPrefix);
  // Target catalogs never match: they are neither the source pattern nor scripts.
  const isWatched = (path: string) =>
    !path.startsWith("..") &&
    !IGNORED.test(path) &&
    (sourcePattern.test(path) ||
      (config.wrapperMode && SCRIPT.test(path) && prefixes.some((p) => path.startsWith(p))));

  // Source catalogs as of the last run, so our own `extract` writes don't retrigger a run.
  const snapshot = new Map<string, string>();
  const read = (file: string) => readFile(file, "utf8").catch(() => "");
  const takeSnapshot = async () => {
    const files = await resolveCatalogFiles(config.pattern, config.sourceLocale, root);
    await Promise.all(files.map(async ({ file }) => snapshot.set(file, await read(file))));
  };
  const changed = async (file: string) =>
    !sourcePattern.test(rel(file)) || (await read(file)) !== snapshot.get(file);

  const run = async () => {
    try {
      if (config.wrapperMode) {
        const extracted = await extract(config);
        log(ctx, ...formatExtract(extracted, config.root));
        if (extracted.warnings.length > 0) logErr(ctx, ...formatWarnings(extracted));
      }
      if (client) {
        log(ctx, ...formatReport(await translate({ config, client, onProgress: progress(ctx) })));
      }
    } catch (error) {
      printError(ctx, error, config.apiKeyEnv);
    } finally {
      await takeSnapshot();
    }
  };

  const pending = new Set<string>();
  let busy = false;
  let stopped = false;
  let current = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  // Changes that arrive during a run stay pending and get one more pass.
  const cycle = async () => {
    busy = true;
    while (pending.size > 0 && !stopped) {
      const files = [...pending];
      pending.clear();
      if ((await Promise.all(files.map(changed))).some(Boolean)) {
        log(ctx, c.dim(`↻ ${files.map(rel).join(", ")}`));
        await run();
      }
    }
    busy = false;
  };

  await takeSnapshot();
  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const file = resolve(root, filename);
      if (!isWatched(rel(file))) return;
      pending.add(file);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!busy) current = cycle();
      }, options.debounce ?? 300);
    });
  } catch (error) {
    logErr(ctx, c.red(`✗ Recursive file watching is not available: ${(error as Error).message}`));
    return 2;
  }

  log(ctx, `watching ${root} …`, c.dim("Press Ctrl-C to stop."));
  return new Promise((resolveExit) => {
    // Lets the in-flight run finish writing; a second Ctrl-C kills the process.
    const stop = (code: number) => {
      process.off("SIGINT", onSigint);
      clearTimeout(timer);
      watcher.close();
      stopped = true;
      void current.then(() => resolveExit(code));
    };
    const onSigint = () => stop(0);
    process.once("SIGINT", onSigint);
    watcher.on("error", (error) => stop(printError(ctx, error)));
  });
}
