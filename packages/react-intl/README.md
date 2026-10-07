# @lingua-api/react-intl

Write source strings inline with [react-intl](https://formatjs.github.io/docs/react-intl). Ids are content hashes, so there are no keys to invent: `t(message, values)` takes the message text itself (no namespaces). `lingua extract && lingua translate` populate `lang/*.json`.

## Install

```sh
pnpm add @lingua-api/react-intl react-intl
pnpm add -D @lingua-api/cli
```

`react-intl` 12 itself is ESM-only, so CommonJS consumers need Node ≥ 22.12 (`require(esm)`); bundlers are unaffected.

## Setup

Keep your standard `IntlProvider`; load `lang/${locale}.json` however the app already does (`formatjs compile` output works unchanged).

```tsx
import { IntlProvider } from "react-intl";

const messages = await import(`../lang/${locale}.json`).then((m) => m.default);

<IntlProvider locale={locale} defaultLocale="en" messages={messages}>
  <App />
</IntlProvider>;
```

## Usage

```tsx
import { T, useTranslations } from "@lingua-api/react-intl";

function Greeting({ name, count }: { name: string; count: number }) {
  const t = useTranslations();
  return (
    <>
      <h1>{t("Hello {name}", { name })}</h1>
      <p>{t("{count, plural, one {# message} other {# messages}}", { count })}</p>
      <p>{t.rich("Read the <b>docs</b>", { b: (chunks) => <b>{chunks}</b> })}</p>
      <button type="button">{t({ message: "Open", context: "menu" })}</button>
      <T message="Saved by <b>{name}</b>" values={{ name, b: (chunks) => <b>{chunks}</b> }} />
    </>
  );
}
```

- `t(message, values)` → `string`; `t.rich(message, values)` → `ReactNode` (tags map to functions, values may be elements).
- `message` can be a string or `{ message, context?, id? }`. `context` disambiguates identical strings; an explicit `id` wins over the hash.
- `t.has(message)` → whether the catalog has a translation; `t.locale` → the active locale.
- `<T message context? id? values? />` renders rich text when any value is a function or React element, plain text otherwise.

Outside React (server code, scripts), pass an `IntlShape` from `createIntl()`:

```ts
import { createIntl } from "react-intl";
import { createTranslations } from "@lingua-api/react-intl";

const t = createTranslations(createIntl({ locale, defaultLocale: "en", messages }));
t("Hello {name}", { name: "Ada" });
```

Lookups go through `intl.formatMessage({ id, defaultMessage: message, description: context }, values)`, so an id missing from the catalog falls back to formatting the inline message natively.

## Missing translations

For a non-default locale, react-intl reports a `MissingTranslationError` through `onError` whenever an id is missing (by default `console.error` outside production). Either run `lingua translate` so no id is missing, or configure `onError` on `IntlProvider` / `createIntl`:

```tsx
<IntlProvider
  locale={locale}
  defaultLocale="en"
  messages={messages}
  onError={(err) => {
    if (err.code !== "MISSING_TRANSLATION") console.error(err);
  }}
>
```

## Workflow

```sh
lingua extract     # collects t()/t.rich()/<T> messages into lang/en.json
lingua translate   # writes lang/<target>.json
```

