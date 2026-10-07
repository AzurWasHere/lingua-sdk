import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import App from "./App.vue";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";

const messages = { en, es, fr };
const base = navigator.language.split("-")[0] ?? "en";
const locale = Object.hasOwn(messages, base) ? base : "en";

createApp(App)
  .use(createI18n({ legacy: false, locale, fallbackLocale: "en", messages }))
  .mount("#app");
