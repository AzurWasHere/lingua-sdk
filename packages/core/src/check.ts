import type { ResolvedConfig } from "./config";
import { getDriver } from "./formats/index";
import {
  loadSourceCatalogs,
  loadTargetCatalogs,
  selectLocales,
  sourceMissingMessage,
} from "./load";
import { entryKey, readLockfile } from "./lockfile";
import { planLocale } from "./plan";

export type CheckIssueKind =
  | "source-missing"
  | "missing"
  | "stale-manual"
  | "needs-review"
  | "unused"
  | "source-stale";

export interface CheckIssue {
  kind: CheckIssueKind;
  locale?: string;
  key?: string;
  detail: string;
}

export interface CheckReport {
  ok: boolean;
  issues: CheckIssue[];
  locales: { locale: string; missing: number; unused: number }[];
}

/** Offline consistency check of the target catalogs against the source catalog and lockfile. */
export async function check(options: {
  config: ResolvedConfig;
  locales?: string[];
}): Promise<CheckReport> {
  const { config } = options;
  const locales = selectLocales(config, options.locales);
  const sources = await loadSourceCatalogs(config);
  if (sources.size === 0) {
    return {
      ok: false,
      issues: [{ kind: "source-missing", detail: sourceMissingMessage(config) }],
      locales: [],
    };
  }
  const lock = await readLockfile(config.lockfile);
  const driver = getDriver(config.format);

  const results = await Promise.all(
    locales.map(async (locale) => {
      const plan = planLocale({
        locale,
        sourceCatalogs: sources,
        targetCatalogs: await loadTargetCatalogs(config, locale, sources),
        lock,
        driver,
      });
      const keyIssues = plan.keys.flatMap((planned): CheckIssue[] => {
        const key = entryKey(planned.namespace, planned.path);
        if (planned.action === "translate") {
          const detail =
            planned.existing === undefined
              ? "not translated"
              : "source changed since it was translated";
          return [{ kind: "missing", locale, key, detail }];
        }
        if (planned.action === "stale-manual") {
          return [
            { kind: "stale-manual", locale, key, detail: "manual translation of an older source" },
          ];
        }
        const locked = lock.entries[key]?.targets[locale];
        if (locked?.needsReview && locked.text === planned.existing) {
          return [
            { kind: "needs-review", locale, key, detail: "machine translation needs review" },
          ];
        }
        return [];
      });
      const unused = plan.pruned.map(
        (pruned): CheckIssue => ({
          kind: "unused",
          locale,
          key: entryKey(pruned.namespace, pruned.path),
          detail: "not in the source catalog",
        }),
      );
      return {
        locale,
        issues: [...keyIssues, ...unused],
        missing: keyIssues.filter(({ kind }) => kind === "missing").length,
        unused: unused.length,
      };
    }),
  );

  const issues = results.flatMap((result) => result.issues);
  return {
    ok: issues.length === 0,
    issues,
    locales: results.map(({ locale, missing, unused }) => ({ locale, missing, unused })),
  };
}
