import { extract, loadConfig, translate } from "@lingua-api/core";
import {
  type Context,
  formatExtract,
  formatReport,
  formatWarnings,
  log,
  logErr,
  printError,
  progress,
} from "../output";

export interface TranslateCommandOptions {
  dryRun?: boolean;
  locales?: string[];
  force?: boolean;
  keepUnused?: boolean;
  /** Wrapper mode: run `extract` first. Default true; skipped on dry runs, which write nothing. */
  extract?: boolean;
}

export async function runTranslate(
  ctx: Context,
  options: TranslateCommandOptions = {},
): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  try {
    if (config.wrapperMode && options.extract !== false && !options.dryRun) {
      const extracted = await extract(config);
      if (!ctx.json) log(ctx, ...formatExtract(extracted, config.root), "");
      if (extracted.warnings.length > 0) logErr(ctx, ...formatWarnings(extracted));
    }
    const report = await translate({
      config,
      locales: options.locales,
      dryRun: options.dryRun,
      force: options.force,
      keepUnused: options.keepUnused,
      onProgress: ctx.json || options.dryRun ? undefined : progress(ctx),
    });
    log(ctx, ...(ctx.json ? [JSON.stringify(report, null, 2)] : formatReport(report)));
    return 0;
  } catch (error) {
    return printError(ctx, error, config.apiKeyEnv);
  }
}
