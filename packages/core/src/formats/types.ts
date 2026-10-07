import type { KeyPath } from "../catalog/pointer";
import type { FormatName } from "../presets";

export interface SourceEntry {
  path: KeyPath;
  value: string;
}

export interface PlannedTarget {
  path: KeyPath;
  sourcePath: KeyPath;
  source: string;
  pluralCategory?: string;
  ordinal?: boolean;
}

export interface PrepareContext {
  sourceLocale: string;
  targetLocale: string;
  doNotTranslate: string[];
  pluralCategory?: string;
  ordinal?: boolean;
}

export interface RestoreResult {
  text: string;
  needsReview: boolean;
  /** Translate these segments instead and use its restore; a fallback never has a fallback. */
  fallback?: PreparedMessage;
}

export interface PreparedMessage {
  segments: string[];
  restore(translated: string[]): RestoreResult;
}

export interface FormatDriver {
  name: FormatName;
  planTargets(source: SourceEntry[], targetLocale: string): PlannedTarget[];
  prepare(text: string, ctx: PrepareContext): PreparedMessage;
}
