import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyLockfile,
  entryKey,
  type Lockfile,
  parseEntryKey,
  readLockfile,
  serializeLockfile,
  writeLockfile,
} from "../src/index";

describe("lockfile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lingua-lock-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a missing lockfile as empty", async () => {
    expect(await readLockfile(join(dir, "lingua.lock.json"))).toEqual(emptyLockfile());
  });

  it("rejects an unknown version", async () => {
    const file = join(dir, "lingua.lock.json");
    await writeFile(file, JSON.stringify({ version: 2, entries: {} }));
    await expect(readLockfile(file)).rejects.toMatchObject({ code: "lockfile" });
  });

  it("serializes with sorted entries and locales and round trips", async () => {
    const target = { source: "Hi", text: "x", manual: false };
    const lock: Lockfile = {
      version: 1,
      entries: {
        "|/b": { targets: { fr: target, de: target } },
        "|/a": { extracted: true, targets: { es: target } },
      },
    };
    const text = serializeLockfile(lock);
    expect(text.endsWith("}\n")).toBe(true);
    const parsed = JSON.parse(text) as Lockfile;
    expect(Object.keys(parsed.entries)).toEqual(["|/a", "|/b"]);
    expect(Object.keys(parsed.entries["|/b"]?.targets ?? {})).toEqual(["de", "fr"]);
    expect(text).toContain('\n  "version": 1');

    const file = join(dir, "nested", "lingua.lock.json");
    await writeLockfile(file, lock);
    expect(await readLockfile(file)).toEqual(parsed);
  });

  it("encodes entry keys", () => {
    const key = entryKey("common", ["a/b", 0]);
    expect(key).toBe("common|/a~1b/0");
    expect(parseEntryKey(key)).toEqual({ namespace: "common", pointer: "/a~1b/0" });
    expect(parseEntryKey(entryKey("", ["x|y"]))).toEqual({ namespace: "", pointer: "/x|y" });
  });
});
