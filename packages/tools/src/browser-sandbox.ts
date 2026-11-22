import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import {
  ensureSandbox,
  ensureSandboxNetwork,
  type SandboxOptions,
  sandboxRunArgs,
} from "@zelyq/runtime";
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  chromium,
  type Route,
} from "playwright";
import { guardedFetch } from "./capture-fetch-guard.js";

/**
 * Every browser the agent opens: for a screenshot of a team's preview, a walk
 * through it, or a look at a public website.
 *
 * Self-hosted, this is Chromium on this machine, as it always was. On a
 * strict server (every managed one), a team's page must never run on the
 * server itself, so the browser runs in a gVisor container of its own, on a
 * network that reaches nothing at all: not the internet, not this server, not
 * another team. Every request the page makes comes back here, and is answered
 * only when allowed. The team's own preview is fetched for it, and a public
 * website goes through the address guard (resolved once, connected to that
 * address). Anything else fails. A page that breaks the browser is left
 * inside an empty gVisor box.
 */
export interface PageBrowser {
  newContext(options?: BrowserContextOptions): Promise<BrowserContext>;
  close(): Promise<void>;
}

export interface OpenBrowserOptions {
  /** Extra Chromium switches. */
  args?: string[];
  /**
   * The one private address the page may load: the team's own preview, as
   * the runtime gave it (e.g. http://127.0.0.1:4301). Everything else must
   * be a public address.
   */
  trustedOrigin?: string;
}

interface Configured {
  sandbox: SandboxOptions;
  engine: string;
  /** This agent's label on its browser containers, so it removes only its own. */
  instance: string;
}

let configured: Configured | null = null;

/** Browsers open at once: each is a gVisor container with up to 1.5 GB. */
const MAX_BROWSERS = 3;
let openBrowsers = 0;
const waiting: (() => void)[] = [];

async function acquireBrowserSlot(): Promise<() => void> {
  if (openBrowsers >= MAX_BROWSERS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    openBrowsers += 1;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiting.shift();
    if (next) next();
    else openBrowsers -= 1;
  };
}

/**
 * Called once by the agent at start, with its strict sandbox. Removes browser
 * containers an earlier run of this agent left behind (a crash, a restart).
 */
export function configureBrowserSandbox(
  sandbox: SandboxOptions,
  engine = "docker",
  instance = "default",
): void {
  configured = sandbox.strict ? { sandbox, engine, instance } : null;
  if (configured) void removeLeftoverBrowsers(configured);
}

async function removeLeftoverBrowsers({ engine, instance }: Configured): Promise<void> {
  const listed = await run(engine, ["ps", "-aq", "--filter", `label=zelyq.browser=${instance}`]);
  const ids = listed.code === 0 ? listed.out.split(/\s+/).filter(Boolean) : [];
  if (ids.length) await run(engine, ["rm", "-f", ...ids]);
}

/** For tests. */
export function browserSandboxed(): boolean {
  return configured !== null;
}

export async function openBrowser(options: OpenBrowserOptions = {}): Promise<PageBrowser> {
  if (!configured) {
    const browser = await chromium.launch({ headless: true, args: options.args ?? [] });
    return {
      newContext: (contextOptions) => browser.newContext(contextOptions),
      close: () => browser.close(),
    };
  }
  return openSandboxedBrowser(configured, options);
}

const BROWSER_NETWORK = "zelyq-browser";
const PORT = 9333;
/** Switches every sandboxed browser gets; launch arguments are fixed when the server starts. */
const BROWSER_ARGS = ["--autoplay-policy=no-user-gesture-required"];

function playwrightVersion(): string {
  // playwright and playwright-core are released together, at one version.
  const require = createRequire(import.meta.url);
  return (require("playwright/package.json") as { version: string }).version;
}

