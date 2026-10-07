import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { messageId } from "@lingua-api/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli";

type Mode = "ok" | "quota" | "invalid-key" | "no-batch";
let mode: Mode = "ok";
let requests: string[] = [];

const LIMIT_HEADERS = {
  "X-RateLimit-Limit": "10",
  "X-RateLimit-Remaining": "9",
  "X-RateLimit-Reset": "0",
  "X-Usage-Included-Remaining": "1000",
};
const translation = (text: string, target: string) => ({
  text: `[${target}] ${text}`,
  detected: "en",
  confidence: 1,
  engine: "libre",
  characters: text.length,
});

const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  requests.push(`${req.method} ${req.url}`);
  const send = (status: number, data: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(data));
  };
  if (mode === "invalid-key") {
    return send(401, { error: { code: "invalid_key", message: "Invalid API key" } });
  }
  if (req.method === "GET" && req.url === "/v1/languages") {
    return send(200, {
      languages: [
        { code: "en", name: "English" },
        { code: "es", name: "Spanish" },
        { code: "fr", name: "French" },
      ],
    });
  }
  if (mode === "quota") {
    return send(402, { error: { code: "quota_exceeded", message: "Monthly quota exceeded" } });
  }
  if (req.method === "POST" && req.url === "/v1/translate/batch" && mode !== "no-batch") {
    const { texts, target } = JSON.parse(body) as { texts: string[]; target: string };
    return send(
      200,
      {
        translations: texts.map((text) => translation(text, target)),
        engine: "libre",
        characters: texts.reduce((sum, text) => sum + text.length, 0),
      },
      LIMIT_HEADERS,
    );
  }
  if (req.method === "POST" && req.url === "/v1/translate") {
    const { text, target } = JSON.parse(body) as { text: string; target: string };
    return send(200, translation(text, target), LIMIT_HEADERS);
  }
  send(404, { error: { code: "not_found", message: "Not found" } });
});

let baseUrl: string;
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

let root: string;
const previousKey = process.env.TEST_LINGUA_KEY;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "lingua-cli-"));
  mode = "ok";
  requests = [];
  process.env.TEST_LINGUA_KEY = "lk_test_123";
});
afterEach(async () => {
  if (previousKey === undefined) delete process.env.TEST_LINGUA_KEY;
  else process.env.TEST_LINGUA_KEY = previousKey;
  await rm(root, { recursive: true, force: true });
});

async function run(...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, {
    cwd: root,
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  return {
    code,
    stdout: stripVTControlCharacters(stdout),
    stderr: stripVTControlCharacters(stderr),
  };
}

const put = async (file: string, content: unknown) => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(
    join(root, file),
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
  );
};
const json = async (file: string) => JSON.parse(await readFile(join(root, file), "utf8"));
const has = (file: string) => existsSync(join(root, file));
const batchRequests = () => requests.filter((r) => r === "POST /v1/translate/batch").length;

async function setup(extra: Record<string, unknown> = {}) {
  await put("lingua.config.json", {
    runtime: "next-intl",
    sourceLocale: "en",
    targetLocales: ["es", "fr"],
    api: { baseUrl, keyEnv: "TEST_LINGUA_KEY" },
    ...extra,
  });
  await put("messages/en.json", { greeting: "Hello", nav: { home: "Home" } });
}

