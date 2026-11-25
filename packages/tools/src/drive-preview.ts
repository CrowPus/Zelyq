import type { Locator, Page } from "playwright";
import { z } from "zod";
import { type Telemetry, withPage } from "./browser-qa.js";
import { previewTarget } from "./preview.js";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

/**
 * `drive_preview`: use the running app the way a person would — click, type,
 * pick, submit, reload — and check what it shows after each step.
 *
 * Every other preview tool only looks. The agent could see a form but not
 * submit it, so "the todo is added", "the filter works" and "the total
 * updates" were claims nobody had tested. This runs a short script in one
 * browser session and reports each step, the errors the app threw during it,
 * and, when a step fails, a screenshot and what was on the page, so the next
 * attempt can be aimed.
 *
 * The schema is flat on purpose: one object per step with optional fields,
 * not a union of step shapes, because not every provider accepts a union in
 * a tool schema.
 */

const ACTIONS = [
  "click",
  "fill",
  "press",
  "select",
  "check",
  "uncheck",
  "goto",
  "reload",
  "wait",
  "expect_text",
  "expect_visible",
  "expect_url",
] as const;

const ROLES = [
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "tab",
  "menuitem",
  "switch",
  "heading",
  "dialog",
  "listitem",
  "img",
  "slider",
  "spinbutton",
  "searchbox",
  "row",
  "cell",
  "navigation",
  "alert",
  "status",
] as const;

const targetSchema = z
  .object({
    role: z.enum(ROLES).optional().describe("ARIA role, with `name` — the most reliable way in."),
    name: z.string().optional().describe("Accessible name for `role`, e.g. the button's text."),
    label: z.string().optional().describe("A form field by its label text."),
    placeholder: z.string().optional().describe("A field by its placeholder."),
    text: z.string().optional().describe("An element by its visible text."),
    selector: z.string().optional().describe("A CSS selector, when nothing above fits."),
    nth: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Which match, from 0, when several match. Without it, several matches fail."),
    exact: z.boolean().optional().describe("Match the name or text exactly (default false)."),
  })
  .describe("What to act on. Give role+name, label, placeholder, text or selector.");

const stepSchema = z.object({
  action: z.enum(ACTIONS),
  target: targetSchema.optional(),
  value: z.string().optional().describe("For fill: the text to type. For select: the option."),
  key: z.string().optional().describe('For press: a key such as "Enter" or "Escape".'),
  path: z
    .string()
    .optional()
    .describe(
      "For goto: a route in the app, e.g. /cart. For expect_url: what the URL should contain.",
    ),
  text: z.string().optional().describe("For expect_text: text that should be on the page."),
  absent: z
    .boolean()
    .optional()
    .describe("For expect_text / expect_visible: true checks it is NOT there."),
  ms: z.number().int().min(0).max(5000).optional().describe("For wait: milliseconds."),
});

type Step = z.infer<typeof stepSchema>;
/** One step of a flow: what to do in the app, or what to expect of it. */
export type FlowStep = Step;
type Target = z.infer<typeof targetSchema>;

const schema = z.object({
  path: z
    .string()
    .optional()
    .describe('Where to start, relative to the preview root. Default "/".'),
  steps: z.array(stepSchema).min(1).max(30),
  width: z.number().int().min(320).max(2560).optional().describe("Viewport width (default 1280)."),
  screenshot: z
    .boolean()
    .optional()
    .describe("Also return a screenshot at the end when every step passes (default false)."),
});

const ACTION_TIMEOUT_MS = 5_000;
const SETTLE_MS = 1_500;

function describeTarget(target: Target | undefined): string {
  if (!target) return "(no target)";
  const parts: string[] = [];
  if (target.role) parts.push(`${target.role}${target.name ? ` "${target.name}"` : ""}`);
  else if (target.name) parts.push(`"${target.name}"`);
  if (target.label) parts.push(`field labelled "${target.label}"`);
  if (target.placeholder) parts.push(`field with placeholder "${target.placeholder}"`);
  if (target.text) parts.push(`text "${target.text}"`);
  if (target.selector) parts.push(`selector ${target.selector}`);
  if (target.nth !== undefined) parts.push(`#${target.nth}`);
  return parts.join(" ") || "(empty target)";
}