/** The browser image: Chromium and the Playwright server, at the exact version this client speaks. */
export function browserDockerfile(version: string): string {
  return `FROM node:22-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright NODE_PATH=/usr/local/lib/node_modules
RUN npm install -g playwright-core@${version} playwright@${version} \\
    && npx playwright@${version} install --with-deps chromium \\
    && rm -rf /var/lib/apt/lists/* /root/.npm
USER node
`;
}

function run(
  engine: string,
  args: string[],
  input?: string,
  timeoutMs = 60_000,
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(engine, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, out: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input ?? "");
  });
}

const imageReady = new Map<string, Promise<string>>();

/** Built once per host and version; a failed build is tried again next time. */
function ensureBrowserImage(engine: string): Promise<string> {
  const version = playwrightVersion();
  const tag = `zelyq/browser:pw-${version}`;
  let ready = imageReady.get(tag);
  if (!ready) {
    ready = (async () => {
      if ((await run(engine, ["image", "inspect", tag], undefined, 15_000)).code === 0) return tag;
      const built = await run(
        engine,
        ["build", "-t", tag, "-"],
        browserDockerfile(version),
        1_200_000,
      );
      if (built.code !== 0) {
        throw new Error(`Could not build the browser image: ${built.out.trim().split("\n").pop()}`);
      }
      return tag;
    })().catch((error: unknown) => {
      imageReady.delete(tag);
      throw error;
    });
    imageReady.set(tag, ready);
  }
  return ready;
}

async function openSandboxedBrowser(
  configuredSandbox: Configured,
  options: OpenBrowserOptions,
): Promise<PageBrowser> {
  const release = await acquireBrowserSlot();
  try {
    return await startSandboxedBrowser(configuredSandbox, options, release);
  } catch (error) {
    release();
    throw error;
  }
}

async function startSandboxedBrowser(
  { sandbox, engine, instance }: Configured,
  options: OpenBrowserOptions,
  release: () => void,
): Promise<PageBrowser> {
  const image = await ensureBrowserImage(engine);
  await ensureSandbox(engine, sandbox);
  // Internal: nothing leaves it. The firewall keeps it from this server too.
  await ensureSandboxNetwork(engine, BROWSER_NETWORK, ["--internal"]);

  const name = `zelyq-browser-${randomBytes(6).toString("hex")}`;
  const wsPath = `/${randomBytes(24).toString("hex")}`;
  const server = [
    "const { chromium } = require('playwright-core');",
    `chromium.launchServer({ host: '0.0.0.0', port: ${PORT}, wsPath: process.env.ZELYQ_WS_PATH,`,
    `  headless: true, args: ${JSON.stringify([...BROWSER_ARGS, ...(options.args ?? [])])} })`,
    "  .then(() => console.log('READY'), (error) => { console.error(error); process.exit(1); });",
  ].join("\n");
  const started = await run(
    engine,
    [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--label",
      `zelyq.browser=${instance}`,
      "--network",
      BROWSER_NETWORK,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      "/tmp:exec,mode=1777,size=512m",
      "--shm-size",
      "256m",
      "--memory",
      "1500m",
      "--cpus",
      "1",
      "--pids-limit",
      "512",
      "--env",
      "HOME=/tmp",
      "--env",
      `ZELYQ_WS_PATH=${wsPath}`,
      ...(await sandboxRunArgs(sandbox)),
      image,
      "node",
      "-e",
      server,
    ],
    undefined,
    120_000,
  );
  const remove = () => run(engine, ["rm", "-f", name], undefined, 30_000).then(() => undefined);
  if (started.code !== 0) {
    // A run that timed out may still have made the container.
    await remove();
    throw new Error(`Could not start a browser: ${started.out.trim().split("\n").pop()}`);
  }

  let browser: Browser | null = null;
  try {
    const inspected = await run(engine, [
      "inspect",
      "--format",
      `{{(index .NetworkSettings.Networks "${BROWSER_NETWORK}").IPAddress}}`,
      name,
    ]);
    const address = inspected.out.trim();
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(address)) throw new Error("The browser has no address.");
    const deadline = Date.now() + 60_000;
    let lastError: unknown = null;
    while (!browser && Date.now() < deadline) {
      try {
        browser = await chromium.connect(`ws://${address}:${PORT}${wsPath}`, { timeout: 5_000 });
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!browser) {
      const logs = await run(engine, ["logs", "--tail", "5", name]);
      throw new Error(
        `The browser did not start: ${logs.out.trim().split("\n").pop() || String(lastError)}`,
      );
    }
  } catch (error) {
    await remove();
    throw error;
  }

  const connected = browser;
  const budget = newBudget();
  return {
    newContext: async (contextOptions) => {
      const context = await connected.newContext({ ...contextOptions, serviceWorkers: "block" });
      await context.route("**/*", (route) => answer(route, options.trustedOrigin, budget));
      return context;
    },
    close: async () => {
      await connected.close().catch(() => undefined);
      await remove();
      release();
    },
  };
}

