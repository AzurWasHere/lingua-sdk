"use client";

import { T, useTranslations } from "@lingua-api/next-intl";
import { useTranslations as useCatalog } from "next-intl";

export function Greeting({ name }: { name: string }) {
  const t = useTranslations();
  const nav = useCatalog("nav");
  return (
    <section>
      <nav>
        <a href="/">{nav("home")}</a>
      </nav>
      <p>{t("Hello {name}", { name })}</p>
      <p>
        <T message="Read the <b>docs</b>" values={{ b: (chunks) => <b>{chunks}</b> }} />
      </p>
    </section>
  );
}
