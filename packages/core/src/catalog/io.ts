import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { escapePath, glob } from "tinyglobby";
import { LinguaError } from "../errors";
import type { KeyPath, PathSegment } from "./pointer";

export type CatalogShape = "nested" | "flat" | "formatjs";

/** A string value is translatable text; anything else is copied verbatim. */
export interface CatalogEntry {
  path: KeyPath;
  value: unknown;
}

export interface Catalog {
  file: string;
  exists: boolean;
  shape: CatalogShape;
  indent: string;
  newline: "\n" | "\r\n";
  raw: Record<string, unknown>;
  entries: CatalogEntry[];
}

export interface CatalogFile {
  namespace: string;
  locale: string;
  file: string;
}

type Container = Record<string, unknown> | unknown[];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// defineProperty keeps keys like "__proto__" as own data instead of touching the prototype.
function setOwn(target: Container, key: string | number, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function fillPattern(pattern: string, locale: string, namespace: string): string {
  return pattern.replaceAll("{locale}", locale).replaceAll("{ns}", namespace);
}

export function catalogPath(
  pattern: string,
  locale: string,
  namespace: string,
  root: string,
): string {
  return resolve(root, fillPattern(pattern, locale, namespace));
}

export async function resolveCatalogFiles(
  pattern: string,
  locale: string,
  root: string,
): Promise<CatalogFile[]> {
  if (!pattern.includes("{ns}")) {
    return [{ namespace: "", locale, file: catalogPath(pattern, locale, "", root) }];
  }
  const parts = pattern.replaceAll("{locale}", locale).split("{ns}");
  const matcher = new RegExp(
    `^${parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("([^/]+)")}$`,
  );
  const matches = await glob(parts.map(escapePath).join("*"), { cwd: root, onlyFiles: true });
  return matches
    .flatMap((relative) => {
      const namespace = matcher.exec(relative)?.[1];
      return namespace === undefined ? [] : [{ namespace, locale, file: resolve(root, relative) }];
    })
    .sort((a, b) => (a.namespace < b.namespace ? -1 : a.namespace > b.namespace ? 1 : 0));
}

export async function readCatalog(file: string): Promise<Catalog> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      file,
      exists: false,
      shape: "nested",
      indent: "  ",
      newline: "\n",
      raw: {},
      entries: [],
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new LinguaError(`Invalid JSON in ${file}: ${(error as Error).message}`, "catalog", error);
  }
  if (!isPlainObject(raw)) {
    throw new LinguaError(
      `Catalog ${file} must contain a JSON object at the top level.`,
      "catalog",
    );
  }
  const shape = detectShape(raw);
  return {
    file,
    exists: true,
    shape,
    indent: detectIndent(text),
    newline: text.includes("\r\n") ? "\r\n" : "\n",
    raw,
    entries: flattenCatalog(raw, shape),
  };
}

function hasObject(value: unknown): boolean {
  return isPlainObject(value) || (Array.isArray(value) && value.some(hasObject));
}

export function detectShape(raw: Record<string, unknown>): CatalogShape {
  const values = Object.values(raw);
  if (
    values.length > 0 &&
    values.every((value) => isPlainObject(value) && typeof value.defaultMessage === "string")
  ) {
    return "formatjs";
  }
  if (values.length === 0 || values.some(hasObject)) return "nested";
  return "flat";
}

function walk(value: unknown, path: KeyPath): CatalogEntry[] {
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    return Object.entries(value).flatMap(([key, child]) => walk(child, [...path, key]));
  }
  if (Array.isArray(value) && value.length > 0) {
    return value.flatMap((child, index) => walk(child, [...path, index]));
  }
  return [{ path, value }];
}

export function flattenCatalog(raw: Record<string, unknown>, shape: CatalogShape): CatalogEntry[] {
  if (shape === "formatjs") {
    return Object.entries(raw).map(([id, value]) => ({
      path: [id],
      value: isPlainObject(value) ? value.defaultMessage : value,
    }));
  }
  return Object.entries(raw).flatMap(([key, value]) => walk(value, [key]));
}

function setIn(root: Record<string, unknown>, path: KeyPath, value: unknown): void {
  const last = path.at(-1);
  if (last === undefined) return;
  const parent = path.slice(0, -1).reduce<Container>((container, segment, i) => {
    const existing = Object.hasOwn(container, segment)
      ? (container as Record<PathSegment, unknown>)[segment]
      : undefined;
    if (typeof existing === "object" && existing !== null) return existing as Container;
    const created: Container = typeof path[i + 1] === "number" ? [] : {};
    setOwn(container, segment, created);
    return created;
  }, root);
  setOwn(parent, last, value);
}

export function buildCatalogObject(
  entries: CatalogEntry[],
  shape: CatalogShape,
  source?: Catalog,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (shape === "formatjs") {
    entries.forEach(({ path, value }) => {
      const id = String(path[0]);
      const previous = source && Object.hasOwn(source.raw, id) ? source.raw[id] : undefined;
      setOwn(result, id, { ...(isPlainObject(previous) ? previous : {}), defaultMessage: value });
    });
    return result;
  }
  entries.forEach(({ path, value }) => {
    setIn(result, path, value);
  });
  return result;
}

export function serializeCatalog(
  raw: Record<string, unknown>,
  catalog: Pick<Catalog, "indent" | "newline">,
): string {
  const text = `${JSON.stringify(raw, null, catalog.indent)}\n`;
  return catalog.newline === "\r\n" ? text.replaceAll("\n", "\r\n") : text;
}

export async function writeCatalog(
  file: string,
  raw: Record<string, unknown>,
  style: Pick<Catalog, "indent" | "newline">,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, serializeCatalog(raw, style));
}

export function detectIndent(text: string): string {
  return /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
}
