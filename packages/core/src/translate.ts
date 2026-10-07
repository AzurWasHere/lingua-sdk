import { createClient, type LinguaClient, packBatches } from "@lingua-api/client";
import { buildCatalogObject, type Catalog, type CatalogEntry, writeCatalog } from "./catalog/io";
import type { ResolvedConfig } from "./config";
import { LinguaError } from "./errors";
import { getDriver } from "./formats/index";
import type { FormatDriver, PreparedMessage } from "./formats/types";
import {
  loadSourceCatalogs,
  loadTargetCatalogs,
  selectLocales,
  sourceMissingMessage,
  stringEntries,
} from "./load";
import { entryKey, type Lockfile, type LockTarget, readLockfile, writeLockfile } from "./lockfile";
import { type PlannedKey, planLocale } from "./plan";

export type ProgressEvent =
  | { type: "locale-start"; locale: string; toTranslate: number; characters: number }
  | {
      type: "batch";
      locale: string;
      items: number;
      characters: number;
      includedRemaining: number | null;
    }
  | { type: "locale-done"; locale: string; report: LocaleReport }
  | { type: "warning"; message: string };

export interface TranslateOptions {
  config: ResolvedConfig;
  client?: LinguaClient;
  locales?: string[];
  dryRun?: boolean;
  force?: boolean;
  keepUnused?: boolean;
  onProgress?: (event: ProgressEvent) => void;
}

export interface LocaleReport {
  locale: string;
  translated: number;
  reused: number;
  /** Kept human translations, stale ones included. */
  manual: number;
  staleManual: string[];
  needsReview: string[];
  pruned: string[];
  prunedManual: string[];
  characters: number;
  requests: number;
}

export interface TranslateReport {
  dryRun: boolean;
  locales: LocaleReport[];
  characters: number;
  requests: number;
  includedRemaining: number | null;
  warnings: string[];
}

interface Context {
  config: ResolvedConfig;
  driver: FormatDriver;
  lock: Lockfile;
  sources: Map<string, Catalog>;
  /** Entry keys expected for at least one configured locale. */
  live: Set<string>;
  client: LinguaClient | undefined;
  force: boolean;
  keepUnused: boolean;
  emit: (event: ProgressEvent) => void;
  onIncludedRemaining: (value: number | null) => void;
}

interface Work {
  key: PlannedKey;
  prepared: PreparedMessage;
  /** Starts as the segments themselves, so identity segments are already final. */
  translated: string[];
  remaining: number;
  fallback: boolean;
}

interface Segment {
  work: Work;
  index: number;
  text: string;
}

const TOKENS_ONLY = /^\s*(?:lng\s?\d+\s*)+$/i;
const isIdentity = (text: string) => text.trim() === "" || TOKENS_ONLY.test(text);
const baseCode = (code: string) => code.toLowerCase().replace(/-.*/, "");
const keyOf = (key: { namespace: string; path: PlannedKey["path"] }) =>
  entryKey(key.namespace, key.path);

export function createClientFromConfig(config: ResolvedConfig): LinguaClient {
  if (!config.apiKey) {
    throw new LinguaError(
      `Missing API key: set the ${config.apiKeyEnv} environment variable (e.g. in .env.local).`,
      "auth",
    );
  }
  return createClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    concurrency: config.concurrency,
  });
}

function setLockTarget(lock: Lockfile, key: string, locale: string, target: LockTarget): void {
  const entry = lock.entries[key] ?? { targets: {} };
  entry.targets[locale] = target;
  lock.entries[key] = entry;
}

function deleteLockTarget(lock: Lockfile, key: string, locale: string): void {
  const entry = lock.entries[key];
  if (!entry) return;
  delete entry.targets[locale];
  if (Object.keys(entry.targets).length === 0 && !entry.extracted) delete lock.entries[key];
}

