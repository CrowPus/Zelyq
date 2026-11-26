import type { Page } from "playwright";
import { z } from "zod";
import { openBrowser } from "./browser-sandbox.js";
import { previewTarget } from "./preview.js";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

/**
 * Looking at the running preview: what it renders, whether it throws, which
 * requests fail, basic accessibility and overflow at phone width.
 *
 * These used to be a plugin (`plugins/browser-qa.mjs`) that loaded only when
 * ZELYQ_PLUGIN_DIR was set — commented out in `.env.example` and absent from
 * the Docker image — so a fresh install got an agent without them, while the
 * prompt and the end-of-turn rules assumed they existed. They also launched
 * their own Chromium outside the strict sandbox. Built in, they use the same
 * sandboxed browser as `view_preview`.
 *
 * Every listener is attached before the page loads. The plugin attached the
 * uncaught-exception listener after `goto`, so an app that crashed while
 * loading reported no errors: 359 of 362 recorded checks found none.
 */

const pathField = {
  path: z
    .string()
    .optional()
    .describe('Route to inspect, relative to the preview root. Default "/". Accepts a hash route.'),
};

export interface Telemetry {
  url: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: Array<{ url: string; error?: string }>;
  httpErrors: Array<{ url: string; status: number }>;
}

/** How long to wait for the page's own requests after `load`; an app that polls never goes quiet. */
const SETTLE_MS = 3000;

