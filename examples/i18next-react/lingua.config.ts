import { defineConfig } from "@lingua-api/cli";

export default defineConfig({
  runtime: "i18next",
  sourceLocale: "en",
  targetLocales: ["es", "fr"],
  include: ["src/**/*.{ts,tsx}"],
});
