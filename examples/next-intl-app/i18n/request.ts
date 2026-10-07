import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

const locales = ["en", "es", "fr"];

export default getRequestConfig(async () => {
  const requested = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale = requested && locales.includes(requested) ? requested : "en";
  return { locale, messages: (await import(`../messages/${locale}.json`)).default };
});
