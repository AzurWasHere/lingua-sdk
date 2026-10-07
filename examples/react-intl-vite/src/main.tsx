import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "react-intl";
import en from "../lang/en.json";
import es from "../lang/es.json";
import fr from "../lang/fr.json";
import { App } from "./App";
import { compileMessages } from "./messages";

const catalogs = { en, es, fr };
const base = navigator.language.split("-")[0] ?? "en";
const locale = Object.hasOwn(catalogs, base) ? (base as keyof typeof catalogs) : "en";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <IntlProvider
      locale={locale}
      defaultLocale="en"
      messages={compileMessages(catalogs[locale])}
      onError={(err) => {
        if (err.code !== "MISSING_TRANSLATION") console.error(err);
      }}
    >
      <App />
    </IntlProvider>
  </StrictMode>,
);
