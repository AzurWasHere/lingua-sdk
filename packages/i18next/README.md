# @lingua-api/i18next

Write source strings inline with i18next. Keep your existing i18next setup. Untranslated strings fall back to the inline text.

```sh
pnpm add @lingua-api/i18next
```

Peers: `i18next` (required). For React, also `react` and `react-i18next`.

## Works with your existing i18next setup

Load catalogs however you already do, for example from `public/locales/{lng}/{ns}.json` through any backend (`i18next-http-backend`, `i18next-fs-backend`, `i18next-resources-to-backend`, inline `resources`). Each inline message is looked up under a content-hash id: `messageId(message, context)`, or your explicit `id`. If the id is missing, i18next renders the inline message through its `defaultValue` / `defaultValue_<category>` options.

## Anywhere (Node, Svelte, Vue, plain JS)

```ts
import i18next from "i18next";
import { createTranslations } from "@lingua-api/i18next";

const t = createTranslations(i18next); // or createTranslations(i18next, { ns: "common" })

t("Hello {{name}}", { name: "Ada" });
t({ message: "Save", context: "button" });
t({ message: "Save", id: "actions.save" });
t({ one: "{{count}} item", other: "{{count}} items" }, { count: 3 });
t.has("Hello {{name}}"); // true when the catalog has the id
t.has({ one: "{{count}} item", other: "{{count}} items" }, { count: 3 });
t.locale; // i18n.resolvedLanguage ?? i18n.language
```

`createTranslations` does not import React. It runs anywhere i18next runs.

## React (`@lingua-api/i18next/react`)

```tsx
import { T, useTranslations } from "@lingua-api/i18next/react";

function Cart({ count }: { count: number }) {
  const t = useTranslations(); // or useTranslations({ ns: "common" })
  return (
    <>
      <h1>{t("Hello {{name}}", { name: "Ada" })}</h1>
      <T message="Click <b>here</b>" components={{ b: <b /> }} />
      <T message={{ one: "{{count}} item", other: "{{count}} items" }} count={count} />
    </>
  );
}
```

`useTranslations` calls `react-i18next`'s `useTranslation`, so components re-render when the language changes. `<T>` renders through `<Trans>`. It takes `message`, `context`, `id`, `values`, `count` and `components`.

## Message syntax

Messages use i18next syntax: `{{name}}` interpolation, `<b>…</b>` or `<0>…</0>` tags for `<T>`, and the plural object form `{ zero?, one?, two?, few?, many?, other }`. The plural id is `messageId(other, context)`. The catalog holds `<id>_one`, `<id>_other`, … like any i18next JSON v4 plural.

`t` does not take a namespace argument. Pick the namespace once with `createTranslations(i18n, { ns })` or `useTranslations({ ns })`. Otherwise the instance's default namespace is used, and `lingua extract` writes ids there (`translation` by default).

## Workflow

```sh
lingua extract && lingua translate
```

`extract` adds the inline messages to the source-locale catalog. `translate` fills in the target locales.
