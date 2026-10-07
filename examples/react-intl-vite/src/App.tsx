import { T, useTranslations } from "@lingua-api/react-intl";
import { FormattedMessage } from "react-intl";

export function App() {
  const t = useTranslations();
  return (
    <main>
      <h1>
        <FormattedMessage id="app.title" />
      </h1>
      <p>{t("Hello {name}", { name: "Ada" })}</p>
      <p>{t("{count, plural, one {# message} other {# messages}}", { count: 3 })}</p>
      <p>
        <T
          message="Saved by <b>{name}</b>"
          values={{ name: "Ada", b: (chunks) => <b>{chunks}</b> }}
        />
      </p>
    </main>
  );
}
