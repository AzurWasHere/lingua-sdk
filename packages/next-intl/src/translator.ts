import { type Message, resolveMessage } from "@lingua-api/shared";
import { createTranslator } from "next-intl";
import type { ReactNode } from "react";

export type TranslationValues = Record<string, string | number | Date | boolean | null | undefined>;
export type RichTranslationValues = Record<
  string,
  string | number | Date | boolean | null | undefined | ((chunks: ReactNode) => ReactNode)
>;
export type MarkupTranslationValues = Record<
  string,
  string | number | ((chunks: string) => string)
>;

export interface LinguaTranslator {
  (message: Message, values?: TranslationValues): string;
  rich(message: Message, values?: RichTranslationValues): ReactNode;
  markup(message: Message, values?: MarkupTranslationValues): string;
  has(message: Message): boolean;
  readonly locale: string;
}

export type NextIntlT = ReturnType<typeof createTranslator>;

// Pure formatters keyed by (locale, message text): safe to share across requests.
const fallbacks = new Map<string, NextIntlT>();
const FALLBACK_KEY = "m";

function fallback(locale: string, message: string): NextIntlT {
  const key = `${locale}\u0000${message}`;
  let t = fallbacks.get(key);
  if (!t) {
    if (fallbacks.size >= 5000) fallbacks.clear();
    t = createTranslator({
      locale,
      messages: { [FALLBACK_KEY]: message },
      onError: () => {},
      getMessageFallback: () => message,
    });
    fallbacks.set(key, t);
  }
  return t;
}

// next-intl's value types are narrower than what intl-messageformat accepts at runtime.
type PlainValues = Parameters<NextIntlT>[1];
type RichValues = Parameters<NextIntlT["rich"]>[1];
type MarkupValues = Parameters<NextIntlT["markup"]>[1];

export function createLinguaTranslator(t: NextIntlT, locale: string): LinguaTranslator {
  const pick = (input: Message): [NextIntlT, string] => {
    const { id, message } = resolveMessage(input);
    return t.has(id) ? [t, id] : [fallback(locale, message), FALLBACK_KEY];
  };
  const translate = (input: Message, values?: TranslationValues) => {
    const [tr, key] = pick(input);
    return tr(key, values as PlainValues);
  };
  return Object.assign(translate, {
    rich: (input: Message, values?: RichTranslationValues) => {
      const [tr, key] = pick(input);
      return tr.rich(key, values as RichValues);
    },
    markup: (input: Message, values?: MarkupTranslationValues) => {
      const [tr, key] = pick(input);
      return tr.markup(key, values as MarkupValues);
    },
    has: (input: Message) => t.has(resolveMessage(input).id),
    locale,
  });
}
