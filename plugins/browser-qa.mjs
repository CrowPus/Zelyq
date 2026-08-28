import { z } from "zod";
import { jsonOutput } from "./lib/shared.mjs";

// Every browser-QA tool can target a route other than the app root. Default
// is the root, so existing behaviour is unchanged when `path` is omitted.
const pathField = {
  path: z
    .string()
    .optional()
    .describe('Route to inspect, relative to the preview root. Default "/". Accepts a hash route.'),
};

// `options` is `{ viewport?, path? }`. `path` selects a route other than the
// app root — composed against the preview URL the same way view_preview does,
// so a hash route ("/#/x") or a real path ("/settings") both work. Callers
// that pass `null` get the root at the default viewport, unchanged.
async function withPage(context, options, action) {
  const { viewport, path } = options ?? {};
  const preview = await context.runtime.previewStatus(context.projectId);
  if (preview.status !== "running" || !preview.url)
    return { output: `Preview is not running (${preview.status}).`, isError: true };
  let target;
  try {
    target = path ? new URL(path, preview.url).href : preview.url;
  } catch {
    return { output: `Not a valid path: "${path}".`, isError: true };
  }
  // Load the heavy browser dependency only when a browser tool is actually used.
  // This also lets the other Phase 1 bundles operate when Chromium is unavailable.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: viewport ?? { width: 1280, height: 800 } });
    const consoleErrors = [];
    const failedRequests = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("requestfailed", (request) =>
      failedRequests.push({ url: request.url(), error: request.failure()?.errorText }),
    );
    await page.goto(target, { waitUntil: "networkidle", timeout: 30000 });
    return await action(page, { consoleErrors, failedRequests, url: target });
  } catch (error) {
    return {
      output: `Browser QA failed: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export default [
  {
    name: "inspect_page",
    description:
      "Inspect the running preview's title, headings, landmarks, links, controls, and visible text as structured data. Pass `path` for a route other than the app root.",
    schema: z.object({ ...pathField }),
    async run(context, input) {
      return withPage(context, { path: input.path }, async (page, telemetry) =>
        jsonOutput({
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
          text: (await page.locator("body").innerText()).slice(0, 12000),
        }),
      );
    },
  },
  {
    name: "check_console_errors",
    description:
      "Load the running preview and return browser console errors and uncaught page errors. Pass `path` for a route other than the app root.",
    schema: z.object({ ...pathField }),
    async run(context, input) {
      return withPage(context, { path: input.path }, async (page, telemetry) => {
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.waitForTimeout(500);
        return jsonOutput({ consoleErrors: telemetry.consoleErrors, pageErrors });
      });
    },
  },
  {
    name: "check_network_failures",
    description:
      "Load the running preview and report failed browser network requests. Pass `path` for a route other than the app root.",
    schema: z.object({ ...pathField }),
    async run(context, input) {
      return withPage(context, { path: input.path }, async (_page, telemetry) =>
        jsonOutput({ failedRequests: telemetry.failedRequests }),
      );
    },
  },
  {
    name: "accessibility_audit",
    description:
      "Run a lightweight accessibility audit of the preview for missing labels, alt text, document language, heading structure, and unnamed links/buttons. Pass `path` for a route other than the app root.",
    schema: z.object({ ...pathField }),
    async run(context, input) {
      return withPage(context, { path: input.path }, async (page) =>
        jsonOutput(
          await page.evaluate(() => {
            const issues = [];
            if (!document.documentElement.lang) issues.push({ rule: "html-lang", target: "html" });
            document.querySelectorAll("img:not([alt])").forEach((el) => {
              issues.push({ rule: "image-alt", target: el.outerHTML.slice(0, 180) });
            });
            document.querySelectorAll("input:not([type=hidden]),textarea,select").forEach((el) => {
              if (
                !el.getAttribute("aria-label") &&
                !el.getAttribute("aria-labelledby") &&
                !el.id?.length
              )
                issues.push({ rule: "form-label", target: el.outerHTML.slice(0, 180) });
            });
            document.querySelectorAll("button,a[href]").forEach((el) => {
              if (!(el.textContent ?? "").trim() && !el.getAttribute("aria-label"))
                issues.push({ rule: "accessible-name", target: el.outerHTML.slice(0, 180) });
            });
            const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((el) =>
              Number(el.tagName[1]),
            );
            headings.forEach((level, i) => {
              if (i && level > headings[i - 1] + 1)
                issues.push({ rule: "heading-order", target: `h${headings[i - 1]} to h${level}` });
            });
            return { issueCount: issues.length, issues };
          }),
        ),
      );
    },
  },
  {
    name: "test_responsive_layout",
    description:
      "Check the running preview at common viewport sizes for horizontal overflow and elements extending beyond the viewport. Pass `path` for a route other than the app root.",
    schema: z.object({
      widths: z.array(z.number().int().min(240).max(2560)).max(8).default([375, 768, 1280]),
      ...pathField,
    }),
    async run(context, input) {
      const results = [];
      for (const width of input.widths) {
        const result = await withPage(
          context,
          { viewport: { width, height: 800 }, path: input.path },
          async (page) =>
            jsonOutput(
              await page.evaluate(() => ({
                viewport: innerWidth,
                documentWidth: document.documentElement.scrollWidth,
                horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
                overflowingElements: [...document.querySelectorAll("body *")]
                  .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
                  .slice(0, 30)
                  .map((el) => ({ tag: el.tagName.toLowerCase(), id: el.id, class: el.className })),
              })),
            ),
        );
        results.push({ width, result: JSON.parse(result.output), isError: result.isError });
      }
      return jsonOutput(results);
    },
  },
];
