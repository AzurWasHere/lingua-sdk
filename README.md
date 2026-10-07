# lingua-sdk

`lingua` keeps an application's translation catalogs in sync with its source-language catalog by machine-translating through the Lingua API (`https://api.lingua-api.com`). It understands the catalog formats and layouts of **next-intl**, **react-intl**, **i18next** and **vue-i18n**, protects interpolation placeholders and markup from the translation engine, writes only the target-locale files, and records every result in `lingua.lock.json` so later runs translate only what changed. Translation happens at development/build time only — never in the browser and never at request time.

Status: pre-release. Repository URL and npm org are placeholders until the project is published (`https://github.com/TODO/lingua-sdk`).

## Quick start

```sh
pnpm add -D @lingua-api/cli
npx lingua init          # detects the runtime from package.json, writes lingua.config.ts
```

Put your API key in `.env.local` (keep it out of git). Keys come from the Lingua dashboard and require a paid plan.

```sh
LINGUA_API_KEY=lk_live_…
```

```sh
npx lingua translate     # writes the target-locale catalogs and lingua.lock.json
```

Commit the generated catalogs **and** `lingua.lock.json` — the lockfile is what makes the next run diff-only.

## How it works

- **File-based mode (default):** keep authoring your source catalog (`messages/en.json`, `public/locales/en/common.json`, …) as usual; `lingua translate` writes and merges the target-locale catalogs. The source catalog is never written.
- **Wrapper mode (opt-in, `include` in the config):** write source strings inline with `t("Hello {name}")` / `<T message="Save" />` from an integration package; `lingua extract` turns them into content-hash ids in the source catalog, and untranslated strings still render through the runtime's own formatter.
- **Placeholder protection:** ICU arguments, i18next `{{var}}` / `$t()` nesting, vue-i18n `{name}` / `@:links`, tags and `doNotTranslate` terms are swapped for sentinel tokens before translation and restored afterwards; anything that fails to round-trip is retranslated fragment by fragment and flagged for review.
- **Plural expansion:** plural/select branches are translated as full sentences and expanded to the *target* locale's `Intl.PluralRules` categories (ICU branches, i18next `_one`/`_few`/`_many` keys).
- **Shape preservation:** nested, flat and formatjs `{ defaultMessage, description }` catalogs keep their shape, key order and indentation.
- **Lockfile = diff-only:** `lingua.lock.json` stores the source text behind every translation, so only new or changed strings are sent; catalogs and lockfile are saved after every API batch.
- **Manual overrides preserved:** hand-written or hand-edited translations are recorded as `manual` and never overwritten; when their source changes they are reported as stale instead.
- **Pruning:** target keys no longer in the source are removed unless `--keep-unused`.

Design details: [docs/architecture.md](docs/architecture.md).

## Supported runtimes

| Runtime | Default catalog | Integration package | Inline syntax |
|---|---|---|---|
| next-intl | `messages/{locale}.json` | [`@lingua-api/next-intl`](packages/next-intl/README.md) | `t("Hello {name}", { name })` |
| react-intl | `lang/{locale}.json` | [`@lingua-api/react-intl`](packages/react-intl/README.md) | `t("{count, plural, one {# item} other {# items}}", { count })` |
| i18next | `public/locales/{locale}/{ns}.json` | [`@lingua-api/i18next`](packages/i18next/README.md) | `t({ one: "{{count}} item", other: "{{count}} items" }, { count })` |
| vue-i18n | `src/locales/{locale}.json` | [`@lingua-api/vue-i18n`](packages/vue-i18n/README.md) | `t("one car \| {count} cars", { count })` |

Integration packages are optional — file-based mode only needs the CLI. Point `catalog.pattern` at wherever your runtime actually loads catalogs from.

## Commands

- `lingua init` — create `lingua.config.ts` for the detected runtime.
- `lingua translate` — translate new and changed source strings into every target catalog (`--dry-run`, `--locale`, `--force`, `--keep-unused`).
- `lingua check` — offline check for missing, stale or unreviewed translations; exits 1 on issues.
- `lingua extract` — wrapper mode: collect inline messages from code into the source catalog.
- `lingua watch` — re-run extract + translate when source files change.

Flags, exit codes and programmatic use: [packages/cli/README.md](packages/cli/README.md).

## Cost model

- You are billed for the **characters of source text sent, once per target locale**.
- The first run sends everything; later runs send only new or changed strings.
- `lingua translate --dry-run` prints what would be sent and its character cost without calling the API.
- Cache hits on the Lingua API are still metered, which is why the lockfile — not the API — decides what gets resent. Commit it.
- `lingua watch` translates on every saved change, so autosave while drafting can pay for intermediate versions; use `--no-translate` or turn autosave off while writing.

## CI

```yaml
- run: pnpm lingua check                 # gate: fails when catalogs are out of date; no API key, no requests
- run: pnpm lingua translate --json > lingua-report.json
  env:
    LINGUA_API_KEY: ${{ secrets.LINGUA_API_KEY }}
```

## Examples

- [examples/next-intl-app](examples/next-intl-app/README.md) — Next.js 16 App Router + next-intl 4, Server and Client Components.
- [examples/react-intl-vite](examples/react-intl-vite/README.md) — Vite + React 19 + react-intl with formatjs-shaped catalogs.
- [examples/i18next-react](examples/i18next-react/README.md) — Vite + React 19 + react-i18next with namespaces and plurals.
- [examples/i18next-node](examples/i18next-node/README.md) — plain Node script with i18next.
- [examples/vue-i18n-app](examples/vue-i18n-app/README.md) — Vite + Vue 3.5 + vue-i18n 11 (Composition API).

Each shows file-based keys and inline messages side by side.

## Node support

Every Node 22.x and 24.x minor (`engines: ">=22.0.0"`); CI runs 22.0.0, latest 22, 24.0.0 and latest 24 on Ubuntu and Windows.

## Packages

| Package | Role |
|---|---|
| [`@lingua-api/cli`](packages/cli/README.md) | The `lingua` binary: `init`, `extract`, `translate`, `check`, `watch`. |
| [`@lingua-api/core`](packages/core/README.md) | Config loading, catalog I/O, lockfile, format drivers, runtime presets, translate/check pipeline, extraction. |
| [`@lingua-api/client`](packages/client/README.md) | Zero-dependency HTTP client for the Lingua API with retries and rate-limit-aware scheduling. |
| [`@lingua-api/next-intl`](packages/next-intl/README.md) | Inline-message hooks for next-intl. |
| [`@lingua-api/react-intl`](packages/react-intl/README.md) | Inline-message hooks for react-intl. |
| [`@lingua-api/i18next`](packages/i18next/README.md) | Inline-message translator for i18next (+ React entry). |
| [`@lingua-api/vue-i18n`](packages/vue-i18n/README.md) | Inline-message composable for vue-i18n. |
| `packages/shared` (private) | `messageId()`; bundled into every package that uses it. |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
