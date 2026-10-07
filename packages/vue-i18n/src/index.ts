import { type Message, resolveMessage } from "@lingua-api/shared";
import { defineComponent, type PropType } from "vue";
import { type Composer, type I18n, useI18n } from "vue-i18n";

export type { Message, MessageDescriptor } from "@lingua-api/shared";
export { messageId } from "@lingua-api/shared";

export type TranslationValues = Record<string, unknown> & { count?: number };

export interface LinguaTranslator {
  (message: Message, values?: TranslationValues): string;
  has(message: Message): boolean;
  readonly locale: string;
}

// Composer/I18n are invariant in their schema and locale generics, so app-typed instances need `any` here.
// biome-ignore lint/suspicious/noExplicitAny: see above
type AnyComposer = Composer<any, any, any, any, any, any>;
// biome-ignore lint/suspicious/noExplicitAny: see above
type AnyI18n = I18n<any, any, any, any, any>;

function toComposer(source: AnyComposer | AnyI18n): Composer {
  if (!("global" in source)) return source as Composer;
  if (source.mode === "legacy") {
    throw new Error(
      "@lingua-api/vue-i18n requires the Composition API: create the instance with createI18n({ legacy: false })",
    );
  }
  return source.global as Composer;
}

export function createTranslations(source: AnyComposer | AnyI18n): LinguaTranslator {
  const composer = toComposer(source);
  const translate = (input: Message, values?: TranslationValues): string => {
    const { id, message } = resolveMessage(input);
    const named = values ?? {};
    const count = typeof named.count === "number" ? named.count : undefined;
    if (composer.te(id)) {
      return count === undefined ? composer.t(id, named) : composer.t(id, count, { named });
    }
    // rt has no (message, named) overload in the types; the list overload with options.named is equivalent.
    return count === undefined
      ? composer.rt(message, [], { named })
      : composer.rt(message, count, { named });
  };
  return Object.defineProperties(translate as LinguaTranslator, {
    has: { value: (input: Message) => composer.te(resolveMessage(input).id) },
    locale: { get: () => composer.locale.value },
  });
}

export function useTranslations(): LinguaTranslator {
  return createTranslations(useI18n({ useScope: "global" }));
}

export const T = defineComponent({
  props: {
    message: { type: String, required: true },
    context: String,
    id: String,
    values: Object as PropType<Record<string, unknown>>,
    count: Number,
  },
  setup(props) {
    const t = useTranslations();
    return () =>
      t(
        { message: props.message, context: props.context, id: props.id },
        props.count === undefined ? props.values : { ...props.values, count: props.count },
      );
  },
});