async function translateLocale(ctx: Context, locale: string): Promise<LocaleReport> {
  const { config, driver, lock, sources, client, keepUnused, emit } = ctx;
  const targets = await loadTargetCatalogs(config, locale, sources);
  const plan = planLocale({
    locale,
    sourceCatalogs: sources,
    targetCatalogs: targets,
    lock,
    driver,
    force: ctx.force,
  });
  const report: LocaleReport = {
    locale,
    translated: 0,
    reused: 0,
    manual: 0,
    staleManual: [],
    needsReview: [],
    pruned: [],
    prunedManual: [],
    characters: 0,
    requests: 0,
  };

  plan.keys.forEach((key) => {
    if (key.action === "reuse") report.reused++;
    if (key.action === "stale-manual") report.staleManual.push(keyOf(key));
    if (key.action === "manual" || key.action === "stale-manual") report.manual++;
    // Stale manual entries keep their old source so the staleness stays visible to `check`.
    if (key.action === "manual" && key.existing !== undefined) {
      const engine = lock.entries[keyOf(key)]?.targets[locale]?.engine;
      setLockTarget(lock, keyOf(key), locale, {
        source: key.source,
        text: key.existing,
        ...(engine ? { engine } : {}),
        manual: true,
      });
    }
  });
  if (!keepUnused) {
    plan.pruned.forEach((pruned) => {
      report.pruned.push(keyOf(pruned));
      if (pruned.manual) report.prunedManual.push(keyOf(pruned));
      deleteLockTarget(lock, keyOf(pruned), locale);
    });
    // Keys no longer expected for any locale (extract owns `extracted` entries).
    Object.keys(lock.entries)
      .filter((key) => !ctx.live.has(key))
      .forEach((key) => {
        deleteLockTarget(lock, key, locale);
      });
  }

  const makeWork = (key: PlannedKey, prepared: PreparedMessage, fallback: boolean): Work => ({
    key,
    prepared,
    translated: [...prepared.segments],
    remaining: prepared.segments.filter((segment) => !isIdentity(segment)).length,
    fallback,
  });
  const segmentsOf = (works: Work[]): Segment[] =>
    works.flatMap((work) =>
      work.prepared.segments.flatMap((text, index) =>
        isIdentity(text) ? [] : [{ work, index, text }],
      ),
    );

  const firstRound = plan.keys
    .filter((key) => key.action === "translate")
    .map((key) =>
      makeWork(
        key,
        driver.prepare(key.source, {
          sourceLocale: config.sourceLocale,
          targetLocale: locale,
          doNotTranslate: config.doNotTranslate,
          pluralCategory: key.pluralCategory,
          ordinal: key.ordinal,
        }),
        false,
      ),
    );
  const characters = segmentsOf(firstRound).reduce((sum, { text }) => sum + text.length, 0);
  emit({ type: "locale-start", locale, toTranslate: firstRound.length, characters });

  if (!client) {
    report.translated = firstRound.length;
    report.characters = characters;
    emit({ type: "locale-done", locale, report });
    return report;
  }

  const finals = new Map<PlannedKey, string>();
  const secondRound: Work[] = [];
  const complete = (work: Work, engine?: string): void => {
    const result = work.prepared.restore(work.translated);
    if (result.fallback && !work.fallback) {
      const next = makeWork(work.key, result.fallback, true);
      if (next.remaining === 0) complete(next, engine);
      else secondRound.push(next);
      return;
    }
    finals.set(work.key, result.text);
    report.translated++;
    if (result.needsReview) report.needsReview.push(keyOf(work.key));
    setLockTarget(lock, keyOf(work.key), locale, {
      source: work.key.source,
      text: result.text,
      ...(engine ? { engine } : {}),
      manual: false,
      ...(result.needsReview ? { needsReview: true } : {}),
    });
  };

  const bySource = plan.keys.reduce((map, key) => {
    const sourceKey = entryKey(key.namespace, key.sourcePath);
    map.set(sourceKey, [...(map.get(sourceKey) ?? []), key]);
    return map;
  }, new Map<string, PlannedKey[]>());
  const entriesFor = (namespace: string, source: Catalog): CatalogEntry[] => [
    ...source.entries.flatMap((entry): CatalogEntry[] =>
      typeof entry.value !== "string"
        ? [entry]
        : (bySource.get(entryKey(namespace, entry.path)) ?? []).flatMap((key) => {
            const value = finals.get(key) ?? key.existing;
            return value === undefined ? [] : [{ path: key.path, value }];
          }),
    ),
    ...(keepUnused
      ? plan.pruned
          .filter((pruned) => pruned.namespace === namespace)
          .map(({ path, text }) => ({ path, value: text }))
      : []),
  ];
  const write = async () => {
    await Promise.all(
      [...sources].map(async ([namespace, source]) => {
        const target = targets.get(namespace);
        const entries = entriesFor(namespace, source);
        if (!target || (entries.length === 0 && !target.exists)) return;
        const style = target.exists ? target : source;
        await writeCatalog(target.file, buildCatalogObject(entries, source.shape, source), style);
      }),
    );
    await writeLockfile(config.lockfile, lock);
  };
  // Serialized so concurrent batches never interleave writes; a failed write doesn't block later ones.
  let chain: Promise<void> = Promise.resolve();
  const persist = () => {
    const next = chain.then(write);
    chain = next.catch(() => {});
    return next;
  };

  const run = async (works: Work[]) => {
    works
      .filter((work) => work.remaining === 0)
      .forEach((work) => {
        complete(work);
      });
    const batches = packBatches(segmentsOf(works), ({ text }) => text);
    const settled = await Promise.allSettled(
      batches.map(async (batch) => {
        const result = await client.translateBatch({
          texts: batch.map(({ text }) => text),
          target: locale,
          source: config.sourceLocale,
          engine: config.engine,
        });
        if (result.translations.length !== batch.length) {
          throw new LinguaError(
            `The API returned ${result.translations.length} translations for ${batch.length} texts.`,
            "api",
          );
        }
        batch.forEach(({ work, index, text }, i) => {
          work.translated[index] = result.translations[i]?.text ?? text;
          work.remaining--;
          if (work.remaining === 0) complete(work, result.engine);
        });
        report.characters += result.characters;
        report.requests++;
        ctx.onIncludedRemaining(result.rateLimit.includedRemaining);
        emit({
          type: "batch",
          locale,
          items: batch.length,
          characters: result.characters,
          includedRemaining: result.rateLimit.includedRemaining,
        });
        await persist();
      }),
    );
    const failure = settled.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    if (failure) {
      await persist();
      throw failure.reason;
    }
  };

  await run(firstRound);
  await run(secondRound);
  await persist();
  emit({ type: "locale-done", locale, report });
  return report;
}

