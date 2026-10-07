import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  type FormatName,
  getDriver,
  i18nextDriver,
  icuDriver,
  LinguaError,
  messageId,
  resolveMessage,
  vueI18nDriver,
} from "../src/index";

it("re-exports the shared message helpers", () => {
  expect(typeof messageId("Hello")).toBe("string");
  expect(resolveMessage({ message: "Hi", id: "x" }).id).toBe("x");
});

it("registers every format driver and rejects unknown names", () => {
  expect(getDriver("icu")).toBe(icuDriver);
  expect(getDriver("i18next")).toBe(i18nextDriver);
  expect(getDriver("vue-i18n")).toBe(vueI18nDriver);
  expect(() => getDriver("po" as FormatName)).toThrow(LinguaError);
});

const dist = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));

it.skipIf(!existsSync(dist))("bundles @lingua-api/shared and @formatjs into dist", () => {
  const code = readFileSync(dist, "utf8");
  expect(code).not.toMatch(/from\s+["']@lingua-api\/shared["']/);
  expect(code).not.toMatch(/from\s+["']@formatjs\//);
});