const DROPPED_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

function responseHeaders(
  headers: Record<string, string | string[] | undefined> | Headers,
): Record<string, string> {
  const out: Record<string, string> = {};
  const entries =
    headers instanceof Headers ? [...headers.entries()] : Object.entries(headers ?? {});
  for (const [key, value] of entries) {
    if (value === undefined || DROPPED_HEADERS.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

/** One request from a sandboxed page: fetched here when allowed, refused otherwise. */
export async function answer(
  route: Route,
  trustedOrigin: string | undefined,
  budget: Budget = newBudget(),
): Promise<void> {
  const request = route.request();
  let url: URL;
  try {
    url = new URL(request.url());
  } catch {
    return route.abort("blockedbyclient");
  }
  // data:, blob: and the like never leave the browser.
  if (url.protocol !== "http:" && url.protocol !== "https:") return route.fallback();
  // A page cannot make this process hold more than a browser's share.
  if (budget.inFlight >= MAX_IN_FLIGHT || budget.bytes >= MAX_BYTES_PER_BROWSER) {
    return route.abort("blockedbyclient");
  }
  budget.inFlight += 1;
  try {
    if (trustedOrigin && url.origin === new URL(trustedOrigin).origin) {
      // The team's own preview: the one private address this page may load.
      const body = request.postDataBuffer();
      const headers = { ...request.headers() };
      delete headers.host;
      const response = await fetch(url, {
        method: request.method(),
        headers,
        ...(body && !["GET", "HEAD"].includes(request.method()) ? { body } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      const bytes = await readCapped(response, MAX_RESPONSE_BYTES);
      budget.bytes += bytes.length;
      return route.fulfill({
        status: response.status,
        headers: responseHeaders(response.headers),
        body: bytes,
      });
    }
    // Anywhere else: a public address, checked and pinned.
    const response = await guardedFetch(url.href, {
      method: request.method(),
      ...(request.postDataBuffer() ? { body: request.postDataBuffer() as Buffer } : {}),
      headers: pickHeaders(request.headers()),
      maxBytes: MAX_RESPONSE_BYTES,
      timeoutMs: 30_000,
      followRedirects: false,
    });
    budget.bytes += response.body.length;
    return route.fulfill({
      status: response.status,
      headers: responseHeaders(response.headers),
      body: response.body,
    });
  } catch {
    return route.abort("blockedbyclient");
  } finally {
    budget.inFlight -= 1;
  }
}

export interface Budget {
  inFlight: number;
  bytes: number;
}

const MAX_IN_FLIGHT = 24;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_BYTES_PER_BROWSER = 256 * 1024 * 1024;

function newBudget(): Budget {
  return { inFlight: 0, bytes: 0 };
}

/** A response body, refused past `limit` bytes rather than read without end. */
async function readCapped(response: Response, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The response is too large.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** What a public site may see of the page's request: nothing that identifies this server. */
function pickHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["accept", "accept-language", "content-type", "range", "user-agent"]) {
    const value = headers[key];
    if (value) out[key] = value;
  }
  return out;
}
