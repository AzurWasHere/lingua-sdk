import { type Message, resolveMessage } from "@lingua-api/shared";
import { isValidElement, type ReactNode } from "react";
import { type IntlShape, useIntl } from "react-intl";

export type { Message, MessageDescriptor } from "@lingua-api/shared";
export { messageId } from "@lingua-api/shared";

export type TranslationValues = Record<string, string | number | boolean | Date | null | undefined>;
export type RichTranslationValues = Record<
  string,
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | ReactNode
  | ((chunks: ReactNode[]) => ReactNode)
>;

export interface LinguaTranslator {
  (message: Message, values?: TranslationValues): string;
  rich(message: Message, values?: RichTranslationValues): ReactNode;
  has(message: Message): boolean;
  readonly locale: string;
}

export interface TProps {
  message: string;
  context?: string;
  id?: string;
  values?: RichTranslationValues;
}

const translators = new WeakMap<IntlShape, LinguaTranslator>();

function describe(input: Message) {
  const { id, message, context } = resolveMessage(input);
  return { id, defaultMessage: message, description: context };
}

/** Translator over a react-intl `IntlShape` (from `useIntl()` or `createIntl()`); missing ids fall back to the inline message. */
export function createTranslations(intl: IntlShape): LinguaTranslator {
  const cached = translators.get(intl);
  if (cached) return cached;
  const t: LinguaTranslator = Object.assign(
    (message: Message, values?: TranslationValues) =>
      String(intl.formatMessage(describe(message), values)),
    {
      rich: (message: Message, values?: RichTranslationValues): ReactNode =>
        intl.formatMessage(describe(message), values),
      has: (message: Message) => Object.hasOwn(intl.messages, resolveMessage(message).id),
      locale: intl.locale,
    },
  );
  translators.set(intl, t);
  return t;
}

export function useTranslations(): LinguaTranslator {
  return createTranslations(useIntl());
}

export function T({ values, ...message }: TProps): ReactNode {
  const t = useTranslations();
  const rich = Object.values(values ?? {}).some(
    (v) => typeof v === "function" || isValidElement(v),
  );
  return rich ? t.rich(message, values) : t(message, values as TranslationValues);
}
