import { relative } from "node:path";
import type { CheckIssue, ExtractReport, ProgressEvent, TranslateReport } from "@lingua-api/core";
import pc from "picocolors";
import { describeError } from "./errors";

export interface Context {
  cwd: string;
  json: boolean;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

export let c = pc.createColors(pc.isColorSupported);

export function setColors(enabled: boolean): void {
  c = pc.createColors(enabled);
}

export const log = (ctx: Context, ...lines: string[]) => ctx.stdout(`${lines.join("\n")}\n`);
export const logErr = (ctx: Context, ...lines: string[]) => ctx.stderr(`${lines.join("\n")}\n`);

export const num = (n: number) => n.toLocaleString("en-US");

/** Lockfile entry keys are `<ns>|<pointer>`; drop the separator when there is no namespace. */
export const showKey = (key: string) => (key.startsWith("|") ? key.slice(1) : key);

/** Prints the error and returns its exit code. */
export function printError(ctx: Context, err: unknown, apiKeyEnv?: string): 1 | 2 {
  const { message, hint, exitCode } = describeError(err, apiKeyEnv);
  logErr(ctx, c.red(`✗ ${message}`), ...(hint ? [c.dim(hint)] : []));
  return exitCode;
}

function table(rows: string[][]): string[] {
  const widths = (rows[0] ?? []).map((_, i) => Math.max(...rows.map((row) => row[i]?.length ?? 0)));
  return rows.map((row) =>
    row
      .map((cell, i) => (i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0)))
      .join("  "),
  );
}

export function formatExtract(report: ExtractReport, root: string, dryRun = false): string[] {
  const file = relative(root, report.file).replaceAll("\\", "/");
  return [
    `${dryRun ? "Would extract" : "Extracted"} ${num(report.messages)} messages from ${num(report.files)} files → ${file}`,
    `  ${c.green(`+${report.added.length} added`)} · ${c.cyan(`~${report.updated.length} updated`)} · ${c.red(`-${report.removed.length} removed`)} · ${report.unchanged} unchanged`,
    ...report.added.map((id) => c.green(`  + ${id}`)),
    ...report.removed.map((id) => c.red(`  - ${id}`)),
  ];
}

export function formatWarnings(report: ExtractReport): string[] {
  return report.warnings.map(({ file, line, column, message }) =>
    c.yellow(`! ${file}:${line}:${column + 1} ${message}`),
  );
}

export function formatReport(report: TranslateReport): string[] {
  if (report.dryRun) {
    const strings = report.locales.reduce((sum, locale) => sum + locale.translated, 0);
    return [
      "Dry run — nothing was sent or written.",
      ...report.locales.map(
        (l) => `  ${l.locale}: ${num(l.translated)} strings, ${num(l.characters)} characters`,
      ),
      `Would translate ${num(strings)} strings, ${num(report.characters)} characters.`,
    ];
  }
  const total = (key: "translated" | "reused" | "manual" | "characters") =>
    num(report.locales.reduce((sum, l) => sum + l[key], 0));
  const pairs = (list: (l: TranslateReport["locales"][number]) => string[]) =>
    report.locales.flatMap((l) => list(l).map((key) => `  ${l.locale} ${showKey(key)}`));
  const section = (title: string, lines: string[]) =>
    lines.length > 0 ? ["", c.yellow(`${title} (${lines.length})`), ...lines] : [];
  return [
    ...table([
      ["locale", "translated", "reused", "manual", "pruned", "review", "chars"],
      ...report.locales.map((l) => [
        l.locale,
        num(l.translated),
        num(l.reused),
        num(l.manual),
        num(l.pruned.length),
        num(l.needsReview.length),
        num(l.characters),
      ]),
      [
        "total",
        total("translated"),
        total("reused"),
        total("manual"),
        num(report.locales.reduce((sum, l) => sum + l.pruned.length, 0)),
        num(report.locales.reduce((sum, l) => sum + l.needsReview.length, 0)),
        total("characters"),
      ],
    ]),
    ...(report.includedRemaining === null
      ? []
      : [c.dim(`Included characters remaining: ${num(report.includedRemaining)}`)]),
    ...section(
      "Stale manual overrides",
      pairs((l) => l.staleManual),
    ),
    ...section(
      "Needs review",
      pairs((l) => l.needsReview),
    ),
    ...report.locales.flatMap((l) =>
      l.prunedManual.map((key) =>
        c.yellow(`! ${l.locale} ${showKey(key)}: manual translation pruned (key left the source)`),
      ),
    ),
  ];
}

export function formatIssues(issues: CheckIssue[]): string[] {
  const groups = issues.reduce((map, issue) => {
    map.set(issue.kind, [...(map.get(issue.kind) ?? []), issue]);
    return map;
  }, new Map<string, CheckIssue[]>());
  return [
    c.red(`✗ ${issues.length} issue${issues.length === 1 ? "" : "s"}`),
    ...[...groups].flatMap(([kind, list]) => [
      "",
      c.bold(`${kind} (${list.length})`),
      ...list.map(({ locale, key, detail }) =>
        `  ${[locale, key && showKey(key)].filter(Boolean).join(" ")}  ${c.dim(detail)}`.trimEnd(),
      ),
    ]),
  ];
}

/** Progress lines on stderr for `translate` and `watch`. */
export function progress(ctx: Context): (event: ProgressEvent) => void {
  const batches = new Map<string, number>();
  return (event) => {
    if (event.type === "locale-start" && event.toTranslate > 0) {
      logErr(
        ctx,
        `${event.locale}: translating ${num(event.toTranslate)} strings (${num(event.characters)} chars)`,
      );
    }
    if (event.type === "batch") {
      const n = (batches.get(event.locale) ?? 0) + 1;
      batches.set(event.locale, n);
      const remaining =
        event.includedRemaining === null
          ? ""
          : `, ${num(event.includedRemaining)} included remaining`;
      logErr(ctx, c.dim(`  ↳ batch ${n} (${num(event.characters)} chars${remaining})`));
    }
    if (event.type === "locale-done") {
      const { locale, translated, reused, manual, characters } = event.report;
      logErr(
        ctx,
        `${c.green("✓")} ${locale}: ${num(translated)} translated, ${num(reused)} reused, ${num(manual)} manual (${num(characters)} chars)`,
      );
    }
    if (event.type === "warning") logErr(ctx, c.yellow(`! ${event.message}`));
  };
}
