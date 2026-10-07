import { messageId } from "@lingua-api/shared";
import { LinguaError } from "../errors";
import type { ExtractedLocation, ExtractedMessage, ExtractOptions, ExtractWarning } from "./types";

type Oxc = typeof import("oxc-parser");
// oxc-parser is ESM-only; a static import would break require() of the CJS build on Node < 22.12.
let parser: Promise<Oxc> | undefined;
export const loadParser = () => (parser ??= import("oxc-parser"));

interface Node {
  type: string;
  start: number;
  [key: string]: unknown;
}

/** Static string fields of a message descriptor or i18next plural object. */
export type Fields = Record<string, string>;
export type StaticValue = string | Fields | undefined;

export interface Attribute {
  name: string;
  value: StaticValue;
  location: ExtractedLocation;
}

const DESCRIPTOR_KEYS = ["message", "context", "id", "comment"];
const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"];
const FIELD_KEYS = new Set([...DESCRIPTOR_KEYS, ...PLURAL_CATEGORIES]);
const MEMBERS = ["rich", "markup", "has"];
const SKIPPED_KEYS = new Set(["parent", "loc", "range"]);

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof (value as Node).type === "string";

function walk(value: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      walk(item, visit);
    });
    return;
  }
  if (!isNode(value)) return;
  visit(value);
  Object.entries(value).forEach(([key, child]) => {
    if (typeof child === "object" && child !== null && !SKIPPED_KEYS.has(key)) walk(child, visit);
  });
}

function unwrap(node: Node): Node {
  return node.type === "ParenthesizedExpression" ? unwrap(node.expression as Node) : node;
}

function propertyName(key: Node): unknown {
  return key.type === "Identifier" ? key.name : key.type === "Literal" ? key.value : undefined;
}

/** A string literal, an expression-free template, or an object of static descriptor/plural fields. */
export function staticValue(input: Node | null | undefined): StaticValue {
  if (!input) return undefined;
  const node = unwrap(input);
  if (node.type === "Literal") return typeof node.value === "string" ? node.value : undefined;
  if (node.type === "TemplateLiteral") {
    const [quasi, ...rest] = node.quasis as Node[];
    return rest.length === 0
      ? ((quasi?.value as { cooked?: string } | undefined)?.cooked ?? undefined)
      : undefined;
  }
  if (node.type !== "ObjectExpression") return undefined;
  const fields: Fields = {};
  const isStatic = (node.properties as Node[]).every((property) => {
    if (property.type !== "Property" || property.computed) return false;
    const name = propertyName(property.key as Node);
    if (typeof name !== "string" || !FIELD_KEYS.has(name)) return true;
    const value = staticValue(property.value as Node);
    if (typeof value !== "string") return false;
    fields[name] = value;
    return true;
  });
  return isStatic ? fields : undefined;
}

/** Parses a single expression (e.g. a Vue binding) and evaluates it with `staticValue`. */
export function staticExpression(code: string, { parseSync }: Oxc): StaticValue {
  const { program, errors } = parseSync("expression.ts", `(${code});`);
  const [statement] = program.body as unknown as Node[];
  return errors.length === 0 && statement?.type === "ExpressionStatement"
    ? staticValue(statement.expression as Node)
    : undefined;
}

export function toMessage(
  fields: Fields,
  location: ExtractedLocation,
): ExtractedMessage | undefined {
  const { message, context, id, comment, other } = fields;
  const text = other ?? message;
  if (text === undefined) return undefined;
  const plural =
    other === undefined
      ? undefined
      : Object.fromEntries(
          PLURAL_CATEGORIES.flatMap((category) => {
            const form = fields[category];
            return form === undefined ? [] : [[category, form]];
          }),
        );
  return {
    id: id ?? messageId(text, context),
    message: text,
    context,
    comment,
    plural,
    locations: [location],
  };
}

/** `<T message context id comment />` from already-evaluated attributes (JSX or Vue). */
export function fromElement(
  tag: string,
  attributes: Attribute[],
  location: ExtractedLocation,
): { message?: ExtractedMessage; warnings: ExtractWarning[] } {
  const fields: Fields = {};
  const warnings: ExtractWarning[] = [];
  attributes
    .filter(({ name }) => DESCRIPTOR_KEYS.includes(name))
    .forEach(({ name, value, location: at }) => {
      if (typeof value === "string") fields[name] = value;
      // i18next plural object: its own context/id win, as in `<T>` of @lingua-api/i18next.
      else if (name === "message" && value?.other !== undefined) Object.assign(fields, value);
      else
        warnings.push({ ...at, message: `Dynamic ${name} passed to <${tag}> cannot be extracted` });
    });
  if (warnings.length > 0) return { warnings };
  const message = toMessage(fields, location);
  return message
    ? { message, warnings }
    : { warnings: [{ ...location, message: `<${tag}> has no message attribute` }] };
}

