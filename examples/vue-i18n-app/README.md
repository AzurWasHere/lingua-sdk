# vue-i18n example

Vite + Vue 3.5 + vue-i18n 11 (Composition API) with Lingua, both workflows side by side:

- **Catalog keys**: `nav.home` and the `|` plural `cart` in `src/locales/en.json`, rendered with vue-i18n's own `$t()`.
- **Inline messages**: `useTranslations()` and `<T>` from `@lingua-api/vue-i18n` in `src/App.vue`. Their ids are already in `src/locales/en.json`.

The locale is `navigator.language` (`en`, `es` or `fr`; default `en`).

## Run

```sh
pnpm install && pnpm build    # at the repo root
pnpm --filter @lingua-api/example-vue-i18n-app dev
```

## Translate

`src/locales/es.json` and `src/locales/fr.json` are hand-written and there is no `lingua.lock.json` yet, so the first `lingua translate` adopts them as manual overrides and never overwrites them (delete a value to get a machine translation instead).

```sh
cp .env.example .env.local    # then put your API key in it
pnpm lingua extract           # after adding or changing inline messages
pnpm translate
pnpm check                    # offline, no API key needed
```
