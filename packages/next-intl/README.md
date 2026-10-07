# @lingua-api/next-intl

Write source strings inline with [next-intl](https://next-intl.dev). Each message is looked up in the next-intl catalog by its content hash (`messageId(message, context)`); when the translation is missing, the inline message is formatted with next-intl's own ICU formatter, so untranslated strings still render.

## Install

```sh
pnpm add next-intl @lingua-api/next-intl
pnpm add -D @lingua-api/cli
```

`next-intl` itself is ESM-only, so CommonJS consumers need Node ≥ 22.12 (`require(esm)`); Next.js bundles it, so this only affects unusual setups.

## Setup (standard next-intl, unchanged)

```ts
// i18n/request.ts
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) ?? "en";
  return { locale, messages: (await import(`../messages/${locale}.json`)).default };
});
```

```tsx
// app/[locale]/layout.tsx
import { NextIntlClientProvider } from "next-intl";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider>{children}</NextIntlClientProvider>;
}
```

## Usage

Client Components and synchronous Server Components:

```tsx
import { T, useTranslations } from "@lingua-api/next-intl";

export function Greeting({ name, count }: { name: string; count: number }) {
  const t = useTranslations();
  return (
    <>
      <h1>{t("Hello {name}", { name })}</h1>
      <p>{t("{count, plural, one {# item} other {# items}}", { count })}</p>
      <p>{t.rich("Read the <b>docs</b>", { b: (chunks) => <b>{chunks}</b> })}</p>
      <button type="button">{t({ message: "Open", context: "menu" })}</button>
      <T message="Welcome back, {name}" values={{ name }} />
    </>
  );
}
```

Async Server Components, Server Actions, metadata:

```ts
import { getTranslations } from "@lingua-api/next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations(); // or getTranslations({ locale })
  return { title: t("My app") };
}
```

The translator:

- `t(message, values?)` → `string`
- `t.rich(message, values?)` → `ReactNode` (tag values are `(chunks) => ReactNode`)
- `t.markup(message, values?)` → `string` (tag values are `(chunks: string) => string`)
- `t.has(message)` → whether the catalog has a translation
- `t.locale` → the active locale

`message` is the source text itself, or `{ message, context?, id? }`. An explicit `id` replaces the hash; `context` disambiguates identical strings. **There is no namespace argument** (unlike next-intl's `useTranslations("Namespace")`): the first argument to `t` is the message text, not a key. `<T>` renders rich text when any value is a function, plain text otherwise.

## Populating the catalogs

```sh
lingua extract     # writes the inline messages into messages/<sourceLocale>.json
lingua translate   # machine-translates them into the target-locale catalogs
```

Set `runtime: "next-intl"` and `include` in `lingua.config.ts` to enable extraction.

