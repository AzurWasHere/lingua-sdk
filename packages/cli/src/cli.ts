import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type ParseArgsConfig, parseArgs } from "node:util";
import pc from "picocolors";
import { runCheck } from "./commands/check";
import { runExtract } from "./commands/extract";
import { init } from "./commands/init";
import { runTranslate } from "./commands/translate";
import { runWatch } from "./commands/watch";
import { UsageError } from "./errors";
import { type Context, log, logErr, printError, setColors } from "./output";

export interface MainIo {
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  cwd?: string;
}

type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

const OPTIONS = {
  cwd: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  "no-color": { type: "boolean" },
  runtime: { type: "string" },
  source: { type: "string" },
  targets: { type: "string" },
  pattern: { type: "string" },
  force: { type: "boolean" },
  "dry-run": { type: "boolean" },
  locale: { type: "string", multiple: true },
  "keep-unused": { type: "boolean" },
  "no-extract": { type: "boolean" },
  "no-translate": { type: "boolean" },
  debounce: { type: "string" },
} satisfies ParseArgsConfig["options"];

const GLOBAL_FLAGS: [string, string][] = [
  ["--cwd <dir>", "Run as if started in <dir>"],
  ["--json", "Print machine-readable JSON on stdout"],
  ["--no-color", "Disable colors (also NO_COLOR=1)"],
  ["-h, --help", "Show help"],
  ["-v, --version", "Show the version"],
];

const LOCALE_FLAG: [string, string] = ["--locale <a,b>", "Only these target locales (repeatable)"];

const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

interface Command {
  summary: string;
  flags: [string, string][];
  run: (ctx: Context, values: Values) => Promise<number>;
}

const COMMANDS: Record<string, Command> = {
  init: {
    summary: "Create lingua.config.ts for this project",
    flags: [
      ["--runtime <name>", "next-intl | react-intl | i18next | vue-i18n (default: detected)"],
      ["--source <locale>", "Source locale (default: en)"],
      ["--targets <a,b,c>", "Target locales (default: es,fr,de)"],
      ["--pattern <pattern>", "Catalog path pattern with {locale} (default: the runtime's)"],
      ["--force", "Overwrite an existing config"],
    ],
    run: (ctx, v) =>
      init(ctx, {
        runtime: v.runtime as string | undefined,
        source: v.source as string | undefined,
        targets: typeof v.targets === "string" ? list(v.targets) : undefined,
        pattern: v.pattern as string | undefined,
        force: v.force === true,
      }),
  },
  extract: {
    summary: "Collect inline messages from code into the source catalog (wrapper mode)",
    flags: [["--dry-run", "Report changes without writing"]],
    run: (ctx, v) => runExtract(ctx, { dryRun: v["dry-run"] === true }),
  },
  translate: {
    summary: "Machine-translate new and changed source strings into every target catalog",
    flags: [
      ["--dry-run", "Show what would be sent and its character cost; send and write nothing"],
      LOCALE_FLAG,
      ["--force", "Retranslate every key that is not a manual override"],
      ["--keep-unused", "Keep target keys that are no longer in the source"],
      ["--no-extract", "Wrapper mode: skip the automatic `lingua extract`"],
    ],
    run: (ctx, v) =>
      runTranslate(ctx, {
        dryRun: v["dry-run"] === true,
        locales: locales(v),
        force: v.force === true,
        keepUnused: v["keep-unused"] === true,
        extract: v["no-extract"] !== true,
      }),
  },
  check: {
    summary: "Verify catalogs are complete and up to date (offline; exit 1 on issues)",
    flags: [LOCALE_FLAG],
    run: (ctx, v) => runCheck(ctx, { locales: locales(v) }),
  },
  watch: {
    summary: "Re-run extract and translate when source files change",
    flags: [
      ["--no-translate", "Only extract"],
      ["--debounce <ms>", "Wait this long after the last change (default: 300)"],
    ],
    run: (ctx, v) => {
      const debounce = v.debounce === undefined ? undefined : Number(v.debounce);
      if (debounce !== undefined && !(Number.isInteger(debounce) && debounce >= 0)) {
        throw new UsageError("--debounce must be a whole number of milliseconds.");
      }
      return runWatch(ctx, { translate: v["no-translate"] !== true, debounce });
    },
  },
};

function locales(values: Values): string[] | undefined {
  const given = values.locale;
  return Array.isArray(given) ? given.flatMap((value) => list(String(value))) : undefined;
}

const flagName = (flag: string) => /--([\w-]+)/.exec(flag)?.[1] ?? "";
const dash = (name: string) => (name.length === 1 ? `-${name}` : `--${name}`);

// `strict: false` keeps parsing lenient; this restores the checks with friendlier messages.
function validate(values: Values, command: Command): void {
  const allowed = new Set([...GLOBAL_FLAGS, ...command.flags].map(([flag]) => flagName(flag)));
  Object.entries(values).forEach(([name, value]) => {
    if (!allowed.has(name)) throw new UsageError(`Unknown option ${dash(name)}.`);
    const { type } = OPTIONS[name as keyof typeof OPTIONS];
    const items = Array.isArray(value) ? value : [value];
    if (type === "string" && items.some((item) => typeof item !== "string")) {
      throw new UsageError(`${dash(name)} needs a value.`);
    }
    if (type === "boolean" && items.some((item) => item !== true)) {
      throw new UsageError(`${dash(name)} does not take a value.`);
    }
  });
}

const rows = (flags: [string, string][]) => {
  const width = Math.max(...flags.map(([flag]) => flag.length));
  return flags.map(([flag, text]) => `  ${flag.padEnd(width)}  ${text}`);
};

const usage = () => {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  return [
    "Usage: lingua <command> [options]",
    "",
    "Commands:",
    ...Object.entries(COMMANDS).map(([name, { summary }]) => `  ${name.padEnd(width)}  ${summary}`),
    "",
    "Global options:",
    ...rows(GLOBAL_FLAGS),
    "",
    "Run `lingua <command> --help` for the command's options.",
  ];
};

const commandUsage = (name: string, command: Command) => [
  `Usage: lingua ${name} [options]`,
  "",
  command.summary,
  "",
  "Options:",
  ...rows(command.flags),
  "",
  "Global options:",
  ...rows(GLOBAL_FLAGS),
];

export async function main(argv: string[], io: MainIo = {}): Promise<number> {
  const base = io.cwd ?? process.cwd();
  const ctx: Context = {
    cwd: base,
    json: false,
    stdout: io.stdout ?? ((s) => process.stdout.write(s)),
    stderr: io.stderr ?? ((s) => process.stderr.write(s)),
  };
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: false,
      options: OPTIONS,
    }) as { values: Values; positionals: string[] };
    setColors(values["no-color"] !== true && pc.isColorSupported);
    if (values.version === true) {
      const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
      log(ctx, pkg.version);
      return 0;
    }
    const [name, ...extra] = positionals;
    if (name === undefined) {
      if (values.help === true) log(ctx, ...usage());
      else logErr(ctx, ...usage());
      return values.help === true ? 0 : 2;
    }
    const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
    if (!command) throw new UsageError(`Unknown command "${name}".`);
    if (values.help === true) {
      log(ctx, ...commandUsage(name, command));
      return 0;
    }
    validate(values, command);
    if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}".`);
    ctx.json = values.json === true;
    if (typeof values.cwd === "string") ctx.cwd = resolve(base, values.cwd);
    return await command.run(ctx, values);
  } catch (error) {
    return printError(ctx, error);
  }
}
