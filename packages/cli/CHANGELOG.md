# @lingua-api/cli

## 0.1.0

### Minor Changes

- 0555ab6: Initial release: the `lingua` CLI (`init`, `extract`, `translate`, `check`, `watch`) keeps next-intl, react-intl, i18next and vue-i18n catalogs in sync with the source-locale catalog by machine-translating through the Lingua API. Catalog shape, key order and indentation are preserved; ICU, i18next and vue-i18n placeholders, tags and `doNotTranslate` terms are protected with sentinel tokens; plural/select branches are translated as full sentences and expanded to each target locale's plural categories; `lingua.lock.json` makes every run diff-only, keeps hand-edited translations as manual overrides and powers the offline `lingua check` CI gate. The optional `@lingua-api/next-intl`, `@lingua-api/react-intl`, `@lingua-api/i18next` and `@lingua-api/vue-i18n` integrations add `useTranslations` / `createTranslations` / `<T>` for writing source strings inline with content-hash ids and native runtime fallback, and `@lingua-api/client` is the zero-dependency HTTP client with retries and rate-limit-aware scheduling.

### Patch Changes

- Updated dependencies [0555ab6]
  - @lingua-api/core@0.1.0
