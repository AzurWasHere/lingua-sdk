import { extract, loadConfig } from "@lingua-api/core";
import { type Context, formatExtract, formatWarnings, log, logErr } from "../output";

export async function runExtract(
  ctx: Context,
  options: { dryRun?: boolean } = {},
): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const report = await extract(config, { dryRun: options.dryRun });
  if (ctx.json) {
    log(ctx, JSON.stringify(report, null, 2));
    return 0;
  }
  log(ctx, ...formatExtract(report, config.root, options.dryRun));
  if (report.warnings.length > 0) logErr(ctx, ...formatWarnings(report));
  return 0;
}
