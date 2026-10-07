# i18next + Node example

A plain Node script with i18next and Lingua, both workflows side by side:

- **Catalog keys**: `farewell` in `locales/en/translation.json`, printed with i18next's own `i18n.t("farewell")`.
- **Inline messages**: `createTranslations(i18n)` from `@lingua-api/i18next` in `src/main.ts`, including the plural object form. Their ids are already in `locales/en/translation.json`.

The catalogs are read with `fs` into `resources`; the script prints the same lines in `en`, `es` and `fr`.

## Run

```sh
pnpm install && pnpm build    # at the repo root
pnpm --filter @lingua-api/example-i18next-node start
```

## Translate

The `es` and `fr` catalogs are hand-written (with the `_many` plural forms Spanish and French need) and there is no `lingua.lock.json` yet, so the first `lingua translate` adopts them as manual overrides and never overwrites them (delete a value to get a machine translation instead).

```sh
cp .env.example .env.local    # then put your API key in it
pnpm lingua extract           # after adding or changing inline messages
pnpm translate
pnpm check                    # offline, no API key needed
```
