import { defineConfig } from "@lingua-api/cli";

export default defineConfig({
  runtime: "vue-i18n",
  sourceLocale: "en",
  targetLocales: ["es", "fr"],
  include: ["src/**/*.{ts,vue}"],
});
