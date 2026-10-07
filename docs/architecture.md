# Architecture

## What it does

`lingua` keeps an application's translation catalogs in sync with its source-language catalog by machine-translating through the Lingua API (`https://api.lingua-api.com`). It understands the catalog formats and layouts of **next-intl**, **react-intl**, **i18next** and **vue-i18n**, protects interpolation placeholders and markup from the translation engine, writes only the target-locale files, and records every result in `lingua.lock.json` so later runs translate only what changed. Translation happens at development/build time only — never in the browser and never at request time.

## Packages

| Package | Role |
|---|---|
| `@lingua-api/client` | Zero-dependency HTTP client for the Lingua API: `translate`, `translateBatch`, `languages`, retries, rate-limit-aware scheduling. |
| `@lingua-api/core` | Config loading, catalog I/O, lockfile, format drivers, runtime presets, translate/check pipeline, wrapper-call extraction. |
| `@lingua-api/cli` | The `lingua` binary: `init`, `extract`, `translate`, `check`, `watch`. |
| `@lingua-api/next-intl`, `@lingua-api/react-intl`, `@lingua-api/i18next`, `@lingua-api/vue-i18n` | Optional wrapper hooks (`useTranslations`, `getTranslations`, `createTranslations`, `<T>`) for writing source strings inline. Ids are content hashes. |
| `packages/shared` (private) | `messageId()`; bundled into every package that uses it. |

Dependency graph: `client → core → cli`; `shared → core`; `shared → each integration`. Integrations never depend on `core`.

## Two workflows, one pipeline

### File-based (default, zero code changes)
The app keeps authoring its source-locale catalog as it always has (`messages/en.json`, `public/locales/en/common.json`, …). `lingua translate` reads it and writes/merges the target-locale catalogs. **The source catalog is never written in this mode.**

### Wrapper mode (opt-in)
Developers write source strings inline through the integration hooks — `t("Hello {name}", { name })`, `<T message="Save" />`. `lingua extract` parses the code, computes `messageId(message, context)` for each call, and merges those ids into the source-locale catalog (only ids it previously wrote are ever removed). From there the pipeline is identical to file-based mode. At runtime the hooks look the id up in the catalog and fall back to formatting the inline message with the runtime's own formatter, so untranslated strings still render.

Wrapper mode is active when `include` is set in the config.

## Config — `lingua.config.ts`

Loaded with `jiti` (so `.ts`, `.mts`, `.js`, `.mjs` all work on every supported Node version); `lingua.config.json` is also accepted. `.env` and `.env.local` in the project root are loaded with `process.loadEnvFile` (missing files are ignored).

```ts
import { defineConfig } from "@lingua-api/cli";

export default defineConfig({
  runtime: "next-intl",            // "next-intl" | "react-intl" | "i18next" | "vue-i18n"
  sourceLocale: "en",
  targetLocales: ["es", "fr", "pt-BR"],
  engine: "deepl",                 // optional; omitted = the API picks per plan
  catalog: { pattern: "messages/{locale}.json" }, // optional; default from the runtime preset
  api: { keyEnv: "LINGUA_API_KEY", baseUrl: "https://api.lingua-api.com" }, // both optional
  doNotTranslate: ["Lingua"],      // optional; terms protected from translation
  concurrency: 4,                  // optional; concurrent API requests
  lockfile: "lingua.lock.json",    // optional
  // wrapper mode only:
  include: ["src/**/*.{ts,tsx}"],  // enables extraction
  exclude: ["**/*.test.*"],
  functionNames: ["t"],            // identifiers treated as translation functions
  componentNames: ["T"],           // JSX/Vue components treated as <T>
});
```

Rules: the API key is read only from the environment variable named by `api.keyEnv`; a literal `lk_live_` anywhere in the config is a hard error. `sourceLocale` and `targetLocales` are validated against `GET /v1/languages` before anything is translated.

## Catalog layouts and presets

The layout is per app, not universal. `pattern` contains `{locale}` and optionally `{ns}` (namespace = one file per namespace, i18next style).

| Runtime | Default pattern | Format driver | Typical shape |
|---|---|---|---|
| next-intl | `messages/{locale}.json` | `icu` | nested |
| react-intl | `lang/{locale}.json` | `icu` | flat; often formatjs-extracted `{ id: { defaultMessage, description } }` |
| i18next | `public/locales/{locale}/{ns}.json` | `i18next` | nested, `{{var}}`, `key_one`/`key_other` |
| vue-i18n | `src/locales/{locale}.json` | `vue-i18n` | nested, `{name}`, `a \| b` plurals, `@:link` |

`lingua init` writes the preset default; the user points `pattern` at wherever their runtime actually loads from.

**Shape mirrors the source file.** Nested stays nested, flat stays flat, formatjs objects stay objects (translated `defaultMessage`, untouched `description`) so `formatjs compile` keeps working. String arrays are translated element-wise. Non-string leaves are copied as-is. Output uses the source file's key order; JSON is written with the existing file's indentation (default two spaces) and a trailing newline.