export async function translate(options: TranslateOptions): Promise<TranslateReport> {
  const { config, dryRun = false, onProgress } = options;
  const locales = selectLocales(config, options.locales);
  const sources = await loadSourceCatalogs(config);
  if (sources.size === 0) throw new LinguaError(sourceMissingMessage(config), "catalog");
  const lock = await readLockfile(config.lockfile);
  const driver = getDriver(config.format);

  let client: LinguaClient | undefined;
  if (!dryRun) {
    client = options.client ?? createClientFromConfig(config);
    const supported = new Set((await client.languages()).map(({ code }) => baseCode(code)));
    const unsupported = [config.sourceLocale, ...locales].filter(
      (code) => !supported.has(baseCode(code)),
    );
    if (unsupported.length > 0) {
      throw new LinguaError(
        `Locale(s) not supported by the Lingua API: ${unsupported.join(", ")}.`,
        "config",
      );
    }
  }

  let includedRemaining: number | null = null;
  const ctx: Context = {
    config,
    driver,
    lock,
    sources,
    live: new Set(
      [...sources].flatMap(([namespace, source]) =>
        config.targetLocales.flatMap((locale) =>
          driver
            .planTargets(stringEntries(source), locale)
            .map(({ path }) => entryKey(namespace, path)),
        ),
      ),
    ),
    client,
    force: options.force ?? false,
    keepUnused: options.keepUnused ?? false,
    emit: (event) => onProgress?.(event),
    onIncludedRemaining: (value) => {
      if (value !== null) includedRemaining = Math.min(value, includedRemaining ?? value);
    },
  };
  const reports: LocaleReport[] = [];
  for (const locale of locales) reports.push(await translateLocale(ctx, locale));

  const warnings: string[] = [];
  if (client?.batchSupported === false) {
    warnings.push(
      "The batch endpoint is unavailable; texts were translated one request at a time.",
    );
  }
  warnings.forEach((message) => {
    ctx.emit({ type: "warning", message });
  });

  return {
    dryRun,
    locales: reports,
    characters: reports.reduce((sum, report) => sum + report.characters, 0),
    requests: reports.reduce((sum, report) => sum + report.requests, 0),
    includedRemaining,
    warnings,
  };
}
