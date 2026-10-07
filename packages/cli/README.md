# @lingua-api/cli

The `lingua` binary: keeps your app's translation catalogs in sync with the source-locale catalog by machine-translating through the Lingua API. Supports next-intl, react-intl, i18next and vue-i18n. Node 22+.

## Setup

```sh
pnpm add -D @lingua-api/cli
pnpm lingua init
```

`lingua init` detects the runtime from `package.json` and writes `lingua.config.ts` (`import { defineConfig } from "@lingua-api/cli"`, so only the CLI needs to be installed). Then put the API key in `.env.local` (and make sure `.env.local` is in `.gitignore`):

```sh
LINGUA_API_KEY=lk_live_…
```

The key is only ever read from the environment variable named by `api.keyEnv` (default `LINGUA_API_KEY`); `.env.local` and `.env` in the project root are loaded automatically.

## Commands

Global options: `--cwd <dir>`, `--json`, `--no-color` (or `NO_COLOR=1`), `-h, --help`, `-v, --version`. `lingua <command> --help` lists a command's options.

### `lingua init`

| Flag | |
|---|---|
| `--runtime <name>` | `next-intl`, `react-intl`, `i18next` or `vue-i18n` (default: detected from `package.json`) |
| `--source <locale>` | Source locale (default `en`) |
| `--targets <a,b,c>` | Target locales (default `es,fr,de`) |
| `--pattern <pattern>` | Catalog path with `{locale}` (and optionally `{ns}`); default: the runtime's preset |
| `--force` | Overwrite an existing config |

### `lingua translate`

Translates new and changed source strings into every target catalog and records them in `lingua.lock.json`. Only the diff is sent; unchanged keys are reused. In wrapper mode (`include` set) it runs `lingua extract` first.

| Flag | |
|---|---|
| `--dry-run` | Print what would be sent and its character cost; send and write nothing (in wrapper mode, uses the source catalog as is — run `lingua extract` first) |
| `--locale <a,b>` | Only these target locales (repeatable) |
| `--force` | Retranslate every key that is not a manual override |
| `--keep-unused` | Keep target keys that are no longer in the source |
| `--no-extract` | Wrapper mode: skip the automatic extract |

Progress goes to stderr; the summary table (translated · reused · manual · pruned · review · chars, included characters remaining) and the "Stale manual overrides" / "Needs review" lists go to stdout. `--json` prints the full report instead.

### `lingua check`

Offline: reports missing translations, stale manual overrides, translations that need review, unused target keys and, in wrapper mode, code that is out of sync with the source catalog. Exits 1 when anything is off. Flag: `--locale <a,b>`. `--json` prints `{ ok, issues }`.

### `lingua extract`

Wrapper mode only: collects `t("…")` / `<T message="…" />` calls from the files matched by `include`/`exclude` into the source catalog. Flag: `--dry-run`. `--json` prints the report. Two different messages with the same id exit 1.

### `lingua watch`

Watches the source catalog (and, in wrapper mode, the `include` directories) and re-runs extract + translate after each change.

| Flag | |
|---|---|
| `--no-translate` | Only extract |
| `--debounce <ms>` | Wait this long after the last change (default 300) |

Without an API key it warns once and only extracts. Errors are printed and watching continues. Ctrl-C stops after the current run finishes.

**Cost note:** translation is diff-only, so unchanged strings are never resent — but every saved edit of a string is a new string. Autosave while typing a sentence can translate several intermediate versions; turn autosave off or use `--no-translate` while drafting.

## Manual overrides

Hand-edit any value in a target catalog and `lingua` keeps it: it is recorded as `manual` in the lockfile and never overwritten. When its source string changes later, it is listed under "Stale manual overrides" instead of being retranslated. Delete the value from the target catalog to get a fresh machine translation on the next run.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | The command found problems or the API refused: `check` issues, quota exhausted (402), invalid API key (401), other API errors, extraction id collisions, unreadable catalogs |
| `2` | Usage or config error: unknown command or flag, missing/invalid config, missing API key |

## CI

```yaml
- run: pnpm lingua check                 # gate: fails the build when catalogs are out of date
- run: pnpm lingua translate --json > lingua-report.json
  env:
    LINGUA_API_KEY: ${{ secrets.LINGUA_API_KEY }}
```

`check` needs no API key and makes no requests.

## Programmatic use

```ts
import { main } from "@lingua-api/cli";

const exitCode = await main(["check", "--json"], { cwd: "/path/to/app", stdout: (s) => {} });
```

The command functions (`init`, `runExtract`, `runTranslate`, `runCheck`, `runWatch`) and `describeError` are exported too.
