import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const dist = join(import.meta.dirname, "../dist");

it("keeps next-intl/server out of the client entry", () => {
  ["index.js", "index.cjs"].forEach((file) => {
    expect(readFileSync(join(dist, file), "utf8")).not.toContain("next-intl/server");
  });
});

it("bundles @lingua-api/shared", () => {
  const files = readdirSync(dist);
  expect(files.length).toBeGreaterThan(0);
  files.forEach((file) => {
    expect(readFileSync(join(dist, file), "utf8"), file).not.toMatch(/["']@lingua-api\/shared["']/);
  });
});
