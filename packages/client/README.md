# @lingua-api/client

Zero-dependency Node (≥ 22) client for the [Lingua API](https://api.lingua-api.com): `translate`, `translateBatch`, `languages`, with retries and rate-limit-aware scheduling.

```ts
import { createClient, LinguaApiError, packBatches } from "@lingua-api/client";

const client = createClient({ apiKey: process.env.LINGUA_API_KEY ?? "" });

try {
  for (const texts of packBatches(["Hello", "Save", "Cancel"], (t) => t)) {
    const { translations, characters, rateLimit } = await client.translateBatch({
      texts,
      target: "es",
      source: "en",
    });
    console.log(translations.map((t) => t.text), characters, rateLimit.includedRemaining);
  }
} catch (error) {
  if (error instanceof LinguaApiError && error.code === "quota_exceeded") {
    console.error("Out of quota:", error.message);
  } else {
    throw error;
  }
}
```

- `429` is retried after `Retry-After`; `5xx`, network errors and timeouts are retried with exponential backoff (`maxRetries`, default 5). Other `4xx` throw immediately.
- At most `concurrency` (default 4) requests are in flight; once `X-RateLimit-Limit` is seen, request starts are capped to that many per second.
- If `/v1/translate/batch` returns `404`, `translateBatch` falls back to single `translate` calls (`client.batchSupported === false`).
- Errors are `LinguaApiError` with `status`, `code`, `retryAfter` and `rateLimit`; network failures and timeouts use `status: 0` with `network_error` / `timeout`.