function locate(page: Page, target: Target): Locator | null {
  const exact = target.exact ?? false;
  if (target.role) {
    return page.getByRole(target.role, target.name ? { name: target.name, exact } : {});
  }
  if (target.label) return page.getByLabel(target.label, { exact });
  if (target.placeholder) return page.getByPlaceholder(target.placeholder, { exact });
  if (target.text) return page.getByText(target.text, { exact });
  if (target.name) return page.getByRole("button", { name: target.name, exact });
  if (target.selector) return page.locator(target.selector);
  return null;
}

/**
 * Some roles take no name from their content — a list item, a row, a
 * dialog — so `{role: "listitem", name: "Walk dog"}` finds nothing by name.
 * Then it means the element of that role containing that text.
 */
async function locateWithFallback(page: Page, target: Target): Promise<Locator | null> {
  const locator = locate(page, target);
  if (!locator || !target.role || !target.name) return locator;
  if ((await locator.count()) > 0) return locator;
  return page.getByRole(target.role).filter({ hasText: target.name });
}

/** The one element a step means, or why there is not exactly one. */
async function resolve(page: Page, target: Target | undefined): Promise<Locator | string> {
  if (!target) return "this action needs a target";
  const locator = await locateWithFallback(page, target);
  if (!locator)
    return "the target names nothing: give role+name, label, placeholder, text or selector";
  const count = await locator.count();
  if (count === 0) return `nothing matches ${describeTarget(target)}`;
  if (target.nth !== undefined) {
    if (target.nth >= count) return `${describeTarget(target)}: only ${count} match`;
    return locator.nth(target.nth);
  }
  if (count > 1) {
    return `${count} elements match ${describeTarget(target)}; add nth, exact, or a role`;
  }
  return locator;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: SETTLE_MS }).catch(() => undefined);
  await page.waitForTimeout(100);
}

const bodyText = async (page: Page): Promise<string> =>
  (
    await page
      .locator("body")
      .innerText()
      .catch(() => "")
  ).replace(/\n{3,}/g, "\n\n");

/** Runs one step; null when it passed, else why it failed. */
async function runStep(
  page: Page,
  step: Step,
  origin: string,
  base: string,
): Promise<string | null> {
  switch (step.action) {
    case "goto": {
      const target = previewTarget(base, step.path);
      if (!target || new URL(target).origin !== origin)
        return `not a path in this app: ${step.path}`;
      await page.goto(target, { waitUntil: "load", timeout: 15_000 });
      return null;
    }
    case "reload":
      await page.reload({ waitUntil: "load", timeout: 15_000 });
      return null;
    case "wait":
      await page.waitForTimeout(step.ms ?? 500);
      return null;
    case "press": {
      if (!step.key) return "press needs a key";
      if (step.target) {
        const element = await resolve(page, step.target);
        if (typeof element === "string") return element;
        await element.press(step.key, { timeout: ACTION_TIMEOUT_MS });
      } else {
        await page.keyboard.press(step.key);
      }
      return null;
    }
    case "expect_text": {
      if (!step.text) return "expect_text needs text";
      const needle = step.text.toLowerCase();
      // Give a change that lands a moment later (a fetch, a transition) a
      // chance before calling it missing.
      const deadline = Date.now() + ACTION_TIMEOUT_MS;
      for (;;) {
        const present = (await bodyText(page)).toLowerCase().includes(needle);
        if (present !== Boolean(step.absent)) return null;
        if (Date.now() > deadline) {
          return step.absent
            ? `"${step.text}" is still on the page`
            : `"${step.text}" is not on the page`;
        }
        await page.waitForTimeout(200);
      }
    }
    case "expect_url": {
      if (!step.path) return "expect_url needs path";
      const deadline = Date.now() + ACTION_TIMEOUT_MS;
      while (!page.url().includes(step.path)) {
        if (Date.now() > deadline) return `the URL is ${page.url()}, not containing ${step.path}`;
        await page.waitForTimeout(200);
      }
      return null;
    }
    case "expect_visible": {
      if (!step.target) return "expect_visible needs a target";
      // A moment for the element to appear before falling back to "contains".
      const named = locate(page, step.target);
      await named
        ?.first()
        .waitFor({ state: step.absent ? "hidden" : "visible", timeout: 1_000 })
        .catch(() => undefined);
      const locator = await locateWithFallback(page, step.target);
      if (!locator) return "expect_visible needs a target";
      const scoped =
        step.target?.nth !== undefined ? locator.nth(step.target.nth) : locator.first();
      try {
        await scoped.waitFor({
          state: step.absent ? "hidden" : "visible",
          timeout: ACTION_TIMEOUT_MS,
        });
        return null;
      } catch {
        return step.absent
          ? `${describeTarget(step.target)} is still visible`
          : `${describeTarget(step.target)} is not visible`;
      }
    }
    default: {
      const element = await resolve(page, step.target);
      if (typeof element === "string") return element;
      const options = { timeout: ACTION_TIMEOUT_MS };
      if (step.action === "click") await element.click(options);
      else if (step.action === "fill") {
        if (step.value === undefined) return "fill needs a value";
        await element.fill(step.value, options);
      } else if (step.action === "select") {
        if (step.value === undefined) return "select needs a value";
        await element.selectOption(step.value, options);
      } else if (step.action === "check") await element.check(options);
      else if (step.action === "uncheck") await element.uncheck(options);
      return null;
    }
  }
}

