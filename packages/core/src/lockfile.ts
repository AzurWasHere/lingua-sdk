import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type KeyPath, toPointer } from "./catalog/pointer";
import { LinguaError } from "./errors";

export interface LockTarget {
  source: string;
  text: string;
  engine?: string;
  manual: boolean;
  needsReview?: boolean;
}

export interface LockEntry {
  extracted?: true;
  targets: Record<string, LockTarget>;
}

export interface Lockfile {
  version: 1;
  entries: Record<string, LockEntry>;
}

export function entryKey(namespace: string, path: KeyPath): string {
  return `${namespace}|${toPointer(path)}`;
}

export function parseEntryKey(key: string): { namespace: string; pointer: string } {
  const separator = key.indexOf("|");
  return { namespace: key.slice(0, separator), pointer: key.slice(separator + 1) };
}

export function emptyLockfile(): Lockfile {
  return { version: 1, entries: {} };
}

export async function readLockfile(file: string): Promise<Lockfile> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLockfile();
    throw error;
  }
  let lock: Partial<Lockfile>;
  try {
    lock = JSON.parse(text);
  } catch (error) {
    throw new LinguaError(
      `Invalid JSON in ${file}: ${(error as Error).message}`,
      "lockfile",
      error,
    );
  }
  if (lock?.version !== 1) {
    throw new LinguaError(
      `Unsupported lockfile version in ${file} (expected 1, got ${JSON.stringify(lock?.version)}).`,
      "lockfile",
    );
  }
  return { version: 1, entries: lock.entries ?? {} };
}

function sortedObject<T>(record: Record<string, T>): [string, T][] {
  return Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function serializeLockfile(lock: Lockfile): string {
  const entries = Object.fromEntries(
    sortedObject(lock.entries).map(([key, entry]) => [
      key,
      { ...entry, targets: Object.fromEntries(sortedObject(entry.targets)) },
    ]),
  );
  return `${JSON.stringify({ version: 1, entries }, null, 2)}\n`;
}

export async function writeLockfile(file: string, lock: Lockfile): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, serializeLockfile(lock));
}
