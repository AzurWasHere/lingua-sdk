import { defineConfig } from "@lingua-api/cli";

export default defineConfig({
  runtime: "next-intl",
  sourceLocale: "en",
  targetLocales: ["es", "fr"],
  include: ["app/**/*.{ts,tsx}"],
});
