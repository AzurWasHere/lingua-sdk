import { describe, expect, it } from "vitest";
import { extractFromVue } from "../src/extract/vue";
import { messageId } from "../src/index";

const options = { functionNames: ["t"], componentNames: ["T"] };

describe("extractFromVue", () => {
  it("extracts from the template and script setup", async () => {
    const code = [
      "<template>",
      "  <div>",
      '    <T message="Static" />',
      '    <T :message="\'Bound\'" context="c" />',
      '    <p v-if="t(\'Cond\')" @click="n++; go(t(\'Click\'))">{{ t("Interpolated") }}</p>',
      '    <T :message="label" />',
      "  </div>",
      "</template>",
      '<script setup lang="ts">',
      'import { useTranslations } from "@lingua-api/vue-i18n";',
      "const t = useTranslations();",
      'const msg: string = t("Setup");',
      "</script>",
    ].join("\n");
    const result = await extractFromVue(code, "src/App.vue", options);
    expect(
      result.messages.map(({ id, message, context, locations }) => ({
        id,
        message,
        context,
        at: locations.map(({ file, line, column }) => `${file}:${line}:${column}`),
      })),
    ).toEqual([
      { id: messageId("Static"), message: "Static", at: ["src/App.vue:3:4"] },
      { id: messageId("Bound", "c"), message: "Bound", context: "c", at: ["src/App.vue:4:4"] },
      { id: messageId("Cond"), message: "Cond", at: ["src/App.vue:5:13"] },
      { id: messageId("Click"), message: "Click", at: ["src/App.vue:5:40"] },
      { id: messageId("Interpolated"), message: "Interpolated", at: ["src/App.vue:5:56"] },
      { id: messageId("Setup"), message: "Setup", at: ["src/App.vue:12:20"] },
    ]);
    expect(result.warnings).toEqual([
      {
        file: "src/App.vue",
        line: 6,
        column: 17,
        message: "Dynamic message passed to <T> cannot be extracted",
      },
    ]);
  });

  it("handles a plain script block", async () => {
    const code = '<script>\nexport default { setup() { return { a: t("Plain") } } }\n</script>\n';
    const result = await extractFromVue(code, "src/B.vue", options);
    expect(result.messages.map(({ message, locations }) => [message, locations[0]?.line])).toEqual([
      ["Plain", 2],
    ]);
  });
});
