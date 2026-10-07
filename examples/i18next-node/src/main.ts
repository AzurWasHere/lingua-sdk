import { readFileSync } from "node:fs";
import { createTranslations } from "@lingua-api/i18next";
import i18next from "i18next";

const locales = ["en", "es", "fr"];
const readCatalog = (lng: string) =>
  JSON.parse(readFileSync(new URL(`../locales/${lng}/translation.json`, import.meta.url), "utf8"));

const i18n = i18next.createInstance();
await i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: Object.fromEntries(locales.map((lng) => [lng, { translation: readCatalog(lng) }])),
});
const t = createTranslations(i18n);

// Sequential on purpose: changeLanguage switches the one shared instance.
for (const lng of locales) {
  await i18n.changeLanguage(lng);
  const greeting = t("Hello {{name}}", { name: "Ada" });
  const inbox = t({ one: "{{count}} new message", other: "{{count}} new messages" }, { count: 2 });
  console.log(`[${lng}] ${greeting}, ${inbox}. ${i18n.t("farewell")}`);
}
