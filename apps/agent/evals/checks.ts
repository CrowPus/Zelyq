import { chromium } from "@playwright/test";
import type { RuntimeDriver } from "@zelyq/runtime";
import { type Check, type CheckResult, CRITICAL_KINDS } from "./types.js";
import type { ProjectFingerprint } from "./workspace.js";

export interface CheckContext {
  runtime: RuntimeDriver;
  projectId: string;
  before: ProjectFingerprint;
  after: ProjectFingerprint;
  changed: string[];
  /** How many tools the turn ran. Writing nothing is not the same as doing nothing. */
  toolCalls: number;
  /** The agent's final message, for requests that should be answered not built. */
  reply: string;
}

export function describe(check: Check): string {
  switch (check.kind) {
    case "typecheck":
      return "typecheck passes";
    case "build":
      return "build passes";
    case "preview":
      return "dev server serves the app";
    case "file_exists":
      return `${check.path} exists`;
    case "file_absent":
      return `${check.path} does not exist`;
    case "file_matches":
      return `${check.path}: ${check.why}`;
    case "project_matches":
      return check.why;
    case "unchanged":
      return `${check.path} untouched`;
    case "no_new_dependency":
      return "no dependencies added";
    case "no_writes":
      return "wrote no files";
    case "max_files_changed":
      return `changed at most ${check.count} file${check.count === 1 ? "" : "s"}`;
    case "max_file_lines":
      return `no file over ${check.count} lines`;
    case "max_tool_calls":
      return `ran at most ${check.count} tool call${check.count === 1 ? "" : "s"}`;
    case "reply_matches":
      return check.why;
    case "changed_something":
      return "changed something";
    case "renders":
      return "renders without throwing";
  }
}

export async function runCheck(check: Check, context: CheckContext): Promise<CheckResult> {
  const base = {
    label: describe(check),
    critical: CRITICAL_KINDS.has(check.kind),
    cosmetic: check.cosmetic === true,
  };
  const { ok, detail } = await evaluate(check, context);
  return { ...base, ok, detail };
}

async function evaluate(
  check: Check,
  context: CheckContext,
): Promise<{ ok: boolean; detail: string }> {
  const { runtime, projectId, before, after, changed } = context;

  switch (check.kind) {
    case "typecheck":
      return await script(runtime, projectId, "npm run typecheck", 4 * 60_000);

    case "build":
      return await script(runtime, projectId, "npm run build", 6 * 60_000);

    case "preview":
      return await checkPreview(runtime, projectId, after);

    case "file_exists":
      return {
        ok: after.files.has(check.path),
        detail: after.files.has(check.path) ? "" : "not found",
      };

    case "file_absent":
      return {
        ok: !after.files.has(check.path),
        detail: after.files.has(check.path) ? "still present" : "",
      };

    case "file_matches": {
      if (!after.files.has(check.path)) return { ok: false, detail: `${check.path} not found` };
      const file = await runtime.readFile(projectId, check.path);
      return match(file.content, check.pattern, check.expect ?? "present");
    }

    case "project_matches": {
      const contents = await readAllText(runtime, projectId, after);
      return match(contents, check.pattern, check.expect ?? "present");
    }

    case "unchanged": {
      const same = before.files.get(check.path) === after.files.get(check.path);
      return { ok: same, detail: same ? "" : "was modified" };
    }

    case "no_new_dependency":
      return await checkDependencies(runtime, projectId, before);

    case "no_writes":
      return {
        ok: changed.length === 0,
        detail: changed.length === 0 ? "" : `wrote ${changed.join(", ")}`,
      };

    case "renders":
      return await checkRenders(runtime, projectId);

    case "changed_something":
      return {
        ok: changed.length > 0,
        detail: changed.length > 0 ? "" : "the agent changed no files at all",
      };

    case "max_files_changed":
      return {
        ok: changed.length <= check.count,
        detail:
          changed.length <= check.count ? "" : `changed ${changed.length}: ${changed.join(", ")}`,
      };

    case "max_file_lines":
      return await checkFileLengths(runtime, projectId, after, check.count);

    case "max_tool_calls":
      return {
        ok: context.toolCalls <= check.count,
        detail: context.toolCalls <= check.count ? "" : `ran ${context.toolCalls}`,
      };

    case "reply_matches":
      return match(context.reply, check.pattern, check.expect ?? "present");
  }
}

