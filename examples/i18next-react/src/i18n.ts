import i18n, { type Resource } from "i18next";
import { initReactI18next } from "react-i18next";

const files = import.meta.glob<Record<string, unknown>>("../public/locales/**/*.json", {
  eager: true,
  import: "default",
});

const resources: Resource = {};
Object.entries(files).forEach(([path, catalog]) => {
  const [lng = "", file = ""] = path.split("/").slice(-2);
  resources[lng] = { ...resources[lng], [file.replace(/\.json$/, "")]: catalog };
});

void i18n.use(initReactI18next).init({
  resources,
  lng: navigator.language.split("-")[0],
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});
