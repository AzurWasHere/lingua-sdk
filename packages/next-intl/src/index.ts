import { useLocale, useTranslations as useNextIntlTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  createLinguaTranslator,
  type LinguaTranslator,
  type RichTranslationValues,
} from "./translator";

export type { Message, MessageDescriptor } from "@lingua-api/shared";
export { messageId } from "@lingua-api/shared";
export type { LinguaTranslator, RichTranslationValues, TranslationValues } from "./translator";

export function useTranslations(): LinguaTranslator {
  return createLinguaTranslator(useNextIntlTranslations(), useLocale());
}

export interface TProps {
  message: string;
  context?: string;
  id?: string;
  values?: RichTranslationValues;
}

export function T({ message, context, id, values }: TProps): ReactNode {
  const t = useTranslations();
  const descriptor = { message, context, id };
  return Object.values(values ?? {}).some((v) => typeof v === "function")
    ? t.rich(descriptor, values)
    : t(descriptor, values as Parameters<LinguaTranslator>[1]);
}
