import { LinguaError } from "../errors";
import {
  type Attribute,
  compareLocations,
  extractFromSource,
  fromElement,
  loadParser,
  mergeMessages,
  staticExpression,
} from "./js";
import type { ExtractedLocation, ExtractedMessage, ExtractOptions, ExtractWarning } from "./types";

/** Vue positions: both line and column are 1-based. */
interface VuePosition {
  line: number;
  column: number;
}
interface VueExpression {
  content: string;
  loc: { start: VuePosition };
}
interface VueProp {
  type: number;
  name: string;
  loc: { start: VuePosition };
  value?: VueExpression;
  arg?: { content: string };
  exp?: VueExpression;
  forParseResult?: { source: VueExpression };
}
interface VueNode {
  type: number;
  tag?: string;
  loc: { start: VuePosition };
  props?: VueProp[];
  children?: VueNode[];
  content?: VueExpression;
}

// @vue/compiler-core NodeTypes
const ELEMENT = 1;
const INTERPOLATION = 5;
const ATTRIBUTE = 6;
const DIRECTIVE = 7;

interface Extracted {
  messages: ExtractedMessage[];
  warnings: ExtractWarning[];
}

/** Maps a location inside an embedded snippet (whose first `prefix` characters were added) back to the .vue file. */
function shift<T extends ExtractedLocation>(
  item: T,
  file: string,
  start: VuePosition,
  prefix: number,
): T {
  return {
    ...item,
    file,
    line: start.line + item.line - 1,
    column: item.line === 1 ? start.column - 1 + item.column - prefix : item.column,
  };
}

function shifted(result: Extracted, file: string, start: VuePosition, prefix: number): Extracted {
  return {
    messages: result.messages.map((message) => ({
      ...message,
      locations: message.locations.map((location) => shift(location, file, start, prefix)),
    })),
    warnings: result.warnings.map((warning) => shift(warning, file, start, prefix)),
  };
}

const locationOf = (file: string, { line, column }: VuePosition): ExtractedLocation => ({
  file,
  line,
  column: column - 1,
});

export async function extractFromVue(
  code: string,
  file: string,
  options: ExtractOptions,
): Promise<Extracted> {
  let sfc: typeof import("@vue/compiler-sfc");
  try {
    sfc = await import("@vue/compiler-sfc");
  } catch (error) {
    throw new LinguaError(
      "Extracting .vue files requires @vue/compiler-sfc — install it as a dev dependency (e.g. `npm i -D @vue/compiler-sfc`).",
      "extract",
      error,
    );
  }
  const oxc = await loadParser();
  const { descriptor, errors } = sfc.parse(code, { filename: file });
  const results: (Extracted | Promise<Extracted>)[] = [];
  const [error] = errors;
  if (error) {
    const start = "loc" in error ? error.loc?.start : undefined;
    results.push({
      messages: [],
      warnings: [
        {
          ...locationOf(file, start ?? { line: 1, column: 1 }),
          message: `Parse error: ${error.message}`,
        },
      ],
    });
  }

  [descriptor.script, descriptor.scriptSetup].forEach((block) => {
    if (!block) return;
    results.push(
      extractFromSource(block.content, `${file}.${block.lang ?? "js"}`, options).then((result) =>
        shifted(result, file, block.loc.start, 0),
      ),
    );
  });

  const expression = (exp: VueExpression, statement: boolean) => {
    // Event handlers may hold statements (`n++; go()`); everything else is a single expression.
    const prefix = statement ? "" : "(";
    const source = statement ? exp.content : `(${exp.content});`;
    results.push(
      extractFromSource(source, `${file}.ts`, options).then((result) =>
        shifted(result, file, exp.loc.start, prefix.length),
      ),
    );
  };

  const visit = (node: VueNode): void => {
    if (node.type === INTERPOLATION && node.content) expression(node.content, false);
    if (node.type !== ELEMENT) return;
    const props = node.props ?? [];
    props.forEach((prop) => {
      if (prop.type !== DIRECTIVE || prop.name === "slot") return;
      const exp = prop.name === "for" ? prop.forParseResult?.source : prop.exp;
      if (exp) expression(exp, prop.name === "on");
    });
    if (node.tag && options.componentNames.includes(node.tag)) {
      const attributes = props.flatMap((prop): Attribute[] => {
        if (prop.type === ATTRIBUTE) {
          return [
            {
              name: prop.name,
              value: prop.value?.content,
              location: locationOf(file, (prop.value ?? prop).loc.start),
            },
          ];
        }
        if (prop.name !== "bind" || !prop.arg) return [];
        return [
          {
            name: prop.arg.content,
            value: prop.exp && staticExpression(prop.exp.content, oxc),
            location: locationOf(file, (prop.exp ?? prop).loc.start),
          },
        ];
      });
      const result = fromElement(node.tag, attributes, locationOf(file, node.loc.start));
      results.push({ messages: result.message ? [result.message] : [], warnings: result.warnings });
    }
    node.children?.forEach(visit);
  };
  (descriptor.template?.ast as VueNode | undefined)?.children?.forEach(visit);

  const extracted = await Promise.all(results);
  return {
    messages: mergeMessages(extracted.flatMap((result) => result.messages)),
    warnings: extracted.flatMap((result) => result.warnings).sort(compareLocations),
  };
}