Key paths are arrays internally; where they must be serialized (lockfile) they are encoded as JSON Pointers (RFC 6901) so dots in keys are never ambiguous.

## Lockfile — `lingua.lock.json`

```json
{
  "version": 1,
  "entries": {
    "<ns>|/greeting/title": {
      "extracted": true,
      "targets": {
        "es": { "source": "Hello {name}", "text": "Hola {name}", "engine": "deepl", "manual": false }
      }
    }
  }
}
```

- Entry key = `<namespace>|<JSON pointer>`; namespace is `""` when the pattern has no `{ns}`.
- `targets[locale].source` is the exact source text that was translated for that target key (for i18next plural expansion this can come from a different source key, e.g. `item_other`).
- `manual: true` marks a translation that came from a human (pre-existing or hand-edited) and must never be overwritten.
- `extracted: true` marks keys owned by `lingua extract`.
- Keys are sorted; two-space JSON; committed to git.

## Merge rules (invariants)

For each target locale, with `S` = source catalog, `T` = existing target catalog (may be absent), `L` = lockfile:

1. **Expected target keys** come from the format driver's `planTargets(S, locale)` — identity for `icu` and `vue-i18n`; for `i18next` plural groups are expanded to the locale's `Intl.PluralRules` categories.
2. For each expected key `k` with planned source text `src`:
   - `T[k]` exists and `L` has no entry for `(k, locale)` → pre-existing human translation: keep it, record it as `manual: true`.
   - `T[k]` exists and differs from `L[k][locale].text` → hand-edited: keep it, record it as `manual: true`.
   - `L[k][locale].manual` → keep `T[k]`; if `src !== L.source` report it as a **stale manual override**; never retranslate.
   - `T[k]` missing, or `src !== L[k][locale].source` → translate.
   - Otherwise → unchanged, reuse.
   - `--force` retranslates every non-manual key.
3. Keys in `T` that are not expected are **pruned** unless `--keep-unused`; pruned manual overrides are listed in the report.
4. The source-locale catalog is never written by `translate` (only by `extract`, and only the ids it owns).
5. Catalogs and the lockfile are written after every API batch, so an interrupted run (quota, Ctrl-C) loses nothing that was paid for.
6. Writes are merges: untouched keys and the source key order are preserved.

## Format drivers

```ts
interface FormatDriver {
  name: "icu" | "i18next" | "vue-i18n";
  planTargets(source: SourceEntries, targetLocale: string): PlannedTarget[];
  prepare(text: string, ctx: PrepareContext): PreparedMessage;
}
interface PlannedTarget { path: string[]; sourcePath: string[]; source: string; pluralCategory?: string; ordinal?: boolean }
interface PrepareContext { sourceLocale: string; targetLocale: string; doNotTranslate: string[]; pluralCategory?: string; ordinal?: boolean }
interface PreparedMessage { segments: string[]; restore(translated: string[]): { text: string; needsReview: boolean } }
```

The API translates plain text and does not preserve placeholders, so drivers replace anything that must survive with **sentinel tokens** `LNG0`, `LNG1`, … (matched case-insensitively on the way back), translate, and substitute the originals back. Opening and closing tags are independent tokens. `doNotTranslate` terms become tokens too. After restoring, every token must appear exactly once; if not, the driver falls back to translating only the literal text fragments between placeholders (structurally safe, less fluent) and flags `needsReview`.

