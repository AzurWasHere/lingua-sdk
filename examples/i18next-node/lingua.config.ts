import { defineConfig } from "@lingua-api/cli";

export default defineConfig({
  runtime: "i18next",
  sourceLocale: "en",
  targetLocales: ["es", "fr"],
  catalog: { pattern: "locales/{locale}/{ns}.json" },
  include: ["src/**/*.ts"],
});
