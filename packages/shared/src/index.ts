export interface MessageDescriptor {
  message: string;
  context?: string;
  id?: string;
}

export type Message = string | MessageDescriptor;

/** Stable content hash used as the catalog key for inline messages (cyrb53 → base36). */
export function messageId(message: string, context?: string): string {
  // split("") yields UTF-16 code units, matching the reference charCodeAt loop.
  let [h1, h2] = `${context ?? ""}\u0000${message}`.split("").reduce<[number, number]>(
    ([a, b], char) => {
      const ch = char.charCodeAt(0);
      return [Math.imul(a ^ ch, 2654435761), Math.imul(b ^ ch, 1597334677)];
    },
    [0xdeadbeef, 0x41c6ce57],
  );
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Resolves a Message to { id, message, context }: explicit id wins, else messageId(message, context). */
export function resolveMessage(message: Message): {
  id: string;
  message: string;
  context: string | undefined;
} {
  const descriptor: MessageDescriptor = typeof message === "string" ? { message } : message;
  const { message: text, context, id } = descriptor;
  return { id: id ?? messageId(text, context), message: text, context };
}