function describeStep(step: Step): string {
  switch (step.action) {
    case "goto":
      return `goto ${step.path ?? "/"}`;
    case "reload":
      return "reload";
    case "wait":
      return `wait ${step.ms ?? 500}ms`;
    case "press":
      return `press ${step.key ?? "?"}${step.target ? ` in ${describeTarget(step.target)}` : ""}`;
    case "fill":
      return `fill ${describeTarget(step.target)} with "${step.value ?? ""}"`;
    case "select":
      return `select "${step.value ?? ""}" in ${describeTarget(step.target)}`;
    case "expect_text":
      return `expect ${step.absent ? "no " : ""}text "${step.text ?? ""}"`;
    case "expect_url":
      return `expect URL containing ${step.path ?? "?"}`;
    case "expect_visible":
      return `expect ${describeTarget(step.target)} ${step.absent ? "hidden" : "visible"}`;
    default:
      return `${step.action} ${describeTarget(step.target)}`;
  }
}

/** The controls on the page, so a failed step can be re-aimed without guessing. */
const CONTROLS = `(() => {
  const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.getAttribute("name") || "").trim().replace(/\\s+/g, " ").slice(0, 60);
  const out = [];
  for (const el of document.querySelectorAll("button,a[href],input:not([type=hidden]),textarea,select,[role=button],[role=tab],[role=checkbox],[role=switch]")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const tag = el.tagName.toLowerCase();
    const kind = tag === "input" ? "input[" + (el.getAttribute("type") || "text") + "]" : el.getAttribute("role") || tag;
    out.push(kind + " " + JSON.stringify(name(el)));
    if (out.length >= 40) break;
  }
  return out;
})()`;

const newSince = (list: string[], from: number) => list.slice(from).map((e) => e.slice(0, 300));

/** The browser-side record a flow reads: what the page threw, logged and failed. */
export interface FlowTelemetry {
  pageErrors: string[];
  consoleErrors: string[];
  httpErrors: Array<{ url: string; status: number }>;
}

export interface FlowOutcome {
  ok: boolean;
  /** One line per step run, with the errors that step caused. */
  lines: string[];
  /** Index of the step that failed, or -1. */
  failedAt: number;
}

/**
 * Runs steps on a page that is already open at the app, stopping at the first
 * failure. An uncaught error fails a step even when the step itself went
 * through: the person would be looking at a broken app. Shared by
 * `drive_preview` and by graders that judge an app the agent built, so both
 * use the app the same way.
 */
