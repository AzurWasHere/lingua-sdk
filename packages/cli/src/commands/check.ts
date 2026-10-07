import { check, checkExtraction, loadConfig } from "@lingua-api/core";
import { type Context, c, formatIssues, log } from "../output";

export async function runCheck(
  ctx: Context,
  options: { locales?: string[] } = {},
): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const report = await check({ config, locales: options.locales });
  const issues = [...(config.wrapperMode ? await checkExtraction(config) : []), ...report.issues];
  const ok = issues.length === 0;
  if (ctx.json) log(ctx, JSON.stringify({ ok, issues }, null, 2));
  else log(ctx, ...(ok ? [c.green("✓ catalogs are up to date")] : formatIssues(issues)));
  return ok ? 0 : 1;
}
