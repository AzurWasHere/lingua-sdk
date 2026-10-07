import type { KeyPath } from "../catalog/pointer";
import {
  createTokenizer,
  exampleNumber,
  pluralCategories,
  protectTerms,
  restoreTokens,
  swapExampleNumber,
} from "./sentinels";
import type {
  FormatDriver,
  PlannedTarget,
  PrepareContext,
  PreparedMessage,
  SourceEntry,
} from "./types";

interface PluralGroup {
  parent: KeyPath;
  base: string;
  ordinal: boolean;
  forms: Map<string, SourceEntry>;
}

const ORDINAL = /^(.+)_ordinal_(zero|one|two|few|many|other)$/;
const CARDINAL = /^(.+)_(zero|one|two|few|many|other)$/;
const COUNT = /\{\{\s*count\s*\}\}/;
const PARK = 0xe000;
const PARKED = /[\uE000-\uF8FF]/g;

export const TAG = String.raw`<\/?[A-Za-z0-9][^<>]*\/?>`;
const PLACEHOLDER = new RegExp(
  `(${String.raw`\$t\((?:[^()]|\([^()]*\))*\)`}|${String.raw`\{\{[^{}]*\}\}`}|${TAG})`,
);

/** `pattern` has one capturing group: odd split parts are placeholders, even parts literal text. */
export function tokenize(text: string, pattern: RegExp, terms: string[]) {
  const tokenizer = createTokenizer();
  const segment = text
    .split(pattern)
    .map((part, i) => (i % 2 ? tokenizer.token(part) : protectTerms(part, terms, tokenizer)))
    .join("");
  return { segment, originals: tokenizer.originals };
}

/** Translates only the literal fragments between placeholders; always flagged for review. */
export function perLiteral(
  forms: string[],
  pattern: RegExp,
  terms: string[],
  separator: string,
): PreparedMessage {
  const split = forms.map((form) => form.split(pattern));
  const literals = split.flatMap((parts, f) =>
    parts.flatMap((part, p) => {
      const value = part.trim();
      if (p % 2 || !value) return [];
      const lead = part.slice(0, part.length - part.trimStart().length);
      const trail = part.slice(part.trimEnd().length);
      return [{ f, p, lead, trail, ...tokenize(value, pattern, terms) }];
    }),
  );
  return {
    segments: literals.map(({ segment }) => segment),
    restore(translated) {
      const parts = split.map((form) => [...form]);
      literals.forEach(({ f, p, lead, trail, segment, originals }, i) => {
        const body = restoreTokens(translated[i] ?? segment, originals).text;
        (parts[f] as string[])[p] = `${lead}${body}${trail}`;
      });
      return { text: parts.map((form) => form.join("")).join(separator), needsReview: true };
    },
  };
}

function pluralKey(segment: KeyPath[number] | undefined) {
  if (typeof segment !== "string") return undefined;
  const ordinal = ORDINAL.exec(segment);
  const match = ordinal ?? CARDINAL.exec(segment);
  if (!match) return undefined;
  return { base: match[1] as string, category: match[2] as string, ordinal: ordinal !== null };
}

function expandGroup(
  { parent, base, ordinal, forms }: PluralGroup,
  targetLocale: string,
): PlannedTarget[] {
  return pluralCategories(targetLocale, ordinal ? "ordinal" : "cardinal").map((category) => {
    const from = (forms.get(category) ??
      forms.get("other") ??
      [...forms.values()][0]) as SourceEntry;
    return {
      path: [...parent, `${base}_${ordinal ? "ordinal_" : ""}${category}`],
      sourcePath: from.path,
      source: from.value,
      pluralCategory: category,
      ordinal,
    };
  });
}

function countExample(text: string, ctx: PrepareContext): number | undefined {
  if (!ctx.pluralCategory || !COUNT.test(text)) return undefined;
  try {
    return exampleNumber(
      ctx.targetLocale,
      ctx.pluralCategory,
      ctx.ordinal ? "ordinal" : "cardinal",
    );
  } catch {
    // No small example number (fr "many" = 1e6): keep `{{count}}` as a token.
    return undefined;
  }
}

function prepareMessage(
  text: string,
  ctx: PrepareContext,
  count: number | undefined,
  isFallback: boolean,
): PreparedMessage {
  const source = count === undefined ? text : text.replace(COUNT, String(count));
  const { segment, originals } = tokenize(source, PLACEHOLDER, ctx.doNotTranslate);
  return {
    segments: [segment],
    restore([translated]) {
      // Tokens are parked as private-use chars so `<1>` or `LNG0` + `1` don't hide the example number.
      const parked = restoreTokens(
        translated ?? segment,
        originals.map((_, i) => String.fromCharCode(PARK + i)),
      );
      const swapped =
        count === undefined ? parked : swapExampleNumber(parked.text, count, "{{count}}");
      const result = {
        text: swapped.text.replace(PARKED, (char) => originals[char.charCodeAt(0) - PARK] ?? char),
        needsReview: !parked.ok || !swapped.ok,
      };
      if (isFallback || !result.needsReview) return result;
      return {
        ...result,
        fallback: parked.ok
          ? prepareMessage(text, ctx, undefined, true)
          : perLiteral([text], PLACEHOLDER, ctx.doNotTranslate, ""),
      };
    },
  };
}

export const i18nextDriver: FormatDriver = {
  name: "i18next",
  planTargets(source, targetLocale) {
    const groups = new Map<string, PluralGroup>();
    const slots = source.flatMap((entry): (PlannedTarget | PluralGroup)[] => {
      const plural = pluralKey(entry.path.at(-1));
      if (!plural) return [{ path: entry.path, sourcePath: entry.path, source: entry.value }];
      const parent = entry.path.slice(0, -1);
      const id = JSON.stringify([parent, plural.base, plural.ordinal]);
      const group = groups.get(id);
      if (group) {
        group.forms.set(plural.category, entry);
        return [];
      }
      const created: PluralGroup = {
        parent,
        base: plural.base,
        ordinal: plural.ordinal,
        forms: new Map([[plural.category, entry]]),
      };
      groups.set(id, created);
      return [created];
    });
    return slots.flatMap((slot) => ("forms" in slot ? expandGroup(slot, targetLocale) : [slot]));
  },
  prepare(text, ctx) {
    return prepareMessage(text, ctx, countExample(text, ctx), false);
  },
};