export async function runFlow(
  page: Page,
  telemetry: FlowTelemetry,
  steps: FlowStep[],
  base: string,
  signal?: AbortSignal,
): Promise<FlowOutcome> {
  const origin = new URL(base).origin;
  const lines: string[] = [];
  for (const [index, step] of steps.entries()) {
    if (signal?.aborted) {
      lines.push(`${index + 1}. stopped`);
      return { ok: false, lines, failedAt: index };
    }
    const errorsBefore = telemetry.pageErrors.length;
    const consoleBefore = telemetry.consoleErrors.length;
    const httpBefore = telemetry.httpErrors.length;
    let failure: string | null;
    try {
      failure = await runStep(page, step, origin, base);
    } catch (error) {
      failure = (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "failed";
    }
    if (!step.action.startsWith("expect") && step.action !== "wait") await settle(page);

    const thrown = newSince(telemetry.pageErrors, errorsBefore);
    const consoleErrors = newSince(telemetry.consoleErrors, consoleBefore);
    const http = telemetry.httpErrors.slice(httpBefore).map((e) => `${e.status} ${e.url}`);
    const notes = [
      thrown.length ? `threw: ${thrown.join(" | ")}` : "",
      consoleErrors.length ? `console errors: ${consoleErrors.slice(0, 3).join(" | ")}` : "",
      http.length ? `failed requests: ${http.slice(0, 3).join(", ")}` : "",
    ].filter(Boolean);
    lines.push(
      `${index + 1}. ${describeStep(step)} — ${failure ? `FAILED: ${failure}` : "ok"}` +
        (notes.length ? `\n   ${notes.join("\n   ")}` : ""),
    );
    if (failure || thrown.length) {
      const remaining = steps.length - index - 1;
      if (remaining > 0) lines.push(`(${remaining} later step(s) not run)`);
      return { ok: false, lines, failedAt: index };
    }
  }
  return { ok: true, lines, failedAt: -1 };
}

async function drive(
  context: ToolContext,
  page: Page,
  telemetry: Telemetry,
  input: z.infer<typeof schema>,
): Promise<ToolResult> {
  const preview = await context.runtime.previewStatus(context.projectId);
  const base = preview.url ?? telemetry.url;
  const lines: string[] = [`Drove the preview from ${input.path ?? "/"}:`];
  if (telemetry.pageErrors.length) {
    lines.push(
      `  (while loading, the page threw: ${newSince(telemetry.pageErrors, 0).join(" | ")})`,
    );
  }
  const flow = await runFlow(page, telemetry, input.steps, base, context.signal);
  lines.push(...flow.lines);

  if (!flow.ok) {
    const controls = (await page.evaluate(CONTROLS).catch(() => [])) as string[];
    lines.push(
      `\nNow at ${page.url()}.`,
      `Controls on the page: ${controls.length ? controls.join(", ") : "none found"}`,
      `Visible text:\n${(await bodyText(page)).slice(0, 1500)}`,
      "\nThis is how the app behaves for a person. Fix the app, or the step if it aimed at the " +
        "wrong thing, and drive it again.",
    );
    const shot = await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => null);
    return {
      output: lines.join("\n"),
      isError: true,
      ...(shot ? { images: [{ mimeType: "image/jpeg", data: shot.toString("base64") }] } : {}),
    };
  }

  lines.push(`\nEvery step passed. Now at ${page.url()}.`);
  const shot = input.screenshot
    ? await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => null)
    : null;
  return {
    output: lines.join("\n"),
    ...(shot ? { images: [{ mimeType: "image/jpeg", data: shot.toString("base64") }] } : {}),
  };
}

export const drivePreviewTool = defineTool({
  name: "drive_preview",
  description:
    "Use the running app like a person: click, fill, press keys, pick options, tick boxes, go to " +
    "a route, reload — then check text, visibility or the URL. Runs the steps in one browser " +
    "session and reports each one, with any error the app threw; a failed step returns a " +
    "screenshot, the page's controls and its text. Use it to prove a flow works (add an item, " +
    "submit a form, switch a tab, survive a reload) instead of assuming it does. Target by " +
    'role+name ({role:"button", name:"Add"}) where you can. Needs the preview running.',
  schema,
  async run(context, input): Promise<ToolResult> {
    return withPage(context, { path: input.path, width: input.width ?? 1280 }, (page, telemetry) =>
      drive(context, page, telemetry, input),
    );
  },
});
