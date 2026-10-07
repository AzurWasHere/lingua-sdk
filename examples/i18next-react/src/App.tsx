import { T, useTranslations } from "@lingua-api/i18next/react";
import { useTranslation } from "react-i18next";

export function App() {
  const t = useTranslations();
  const { t: keys } = useTranslation();
  const { t: common } = useTranslation("common");
  return (
    <main>
      <h1>{keys("welcome", { name: "Ada" })}</h1>
      <p>{keys("item", { count: 2 })}</p>
      <p>{t("Hello {{name}}", { name: "Ada" })}</p>
      <p>
        <T message={{ one: "{{count}} new message", other: "{{count}} new messages" }} count={3} />
      </p>
      <p>
        <T message="Click <b>here</b>" components={{ b: <b /> }} />
      </p>
      <footer>{common("footer")}</footer>
    </main>
  );
}