export async function withPage(
  context: ToolContext,
  options: { width?: number; height?: number; path?: string | undefined },
  action: (page: Page, telemetry: Telemetry) => Promise<ToolResult>,
): Promise<ToolResult> {
  const preview = await context.runtime.previewStatus(context.projectId);
  if (preview.status !== "running" || !preview.url) {
    return {
      output: `The preview isn't running (${preview.status}). Start it with start_preview first.`,
      isError: true,
    };
  }
  const target = previewTarget(preview.url, options.path);
  if (!target) {
    return {
      output: `Not a path inside the preview: "${options.path}". Give a path such as /about.`,
      isError: true,
    };
  }

  const browser = await openBrowser({ trustedOrigin: new URL(preview.url).origin });
  try {
    const browserContext = await browser.newContext({
      viewport: { width: options.width ?? 1280, height: options.height ?? 800 },
    });
    const page = await browserContext.newPage();
    const telemetry: Telemetry = {
      url: target,
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      httpErrors: [],
    };
    page.on("console", (message) => {
      if (message.type() === "error") telemetry.consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => telemetry.pageErrors.push(error.message));
    page.on("requestfailed", (request) =>
      telemetry.failedRequests.push({
        url: request.url(),
        ...(request.failure()?.errorText ? { error: request.failure()?.errorText } : {}),
      }),
    );
    page.on("response", (response) => {
      if (response.status() >= 400) {
        telemetry.httpErrors.push({ url: response.url(), status: response.status() });
      }
    });
    await page.goto(target, { waitUntil: "load", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: SETTLE_MS }).catch(() => undefined);
    return await action(page, telemetry);
  } catch (error) {
    return {
      output: `Browser check failed: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// In-page scripts are strings, as elsewhere in this package (page-walk.ts):
// they run in the browser, not in Node, and are not type-checked against it.
const A11Y_AUDIT = `(() => {
  const issues = [];
  if (!document.documentElement.lang) issues.push({ rule: "html-lang", target: "html" });
  for (const el of document.querySelectorAll("img:not([alt])")) {
    issues.push({ rule: "image-alt", target: el.outerHTML.slice(0, 180) });
  }
  for (const el of document.querySelectorAll("input:not([type=hidden]),textarea,select")) {
    const labelled =
      el.getAttribute("aria-label") ||
      el.getAttribute("aria-labelledby") ||
      (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) ||
      el.closest("label");
    if (!labelled) issues.push({ rule: "form-label", target: el.outerHTML.slice(0, 180) });
  }
  for (const el of document.querySelectorAll("button,a[href]")) {
    if (!(el.textContent || "").trim() && !el.getAttribute("aria-label")) {
      issues.push({ rule: "accessible-name", target: el.outerHTML.slice(0, 180) });
    }
  }
  const levels = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((el) => Number(el.tagName[1]));
  levels.forEach((level, i) => {
    if (i > 0 && level > levels[i - 1] + 1) {
      issues.push({ rule: "heading-order", target: "h" + levels[i - 1] + " to h" + level });
    }
  });
  return { issueCount: issues.length, issues };
})()`;

const OVERFLOW_CHECK = `(() => ({
  viewport: innerWidth,
  documentWidth: document.documentElement.scrollWidth,
  horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
  overflowingElements: [...document.querySelectorAll("body *")]
    .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
    .slice(0, 30)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id,
      class: typeof el.className === "string" ? el.className : "",
    })),
}))()`;

const json = (value: unknown): ToolResult => ({ output: JSON.stringify(value, null, 2) });

export const inspectPageTool = defineTool({
  name: "inspect_page",
  description:
    "Inspect the running preview's title, headings, landmarks, links, controls and visible text as " +
    "structured data, with any errors it threw while loading. Pass `path` for another route.",
  schema: z.object({ ...pathField }),
  async run(context, input) {
    return withPage(context, { path: input.path }, async (page, telemetry) =>
      json({
        ...telemetry,
        title: await page.title(),
        headings: await page.locator("h1,h2,h3").allTextContents(),
        landmarks: await page
          .locator("header,nav,main,aside,footer")
          .evaluateAll((nodes) => nodes.map((node) => node.tagName.toLowerCase())),
        links: await page.locator("a").evaluateAll((nodes) =>
          nodes.slice(0, 100).map((node) => ({
            text: node.textContent?.trim(),
            href: node.getAttribute("href"),
          })),
        ),
        buttons: await page.locator("button").allTextContents(),
        text: (await page.locator("body").innerText()).slice(0, 12_000),
      }),
    );
  },
});

export const checkConsoleErrorsTool = defineTool({
  name: "check_console_errors",
  description:
    "Load the running preview and return its console errors and uncaught exceptions, including " +
    "any thrown while the page was loading, and failed or 4xx/5xx requests. An empty result " +
    "with a blank page still means something is wrong. Pass `path` for another route.",
  schema: z.object({ ...pathField }),
  async run(context, input) {
    return withPage(context, { path: input.path }, async (page, telemetry) => {
      // No text and nothing drawn: a game on a canvas or an image gallery is
      // not blank.
      const blank =
        (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        ).trim() === "" &&
        (await page
          .locator("canvas, svg, img, video")
          .count()
          .catch(() => 0)) === 0;
      return json({
        consoleErrors: telemetry.consoleErrors,
        pageErrors: telemetry.pageErrors,
        failedRequests: telemetry.failedRequests,
        httpErrors: telemetry.httpErrors,
        blankPage: blank,
      });
    });
  },
});

export const checkNetworkFailuresTool = defineTool({
  name: "check_network_failures",
  description:
    "Load the running preview and report requests that failed or returned 4xx/5xx. Pass `path` " +
    "for another route.",
  schema: z.object({ ...pathField }),
  async run(context, input) {
    return withPage(context, { path: input.path }, async (_page, telemetry) =>
      json({ failedRequests: telemetry.failedRequests, httpErrors: telemetry.httpErrors }),
    );
  },
});

export const accessibilityAuditTool = defineTool({
  name: "accessibility_audit",
  description:
    "A lightweight accessibility audit of the preview: missing labels and alt text, document " +
    "language, heading order, unnamed links and buttons. Pass `path` for another route.",
  schema: z.object({ ...pathField }),
  async run(context, input) {
    return withPage(context, { path: input.path }, async (page) =>
      json(await page.evaluate(A11Y_AUDIT)),
    );
  },
});

export const testResponsiveLayoutTool = defineTool({
  name: "test_responsive_layout",
  description:
    "Check the running preview at common widths (phone 375, tablet 768, desktop 1280 by default) " +
    "for sideways scrolling and elements extending past the screen. Pass `path` for another route.",
  schema: z.object({
    widths: z.array(z.number().int().min(240).max(2560)).max(8).optional(),
    ...pathField,
  }),
  async run(context, input) {
    const results: unknown[] = [];
    for (const width of input.widths ?? [375, 768, 1280]) {
      const result = await withPage(
        context,
        { width, height: 800, path: input.path },
        async (page) => json(await page.evaluate(OVERFLOW_CHECK)),
      );
      if (result.isError) return result;
      results.push({ width, ...JSON.parse(result.output) });
    }
    return json(results);
  },
});

export const BROWSER_QA_TOOLS = [
  inspectPageTool,
  checkConsoleErrorsTool,
  checkNetworkFailuresTool,
  accessibilityAuditTool,
  testResponsiveLayoutTool,
];
