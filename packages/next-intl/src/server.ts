import { getLocale, getTranslations as getNextIntlTranslations } from "next-intl/server";
import { createLinguaTranslator, type LinguaTranslator } from "./translator";

export type {
  LinguaTranslator,
  Message,
  MessageDescriptor,
  RichTranslationValues,
  TranslationValues,
} from "./index";

export async function getTranslations(options?: { locale?: string }): Promise<LinguaTranslator> {
  const locale = options?.locale;
  const [t, resolved] = await Promise.all([
    locale ? getNextIntlTranslations({ locale }) : getNextIntlTranslations(),
    locale ?? getLocale(),
  ]);
  return createLinguaTranslator(t, resolved);
}
