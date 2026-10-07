import { getTranslations } from "@lingua-api/next-intl/server";
import { Greeting } from "./greeting";

export default async function Home() {
  const t = await getTranslations();
  return (
    <main>
      <h1>{t("Welcome to the example app")}</h1>
      <p>{t("{count, plural, one {# new message} other {# new messages}}", { count: 3 })}</p>
      <Greeting name="Ada" />
    </main>
  );
}
