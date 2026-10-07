import { LinguaError } from "../errors";

export interface Tokenizer {
  token(original: string): string;
  originals: string[];
}

export function createTokenizer(): Tokenizer {
  const originals: string[] = [];
  return {
    originals,
    token(original) {
      originals.push(original);
      return `LNG${originals.length - 1}`;
    },
  };
}

/** Engines may change the case of a token or insert a space before its index. */
export const TOKEN_PATTERN = /lng\s?(\d+)/gi;

export function restoreTokens(text: string, originals: string[]): { text: string; ok: boolean } {
  const seen = originals.map(() => 0);
  let ok = true;
  // A token followed by text digits (`LNG0` + `1` → `LNG01`) keeps the longest valid index, no leading zeros.
  const restored = text.replace(TOKEN_PATTERN, (match, digits: string) => {
    const length = [...digits].reduce((best, _, i) => {
      const prefix = digits.slice(0, i + 1);
      const valid =
        (prefix === "0" || !prefix.startsWith("0")) && Number(prefix) < originals.length;
      return valid ? i + 1 : best;
    }, 0);
    const index = Number(digits.slice(0, length));
    if (length === 0) {
      ok = false;
      return match;
    }
    seen[index] = (seen[index] ?? 0) + 1;
    return `${originals[index]}${digits.slice(length)}`;
  });
  return { text: restored, ok: ok && seen.every((count) => count === 1) };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

/** Replaces each term occurrence (case-sensitive, longest first) with a token. */
export function protectTerms(
  text: string,
  terms: string[],
  tokenizer: Pick<Tokenizer, "token">,
): string {
  const sorted = terms.filter((term) => term !== "").sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return text;
  return text.replace(new RegExp(sorted.map(escapeRegExp).join("|"), "g"), (term) =>
    tokenizer.token(term),
  );
}

const CATEGORY_ORDER = ["zero", "one", "two", "few", "many", "other"];

export function pluralCategories(
  locale: string,
  type: "cardinal" | "ordinal" = "cardinal",
): string[] {
  const categories: string[] = new Intl.PluralRules(locale, { type }).resolvedOptions()
    .pluralCategories;
  return CATEGORY_ORDER.filter((category) => categories.includes(category));
}

// Positive numbers first so "other" reads naturally (en: 2, en ordinal: 4, ru: 1.5); 0 and 0.5 only as a last resort.
const CANDIDATES = [
  ...Array.from({ length: 1000 }, (_, i) => i + 1),
  0,
  ...Array.from({ length: 100 }, (_, i) => i + 1.5),
  0.5,
];
const examples = new Map<string, Map<string, number>>();

export function exampleNumber(
  locale: string,
  category: string,
  type: "cardinal" | "ordinal" = "cardinal",
): number {
  const key = `${locale}|${type}`;
  let byCategory = examples.get(key);
  if (!byCategory) {
    const rules = new Intl.PluralRules(locale, { type });
    byCategory = CANDIDATES.reduce((map, n) => {
      const selected = rules.select(n);
      if (!map.has(selected)) map.set(selected, n);
      return map;
    }, new Map<string, number>());
    examples.set(key, byCategory);
  }
  const n = byCategory.get(category);
  if (n === undefined) {
    throw new LinguaError(
      `No example number for plural category "${category}" (${type}) in locale "${locale}".`,
      "plural",
    );
  }
  return n;
}

/** Replaces exactly one standalone occurrence of `n` (not part of a longer number or a token). */
export function swapExampleNumber(
  text: string,
  n: number,
  replacement: string,
): { text: string; ok: boolean } {
  const pattern = new RegExp(
    `(?<!\\d|\\d[.,]|lng\\s?)${escapeRegExp(String(n))}(?!\\d|[.,]\\d)`,
    "gi",
  );
  const count = text.match(pattern)?.length ?? 0;
  if (count !== 1) return { text, ok: false };
  return { text: text.replace(pattern, () => replacement), ok: true };
}