describe("global flags", () => {
  it("--help lists the commands", async () => {
    const { code, stdout } = await run("--help");
    expect(code).toBe(0);
    ["init", "extract", "translate", "check", "watch"].forEach((name) => {
      expect(stdout).toContain(`  ${name}`);
    });
  });

  it("--version prints the package version", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const { code, stdout } = await run("--version");
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  it("rejects unknown commands and flags with exit 2", async () => {
    expect((await run("bogus")).code).toBe(2);
    expect((await run("check", "--bogus")).code).toBe(2);
  });
});

describe("init", () => {
  it("detects the runtime and refuses to overwrite without --force", async () => {
    await put("package.json", { dependencies: { "next-intl": "^4.0.0" } });
    await put(".gitignore", "node_modules\n");
    const first = await run("init");
    expect(first.code).toBe(0);
    const config = await readFile(join(root, "lingua.config.ts"), "utf8");
    expect(config).toContain('from "@lingua-api/cli"');
    expect(config).toContain('runtime: "next-intl"');
    expect(config).toContain('targetLocales: ["es", "fr", "de"]');
    expect(first.stdout).toContain(".env.local");

    const second = await run("init");
    expect(second.code).toBe(2);
    expect(second.stderr).toContain("--force");
    expect((await run("init", "--force", "--targets", "it,ja")).code).toBe(0);
    expect(await readFile(join(root, "lingua.config.ts"), "utf8")).toContain('["it", "ja"]');
  });

  it("rejects an unknown runtime", async () => {
    const { code, stderr } = await run("init", "--runtime", "bogus");
    expect(code).toBe(2);
    expect(stderr).toContain("next-intl");
  });

  it("fails when no runtime can be detected", async () => {
    const { code, stderr } = await run("init");
    expect(code).toBe(2);
    expect(stderr).toContain("--runtime");
    expect(has("lingua.config.ts")).toBe(false);
  });
});

describe("translate and check", () => {
  it("translates, then reuses everything on the second run", async () => {
    await setup();
    const first = await run("translate");
    expect(first.code).toBe(0);
    expect(await json("messages/es.json")).toEqual({
      greeting: "[es] Hello",
      nav: { home: "[es] Home" },
    });
    expect(await json("messages/fr.json")).toEqual({
      greeting: "[fr] Hello",
      nav: { home: "[fr] Home" },
    });
    expect(has("lingua.lock.json")).toBe(true);
    expect(first.stdout).toMatch(/locale\s+translated\s+reused/);
    expect(first.stdout).toContain("total");

    const before = batchRequests();
    const second = await run("translate");
    expect(second.code).toBe(0);
    expect(batchRequests()).toBe(before);
  });

  it("--dry-run sends and writes nothing", async () => {
    await setup();
    const { code, stdout } = await run("translate", "--dry-run");
    expect(code).toBe(0);
    expect(stdout).toContain("characters");
    expect(requests).toEqual([]);
    expect(has("messages/es.json")).toBe(false);
    expect(has("lingua.lock.json")).toBe(false);
  });

  it("--locale limits the run", async () => {
    await setup();
    expect((await run("translate", "--locale", "es")).code).toBe(0);
    expect(has("messages/es.json")).toBe(true);
    expect(has("messages/fr.json")).toBe(false);
  });

  it("check passes after translate and fails on a new source key", async () => {
    await setup();
    await run("translate");
    const ok = await run("check");
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("up to date");

    await put("messages/en.json", { greeting: "Hello", nav: { home: "Home" }, bye: "Bye" });
    const failed = await run("check");
    expect(failed.code).toBe(1);
    expect(failed.stdout).toContain("missing");
    expect(failed.stdout).toContain("/bye");
  });

  it("--json prints the report", async () => {
    await setup();
    const { code, stdout } = await run("translate", "--json");
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.locales.map((l: { locale: string }) => l.locale)).toEqual(["es", "fr"]);
    expect(report.includedRemaining).toBe(1000);
  });

  it("reports an exhausted quota with exit 1", async () => {
    await setup();
    mode = "quota";
    const { code, stderr } = await run("translate");
    expect(code).toBe(1);
    expect(stderr).toContain("quota");
  });

  it("reports an invalid key with exit 1 naming the variable", async () => {
    await setup();
    mode = "invalid-key";
    const { code, stderr } = await run("translate");
    expect(code).toBe(1);
    expect(stderr).toContain("Invalid API key — check TEST_LINGUA_KEY");
  });

  it("exits 2 when the API key is missing", async () => {
    await setup();
    delete process.env.TEST_LINGUA_KEY;
    const { code, stderr } = await run("translate");
    expect(code).toBe(2);
    expect(stderr).toContain("TEST_LINGUA_KEY");
  });

  it("exits 2 without a config", async () => {
    const { code, stderr } = await run("translate");
    expect(code).toBe(2);
    expect(stderr).toContain("lingua init");
  });

  it("falls back to single requests when the batch endpoint is missing", async () => {
    await setup();
    mode = "no-batch";
    const { code, stderr } = await run("translate");
    expect(code).toBe(0);
    expect(requests).toContain("POST /v1/translate");
    expect(stderr).toContain("one request at a time");
    expect((await json("messages/es.json")).greeting).toBe("[es] Hello");
  });
});

describe("wrapper mode", () => {
  it("extracts, translates and detects stale sources", async () => {
    await setup({ include: ["src/**/*.{ts,tsx}"] });
    await rm(join(root, "messages"), { recursive: true });
    const page = (text: string) =>
      [
        'import { useTranslations } from "@lingua-api/next-intl";',
        "export default function Page() {",
        "  const t = useTranslations();",
        `  return <h1>{t("${text}")}</h1>;`,
        "}",
        "",
      ].join("\n");
    await put("src/page.tsx", page("Hello"));
    const id = messageId("Hello");

    expect((await run("extract")).code).toBe(0);
    expect(await json("messages/en.json")).toEqual({ [id]: "Hello" });
    expect((await run("translate")).code).toBe(0);
    expect(await json("messages/es.json")).toEqual({ [id]: "[es] Hello" });
    expect((await run("check")).code).toBe(0);

    await put("src/page.tsx", page("Hello world"));
    const stale = await run("check");
    expect(stale.code).toBe(1);
    expect(stale.stdout).toContain("source-stale");
  });
});

describe("watch", () => {
  const until = async (condition: () => Promise<boolean> | boolean, timeout = 5000) => {
    const start = Date.now();
    while (!(await condition())) {
      if (Date.now() - start > timeout) throw new Error("Timed out waiting for watch");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  it("retranslates when the source catalog changes", { timeout: 15_000 }, async () => {
    await setup();
    let stdout = "";
    const exit = main(["watch", "--debounce", "50"], {
      cwd: root,
      stdout: (s) => {
        stdout += s;
      },
      stderr: () => {},
    });
    await until(() => stdout.includes("watching"));
    await put("messages/en.json", { greeting: "Hello", nav: { home: "Home" }, bye: "Bye" });
    await until(async () => (await json("messages/es.json").catch(() => ({}))).bye === "[es] Bye");
    process.emit("SIGINT");
    expect(await exit).toBe(0);
  });
});