async function script(
  runtime: RuntimeDriver,
  projectId: string,
  command: string,
  timeoutMs: number,
): Promise<{ ok: boolean; detail: string }> {
  const result = await runtime.exec(projectId, { command, timeoutMs });
  if (result.exitCode === 0) return { ok: true, detail: "" };
  const output = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  return {
    ok: false,
    detail: result.timedOut ? "timed out" : firstLines(output, 4),
  };
}

/**
 * "It builds" and "it runs" are different claims, and only the second one is
 * what the user sees. Two requests: the page itself, then the entry module
 * through Vite's transform — a bad import or a syntax error that somehow
 * survived the build shows up there as a 500.
 */
async function checkPreview(
  runtime: RuntimeDriver,
  projectId: string,
  after: ProjectFingerprint,
): Promise<{ ok: boolean; detail: string }> {
  const preview = await runtime.startPreview(projectId);

  if (preview.status !== "running" || !preview.url) {
    const logs = await runtime.previewLogs(projectId, 20).catch(() => "");
    return {
      ok: false,
      detail: `preview ${preview.status}: ${preview.lastError ?? firstLines(logs, 3)}`,
    };
  }

  const page = await get(preview.url);
  if (!page.ok) return { ok: false, detail: `GET / → ${page.detail}` };
  if (!/<div[^>]+id=["']root["']/.test(page.body)) {
    return { ok: false, detail: "served page has no #root mount point" };
  }

  // Vite compiles on demand, so a module is only proved good by asking for it.
  // Requesting every source module — not just the entry — is what catches the
  // syntax error three imports deep, which is where they usually are. Fetching
  // only `main.tsx` reports a green preview for an app that cannot render.
  for (const file of after.files.keys()) {
    if (!/^src\/.+\.(tsx?|jsx?)$/.test(file)) continue;
    const module = await get(new URL(`/${file}`, preview.url).toString());
    if (!module.ok) return { ok: false, detail: `${file} failed to transform: ${module.detail}` };
  }

  return { ok: true, detail: "" };
}

/**
 * Does the app actually appear?
 *
 * `preview` proves every module compiles and is served. It cannot see the most
 * common way a generated app fails a person: it builds, it is served, and then
 * a component throws on mount and the screen stays white. `intact` scored 22/22
 * in the first honest baseline with this hole in it.
 *
 * Two failures are reported, and only two. An **uncaught exception** and an
 * **empty root** are unambiguous. Console warnings are not: React logs them in
 * normal operation, and a check that cries wolf is one somebody marks cosmetic
 * and then ignores.
 */
export async function checkRenders(
  runtime: RuntimeDriver,
  projectId: string,
): Promise<{ ok: boolean; detail: string }> {
  const preview = await runtime.startPreview(projectId);
  if (preview.status !== "running" || !preview.url) {
    return { ok: false, detail: `preview ${preview.status}` };
  }
  return await renderReport(preview.url);
}

/**
 * Loads a URL in headless chromium and says what happened.
 *
 * Separated from the runtime so it can be tested against a page we control —
 * including one that throws on purpose, which is the only way to know this
 * check is capable of failing.
 */
export async function renderReport(url: string): Promise<{ ok: boolean; detail: string }> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const thrown: string[] = [];
    page.on("pageerror", (error) => thrown.push(error.message));

    await page.goto(url, { waitUntil: "load", timeout: 30_000 });

    // A generous wait, because a slow mount on a loaded machine reading as a
    // white screen would score the harness's impatience as the agent's bug.
    // Settles as soon as the root has content, so a healthy app pays nothing.
    await page
      .waitForFunction(() => (document.querySelector("#root")?.childElementCount ?? 0) > 0, null, {
        timeout: 15_000,
      })
      .catch(() => undefined);

    const mounted = await page
      .evaluate(() => (document.querySelector("#root")?.childElementCount ?? 0) > 0)
      .catch(() => false);

    // Reported separately: "it threw" and "it never appeared" are different
    // bugs and the message has to say which.
    if (thrown.length > 0) {
      return { ok: false, detail: `threw on render: ${thrown[0]?.split("\n")[0] ?? "unknown"}` };
    }
    if (!mounted) return { ok: false, detail: "#root is empty — the app rendered nothing" };
    return { ok: true, detail: "" };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * A compile error comes back as a 500 with the message in the body. A dropped
 * connection is something else entirely: Vite re-optimises dependencies when it
 * meets a new import — precisely when the agent has just added a component —
 * and refuses connections while it does. Failing the case there would score the
 * harness's impatience as the agent's bug, so transport errors are retried and
 * only an HTTP error is believed first time.
 */
async function get(
  url: string,
  attempts = 3,
): Promise<{ ok: boolean; body: string; detail: string }> {
  let lastError = "no attempt made";
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const body = await response.text();
      if (!response.ok) {
        return { ok: false, body, detail: `${response.status} ${firstLines(body, 2)}` };
      }
      return { ok: true, body, detail: "" };
    } catch (error) {
      lastError = (error as Error).message;
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  return { ok: false, body: "", detail: `${lastError} after ${attempts} attempts` };
}

async function checkDependencies(
  runtime: RuntimeDriver,
  projectId: string,
  before: ProjectFingerprint,
): Promise<{ ok: boolean; detail: string }> {
  if (before.files.get("package.json") === undefined) return { ok: true, detail: "" };
  const file = await runtime.readFile(projectId, "package.json");
  const parsed = JSON.parse(file.content) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const names = [
    ...Object.keys(parsed.dependencies ?? {}),
    ...Object.keys(parsed.devDependencies ?? {}),
  ];
  const expected = new Set([
    "react",
    "react-dom",
    "@tailwindcss/vite",
    "@types/react",
    "@types/react-dom",
    "@vitejs/plugin-react",
    "tailwindcss",
    "typescript",
    "vite",
  ]);
  const added = names.filter((name) => !expected.has(name));
  return { ok: added.length === 0, detail: added.length ? `added ${added.join(", ")}` : "" };
}

/**
 * Restraint has two failure modes, and bounding the file count only catches one.
 * An agent told to stop creating files will cheerfully put a 650-line component
 * in App.tsx instead, which passes every other check in this suite and is worse
 * code than the sprawl it replaced.
 */
async function checkFileLengths(
  runtime: RuntimeDriver,
  projectId: string,
  after: ProjectFingerprint,
  limit: number,
): Promise<{ ok: boolean; detail: string }> {
  let worst = { file: "", lines: 0 };
  for (const file of after.files.keys()) {
    if (!/^src\/.+\.(tsx?|jsx?)$/.test(file)) continue;
    const content = await runtime.readFile(projectId, file).catch(() => null);
    if (content?.encoding !== "utf8") continue;
    const lines = content.content.split("\n").length;
    if (lines > worst.lines) worst = { file, lines };
  }
  return worst.lines > limit
    ? { ok: false, detail: `${worst.file} is ${worst.lines} lines` }
    : { ok: true, detail: "" };
}

async function readAllText(
  runtime: RuntimeDriver,
  projectId: string,
  after: ProjectFingerprint,
): Promise<string> {
  const parts: string[] = [];
  for (const file of after.files.keys()) {
    if (!/\.(tsx?|jsx?|css|html)$/.test(file)) continue;
    const content = await runtime.readFile(projectId, file).catch(() => null);
    if (content?.encoding === "utf8") parts.push(content.content);
  }
  return parts.join("\n");
}

function match(
  content: string,
  pattern: string,
  expect: "present" | "absent",
): { ok: boolean; detail: string } {
  const found = new RegExp(pattern).test(content);
  if (expect === "present") return { ok: found, detail: found ? "" : `no match for /${pattern}/` };
  return { ok: !found, detail: found ? `matched /${pattern}/` : "" };
}

function firstLines(text: string, count: number): string {
  return text.split("\n").filter(Boolean).slice(0, count).join(" · ").slice(0, 300);
}
