# i18next + React example

Vite + React 19 + i18next / react-i18next with Lingua, both workflows side by side:

- **Catalog keys**: `welcome` and `item_one`/`item_other` in `public/locales/en/translation.json`, `footer` in `public/locales/en/common.json`, rendered with react-i18next's own `useTranslation()` / `useTranslation("common")`.
- **Inline messages**: `useTranslations()` and `<T>` (including the plural object form with `count`) from `@lingua-api/i18next/react` in `src/App.tsx`. Their ids are already in `public/locales/en/translation.json`.

The catalogs are bundled with `import.meta.glob` (no HTTP backend, works offline). The locale is `navigator.language` (`en`, `es` or `fr`; falls back to `en`).

## Run

```sh
pnpm install && pnpm build    # at the repo root
pnpm --filter @lingua-api/example-i18next-react dev
```

## Translate

The `es` and `fr` catalogs are hand-written (with the `_many` plural forms Spanish and French need) and there is no `lingua.lock.json` yet, so the first `lingua translate` adopts them as manual overrides and never overwrites them (delete a value to get a machine translation instead).

```sh
cp .env.example .env.local    # then put your API key in it
pnpm lingua extract           # after adding or changing inline messages
pnpm translate
pnpm check                    # offline, no API key needed
```