**`icu`** (next-intl, react-intl) — parses with `@formatjs/icu-messageformat-parser`, reassembles with `printAST`. Arguments (`{name}`, `{n, number}`, `{d, date, short}`) and tags (`<b>…</b>`) become tokens. `plural`/`selectordinal`/`select` elements are *lifted* so each branch is translated as a full sentence: `You have {n, plural, one {# item} other {# items}}` becomes one variant per target plural category, each translated separately, then re-nested. Branches are expanded to the **target** locale's `Intl.PluralRules` categories (a missing source category falls back to `other`); before translating, `#` (and `{n}` where `n` is the plural variable) is replaced by an example number for that category (e.g. `ru`: one→1, few→2, many→5, other→1.5) so the engine inflects correctly, and the number is swapped back to `#` afterwards (exactly one occurrence, else sentinel fallback + `needsReview`). At most two nested plural/select elements per message are lifted; more falls back to per-literal translation. Escapes (`'{'`, `''`) survive round-trips because the output is produced by `printAST`.

**`i18next`** (JSON v4) — `{{var}}`, `{{var, format}}`, `{{- var}}`, `$t(key)`, `$t(key, {...})` and `<0>…</0>` / `<strong>` tags become tokens. `planTargets` groups keys by plural suffix (`_zero|_one|_two|_few|_many|_other`, and `_ordinal_<cat>`), and emits one target key per category of the target locale, sourcing each from the matching source category or `_other`. `{{count}}` is replaced by the category's example number before translating and swapped back afterwards (same rule as `#`). `_context` suffixes are ordinary keys. Keys that exist only in the target because of expansion are expected keys and are not pruned.

**`vue-i18n`** — `{name}`, `{0}`, `%{name}`, `@:path`, `@.upper:path`, `@:(path)` and HTML tags become tokens; `{'@'}` / `{'|'}` literals are preserved. Messages with `|` are split into their positional plural forms, each form translated separately and rejoined with ` | ` — the number of forms is preserved (vue-i18n cannot gain forms without app-defined `pluralRules`; documented limitation).

## Translation pipeline (`core/translate`)

1. Load config, source catalog(s), lockfile, existing target catalogs.
2. Validate `sourceLocale`/`targetLocales` against `GET /v1/languages`.
3. Per locale: `planTargets` → apply merge rules → list of `(key, source)` to translate.
4. `prepare` each → collect segments → pack into API batches (≤ 100 items, ≤ 20 000 characters, one `target` per batch) → `client.translateBatch` with `source` pinned to `sourceLocale`. If the batch endpoint is unavailable (404) the client transparently falls back to single `translate` calls.
5. `restore` → write target catalogs + lockfile after each batch.
6. Report per locale: `translated`, `reused`, `manual`, `staleManual[]`, `needsReview[]`, `pruned[]`, `characters`, `includedRemaining`.

`--dry-run` performs steps 1–3 and reports counts and character cost without calling the API. `check` is fully offline: stale source catalog (wrapper mode), missing keys per locale, stale manual overrides, lockfile/catalog drift; exits non-zero when anything is off.

## Extraction (`core/extract`, wrapper mode)

- Files from `include`/`exclude` via `tinyglobby`; only files whose text contains `@lingua-api/` are parsed (keeps the runtimes' own `t()` calls out).
- JS/TS/JSX/TSX parsed with `oxc-parser`; a small recursive ESTree walk finds:
  - `t("…")`, `` t(`…`) `` (no expressions), `t.rich("…", …)` where the callee identifier is in `functionNames`;
  - `t({ message, context?, id?, comment? })`;
  - i18next plural object form `t({ one: "…", other: "…" }, …)` → one key per category, `id_<category>`;
  - `<T message="…" context="…" id="…" />` where the element name is in `componentNames`.
- `.vue` files (vue-i18n runtime): `@vue/compiler-sfc` `parse()` → script / script-setup content goes through the JS extractor; the template AST is walked for `<T>` elements (static attrs) and for interpolation / directive expressions, which are parsed as expressions and matched the same way.
- Dynamic first arguments produce a warning with `file:line:col`. The same id with two different messages is an error.
- Id = explicit `id` if given, else `messageId(message, context)`.
- Output is merged into the source catalog under the preset's layout (for `{ns}` patterns, into the default namespace, `translation` for i18next). The written shape matches the existing source file (formatjs objects for react-intl, flat strings otherwise).

## Integrations

All expose the same translator shape:

```ts
type Message = string | { message: string; context?: string; id?: string };
type LinguaT = {
  (message: Message, values?: Record<string, unknown>): string;
  rich?(message: Message, values?: Record<string, unknown>): ReactNode;  // where the runtime supports rich text
  has(message: Message): boolean;                                        // translation present in the catalog
};
```

| Package | Entry points | Lookup / fallback |
|---|---|---|
| `@lingua-api/next-intl` | `useTranslations()`, `<T>` (no `"use client"` — works in Client and sync Server Components); `@lingua-api/next-intl/server` → `await getTranslations({ locale? })` | `t.has(id) ? t(id, values) : createTranslator({ locale, messages: { [id]: message } })(id, values)` |
| `@lingua-api/react-intl` | `useTranslations()`, `createTranslations(intl)`, `<T>` | `intl.formatMessage({ id, defaultMessage: message, description: context }, values)` — native fallback |
| `@lingua-api/i18next` | `createTranslations(i18n)`; `@lingua-api/i18next/react` → `useTranslations()`, `<T>` | `t(id, { defaultValue: message, ...values })`; plural object form → `defaultValue_one`, `defaultValue_other`, … |
| `@lingua-api/vue-i18n` | `useTranslations()`, `createTranslations(composer)`, `<T>` | `te(id) ? t(id, values) : rt(message, values)` |

SSR safety: no module-level singletons; each integration reads its runtime's own context/provider.

## Node support

Every Node 22.x and 24.x minor (`engines: ">=22.0.0"`). CI runs 22.0.0, latest 22, 24.0.0 and latest 24 on Ubuntu and Windows. Consequences: config loading via `jiti` (not native TS stripping), globbing via `tinyglobby` (not `fs.promises.glob`), colors via `picocolors` (not `util.styleText`), libraries ship ESM **and** CJS (no reliance on `require(esm)`). Safe natives in use: `fetch`, `util.parseArgs`, `process.loadEnvFile`, recursive `fs.watch`, `Intl.PluralRules`. Integrations whose runtime ships ESM only (`next-intl`, `react-intl`) can only be `require()`d on Node ≥ 22.12; this does not affect bundled apps.
