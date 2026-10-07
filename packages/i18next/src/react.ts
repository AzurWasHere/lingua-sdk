import { createElement, type ReactElement, type ReactNode, useMemo } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  type AnyMessage,
  type LinguaTranslator,
  type PluralMessage,
  resolveAnyMessage,
  type TranslationValues,
} from "./index";

export type {
  AnyMessage,
  LinguaTranslator,
  Message,
  MessageDescriptor,
  PluralMessage,
  TranslationValues,
} from "./index";

/** Uses the hook's `t` so components re-render when the language changes. */
export function useTranslations({ ns }: { ns?: string } = {}): LinguaTranslator {
  const { t, i18n } = useTranslation(ns);
  return useMemo(() => {
    const translate = (message: AnyMessage, values?: TranslationValues) => {
      const { id, defaults } = resolveAnyMessage(message);
      return String(t(id, { ...defaults, ...values }));
    };
    return Object.defineProperties(translate, {
      has: {
        value: (message: AnyMessage, values?: { count?: number }) =>
          i18n.exists(resolveAnyMessage(message).id, { ns, count: values?.count }),
      },
      locale: { get: () => i18n.resolvedLanguage ?? i18n.language },
    }) as LinguaTranslator;
  }, [t, i18n, ns]);
}

export interface TProps {
  message: string | PluralMessage;
  context?: string;
  id?: string;
  values?: Record<string, unknown>;
  count?: number;
  components?: Record<string, ReactElement> | ReactElement[];
}

export function T({ message, context, id, values, count, components }: TProps): ReactNode {
  const { t } = useTranslation();
  const resolved = resolveAnyMessage(
    typeof message === "string" ? { message, context, id } : { context, id, ...message },
  );
  return createElement(Trans, {
    i18nKey: resolved.id,
    defaults: resolved.message,
    tOptions: resolved.defaults,
    values: { ...values, count },
    components,
    count,
    t,
  });
}
