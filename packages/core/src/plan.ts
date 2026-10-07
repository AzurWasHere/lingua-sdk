import type { Catalog } from "./catalog/io";
import { type KeyPath, toPointer } from "./catalog/pointer";
import type { FormatDriver } from "./formats/types";
import { stringEntries } from "./load";
import { entryKey, type Lockfile, type LockTarget } from "./lockfile";

export type KeyAction = "translate" | "reuse" | "manual" | "stale-manual";

export interface PlannedKey {
  namespace: string;
  path: KeyPath;
  sourcePath: KeyPath;
  source: string;
  pluralCategory?: string;
  ordinal?: boolean;
  action: KeyAction;
  /** Current target text when present (for manual keys, the lockfile text if the catalog lacks it). */
  existing?: string;
}

export interface PrunedKey {
  namespace: string;
  path: KeyPath;
  text: unknown;
  manual: boolean;
}

export interface LocalePlan {
  locale: string;
  keys: PlannedKey[];
  pruned: PrunedKey[];
}

function actionFor(
  source: string,
  text: string | undefined,
  lockTarget: LockTarget | undefined,
  force: boolean,
): KeyAction {
  if (text !== undefined && text !== lockTarget?.text) return "manual";
  if (lockTarget?.manual) return source === lockTarget.source ? "manual" : "stale-manual";
  if (text === undefined || lockTarget === undefined || source !== lockTarget.source || force) {
    return "translate";
  }
  return "reuse";
}

export function planLocale(input: {
  locale: string;
  sourceCatalogs: Map<string, Catalog>;
  targetCatalogs: Map<string, Catalog>;
  lock: Lockfile;
  driver: FormatDriver;
  force?: boolean;
}): LocalePlan {
  const { locale, lock, driver, force = false } = input;
  const lockTarget = (namespace: string, path: KeyPath) =>
    lock.entries[entryKey(namespace, path)]?.targets[locale];
  const keys: PlannedKey[] = [];
  const pruned: PrunedKey[] = [];

  input.sourceCatalogs.forEach((source, namespace) => {
    const targetStrings = new Map(
      stringEntries(input.targetCatalogs.get(namespace)).map((entry) => [
        toPointer(entry.path),
        entry,
      ]),
    );
    const expected = driver.planTargets(stringEntries(source), locale);
    const expectedPointers = new Set(expected.map(({ path }) => toPointer(path)));

    expected.forEach((target) => {
      const locked = lockTarget(namespace, target.path);
      const text = targetStrings.get(toPointer(target.path))?.value;
      keys.push({
        namespace,
        ...target,
        action: actionFor(target.source, text, locked, force),
        existing: text ?? (locked?.manual ? locked.text : undefined),
      });
    });

    targetStrings.forEach(({ path, value }, pointer) => {
      if (expectedPointers.has(pointer)) return;
      const locked = lockTarget(namespace, path);
      pruned.push({
        namespace,
        path,
        text: value,
        manual: !locked || locked.manual || locked.text !== value,
      });
    });
  });

  return { locale, keys, pruned };
}
