import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { buildCatalogObject, catalogPath, readCatalog, writeCatalog } from "../catalog/io";
import type { CheckIssue } from "../check";
import type { ResolvedConfig } from "../config";
import { LinguaError } from "../errors";
import { entryKey, readLockfile, writeLockfile } from "../lockfile";
import { compareLocations, extractFromSource, mergeMessages } from "./js";
import type { ExtractedMessage, ExtractResult, ExtractWarning } from "./types";
import { extractFromVue } from "./vue";

export interface ExtractWriteReport {
  /** Absolute path of the source catalog. */
  file: string;
  namespace: string;
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: number;
}

export interface ExtractReport extends ExtractWriteReport {
  messages: number;
  warnings: ExtractWarning[];
  files: number;
}

const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/;

export async function extractMessages(config: ResolvedConfig): Promise<ExtractResult> {
  if (!config.wrapperMode) {
    throw new LinguaError("Set `include` in lingua.config to enable extraction", "config");
  }
  const files = (
    await glob(config.include, {
      cwd: config.root,
      ignore: config.exclude,
      absolute: false,
      onlyFiles: true,
      dot: false,
    })
  ).sort();
  const options = { functionNames: config.functionNames, componentNames: config.componentNames };
  const results = await Promise.all(
    files.map(async (file) => {
      const vue = file.endsWith(".vue");
      if (!vue && !SCRIPT.test(file)) return undefined;
      const code = await readFile(join(config.root, file), "utf8");
      if (!code.includes("@lingua-api/")) return undefined;
      return vue ? extractFromVue(code, file, options) : extractFromSource(code, file, options);
    }),
  );

  const merged = mergeMessages(results.flatMap((result) => result?.messages ?? []));
  const pluralSupported = config.format === "i18next";
  const warnings = [
    ...results.flatMap((result) => result?.warnings ?? []),
    ...merged
      .filter((message) => message.plural && !pluralSupported)
      .flatMap(({ locations: [location] }) =>
        location
          ? [{ ...location, message: "The plural object form is only supported with i18next" }]
          : [],
      ),
  ].sort(compareLocations);
  return {
    messages: merged.filter((message) => !message.plural || pluralSupported),
    warnings,
    files,
  };
}

function catalogKeys(message: ExtractedMessage, config: ResolvedConfig): [string, string][] {
  if (!message.plural) return [[message.id, message.message]];
  if (config.format !== "i18next") return [];
  return Object.entries(message.plural).map(([category, text]) => [
    `${message.id}_${category}`,
    text,
  ]);
}

export async function writeExtracted(
  config: ResolvedConfig,
  result: ExtractResult,
  options: { dryRun?: boolean } = {},
): Promise<ExtractWriteReport> {
  const namespace = config.pattern.includes("{ns}") ? config.extractNamespace : "";
  const file = catalogPath(config.pattern, config.sourceLocale, namespace, config.root);
  const [catalog, lock] = await Promise.all([readCatalog(file), readLockfile(config.lockfile)]);
  const formatjs = catalog.exists ? catalog.shape === "formatjs" : config.runtime === "react-intl";

  const produced = new Map(
    result.messages.flatMap((message) =>
      catalogKeys(message, config).map(([key, text]) => [key, { text, message }] as const),
    ),
  );
  const previousObject = (key: string) => {
    const value = Object.hasOwn(catalog.raw, key) ? catalog.raw[key] : undefined;
    return typeof value === "object" && value !== null ? value : {};
  };
  const catalogValue = (
    key: string,
    { text, message }: { text: string; message: ExtractedMessage },
  ) =>
    formatjs
      ? {
          ...previousObject(key),
          defaultMessage: text,
          description: message.context ?? message.comment,
        }
      : text;

  const report: ExtractWriteReport = {
    file,
    namespace,
    added: [],
    updated: [],
    removed: [],
    unchanged: 0,
  };
  const kept = catalog.entries.flatMap((entry) => {
    const key = String(entry.path[0]);
    const next = entry.path.length === 1 ? produced.get(key) : undefined;
    if (next) {
      if (entry.value === next.text) report.unchanged++;
      else report.updated.push(key);
      return [{ path: entry.path, value: catalogValue(key, next) }];
    }
    if (entry.path.length === 1 && lock.entries[entryKey(namespace, entry.path)]?.extracted) {
      report.removed.push(key);
      return [];
    }
    // formatjs entries carry only defaultMessage; keep the whole object.
    return [{ path: entry.path, value: formatjs ? catalog.raw[key] : entry.value }];
  });
  const existing = new Set(
    catalog.entries.filter(({ path }) => path.length === 1).map(({ path }) => String(path[0])),
  );
  const added = [...produced].filter(([key]) => !existing.has(key));
  report.added = added.map(([key]) => key);
  const entries = [
    ...kept,
    ...added.map(([key, next]) => ({ path: [key], value: catalogValue(key, next) })),
  ];

  produced.forEach((_, key) => {
    const lockKey = entryKey(namespace, [key]);
    lock.entries[lockKey] = { ...(lock.entries[lockKey] ?? { targets: {} }), extracted: true };
  });
  report.removed.forEach((key) => {
    delete lock.entries[entryKey(namespace, [key])];
  });

  if (!options.dryRun) {
    // Values are final (formatjs objects included), so build them as plain nested data.
    await writeCatalog(file, buildCatalogObject(entries, "nested"), catalog);
    await writeLockfile(config.lockfile, lock);
  }
  return report;
}

export async function extract(
  config: ResolvedConfig,
  options: { dryRun?: boolean } = {},
): Promise<ExtractReport> {
  const result = await extractMessages(config);
  const report = await writeExtracted(config, result, options);
  return {
    ...report,
    messages: result.messages.length,
    warnings: result.warnings,
    files: result.files.length,
  };
}

/** Offline: differences between the code and the source catalog, as `source-stale` issues. */
export async function checkExtraction(config: ResolvedConfig): Promise<CheckIssue[]> {
  const report = await writeExtracted(config, await extractMessages(config), { dryRun: true });
  const issues = (keys: string[], detail: string) =>
    keys.map(
      (key): CheckIssue => ({
        kind: "source-stale",
        key: entryKey(report.namespace, [key]),
        detail,
      }),
    );
  return [
    ...issues(report.added, "not in source catalog — run lingua extract"),
    ...issues(report.updated, "outdated in source catalog"),
    ...issues(report.removed, "no longer used"),
  ];
}
