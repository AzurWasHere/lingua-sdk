import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCatalogObject,
  catalogPath,
  detectIndent,
  detectShape,
  flattenCatalog,
  LinguaError,
  readCatalog,
  resolveCatalogFiles,
  serializeCatalog,
  writeCatalog,
} from "../src/index";

const nested = { home: { title: "Hi", tags: ["a", { b: "c" }], count: 3 }, empty: {}, flag: true };
const formatjs = {
  greeting: { defaultMessage: "Hello", description: "Shown on home" },
  bye: { defaultMessage: "Bye" },
};

describe("shape", () => {
  it("detects nested, flat and formatjs", () => {
    expect(detectShape(nested)).toBe("nested");
    expect(detectShape({ "home.title": "Hi", list: ["a"] })).toBe("flat");
    expect(detectShape(formatjs)).toBe("formatjs");
    expect(detectShape({})).toBe("nested");
  });

  it("flattens nested catalogs depth-first with numeric array segments", () => {
    expect(flattenCatalog(nested, "nested")).toEqual([
      { path: ["home", "title"], value: "Hi" },
      { path: ["home", "tags", 0], value: "a" },
      { path: ["home", "tags", 1, "b"], value: "c" },
      { path: ["home", "count"], value: 3 },
      { path: ["empty"], value: {} },
      { path: ["flag"], value: true },
    ]);
  });

  it("rebuilds nested catalogs in order and recreates arrays", () => {
    const rebuilt = buildCatalogObject(flattenCatalog(nested, "nested"), "nested");
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(nested));
    expect(Array.isArray((rebuilt.home as { tags: unknown }).tags)).toBe(true);
  });

  it("keeps __proto__ keys as own data", () => {
    const raw = JSON.parse('{"__proto__": {"polluted": "x"}}');
    const rebuilt = buildCatalogObject(flattenCatalog(raw, "nested"), "nested");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(rebuilt)).toBe('{"__proto__":{"polluted":"x"}}');
  });

  it("builds formatjs objects and copies descriptions from the source", async () => {
    const entries = flattenCatalog(formatjs, "formatjs");
    expect(entries).toEqual([
      { path: ["greeting"], value: "Hello" },
      { path: ["bye"], value: "Bye" },
    ]);
    const source = { raw: formatjs } as unknown as Parameters<typeof buildCatalogObject>[2];
    expect(
      buildCatalogObject(
        [
          { path: ["greeting"], value: "Hola" },
          { path: ["bye"], value: "Adiós" },
        ],
        "formatjs",
        source,
      ),
    ).toEqual({
      greeting: { defaultMessage: "Hola", description: "Shown on home" },
      bye: { defaultMessage: "Adiós" },
    });
  });
});

describe("formatting", () => {
  it("detects indentation", () => {
    expect(detectIndent('{\n  "a": 1\n}')).toBe("  ");
    expect(detectIndent('{\n    "a": 1\n}')).toBe("    ");
    expect(detectIndent('{\n\t"a": 1\n}')).toBe("\t");
    expect(detectIndent("{}")).toBe("  ");
  });

  it("serializes with a trailing newline and the newline style", () => {
    expect(serializeCatalog({ a: 1 }, { indent: "  ", newline: "\n" })).toBe('{\n  "a": 1\n}\n');
    expect(serializeCatalog({ a: 1 }, { indent: "\t", newline: "\r\n" })).toBe(
      '{\r\n\t"a": 1\r\n}\r\n',
    );
  });
});

describe("files", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lingua-catalog-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves a single catalog without {ns}", async () => {
    expect(await resolveCatalogFiles("messages/{locale}.json", "de", dir)).toEqual([
      { namespace: "", locale: "de", file: join(dir, "messages", "de.json") },
    ]);
  });

  it("globs namespaces with {ns}", async () => {
    const localeDir = join(dir, "public", "locales", "en");
    await mkdir(localeDir, { recursive: true });
    await writeFile(join(localeDir, "common.json"), "{}");
    await writeFile(join(localeDir, "auth.json"), "{}");
    const files = await resolveCatalogFiles("public/locales/{locale}/{ns}.json", "en", dir);
    expect(files).toEqual([
      { namespace: "auth", locale: "en", file: join(localeDir, "auth.json") },
      { namespace: "common", locale: "en", file: join(localeDir, "common.json") },
    ]);
    expect(catalogPath("public/locales/{locale}/{ns}.json", "en", "auth", dir)).toBe(
      join(localeDir, "auth.json"),
    );
  });

  it("reads missing, valid and invalid catalogs", async () => {
    const missing = await readCatalog(join(dir, "nope.json"));
    expect(missing).toMatchObject({
      exists: false,
      raw: {},
      entries: [],
      shape: "nested",
      indent: "  ",
    });

    const file = join(dir, "sub", "en.json");
    await writeCatalog(file, nested, { indent: "    ", newline: "\r\n" });
    const catalog = await readCatalog(file);
    expect(catalog).toMatchObject({
      exists: true,
      indent: "    ",
      newline: "\r\n",
      shape: "nested",
    });
    expect(await readFile(file, "utf8")).toBe(serializeCatalog(catalog.raw, catalog));

    await writeFile(join(dir, "bad.json"), "{ nope");
    await expect(readCatalog(join(dir, "bad.json"))).rejects.toThrow(/bad\.json/);
    await writeFile(join(dir, "array.json"), "[]");
    await expect(readCatalog(join(dir, "array.json"))).rejects.toBeInstanceOf(LinguaError);
  });
});
