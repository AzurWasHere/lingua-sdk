# react-intl example

Vite + React 19 + react-intl with Lingua, both workflows side by side:

- **Catalog keys**: `app.title` in `lang/en.json`, rendered with react-intl's own `<FormattedMessage id="app.title" />`.
- **Inline messages**: `useTranslations()` and `<T>` from `@lingua-api/react-intl` in `src/App.tsx`. Their ids are already in `lang/en.json`.

`lang/*.json` use the formatjs extraction shape (`{ id: { defaultMessage, description } }`), which Lingua preserves. `IntlProvider` needs `{ id: message }`, so `src/messages.ts` flattens the catalog at load time instead of running `formatjs compile`. The locale is `navigator.language` (`en`, `es` or `fr`; default `en`).

## Run

```sh
pnpm install && pnpm build    # at the repo root
pnpm --filter @lingua-api/example-react-intl-vite dev
```

## Translate

`lang/es.json` and `lang/fr.json` are hand-written and there is no `lingua.lock.json` yet, so the first `lingua translate` adopts them as manual overrides and never overwrites them (delete an entry to get a machine translation instead).

```sh
cp .env.example .env.local    # then put your API key in it
pnpm lingua extract           # after adding or changing inline messages
pnpm translate
pnpm check                    # offline, no API key needed
```
