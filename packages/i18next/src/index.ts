import { type Message, messageId, resolveMessage } from "@lingua-api/shared";
import type { i18n } from "i18next";

export type { Message, MessageDescriptor } from "@lingua-api/shared";
export { messageId } from "@lingua-api/shared";

/** i18next plural object form; the id is derived from `other`. */
export type PluralMessage = {
  one?: string;
  other: string;
  zero?: string;
  two?: string;
  few?: string;
  many?: string;
  context?: string;
  id?: string;
};
export type AnyMessage = Message | PluralMessage;
export type TranslationValues = Record<string, unknown> & { count?: number };

export interface LinguaTranslator {
  (message: AnyMessage, values?: TranslationValues): string;
  has(message: AnyMessage, values?: { count?: number }): boolean;
  readonly locale: string;
}

export interface CreateOptions {
  /** Namespace passed through to i18next (default: the instance's default namespace). */
  ns?: string;
}

export function resolveAnyMessage(message: AnyMessage): {
  id: string;
  defaults: Record<string, string>;
  message: string;
} {
  if (typeof message === "object" && "other" in message) {
    const { context, id, ...forms } = message;
    const plural = Object.entries(forms)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([category, text]) => [`defaultValue_${category}`, text]);
    return {
      id: id ?? messageId(forms.other, context),
      defaults: { defaultValue: forms.other, ...Object.fromEntries(plural) },
      message: forms.other,
    };
  }
  const { id, message: text } = resolveMessage(message);
  return { id, defaults: { defaultValue: text }, message: text };
}

export function createTranslations(i18n: i18n, { ns }: CreateOptions = {}): LinguaTranslator {
  const translate = (message: AnyMessage, values?: TranslationValues) => {
    const { id, defaults } = resolveAnyMessage(message);
    return String(i18n.t(id, { ...defaults, ...values, ns }));
  };
  return Object.defineProperties(translate, {
    has: {
      value: (message: AnyMessage, values?: { count?: number }) =>
        i18n.exists(resolveAnyMessage(message).id, { ns, count: values?.count }),
    },
    locale: { get: () => i18n.resolvedLanguage ?? i18n.language },
  }) as LinguaTranslator;
}
