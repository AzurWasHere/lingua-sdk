# @lingua-api/core

The engine behind the `lingua` CLI: config loading, catalog I/O, the lockfile and format drivers. Most apps use it only through `lingua.config.ts`:

```ts
import { defineConfig } from "@lingua-api/cli";

export default defineConfig({
  runtime: "next-intl",
  sourceLocale: "en",
  targetLocales: ["es", "fr"],
});
```

## Modules

- **Config** — `defineConfig`, `loadConfig(cwd)` (reads `lingua.config.{ts,mts,js,mjs,json}` and `.env.local` / `.env`), `resolveConfig`. The API key is only ever read from the environment variable named by `api.keyEnv` (default `LINGUA_API_KEY`).
- **Presets** — `PRESETS` holds the default catalog pattern, format and namespace per runtime (`next-intl`, `react-intl`, `i18next`, `vue-i18n`); `detectRuntime(packageJson)` picks one.
- **Catalogs** — `resolveCatalogFiles`, `readCatalog`, `flattenCatalog`, `buildCatalogObject`, `writeCatalog`. Nested, flat and formatjs (`{ id: { defaultMessage, description } }`) shapes are preserved, along with key order, indentation and line endings. Key paths serialize as JSON Pointers (`toPointer` / `fromPointer`).
- **Lockfile** — `readLockfile` / `writeLockfile` for `lingua.lock.json`, which records the source text and result of every translation so later runs only translate what changed.
- **Format drivers** — `getDriver(format)` returns a driver that turns a message into plain-text segments for the translation engine and restores the translated segments into a valid message. Placeholders, tags and `doNotTranslate` terms are protected with `LNG0`, `LNG1`, … tokens. The `icu` driver (next-intl, react-intl) translates each plural/select branch as a full sentence, expanded to the target locale's plural categories.

  The `i18next` driver (JSON v4) protects `{{var}}`, `{{- var}}`, `{{var, format}}`, `$t(key, {...})` nesting and `<0>…</0>` / `<strong>` tags. Plural keys (`item_one`, `item_other`, `place_ordinal_one`, …) are grouped by base key and expanded to the target locale's categories, each sourced from the matching source category or `_other`; `{{count}}` is replaced by an example number for the category before translating and swapped back afterwards. `_context` keys are ordinary keys.

  The `vue-i18n` driver protects `{name}`, `{0}`, `%{name}`, linked messages (`@:path`, `@.upper:path`, `@:(path)`), HTML tags and literal escapes (`{'@'}`, `{'|'}`). Messages with `|` are translated form by form and rejoined with ` | `; the number of forms is preserved, since vue-i18n cannot gain forms without app-defined `pluralRules`.
- **Messages** — `messageId` and `resolveMessage`, the content-hash ids used by the wrapper integrations.

## Translate and check

`translate({ config })` is what `lingua translate` runs: it reads the source catalog(s), machine-translates only keys that are new or whose source text changed, and writes each target catalog in the source's shape and key order (non-string values are copied). Hand-written or hand-edited translations are never overwritten — they are recorded as `manual` in `lingua.lock.json`, and reported as stale when their source text changes later. Keys removed from the source are pruned from the targets unless `keepUnused` is set. Catalogs and the lockfile are saved after every API batch, so an interrupted run (quota exceeded, Ctrl-C) keeps everything already paid for. Pass `dryRun: true` to get the key and character counts without calling the API, `locales` to limit the run, `force` to retranslate every non-manual key, and `onProgress` to follow along. `check({ config })` runs the same comparison offline and returns the missing, stale, needs-review and unused keys per locale, with `ok: false` when anything is off.

## Extraction

`extract(config)` is what `lingua extract` runs in wrapper mode (`include` set in the config). It scans the `include`/`exclude` files that mention `@lingua-api/`, parses JS/TS/JSX/TSX with `oxc-parser` and `.vue` files with `@vue/compiler-sfc` (an optional peer dependency, needed only for `.vue`), and collects `t("…")`, `` t(`…`) ``, `t.rich` / `t.markup` / `t.has`, `t({ message, context, id, comment })`, the i18next plural object form `t({ one, other })` and `<T message context id />` — with the names from `functionNames` / `componentNames`. Ids are the explicit `id` or `messageId(message, context)`; dynamic messages become warnings with `file:line:column`, and one id used for two different messages is an error. The ids are merged into the source-locale catalog (the default namespace for `{ns}` patterns): existing keys keep their order, new ids are appended, and only ids previously written by `extract` (`extracted: true` in the lockfile) are ever removed — hand-written keys are left alone. New files are flat strings, or formatjs objects (`{ defaultMessage, description }`) for react-intl; i18next plural objects become `<id>_one`, `<id>_other`, …. `dryRun: true` reports without writing; `extractMessages` and `writeExtracted` are the two halves, and `checkExtraction(config)` returns `source-stale` issues when the source catalog is out of date with the code.
