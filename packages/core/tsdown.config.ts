import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  shims: true,
  platform: "node",
  // @formatjs packages are ESM-only; bundling keeps the CJS build free of require(esm) on Node 22.0.
  deps: { alwaysBundle: ["@lingua-api/shared", /^@formatjs\//] },
  clean: true,
});
