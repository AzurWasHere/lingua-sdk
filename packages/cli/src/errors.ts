import { LinguaError } from "@lingua-api/core";

/** Bad command line: unknown command or flag, missing value. Exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface DescribedError {
  message: string;
  hint?: string;
  exitCode: 1 | 2;
}

interface ApiErrorLike {
  status: number;
  code: string;
  message: string;
}

// Duck-typed: the CLI does not depend on @lingua-api/client directly.
const isApiError = (err: unknown): err is ApiErrorLike =>
  err instanceof Error &&
  err.name === "LinguaApiError" &&
  typeof Reflect.get(err, "status") === "number";

export function describeError(err: unknown, apiKeyEnv = "LINGUA_API_KEY"): DescribedError {
  if (err instanceof UsageError) {
    return { message: err.message, hint: "Run `lingua --help` for usage.", exitCode: 2 };
  }
  if (isApiError(err)) {
    if (err.status === 401) {
      return {
        message: `Invalid API key — check ${apiKeyEnv}`,
        hint: "Set it in .env.local or the environment; keys start with lk_live_.",
        exitCode: 1,
      };
    }
    if (err.status === 402) {
      return {
        message: "Monthly quota exhausted and overage disabled for this API key.",
        hint: "Translations received before this point were saved. Enable overage or upgrade the plan, then run `lingua translate` again.",
        exitCode: 1,
      };
    }
    const status = err.status === 0 ? "network" : `HTTP ${err.status}`;
    return { message: `Lingua API error (${status}, ${err.code}): ${err.message}`, exitCode: 1 };
  }
  if (err instanceof LinguaError) {
    return { message: err.message, exitCode: err.code === "auth" || err.code === "config" ? 2 : 1 };
  }
  return { message: err instanceof Error ? err.message : String(err), exitCode: 1 };
}
