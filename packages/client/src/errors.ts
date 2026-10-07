import type { RateLimit } from "./types";

export const emptyRateLimit = (): RateLimit => ({
  limit: null,
  remaining: null,
  resetAt: null,
  includedRemaining: null,
});

export class LinguaApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number | null;
  readonly rateLimit: RateLimit;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    retryAfter?: number | null;
    rateLimit?: RateLimit;
  }) {
    super(init.message);
    this.name = "LinguaApiError";
    this.status = init.status;
    this.code = init.code;
    this.retryAfter = init.retryAfter ?? null;
    this.rateLimit = init.rateLimit ?? emptyRateLimit();
  }
}
