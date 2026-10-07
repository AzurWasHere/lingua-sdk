export type PathSegment = string | number;
export type KeyPath = PathSegment[];

/** RFC 6901 JSON Pointer. */
export function toPointer(path: KeyPath): string {
  return path
    .map((segment) => `/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`)
    .join("");
}

export function fromPointer(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

export function pathEquals(a: KeyPath, b: KeyPath): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i]);
}
