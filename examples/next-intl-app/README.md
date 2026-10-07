# next-intl example

Next.js 16 App Router + next-intl 4 with Lingua, both workflows side by side:

- **Catalog keys**: `nav.home` in `messages/en.json`, read with next-intl's own `useTranslations("nav")` in `app/greeting.tsx`.
- **Inline messages**: `await getTranslations()` from `@lingua-api/next-intl/server` in `app/page.tsx` (async Server Component), `useTranslations()` and `<T>` from `@lingua-api/next-intl` in `app/greeting.tsx` (Client Component). Their ids are already in `messages/en.json`.

The locale comes from the `NEXT_LOCALE` cookie (`en`, `es` or `fr`; default `en`), no routing middleware.

## Run

```sh
pnpm install && pnpm build    # at the repo root
pnpm --filter @lingua-api/example-next-intl-app dev
```

## Translate

`messages/es.json` and `messages/fr.json` are hand-written and there is no `lingua.lock.json` yet, so the first `lingua translate` adopts them as manual overrides and never overwrites them (delete a value to get a machine translation instead).

```sh
cp .env.example .env.local    # then put your API key in it
pnpm lingua extract           # after adding or changing inline messages
pnpm translate
pnpm check                    # offline, no API key needed
```
