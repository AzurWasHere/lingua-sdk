import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/react.ts"],
  format: ["esm", "cjs"],
  dts: true,
  shims: true,
  platform: "neutral",
  deps: { alwaysBundle: ["@lingua-api/shared"] },
  clean: true,
});
