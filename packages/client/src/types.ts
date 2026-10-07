export type Engine = "libre" | "deepl";

export interface TranslateParams {
  text: string;
  target: string;
  source?: string;
  engine?: Engine;
}

export interface TranslateBatchParams {
  texts: string[];
  target: string;
  source?: string;
  engine?: Engine;
}

export interface Translation {
  text: string;
  detected: string;
  confidence: number | null;
  engine: Engine;
  characters: number;
}

export interface RateLimit {
  limit: number | null;
  remaining: number | null;
  /** Unix seconds, as sent in `X-RateLimit-Reset`. */
  resetAt: number | null;
  includedRemaining: number | null;
}

export interface TranslateResult extends Translation {
  rateLimit: RateLimit;
}

export interface TranslateBatchResult {
  translations: Translation[];
  engine: Engine;
  characters: number;
  rateLimit: RateLimit;
}

export interface Language {
  code: string;
  name: string;
}

export interface ClientOptions {
  apiKey: string;
  /** Default `https://api.lingua-api.com`; a trailing slash is tolerated. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Default 60 000. */
  timeoutMs?: number;
  /** Retries for 5xx / network / timeout. Default 5. */
  maxRetries?: number;
  /** Max in-flight requests. Default 4. */
  concurrency?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Clock in ms. Default `Date.now`. */
  now?: () => number;
}

export interface LinguaClient {
  translate(params: TranslateParams): Promise<TranslateResult>;
  translateBatch(params: TranslateBatchParams): Promise<TranslateBatchResult>;
  languages(): Promise<Language[]>;
  /** `null` until known; `false` after the batch endpoint returned 404. */
  readonly batchSupported: boolean | null;
}
