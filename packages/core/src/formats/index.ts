import { LinguaError } from "../errors";
import type { FormatName } from "../presets";
import { i18nextDriver } from "./i18next";
import { icuDriver } from "./icu";
import type { FormatDriver } from "./types";
import { vueI18nDriver } from "./vue-i18n";

const drivers: Partial<Record<FormatName, FormatDriver>> = {
  icu: icuDriver,
  i18next: i18nextDriver,
  "vue-i18n": vueI18nDriver,
};

export function getDriver(name: FormatName): FormatDriver {
  const driver = drivers[name];
  if (!driver) throw new LinguaError(`Format driver '${name}' is not implemented yet`, "format");
  return driver;
}
