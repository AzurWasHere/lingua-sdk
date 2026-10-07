import {
  type LiteralElement,
  type MessageFormatElement,
  type PluralElement,
  parse,
  type SelectElement,
  TYPE,
} from "@formatjs/icu-messageformat-parser";
import {
  createTokenizer,
  exampleNumber,
  pluralCategories,
  protectTerms,
  restoreTokens,
  swapExampleNumber,
  type Tokenizer,
} from "./sentinels";
import type { FormatDriver, PrepareContext, PreparedMessage } from "./types";

type Lift = PluralElement | SelectElement;

interface Parsed {
  ast: MessageFormatElement[];
  ignoreTag: boolean;
}

interface Choice {
  lift: Lift;
  /** Number shown in the branch text instead of `#` (plural branches only). */
  display?: number;
  substituted: number;
}

interface Leaf {
  elements: MessageFormatElement[];
  chain: Choice[];
}

type Node = { leaf: number } | { lift: Lift; branches: { key: string; node: Node }[] };

const MAX_VARIANTS = 24;
const PARK = 0xe000;
const PARKED = /[\uE000-\uF8FF]/g;

/** ICU-escapes plain text: `'` → `''`, runs of `{}<` (and `#` in plural branches) are quoted. */
export function escapeIcu(text: string, inPlural = false): string {
  const pattern = inPlural ? /[{}<#][{}<#']*|'/g : /[{}<][{}<']*|'/g;
  return text.replace(pattern, (match) =>
    match === "'" ? "''" : `'${match.replaceAll("'", "''")}'`,
  );
}

function tryParse(text: string): Parsed | null {
  try {
    return { ast: parse(text, { captureLocation: true }), ignoreTag: false };
  } catch {
    try {
      return { ast: parse(text, { ignoreTag: true, captureLocation: true }), ignoreTag: true };
    } catch {
      return null;
    }
  }
}

function isValid(text: string, ignoreTag: boolean): boolean {
  try {
    parse(text, { ignoreTag });
    return true;
  } catch {
    return false;
  }
}

function isLift(el: MessageFormatElement): el is Lift {
  return el.type === TYPE.plural || el.type === TYPE.select;
}

function childrenOf(el: MessageFormatElement): MessageFormatElement[] {
  if (el.type === TYPE.tag) return el.children;
  if (isLift(el)) return Object.values(el.options).flatMap((option) => option.value);
  return [];
}

function countLifts(elements: MessageFormatElement[]): number {
  return elements.reduce((n, el) => n + (isLift(el) ? 1 : 0) + countLifts(childrenOf(el)), 0);
}

function findLift(elements: MessageFormatElement[], type: TYPE): Lift | undefined {
  return elements.reduce<Lift | undefined>(
    (found, el) => found ?? (el.type === type && isLift(el) ? el : findLift(childrenOf(el), type)),
    undefined,
  );
}

function sourceSlice(text: string, el: MessageFormatElement): string {
  if (!el.location) throw new Error("ICU element without location");
  return text.slice(el.location.start.offset, el.location.end.offset);
}

function replaceElement(
  elements: MessageFormatElement[],
  target: Lift,
  replacement: MessageFormatElement[],
): MessageFormatElement[] {
  return elements.flatMap((el): MessageFormatElement[] => {
    if (el === target) return replacement;
    if (el.type === TYPE.tag) {
      return [{ ...el, children: replaceElement(el.children, target, replacement) }];
    }
    if (isLift(el)) {
      const options = Object.fromEntries(
        Object.entries(el.options).map(([key, option]) => [
          key,
          { ...option, value: replaceElement(option.value, target, replacement) },
        ]),
      );
      return [{ ...el, options }];
    }
    return [el];
  });
}

/** Replaces `#` and `{variable}` with the example number; nested plurals keep their own `#`. */
function substitute(elements: MessageFormatElement[], variable: string, display: number) {
  let count = 0;
  const visit = (els: MessageFormatElement[]): MessageFormatElement[] =>
    els.map((el) => {
      if (el.type === TYPE.pound || (el.type === TYPE.argument && el.value === variable)) {
        count++;
        return { type: TYPE.literal, value: String(display) } satisfies LiteralElement;
      }
      return el.type === TYPE.tag ? { ...el, children: visit(el.children) } : el;
    });
  const result = visit(elements);
  return { elements: result, count };
}

function branchesFor(lift: Lift, targetLocale: string) {
  if (lift.type === TYPE.select) {
    return Object.entries(lift.options).map(([key, option]) => ({
      key,
      value: option.value,
      display: undefined as number | undefined,
    }));
  }
  const type = lift.pluralType === "ordinal" ? "ordinal" : "cardinal";
  const exact = Object.entries(lift.options)
    .filter(([key]) => key.startsWith("="))
    .map(([key, option]) => ({
      key,
      value: option.value,
      display: Number(key.slice(1)) - lift.offset,
    }));
  // Categories without a small example number (fr "many" = 1e6) are omitted; the runtime falls back to "other".
  const categories = pluralCategories(targetLocale, type).flatMap((category) => {
    try {
      return [
        {
          key: category,
          value: (lift.options[category] ?? lift.options.other)?.value ?? [],
          display: exampleNumber(targetLocale, category, type) as number | undefined,
        },
      ];
    } catch {
      return [];
    }
  });
  return [...exact, ...categories];
}

// Selects are lifted before plurals so every plural ends up innermost, where `#` still binds to it.
function expand(
  elements: MessageFormatElement[],
  targetLocale: string,
  chain: Choice[],
  leaves: Leaf[],
): Node {
  const lift = findLift(elements, TYPE.select) ?? findLift(elements, TYPE.plural);
  if (!lift) {
    leaves.push({ elements, chain });
    return { leaf: leaves.length - 1 };
  }
  return {
    lift,
    branches: branchesFor(lift, targetLocale).map(({ key, value, display }) => {
      const { elements: content, count } =
        display === undefined
          ? { elements: value, count: 0 }
          : substitute(value, lift.value, display);
      const choice: Choice = { lift, display, substituted: count };
      return {
        key,
        node: expand(
          replaceElement(elements, lift, content),
          targetLocale,
          [...chain, choice],
          leaves,
        ),
      };
    }),
  };
}

function assemble(node: Node, texts: string[]): string {
  if ("leaf" in node) return texts[node.leaf] ?? "";
  const { lift } = node;
  const keyword =
    lift.type === TYPE.select
      ? "select"
      : lift.pluralType === "ordinal"
        ? "selectordinal"
        : "plural";
  const offset = lift.type === TYPE.plural && lift.offset ? ` offset:${lift.offset}` : "";
  const branches = node.branches.map(
    ({ key, node: child }) => `${key} {${assemble(child, texts)}}`,
  );
  return `{${lift.value}, ${keyword},${offset} ${branches.join(" ")}}`;
}

function termTokens(tokenizer: Tokenizer, inPlural: boolean): Pick<Tokenizer, "token"> {
  return { token: (term) => tokenizer.token(escapeIcu(term, inPlural)) };
}

function render(
  elements: MessageFormatElement[],
  text: string,
  tokenizer: Tokenizer,
  terms: string[],
  inPlural: boolean,
): string {
  return elements
    .map((el) => {
      if (el.type === TYPE.literal) {
        return protectTerms(el.value, terms, termTokens(tokenizer, inPlural));
      }
      if (el.type === TYPE.tag) {
        const inner = render(el.children, text, tokenizer, terms, inPlural);
        return `${tokenizer.token(`<${el.value}>`)}${inner}${tokenizer.token(`</${el.value}>`)}`;
      }
      return tokenizer.token(sourceSlice(text, el));
    })
    .join("");
}

function plain(text: string, ctx: PrepareContext): PreparedMessage {
  const tokenizer = createTokenizer();
  const segment = protectTerms(text, ctx.doNotTranslate, tokenizer);
  return {
    segments: [segment],
    restore([translated]) {
      const restored = restoreTokens(translated ?? segment, tokenizer.originals);
      return { text: restored.text, needsReview: !restored.ok };
    },
  };
}

function collectLiterals(
  elements: MessageFormatElement[],
  inPlural: boolean,
): { el: LiteralElement; inPlural: boolean }[] {
  return elements.flatMap((el) => {
    if (el.type === TYPE.literal) return el.value.trim() ? [{ el, inPlural }] : [];
    if (el.type === TYPE.tag) return collectLiterals(el.children, inPlural);
    if (isLift(el)) {
      return Object.values(el.options).flatMap((option) =>
        collectLiterals(option.value, el.type === TYPE.plural),
      );
    }
    return [];
  });
}

/** Translates only the literal fragments in place; structurally safe, always flagged for review. */
function perLiteral(text: string, parsed: Parsed, ctx: PrepareContext): PreparedMessage {
  const literals = collectLiterals(parsed.ast, false).map(({ el, inPlural }) => {
    const tokenizer = createTokenizer();
    const value = el.value.trim();
    const segment = protectTerms(value, ctx.doNotTranslate, termTokens(tokenizer, inPlural));
    return { el, inPlural, value, segment, originals: tokenizer.originals };
  });
  return {
    segments: literals.map(({ segment }) => segment),
    restore(translated) {
      const result = literals.reduceRight((out, { el, inPlural, value, segment, originals }, i) => {
        const lead = el.value.slice(0, el.value.indexOf(value));
        const trail = el.value.slice(el.value.indexOf(value) + value.length);
        const body = restoreTokens(escapeIcu(translated[i] ?? segment, inPlural), originals).text;
        const start = el.location?.start.offset ?? 0;
        const end = el.location?.end.offset ?? 0;
        return `${out.slice(0, start)}${lead}${body}${trail}${out.slice(end)}`;
      }, text);
      return { text: result, needsReview: true };
    },
  };
}

function lifted(text: string, parsed: Parsed, ctx: PrepareContext): PreparedMessage {
  const leaves: Leaf[] = [];
  const root = expand(parsed.ast, ctx.targetLocale, [], leaves);

  const prepared = leaves.map(({ elements, chain }) => {
    const plurals = chain.filter(({ lift }) => lift.type === TYPE.plural);
    const innermost = plurals.at(-1);
    const swaps = plurals
      .filter((choice) => choice.substituted > 0)
      .map((choice) => ({
        n: choice.display ?? 0,
        replacement: choice === innermost ? "#" : `{${choice.lift.value}, number}`,
        // `{x, number}` can't express "n - offset", so an outer plural with offset is unsupported.
        supported: choice === innermost || (choice.lift as PluralElement).offset === 0,
      }));
    const inPlural = innermost !== undefined;
    const tokenizer = createTokenizer();
    const segment = render(elements, text, tokenizer, ctx.doNotTranslate, inPlural);
    return { segment, swaps, inPlural, originals: tokenizer.originals };
  });

  if (
    leaves.length > MAX_VARIANTS ||
    prepared.some(({ swaps }) => swaps.some(({ supported }) => !supported))
  ) {
    return perLiteral(text, parsed, ctx);
  }

  return {
    segments: prepared.map(({ segment }) => segment),
    restore(translated) {
      let needsReview = false;
      let tokensOk = true;
      const texts = prepared.map(({ segment, swaps, inPlural, originals }, i) => {
        // Tokens are parked as private-use chars so `LNG0` + `1` doesn't hide the example number.
        const parked = restoreTokens(
          escapeIcu(translated[i] ?? segment, inPlural),
          originals.map((_, index) => String.fromCharCode(PARK + index)),
        );
        if (!parked.ok) tokensOk = false;
        // ponytail: two plurals sharing an example number (en one/one = 1) can't be swapped back; they get flagged for review.
        const swapped = swaps.reduce((out, { n, replacement }) => {
          const result = swapExampleNumber(out, n, replacement);
          if (!result.ok) needsReview = true;
          return result.text;
        }, parked.text);
        return swapped.replace(PARKED, (char) => originals[char.charCodeAt(0) - PARK] ?? char);
      });
      const message = assemble(root, texts);
      if (!tokensOk) {
        return { text: message, needsReview: true, fallback: perLiteral(text, parsed, ctx) };
      }
      return { text: message, needsReview: needsReview || !isValid(message, parsed.ignoreTag) };
    },
  };
}

export const icuDriver: FormatDriver = {
  name: "icu",
  planTargets(source) {
    return source.map(({ path, value }) => ({ path, sourcePath: path, source: value }));
  },
  prepare(text, ctx) {
    const parsed = tryParse(text);
    if (!parsed) return plain(text, ctx);
    if (countLifts(parsed.ast) > 2) return perLiteral(text, parsed, ctx);
    return lifted(text, parsed, ctx);
  },
};
