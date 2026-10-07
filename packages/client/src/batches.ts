import { LinguaApiError } from "./errors";

export const MAX_REQUEST_CHARS = 5_000;
export const MAX_BATCH_ITEMS = 100;
export const MAX_BATCH_CHARS = 20_000;

const invalid = (message: string) =>
  new LinguaApiError({ status: 400, code: "invalid_request", message });

/** Greedy packing in input order that respects both batch caps; throws LinguaApiError(400 invalid_request) if any item exceeds MAX_REQUEST_CHARS. */
export function packBatches<T>(items: readonly T[], textOf: (item: T) => string): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let chars = 0;
  items.forEach((item, i) => {
    const n = textOf(item).length;
    if (n > MAX_REQUEST_CHARS) throw invalid(`item ${i} exceeds ${MAX_REQUEST_CHARS} characters`);
    if (current.length === MAX_BATCH_ITEMS || chars + n > MAX_BATCH_CHARS) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += n;
  });
  if (current.length > 0) batches.push(current);
  return batches;
}

export function assertBatch(texts: readonly string[]): void {
  if (texts.length === 0 || texts.length > MAX_BATCH_ITEMS) {
    throw invalid(`texts must contain 1 to ${MAX_BATCH_ITEMS} items`);
  }
  texts.forEach((text, i) => {
    if (text.trim() === "") throw invalid(`texts[${i}] is empty`);
    if (text.length > MAX_REQUEST_CHARS) {
      throw invalid(`texts[${i}] exceeds ${MAX_REQUEST_CHARS} characters`);
    }
  });
  const total = texts.reduce((sum, text) => sum + text.length, 0);
  if (total > MAX_BATCH_CHARS) throw invalid(`texts exceed ${MAX_BATCH_CHARS} characters in total`);
}
