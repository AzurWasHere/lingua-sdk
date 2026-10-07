import { perLiteral, TAG, tokenize } from "./i18next";
import { restoreTokens } from "./sentinels";
import type { FormatDriver } from "./types";

const ESCAPE = String.raw`\{'[^']*'\}`;
const FORMS = new RegExp(`(${ESCAPE}|\\|)`);
const PLACEHOLDER = new RegExp(
  `(${[
    ESCAPE,
    String.raw`@(?:\.[a-z]+)?:(?:\([^)]*\)|[\w.\-]+)`,
    String.raw`\{\s*[\w.\-]+\s*\}`,
    String.raw`%\{[\w.\-]+\}`,
    TAG,
  ].join("|")})`,
);
const SEPARATOR = " | ";

/** Splits on `|` outside literal escapes like `{'|'}`. */
function splitForms(text: string): string[] {
  return text
    .split(FORMS)
    .reduce<string[]>(
      (forms, part) => {
        if (part === "|") forms.push("");
        else forms[forms.length - 1] += part;
        return forms;
      },
      [""],
    )
    .map((form) => form.trim());
}

export const vueI18nDriver: FormatDriver = {
  name: "vue-i18n",
  planTargets(source) {
    return source.map(({ path, value }) => ({ path, sourcePath: path, source: value }));
  },
  prepare(text, ctx) {
    const forms = splitForms(text);
    const prepared = forms.map((form) => tokenize(form, PLACEHOLDER, ctx.doNotTranslate));
    return {
      segments: prepared.map(({ segment }) => segment),
      restore(translated) {
        const restored = prepared.map(({ segment, originals }, i) =>
          restoreTokens(translated[i] ?? segment, originals),
        );
        const message = restored.map(({ text }) => text).join(SEPARATOR);
        if (restored.every(({ ok }) => ok)) return { text: message, needsReview: false };
        return {
          text: message,
          needsReview: true,
          fallback: perLiteral(forms, PLACEHOLDER, ctx.doNotTranslate, SEPARATOR),
        };
      },
    };
  },
};
