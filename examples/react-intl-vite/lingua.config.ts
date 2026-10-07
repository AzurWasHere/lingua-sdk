import { defineConfig } from "@lingua-api/cli";

export default defineConfig({
  runtime: "react-intl",
  sourceLocale: "en",
  targetLocales: ["es", "fr"],
  include: ["src/**/*.{ts,tsx}"],
});
