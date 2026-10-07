const WINDOW_MS = 1000;

export interface Scheduler {
  schedule<T>(fn: () => Promise<T>): Promise<T>;
  /** Max request starts per 1000 ms window, learned from `X-RateLimit-Limit`. */
  setLimit(perSecond: number): void;
}

export function createScheduler(options: {
  concurrency: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}): Scheduler {
  const { concurrency, sleep, now } = options;
  const waiting: (() => void)[] = [];
  let active = 0;
  let limit: number | null = null;
  let starts: number[] = [];

  const acquire = (): Promise<void> => {
    if (active < concurrency) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };

  // Hands the slot straight to the next waiter so `active` never over-counts.
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  const waitForWindow = async (): Promise<void> => {
    const t = now();
    starts = starts.filter((s) => t - s < WINDOW_MS);
    if (limit === null || starts.length < limit) {
      starts.push(t);
      return;
    }
    await sleep((starts[0] ?? t) + WINDOW_MS - t);
    return waitForWindow();
  };

  return {
    async schedule(fn) {
      await acquire();
      try {
        await waitForWindow();
        return await fn();
      } finally {
        release();
      }
    },
    setLimit(perSecond) {
      limit = perSecond;
    },
  };
}
