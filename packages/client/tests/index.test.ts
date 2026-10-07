import { describe, expect, it, vi } from "vitest";
import {
  type ClientOptions,
  createClient,
  LinguaApiError,
  parseRateLimit,
  type Translation,
} from "../src/index";

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;
type Handler = (url: string, body: unknown) => Reply | Promise<Reply>;

const tr = (text: string): Translation => ({
  text,
  detected: "en",
  confidence: 0.9,
  engine: "deepl",
  characters: text.length,
});
const apiError = (status: number, code: string, headers?: Record<string, string>): Reply => ({
  status,
  body: { error: { code, message: code } },
  headers,
});
const queue =
  (...replies: Reply[]): Handler =>
  () => {
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected extra request");
    return reply;
  };

function setup(handler: Handler, options: Partial<ClientOptions> = {}) {
  let clock = 0;
  // Concurrent sleepers overlap like real timers instead of adding up.
  const sleep = vi.fn(async (ms: number) => {
    const wake = clock + ms;
    await new Promise((resolve) => setImmediate(resolve));
    clock = Math.max(clock, wake);
  });
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const reply = await handler(String(input), body);
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: reply.headers,
    });
  });
  const client = createClient({
    apiKey: "lk_test_123",
    fetch: fetch as typeof globalThis.fetch,
    sleep,
    now: () => clock,
    ...options,
  });
  return { client, fetch, sleep, now: () => clock };
}

const urlOf = (fetch: ReturnType<typeof setup>["fetch"], call: number) =>
  String(fetch.mock.calls[call]?.[0]);

