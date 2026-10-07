import { type Catalog, catalogPath, readCatalog, resolveCatalogFiles } from "./catalog/io";
import type { ResolvedConfig } from "./config";
import { LinguaError } from "./errors";
import type { SourceEntry } from "./formats/types";

export function selectLocales(config: ResolvedConfig, locales?: string[]): string[] {
  const selected = locales ?? config.targetLocales;
  const unknown = selected.filter((locale) => !config.targetLocales.includes(locale));
  if (unknown.length > 0) {
    throw new LinguaError(
      `Unknown target locale(s): ${unknown.join(", ")} (configured: ${config.targetLocales.join(", ")}).`,
      "config",
    );
  }
  return selected;
}

export function sourceMissingMessage(config: ResolvedConfig): string {
  const file = config.pattern.replaceAll("{locale}", config.sourceLocale);
  return `Source catalog not found: ${file}${config.wrapperMode ? " — run `lingua extract` first" : ""}`;
}

async function readAll(files: { namespace: string; file: string }[]) {
  return Promise.all(
    files.map(async ({ namespace, file }) => [namespace, await readCatalog(file)] as const),
  );
}

/** Existing source catalogs by namespace; empty when none exists. */
export async function loadSourceCatalogs(config: ResolvedConfig): Promise<Map<string, Catalog>> {
  const files = await resolveCatalogFiles(config.pattern, config.sourceLocale, config.root);
  return new Map((await readAll(files)).filter(([, catalog]) => catalog.exists));
}

/** Target catalogs by namespace, including an empty one for every source namespace without a file. */
export async function loadTargetCatalogs(
  config: ResolvedConfig,
  locale: string,
  sources: Map<string, Catalog>,
): Promise<Map<string, Catalog>> {
  const files = await resolveCatalogFiles(config.pattern, locale, config.root);
  const known = new Set(files.map(({ namespace }) => namespace));
  const missing = [...sources.keys()]
    .filter((namespace) => !known.has(namespace))
    .map((namespace) => ({
      namespace,
      file: catalogPath(config.pattern, locale, namespace, config.root),
    }));
  return new Map(await readAll([...files, ...missing]));
}

export function stringEntries(catalog: Catalog | undefined): SourceEntry[] {
  return (catalog?.entries ?? []).filter(
    (entry): entry is SourceEntry => typeof entry.value === "string",
  );
}
