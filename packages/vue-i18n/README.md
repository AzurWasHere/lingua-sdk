# @lingua-api/vue-i18n

Write source strings inline in a [vue-i18n](https://vue-i18n.intlify.dev/) app. `lingua extract` turns them into content-hash ids in your source catalog, `lingua translate` fills the other locales, and at runtime each call looks the id up in the catalog and falls back to formatting the inline message with vue-i18n itself.

## Install

```sh
pnpm add @lingua-api/vue-i18n vue-i18n vue
pnpm add -D @lingua-api/cli
```

## Setup

Keep your usual Composition API setup (`legacy: false` is required) and load the catalogs from `src/locales/*.json`:

```ts
// src/i18n.ts
import { createI18n } from "vue-i18n";
import en from "./locales/en.json";
import es from "./locales/es.json";

export const i18n = createI18n({ legacy: false, locale: "en", fallbackLocale: "en", messages: { en, es } });
```

```ts
// src/main.ts
createApp(App).use(i18n).mount("#app");
```

## Usage

```vue
<script setup lang="ts">
import { T, useTranslations } from "@lingua-api/vue-i18n";

const t = useTranslations();
</script>

<template>
  <h1>{{ t("Hello {name}", { name: user.name }) }}</h1>
  <p>{{ t("one car | {count} cars", { count: cars.length }) }}</p>
  <button>{{ t({ message: "Save", context: "toolbar" }) }}</button>
  <T message="Welcome back, {name}" :values="{ name: user.name }" />
</template>
```

- `t(message, values?)` returns a string. A message is a string or `{ message, context?, id? }`; the id is `id` if given, else a hash of `message` + `context`.
- When `values.count` is a number it is passed as vue-i18n's plural argument, so `a | b` forms are selected (and `{count}` is available).
- `t.has(message)` is `te(id)` for the current locale; `t.locale` is the current locale.
- `<T message context? id? :values :count />` renders the translated text as a bare text node (no wrapper element).

Outside components (router guards, stores, server code), use the composer directly:

```ts
import { createTranslations } from "@lingua-api/vue-i18n";

const t = createTranslations(i18n.global); // or createTranslations(i18n)
```

`useTranslations()` reads the current app's i18n instance through `useI18n({ useScope: "global" })`; nothing is stored at module level, so SSR requests don't share locale state.

### Message syntax

Inline messages use vue-i18n's own syntax: `{name}` / `{0}` interpolation, `a | b` (or `none | one | many`) plurals, `@:linked.key` messages, `{'@'}` literals. There is no namespace argument: every id lives at the top level of the locale catalog.

### Message compiler

Untranslated inline messages are formatted with `rt()` at runtime, which needs vue-i18n's message compiler. The default `vue-i18n` entry (`vue-i18n.mjs` / `vue-i18n.esm-bundler.js`) includes it. If you alias to a runtime-only build (e.g. `@intlify/unplugin-vue-i18n` with `runtimeOnly: true`), set `runtimeOnly: false`, otherwise the fallback fails with "message compiler not available" (catalog hits still work).

## Workflow

```sh
lingua extract && lingua translate
```

`extract` scans `include` (e.g. `src/**/*.{ts,vue}`) for `t(...)` calls and `<T>` elements and writes their ids into the source catalog; `translate` writes the target locales.
