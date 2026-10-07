import { assertBatch } from "./batches";
import { LinguaApiError } from "./errors";
import { createScheduler } from "./scheduler";
import type {
  ClientOptions,
  Language,
  LinguaClient,
  RateLimit,
  TranslateBatchResult,
  TranslateResult,
  Translation,
} from "./types";

export const DEFAULT_BASE_URL = "https://api.lingua-api.com";
const MAX_CONSECUTIVE_429 = 20;

const num = (headers: Headers, name: string): number | null => {
  const value = headers.get(name)?.trim();
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function parseRateLimit(headers: Headers): RateLimit {
  return {
    limit: num(headers, "X-RateLimit-Limit"),
    remaining: num(headers, "X-RateLimit-Remaining"),
    resetAt: num(headers, "X-RateLimit-Reset"),
    includedRemaining: num(headers, "X-Usage-Included-Remaining"),
  };
}

const parseErrorBody = (body: string): { code?: unknown; message?: unknown } => {
  try {
    return JSON.parse(body)?.error ?? {};
  } catch {
    return {};
  }
};

const toTransportError = (error: unknown): unknown => {
  const name = (error as Error | undefined)?.name;
  if (name === "AbortError" || name === "TimeoutError") {
    return new LinguaApiError({ status: 0, code: "timeout", message: "Request timed out" });
  }
  if (error instanceof TypeError) {
    return new LinguaApiError({ status: 0, code: "network_error", message: error.message });
  }
  return error;
};

const backoff = (attempt: number) =>
  Math.min(500 * 2 ** attempt, 8000) * (1 + Math.random() * 0.25);

export function createClient(options: ClientOptions): LinguaClient {
  const {
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = 60_000,
    maxRetries = 5,
    concurrency = 4,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = options;
  const root = baseUrl.replace(/\/+$/, "");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "@lingua-api/client",
  };
  const scheduler = createScheduler({ concurrency, sleep, now });
  let batchSupported: boolean | null = null;

  const attempt = async (method: string, path: string, body: unknown) => {
    const { res, text } = await scheduler
      .schedule(async () => {
        const res = await fetchImpl(`${root}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        return { res, text: await res.text() };
      })
      .catch((error: unknown) => {
        throw toTransportError(error);
      });
    const rateLimit = parseRateLimit(res.headers);
    if (rateLimit.limit) scheduler.setLimit(rateLimit.limit);
    if (!res.ok) {
      const { code, message } = parseErrorBody(text);
      throw new LinguaApiError({
        status: res.status,
        code: typeof code === "string" ? code : "http_error",
        message: typeof message === "string" ? message : `HTTP ${res.status}`,
        retryAfter: num(res.headers, "Retry-After"),
        rateLimit,
      });
    }
    return { data: JSON.parse(text) as unknown, rateLimit };
  };

  const send = async <T>(
    method: string,
    path: string,
    body?: unknown,
    retries = 0,
    throttled = 0,
  ): Promise<{ data: T; rateLimit: RateLimit }> => {
    try {
      return (await attempt(method, path, body)) as { data: T; rateLimit: RateLimit };
    } catch (error) {
      if (!(error instanceof LinguaApiError)) throw error;
      if (error.status === 429 && throttled + 1 < MAX_CONSECUTIVE_429) {
        await sleep((error.retryAfter ?? 1) * 1000);
        return send(method, path, body, retries, throttled + 1);
      }
      if ((error.status === 0 || error.status >= 500) && retries < maxRetries) {
        await sleep(backoff(retries));
        return send(method, path, body, retries + 1, 0);
      }
      throw error;
    }
  };

  const translate: LinguaClient["translate"] = async (params) => {
    const { data, rateLimit } = await send<Translation>("POST", "/v1/translate", params);
    return { ...data, rateLimit };
  };

  const translateBatch: LinguaClient["translateBatch"] = async (params) => {
    assertBatch(params.texts);
    if (batchSupported !== false) {
      try {
        const { data, rateLimit } = await send<Omit<TranslateBatchResult, "rateLimit">>(
          "POST",
          "/v1/translate/batch",
          params,
        );
        batchSupported = true;
        return { ...data, rateLimit };
      } catch (error) {
        if (!(error instanceof LinguaApiError && error.status === 404)) throw error;
        batchSupported = false;
      }
    }
    const { texts, ...rest } = params;
    let rateLimit: RateLimit | undefined;
    const results = await Promise.all(
      texts.map((text) =>
        translate({ ...rest, text }).then((result: TranslateResult) => {
          rateLimit = result.rateLimit;
          return result;
        }),
      ),
    );
    const translations = results.map(({ rateLimit: _, ...translation }) => translation);
    return {
      translations,
      engine: (translations[0] as Translation).engine,
      characters: translations.reduce((sum, t) => sum + t.characters, 0),
      rateLimit: rateLimit as RateLimit,
    };
  };

  const languages = async (): Promise<Language[]> =>
    (await send<{ languages: Language[] }>("GET", "/v1/languages")).data.languages;

  return {
    translate,
    translateBatch,
    languages,
    get batchSupported() {
      return batchSupported;
    },
  };
}