export function compareLocations(a: ExtractedLocation, b: ExtractedLocation): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.line - b.line || a.column - b.column;
}

const describe = (message: ExtractedMessage) => {
  const at = message.locations[0];
  return `${JSON.stringify(message.message)} at ${at?.file}:${at?.line}:${(at?.column ?? 0) + 1}`;
};

/** Merges messages with the same id; the same id with a different text is an error. */
export function mergeMessages(messages: ExtractedMessage[]): ExtractedMessage[] {
  const byId = new Map<string, ExtractedMessage>();
  messages.forEach((message) => {
    const existing = byId.get(message.id);
    if (!existing) {
      byId.set(message.id, { ...message, locations: [...message.locations] });
      return;
    }
    if (
      existing.message !== message.message ||
      JSON.stringify(existing.plural) !== JSON.stringify(message.plural)
    ) {
      throw new LinguaError(
        `Message id "${message.id}" is used for different messages:\n  ${describe(existing)}\n  ${describe(message)}`,
        "extract",
      );
    }
    existing.locations.push(...message.locations);
  });
  return [...byId.values()]
    .map((message) => ({ ...message, locations: message.locations.sort(compareLocations) }))
    .sort((a, b) =>
      compareLocations(a.locations[0] as ExtractedLocation, b.locations[0] as ExtractedLocation),
    );
}

function calleeName(callee: Node, functionNames: string[]): string | undefined {
  if (callee.type === "Identifier") {
    return functionNames.includes(callee.name as string) ? (callee.name as string) : undefined;
  }
  if (callee.type !== "MemberExpression" || callee.computed) return undefined;
  const object = callee.object as Node;
  const property = callee.property as Node;
  return object.type === "Identifier" &&
    functionNames.includes(object.name as string) &&
    MEMBERS.includes(property.name as string)
    ? `${object.name}.${property.name}`
    : undefined;
}

export async function extractFromSource(
  code: string,
  file: string,
  options: ExtractOptions,
): Promise<{ messages: ExtractedMessage[]; warnings: ExtractWarning[] }> {
  const { parseSync } = await loadParser();
  const { program, errors } = parseSync(file, code, {
    sourceType: "module",
    // oxc rejects JSX in .js files; React projects commonly put it there.
    ...(/\.[cm]?js$/.test(file) ? { lang: "jsx" as const } : {}),
  });
  // oxc offsets are UTF-16 code units, so they index `code` directly.
  const starts = [0, ...[...code.matchAll(/\n/g)].map(({ index }) => index + 1)];
  const at = (offset: number): ExtractedLocation => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] as number) <= offset) low = mid;
      else high = mid - 1;
    }
    return { file, line: low + 1, column: offset - (starts[low] as number) };
  };

  const messages: ExtractedMessage[] = [];
  const warnings: ExtractWarning[] = errors.slice(0, 1).map((error) => ({
    ...at(error.labels[0]?.start ?? 0),
    message: `Parse error: ${error.message}`,
  }));

  walk(program, (node) => {
    if (node.type === "CallExpression") {
      const name = calleeName(node.callee as Node, options.functionNames);
      if (!name) return;
      const [argument] = node.arguments as Node[];
      const value = staticValue(argument);
      const message =
        value === undefined
          ? undefined
          : toMessage(typeof value === "string" ? { message: value } : value, at(node.start));
      if (message) messages.push(message);
      else {
        warnings.push({
          ...at((argument ?? node).start),
          message: `Dynamic message passed to ${name}() cannot be extracted`,
        });
      }
      return;
    }
    if (node.type !== "JSXOpeningElement") return;
    const tag = node.name as Node;
    if (tag.type !== "JSXIdentifier" || !options.componentNames.includes(tag.name as string))
      return;
    const attributes = (node.attributes as Node[]).flatMap((attribute): Attribute[] => {
      const name = attribute.name as Node | undefined;
      if (attribute.type !== "JSXAttribute" || name?.type !== "JSXIdentifier") return [];
      const value = attribute.value as Node | null;
      const expression =
        value?.type === "JSXExpressionContainer" ? (value.expression as Node) : value;
      return [
        {
          name: name.name as string,
          value: staticValue(expression),
          location: at((expression ?? attribute).start),
        },
      ];
    });
    const result = fromElement(tag.name as string, attributes, at(node.start));
    if (result.message) messages.push(result.message);
    warnings.push(...result.warnings);
  });

  return { messages: mergeMessages(messages), warnings };
}
