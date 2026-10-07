export type RuntimeName = "next-intl" | "react-intl" | "i18next" | "vue-i18n";
export type FormatName = "icu" | "i18next" | "vue-i18n";

export interface RuntimePreset {
  runtime: RuntimeName;
  pattern: string;
  format: FormatName;
  defaultNamespace: string;
  include: string[];
}

export const PRESETS: Record<RuntimeName, RuntimePreset> = {
  "next-intl": {
    runtime: "next-intl",
    pattern: "messages/{locale}.json",
    format: "icu",
    defaultNamespace: "",
    include: [
      "src/**/*.{ts,tsx,js,jsx}",
      "app/**/*.{ts,tsx,js,jsx}",
      "components/**/*.{ts,tsx,js,jsx}",
    ],
  },
  "react-intl": {
    runtime: "react-intl",
    pattern: "lang/{locale}.json",
    format: "icu",
    defaultNamespace: "",
    include: ["src/**/*.{ts,tsx,js,jsx}"],
  },
  i18next: {
    runtime: "i18next",
    pattern: "public/locales/{locale}/{ns}.json",
    format: "i18next",
    defaultNamespace: "translation",
    include: ["src/**/*.{ts,tsx,js,jsx,mts,mjs}"],
  },
  "vue-i18n": {
    runtime: "vue-i18n",
    pattern: "src/locales/{locale}.json",
    format: "vue-i18n",
    defaultNamespace: "",
    include: ["src/**/*.{ts,js,vue}"],
  },
};

const DETECTION_ORDER: RuntimeName[] = ["next-intl", "react-intl", "vue-i18n", "i18next"];

export function detectRuntime(packageJson: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): RuntimeName | null {
  const deps = { ...packageJson.devDependencies, ...packageJson.dependencies };
  return DETECTION_ORDER.find((name) => Object.hasOwn(deps, name)) ?? null;
}