describe("translate", () => {
  it("returns the body with parsed rate-limit headers and sends auth headers", async () => {
    const { client, fetch } = setup(
      queue({
        body: tr("Hola"),
        headers: {
          "X-RateLimit-Limit": "10",
          "X-RateLimit-Remaining": "9",
          "X-RateLimit-Reset": "1700000000",
          "X-Usage-Included-Remaining": "4990",
        },
      }),
    );
    const result = await client.translate({ text: "Hello", target: "es", source: "en" });
    expect(result).toEqual({
      ...tr("Hola"),
      rateLimit: { limit: 10, remaining: 9, resetAt: 1700000000, includedRemaining: 4990 },
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.lingua-api.com/v1/translate");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer lk_test_123",
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "@lingua-api/client",
    });
    expect(JSON.parse(String(init?.body))).toEqual({ text: "Hello", target: "es", source: "en" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("parseRateLimit returns null for absent or non-numeric headers", () => {
    expect(
      parseRateLimit(new Headers({ "X-RateLimit-Limit": "abc", "X-RateLimit-Reset": "" })),
    ).toEqual({ limit: null, remaining: null, resetAt: null, includedRemaining: null });
  });

  it("honours Retry-After on 429, then succeeds", async () => {
    const { client, fetch, sleep } = setup(
      queue(apiError(429, "rate_limited", { "Retry-After": "2" }), { body: tr("Hola") }),
    );
    await expect(client.translate({ text: "Hello", target: "es" })).resolves.toMatchObject({
      text: "Hola",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("gives up after 20 consecutive 429s", async () => {
    const { client, fetch } = setup(() => apiError(429, "rate_limited"), { maxRetries: 0 });
    await expect(client.translate({ text: "Hello", target: "es" })).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
    expect(fetch).toHaveBeenCalledTimes(20);
  });

  it("retries 503 maxRetries times with growing backoff, then throws", async () => {
    const { client, fetch, sleep } = setup(() => apiError(503, "engine_unavailable"), {
      maxRetries: 5,
    });
    const error = await client.translate({ text: "Hello", target: "es" }).catch((e) => e);
    expect(error).toBeInstanceOf(LinguaApiError);
    expect(error).toMatchObject({ status: 503, code: "engine_unavailable" });
    expect(fetch).toHaveBeenCalledTimes(6);
    const delays = sleep.mock.calls.map(([ms]) => ms);
    expect(delays).toHaveLength(5);
    [500, 1000, 2000, 4000, 8000].forEach((base, i) => {
      expect(delays[i]).toBeGreaterThanOrEqual(base);
      expect(delays[i]).toBeLessThanOrEqual(base * 1.25);
    });
  });

  it.each([
    [400, "invalid_request"],
    [401, "invalid_key"],
    [402, "quota_exceeded"],
  ])("throws %i immediately without retrying", async (status, code) => {
    const { client, fetch, sleep } = setup(queue(apiError(status, code)));
    await expect(client.translate({ text: "Hello", target: "es" })).rejects.toMatchObject({
      status,
      code,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("falls back to http_error when the error body is not JSON", async () => {
    const { client } = setup(queue({ status: 418, body: "nope" }));
    await expect(client.translate({ text: "Hello", target: "es" })).rejects.toMatchObject({
      status: 418,
      code: "http_error",
      message: "HTTP 418",
    });
  });

  it("retries a network TypeError, then succeeds", async () => {
    const { client, fetch, sleep } = setup(
      queue(new TypeError("fetch failed"), { body: tr("Hola") }),
    );
    await expect(client.translate({ text: "Hello", target: "es" })).resolves.toMatchObject({
      text: "Hola",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("maps timeouts to status 0 / timeout after exhausting retries", async () => {
    const { client, fetch } = setup(() => new DOMException("timed out", "TimeoutError"), {
      maxRetries: 2,
    });
    await expect(client.translate({ text: "Hello", target: "es" })).rejects.toMatchObject({
      status: 0,
      code: "timeout",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("translateBatch", () => {
  it("posts to the batch endpoint and keeps index alignment", async () => {
    const { client, fetch } = setup(
      queue({ body: { translations: [tr("Uno"), tr("Dos")], engine: "deepl", characters: 6 } }),
    );
    const result = await client.translateBatch({ texts: ["One", "Two"], target: "es" });
    expect(urlOf(fetch, 0)).toBe("https://api.lingua-api.com/v1/translate/batch");
    expect(result.translations.map((t) => t.text)).toEqual(["Uno", "Dos"]);
    expect(result).toMatchObject({ engine: "deepl", characters: 6 });
    expect(client.batchSupported).toBe(true);
  });

  it("falls back to single calls on 404 and skips the batch endpoint afterwards", async () => {
    const { client, fetch } = setup((url, body) =>
      url.endsWith("/batch")
        ? apiError(404, "not_found")
        : { body: tr((body as { text: string }).text.toUpperCase()) },
    );
    const texts = ["a", "bb", "ccc"];
    const result = await client.translateBatch({ texts, target: "es" });
    expect(result.translations.map((t) => t.text)).toEqual(["A", "BB", "CCC"]);
    expect(result.characters).toBe(6);
    expect(result.engine).toBe("deepl");
    expect(result.translations[0]).not.toHaveProperty("rateLimit");
    expect(client.batchSupported).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(4);

    await client.translateBatch({ texts, target: "es" });
    expect(fetch).toHaveBeenCalledTimes(7);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/batch"))).toHaveLength(1);
  });

  it.each([
    ["empty", []],
    ["over 100 items", Array.from({ length: 101 }, () => "x")],
    ["blank item", ["ok", "   "]],
    ["oversize item", ["x".repeat(5001)]],
    ["total over 20 000", Array.from({ length: 5 }, () => "x".repeat(4500))],
  ])("rejects %s locally without a network call", async (_, texts) => {
    const { client, fetch } = setup(queue());
    await expect(client.translateBatch({ texts, target: "es" })).rejects.toMatchObject({
      status: 400,
      code: "invalid_request",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("scheduler", () => {
  it("enforces the per-second window once X-RateLimit-Limit is known", async () => {
    const starts: number[] = [];
    const { client, sleep, now } = setup(() => {
      starts.push(now());
      return { body: tr("x"), headers: { "X-RateLimit-Limit": "2" } };
    });
    await client.translate({ text: "x", target: "es" });
    await Promise.all(
      Array.from({ length: 5 }, () => client.translate({ text: "x", target: "es" })),
    );
    expect(sleep).toHaveBeenCalled();
    starts.forEach((t) => {
      expect(starts.filter((s) => s >= t && s < t + 1000).length).toBeLessThanOrEqual(2);
    });
  });

  it("never exceeds concurrency in flight", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { client } = setup(
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight--;
        return { body: tr("x") };
      },
      { concurrency: 2 },
    );
    await Promise.all(
      Array.from({ length: 6 }, () => client.translate({ text: "x", target: "es" })),
    );
    expect(maxInFlight).toBe(2);
  });
});

describe("languages", () => {
  it("returns the array and normalises a trailing slash in baseUrl", async () => {
    const languages = [{ code: "es", name: "Spanish" }];
    const { client, fetch } = setup(queue({ body: { languages } }), {
      baseUrl: "https://example.test//",
    });
    await expect(client.languages()).resolves.toEqual(languages);
    expect(urlOf(fetch, 0)).toBe("https://example.test/v1/languages");
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("GET");
  });
});
