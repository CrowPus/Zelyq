/**
 * `capture_reference` (proposal 067) — the recon step behind `/clone`.
 *
 * Visits a live external website with a real browser, walks same-origin pages,
 * and writes a full capture bundle into the project at `clone/<host>/`:
 * full-page screenshots per width, post-JS DOM, element geometry + resolved
 * styles, a resource manifest with provenance, and every asset it can fetch.
 * It returns a small summary — the model reads the written files for detail,
 * never a DOM dump in a tool result (the 065 lesson).
 *
 * Every network call — page navigation and every subresource — is forced
 * through `capture-fetch-guard`. Public pages only; if the site blocks
 * automation or needs a login, the tool says so and the agent is told to stop
 * and ask.
 *
 * `mode: "single"` with `diffAgainst` pointed at a previously-captured
 * reference dir turns this into the diff step of the build loop: it captures
 * the local preview and writes a pixel diff + a changed-ratio per width.
 */
import { type Browser, chromium, type Page } from "playwright";
import { z } from "zod";
import {
  assertAllowedUrl,
  assertRequestAllowed,
  CaptureBlockedError,
  CLONE_USER_AGENT,
  guardedFetch,
} from "./capture-fetch-guard.js";
import { defineTool, type ToolResult } from "./types.js";

// --- limits (council conditions, §11) ----------------------------------------

const DEFAULT_WIDTHS = [390, 768, 1280, 1440];
const MAX_WIDTHS = 4;
const DEFAULT_MAX_PAGES = 8;
const HARD_MAX_PAGES = 20;
const TOTAL_BYTE_BUDGET = 150 * 1024 * 1024;
const PER_ASSET_BYTES = 8 * 1024 * 1024;
const WALL_CLOCK_MS = 6 * 60 * 1000;
const NAV_TIMEOUT_MS = 30_000;
const VIEWPORT_HEIGHT = 900;

// --- pure helpers (exported for the unit test) ------------------------------

/** A filesystem-safe slug for a host: lowercased, `www.` dropped, odd chars → `-`. */
export function hostSlug(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Normalises a link to a same-origin path, or null if it is off-origin, not
 * http(s), or a download / mailto / tel. Hash and query are dropped.
 */
export function normalizePath(href: string, base: URL): string | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.host !== base.host) return null;
  if (/\.(zip|pdf|dmg|exe|pkg|tar|gz|mp4|mov|mp3|wav)$/i.test(url.pathname)) return null;
  let path = url.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";
  return path;
}

/** `/` → `index`; `/about/` → `about`; `/blog/post` → `blog/post`. */
export function pathToDir(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return clean === "" ? "index" : clean.replace(/[^a-zA-Z0-9/_-]/g, "-");
}

/** Disallowed path prefixes from robots.txt, for `User-agent: *` only. */
export function parseRobots(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const disallow: string[] = [];
  let appliesToUs = false;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      appliesToUs = value === "*";
    } else if (key === "disallow" && appliesToUs && value) {
      disallow.push(value);
    }
  }
  return disallow;
}

export function isDisallowed(path: string, rules: string[]): boolean {
  return rules.some((rule) => rule === "/" || path.startsWith(rule));
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "application/font-woff2": "woff2",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function normalizeType(contentType: string | undefined): string {
  return ((contentType ?? "").split(";")[0] ?? "").trim().toLowerCase();
}

export function pickExtension(contentType: string | undefined, url: string): string {
  const type = normalizeType(contentType);
  if (EXT_BY_TYPE[type]) return EXT_BY_TYPE[type] as string;
  const fromUrl = ((url.split("?")[0] ?? "").split("#")[0] ?? "").match(/\.([a-z0-9]{2,5})$/i);
  return fromUrl ? (fromUrl[1] ?? "bin").toLowerCase() : "bin";
}

const ASSET_TYPE_RE = /^(image\/|font\/|video\/|audio\/|application\/font)/;

export function isAssetType(contentType: string | undefined): boolean {
  return ASSET_TYPE_RE.test(normalizeType(contentType));
}

/** Best-effort framework / CMS fingerprint from the served HTML. */
export function guessFramework(html: string): string {
  const checks: Array<[RegExp, string]> = [
    [/__NEXT_DATA__|\/_next\/static/, "Next.js"],
    [/id="__nuxt"|\/_nuxt\//, "Nuxt"],
    [/<!--\[if!IE\]>-->|data-reactroot|id="root"/, "React (SPA)"],
    [/ng-version=/, "Angular"],
    [/data-svelte-h|__sveltekit/, "SvelteKit"],
    [/<astro-island|\/_astro\//, "Astro"],
    [/wp-content\/|wp-includes\//, "WordPress"],
    [/cdn\.shopify\.com|Shopify\.theme/, "Shopify"],
    [/static\.parastorage\.com|X-Wix-/, "Wix"],
    [/squarespace\.com|static1\.squarespace/, "Squarespace"],
    [/webflow\.js|w-mod-/, "Webflow"],
    [/gatsby-|___gatsby/, "Gatsby"],
  ];
  for (const [re, name] of checks) if (re.test(html)) return name;
  return "unknown / hand-rolled";
}

interface AssetRecord {
  sourceUrl: string;
  file?: string;
  bytes?: number;
  contentType?: string;
  ok: boolean;
  reason?: string;
  provenance: "copied" | "failed" | "skipped";
}

export interface CaptureSummary {
  host: string;
  entryUrl: string;
  mode: string;
  pages: Array<{ path: string; title: string; widths: number[] }>;
  widths: number[];
  framework: string;
  fonts: string[];
  assets: { copied: number; failed: number; skipped: number };
  robotsSkipped: string[];
  bundleDir: string;
  diffs?: Array<{ width: number; changedRatio: number; diffFile: string }>;
  notes: string[];
}

/** The < 4 KB string the model actually receives. */
export function summarize(s: CaptureSummary): string {
  const lines: string[] = [];
  lines.push(`Captured ${s.host} (${s.mode}) → ${s.bundleDir}/`);
  lines.push(`Framework guess: ${s.framework}`);
  lines.push(`Widths: ${s.widths.join(", ")}`);
  lines.push(`Pages (${s.pages.length}):`);
  for (const p of s.pages) lines.push(`  ${p.path}  —  ${p.title || "(no title)"}`);
  lines.push(
    `Assets: ${s.assets.copied} copied, ${s.assets.failed} failed, ${s.assets.skipped} skipped ` +
      `(see ${s.bundleDir}/manifest.json; failures → substitute + log in ${s.bundleDir}/asset-gaps.md)`,
  );
  if (s.fonts.length) lines.push(`Fonts seen: ${s.fonts.slice(0, 8).join(", ")}`);
  if (s.robotsSkipped.length) lines.push(`robots.txt skipped: ${s.robotsSkipped.join(", ")}`);
  if (s.diffs?.length) {
    lines.push("Diff vs reference:");
    for (const d of s.diffs)
      lines.push(`  ${d.width}px — ${(d.changedRatio * 100).toFixed(2)}% changed → ${d.diffFile}`);
  }
  for (const n of s.notes) lines.push(`Note: ${n}`);
  lines.push("");
  lines.push(
    "Next: read manifest.json + reference/<page>/geometry.json, write clone/<host>/REPLICA.md " +
      "(the build plan) BEFORE any component code, then build macro-geometry first.",
  );
  return lines.join("\n");
}

// --- the selector set measured on every page --------------------------------

const GEOMETRY_SELECTORS = [
  "html",
  "body",
  "header",
  "nav",
  "main",
  "footer",
  "section",
  "h1",
  "h2",
  "h3",
  "p",
  "a",
  "button",
  "img",
  "ul",
  "form",
  "input",
];

// --- in-page scripts -------------------------------------------------------

const COLLECT_GEOMETRY = `(selectors) => {
  const props = ["display","position","box-sizing","width","height","max-width","margin-top",
    "margin-bottom","padding-top","padding-bottom","padding-left","padding-right","gap",
    "font-family","font-size","font-weight","line-height","letter-spacing","text-align","color",
    "background-color","border-radius","box-shadow","opacity","object-fit","object-position",
    "flex-direction","align-items","justify-content","grid-template-columns"];
  const out = {};
  for (const sel of selectors) {
    const nodes = [...document.querySelectorAll(sel)].slice(0, 12);
    out[sel] = nodes.map((el, i) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const styles = {};
      for (const p of props) styles[p] = cs.getPropertyValue(p);
      return { index: i, tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().slice(0, 100),
        rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        styles };
    });
  }
  return out;
}`;

const COLLECT_RESOURCES = `() => {
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };
  const seen = new Set();
  const push = (arr, kind, url, extra) => {
    if (!url || seen.has(kind + url)) return;
    seen.add(kind + url);
    arr.push(Object.assign({ kind, url }, extra || {}));
  };
  const out = [];
  for (const img of document.querySelectorAll("img")) {
    const r = img.getBoundingClientRect();
    push(out, "img", abs(img.currentSrc || img.src), {
      intrinsic: [img.naturalWidth, img.naturalHeight],
      displayed: [Math.round(r.width), Math.round(r.height)],
      objectFit: getComputedStyle(img).objectFit, alt: (img.alt || "").slice(0, 80) });
  }
  for (const s of document.querySelectorAll("source[srcset]")) {
    const first = (s.getAttribute("srcset") || "").split(",")[0].trim().split(/\\s+/)[0];
    push(out, "source", abs(first));
  }
  for (const el of document.querySelectorAll("*")) {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== "none") {
      const m = bg.match(/url\\(["']?([^"')]+)["']?\\)/);
      if (m) push(out, "background", abs(m[1]));
    }
  }
  for (const v of document.querySelectorAll("video")) {
    push(out, "video", abs(v.src));
    for (const src of v.querySelectorAll("source")) push(out, "video", abs(src.src));
    push(out, "poster", abs(v.poster));
  }
  for (const l of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]'))
    push(out, "icon", abs(l.href));
  const fonts = [...new Set([...document.fonts].map((f) => f.family + " " + f.weight + " " + f.style))];
  return { resources: out, fonts,
    bodyFont: getComputedStyle(document.body).fontFamily,
    title: document.title };
}`;

const PIXEL_DIFF = `async ({ ref, shot, maxW }) => {
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("decode")); i.src = src; });
  const a = await load("data:image/png;base64," + ref);
  const b = await load("data:image/png;base64," + shot);
  const baseW = Math.max(a.naturalWidth, b.naturalWidth) || 1;
  const scale = Math.min(1, maxW / baseW);
  const w = Math.max(1, Math.round(baseW * scale));
  const h = Math.max(1, Math.round((Math.max(a.naturalHeight, b.naturalHeight) || 1) * scale));
  const mk = () => { const c = new OffscreenCanvas(w, h); const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); return [c, x]; };
  const [, xa] = mk(); xa.drawImage(a, 0, 0, a.naturalWidth * scale, a.naturalHeight * scale);
  const [, xb] = mk(); xb.drawImage(b, 0, 0, b.naturalWidth * scale, b.naturalHeight * scale);
  const [cd, xd] = mk();
  const da = xa.getImageData(0, 0, w, h), db = xb.getImageData(0, 0, w, h);
  const od = xd.createImageData(w, h);
  let changed = 0;
  for (let i = 0; i < da.data.length; i += 4) {
    const diff = Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i+1] - db.data[i+1]) + Math.abs(da.data[i+2] - db.data[i+2]);
    if (diff > 30) { changed++; od.data[i] = 255; od.data[i+1] = 0; od.data[i+2] = 0; od.data[i+3] = 255; }
    else { od.data[i] = da.data[i]; od.data[i+1] = da.data[i+1]; od.data[i+2] = da.data[i+2]; od.data[i+3] = 90; }
  }
  xd.putImageData(od, 0, 0);
  const blob = await cd.convertToBlob({ type: "image/png" });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return { changedRatio: changed / (w * h), width: w, height: h, png: btoa(bin) };
}`;

const SCROLL_THROUGH = `async () => {
  await new Promise((resolve) => {
    let y = 0;
    const step = () => {
      window.scrollTo(0, y);
      y += window.innerHeight;
      if (y < document.body.scrollHeight) setTimeout(step, 60);
      else { window.scrollTo(0, 0); resolve(); }
    };
    step();
  });
}`;

// --- the tool ------------------------------------------------------------

const schema = z.object({
  url: z.string().describe("Absolute http(s) URL to capture."),
  mode: z
    .enum(["site", "single"])
    .optional()
    .describe(
      '"site" (default) crawls same-origin pages; "single" captures just this URL — use "single" ' +
        "against the running preview for the diff loop.",
    ),
  pages: z
    .array(z.string())
    .optional()
    .describe('Extra same-origin paths to force-include, e.g. ["/pricing", "/about"].'),
  widths: z
    .array(z.number().int().min(320).max(2560))
    .optional()
    .describe("Viewport widths (default [390, 768, 1280, 1440], first 4 used)."),
  maxPages: z
    .number()
    .int()
    .min(1)
    .max(HARD_MAX_PAGES)
    .optional()
    .describe(`Crawl ceiling (default ${DEFAULT_MAX_PAGES}, hard cap ${HARD_MAX_PAGES}).`),
  diffAgainst: z
    .string()
    .optional()
    .describe(
      'With mode:"single": what to pixel-diff the capture against. Either a reference page ' +
        'directory holding <width>.png files (e.g. "clone/example.com/reference/index") or a ' +
        'single image file used for every width (e.g. "design/<key>/render/<frame>.png"). ' +
        "Writes a diff image and reports the changed ratio.",
    ),
});

export const captureReferenceTool = defineTool({
  name: "capture_reference",
  description:
    "Visit a live external website with a real browser and save a capture bundle into " +
    "clone/<host>/ — full-page screenshots per width, post-JS DOM, element geometry, a resource " +
    "manifest, and every asset it can fetch. Use it as the first step of a /clone task, then " +
    "read the written files. Returns a short summary, never the DOM. Public pages only: if the " +
    "site needs a login or blocks bots, it says so — stop and ask the user. Every request is " +
    "SSRF-guarded (no private hosts, no redirects to internal addresses).",
  schema,
  async run(context, input): Promise<ToolResult> {
    if (process.env.ZELYQ_CLONE_ENABLED === "false") {
      return {
        output: "The operator has disabled /clone on this instance (ZELYQ_CLONE_ENABLED=false).",
        isError: true,
      };
    }

    let entry: URL;
    try {
      entry = assertAllowedUrl(input.url);
    } catch (error) {
      return {
        output:
          error instanceof CaptureBlockedError
            ? `Refusing to capture ${JSON.stringify(input.url)}: ${error.reason}`
            : `Bad URL: ${(error as Error).message}`,
        isError: true,
      };
    }

    const mode = input.mode ?? "site";
    const widths = [...new Set(input.widths?.length ? input.widths : DEFAULT_WIDTHS)]
      .sort((a, b) => a - b)
      .slice(0, MAX_WIDTHS);
    const maxPages = Math.min(input.maxPages ?? DEFAULT_MAX_PAGES, HARD_MAX_PAGES);
    const host = hostSlug(entry.hostname);
    const bundleDir = `clone/${host}`;
    const deadline = Date.now() + WALL_CLOCK_MS;
    const notes: string[] = [];

    const summary: CaptureSummary = {
      host,
      entryUrl: entry.href,
      mode,
      pages: [],
      widths,
      framework: "unknown / hand-rolled",
      fonts: [],
      assets: { copied: 0, failed: 0, skipped: 0 },
      robotsSkipped: [],
      bundleDir,
      notes,
    };

    // robots.txt — advisory, honoured for the crawl.
    let robotsRules: string[] = [];
    if (mode === "site") {
      try {
        const res = await guardedFetch(`${entry.origin}/robots.txt`, { timeoutMs: 8000 });
        if (res.status === 200) robotsRules = parseRobots(res.body.toString("utf8"));
      } catch {
        /* no robots.txt, or unreachable — nothing to honour */
      }
    }

    const assetUrls = new Map<string, { contentType?: string }>();
    const allFonts = new Set<string>();
    let firstHtml = "";

    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const ctx = await browser.newContext({
        userAgent: CLONE_USER_AGENT,
        deviceScaleFactor: 1,
        // No storage, no permissions — an anonymous visitor.
        javaScriptEnabled: true,
      });
      const resolveCacheOk = new Set<string>();
      const resolveCacheBad = new Set<string>();
      await ctx.route("**/*", async (route) => {
        const reqUrl = route.request().url();
        if (!/^https?:/i.test(reqUrl)) return route.continue();
        try {
          const u = new URL(reqUrl);
          if (resolveCacheBad.has(u.host)) return route.abort();
          if (!resolveCacheOk.has(u.host)) {
            await assertRequestAllowed(reqUrl);
            resolveCacheOk.add(u.host);
          }
          return route.continue();
        } catch {
          try {
            resolveCacheBad.add(new URL(reqUrl).host);
          } catch {
            /* ignore */
          }
          return route.abort();
        }
      });

      // --- BFS crawl -------------------------------------------------------
      const queue: string[] = ["/"];
      for (const extra of input.pages ?? []) {
        const norm = normalizePath(extra, entry);
        if (norm && !queue.includes(norm)) queue.push(norm);
      }
      const visited = new Set<string>();

      while (queue.length > 0 && visited.size < (mode === "single" ? 1 : maxPages)) {
        if (Date.now() > deadline) {
          notes.push("hit the 6-minute wall-clock budget — captured what was reached so far");
          break;
        }
        if (context.signal.aborted) {
          notes.push("aborted by the user");
          break;
        }
        const path = queue.shift() as string;
        if (visited.has(path)) continue;
        if (mode === "site" && isDisallowed(path, robotsRules)) {
          summary.robotsSkipped.push(path);
          continue;
        }
        visited.add(path);

        const pageUrl = mode === "single" ? entry.href : new URL(path, entry).href;
        context.log(
          `capture_reference: ${path}  (${visited.size}/${mode === "single" ? 1 : maxPages})`,
        );

        const pageDir = `${bundleDir}/reference/${pathToDir(path)}`;
        const perPageWidths: number[] = [];
        let pageTitle = "";

        for (const width of widths) {
          if (Date.now() > deadline) break;
          let page: Page | undefined;
          try {
            page = await ctx.newPage();
            await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
            page.on("response", (res) => {
              const ct = res.headers()["content-type"];
              if (isAssetType(ct) && /^https?:/i.test(res.url())) {
                assetUrls.set(res.url().split("#")[0] ?? res.url(), { contentType: ct });
              }
            });
            const resp = await page.goto(pageUrl, {
              waitUntil: "networkidle",
              timeout: NAV_TIMEOUT_MS,
            });
            const status = resp?.status() ?? 0;

            if (visited.size === 1 && width === widths[0]) {
              // Auth / bot-wall check on the very first load.
              const finalUrl = page.url();
              if (
                status === 401 ||
                status === 403 ||
                /\/(login|signin|sign-in|auth|account\/login)(\/|$|\?)/i.test(finalUrl)
              ) {
                await browser.close().catch(() => undefined);
                return {
                  output:
                    `${pageUrl} responded ${status} / redirected to ${finalUrl}. This site needs a ` +
                    "login or blocks automated access. STOP and ask the user whether they own this " +
                    "site or have permission to reproduce it before going further.",
                  isError: true,
                };
              }
            }

            await page
              .evaluate("document.fonts ? document.fonts.ready : Promise.resolve()")
              .catch(() => undefined);
            // Trigger lazy content, then settle.
            await page.evaluate(`(${SCROLL_THROUGH})()`).catch(() => undefined);
            await page.waitForTimeout(500);

            const shot = await page.screenshot({ fullPage: true, animations: "disabled" });
            await context.runtime.writeFile(
              context.projectId,
              `${pageDir}/${width}.png`,
              shot.toString("base64"),
              "base64",
            );
            perPageWidths.push(width);

            // Full detail only at the widest capture.
            if (width === widths[widths.length - 1]) {
              const html = await page.content();
              if (!firstHtml) firstHtml = html;
              await context.runtime.writeFile(context.projectId, `${pageDir}/dom.html`, html);

              const geometry = await page.evaluate(
                `(${COLLECT_GEOMETRY})(${JSON.stringify(GEOMETRY_SELECTORS)})`,
              );
              await context.runtime.writeFile(
                context.projectId,
                `${pageDir}/geometry.json`,
                JSON.stringify({ url: pageUrl, width, data: geometry }, null, 2),
              );

              const collected = await page.evaluate<{
                resources: Array<{ kind: string; url: string }>;
                fonts: string[];
                bodyFont: string;
                title: string;
              }>(`(${COLLECT_RESOURCES})()`);
              pageTitle = collected.title;
              for (const f of collected.fonts) allFonts.add(f);
              await context.runtime.writeFile(
                context.projectId,
                `${pageDir}/resources.json`,
                JSON.stringify(collected, null, 2),
              );
              for (const r of collected.resources) {
                if (r.url && /^https?:/i.test(r.url)) {
                  assetUrls.set(r.url.split("#")[0] ?? r.url, {});
                }
              }

              if (mode === "site") {
                const hrefs = await page.evaluate<string[]>(
                  "Array.from(document.querySelectorAll('a[href]')).map(function(a){return a.href})",
                );
                for (const href of hrefs) {
                  const norm = normalizePath(href, entry);
                  if (
                    norm &&
                    !visited.has(norm) &&
                    !queue.includes(norm) &&
                    visited.size + queue.length < maxPages
                  ) {
                    queue.push(norm);
                  }
                }
              }
            }
          } catch (error) {
            notes.push(`${path} @ ${width}px failed: ${(error as Error).message}`);
          } finally {
            await page?.close().catch(() => undefined);
          }
        }

        if (perPageWidths.length > 0) {
          summary.pages.push({ path, title: pageTitle, widths: perPageWidths });
        }
      }

      // --- asset download ------------------------------------------------
      const assetRecords: AssetRecord[] = [];
      let totalBytes = 0;
      for (const [assetUrl, meta] of assetUrls) {
        if (Date.now() > deadline) {
          notes.push("asset download stopped at the wall-clock budget");
          break;
        }
        if (totalBytes >= TOTAL_BYTE_BUDGET) {
          notes.push("asset download stopped at the 150 MB budget");
          break;
        }
        try {
          const res = await guardedFetch(assetUrl, {
            maxBytes: PER_ASSET_BYTES,
            timeoutMs: 15_000,
          });
          if (res.status !== 200) {
            assetRecords.push({
              sourceUrl: assetUrl,
              ok: false,
              reason: `HTTP ${res.status}`,
              provenance: "failed",
            });
            summary.assets.failed += 1;
            continue;
          }
          const ct = (res.headers["content-type"] as string) ?? meta.contentType;
          const ext = pickExtension(ct, assetUrl);
          const sha = simpleHash(assetUrl);
          const file = `${bundleDir}/assets/${sha}.${ext}`;
          await context.runtime.writeFile(
            context.projectId,
            file,
            res.body.toString("base64"),
            "base64",
          );
          totalBytes += res.body.length;
          assetRecords.push({
            sourceUrl: assetUrl,
            file,
            bytes: res.body.length,
            contentType: ct,
            ok: true,
            provenance: "copied",
          });
          summary.assets.copied += 1;
        } catch (error) {
          const reason =
            error instanceof CaptureBlockedError ? error.reason : (error as Error).message;
          assetRecords.push({ sourceUrl: assetUrl, ok: false, reason, provenance: "failed" });
          summary.assets.failed += 1;
        }
      }

      summary.framework = guessFramework(firstHtml);
      summary.fonts = [...allFonts];

      // --- manifest + logs ---------------------------------------------
      await context.runtime.writeFile(
        context.projectId,
        `${bundleDir}/manifest.json`,
        JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            entryUrl: entry.href,
            host,
            mode,
            widths,
            framework: summary.framework,
            fonts: summary.fonts,
            pages: summary.pages,
            robotsSkipped: summary.robotsSkipped,
            assets: assetRecords,
          },
          null,
          2,
        ),
      );
      await context.runtime.writeFile(
        context.projectId,
        `${bundleDir}/capture-log.md`,
        [
          `# Capture log — ${entry.href}`,
          "",
          `- when: ${new Date().toISOString()}`,
          `- mode: ${mode}`,
          `- widths: ${widths.join(", ")}`,
          `- pages captured: ${summary.pages.length}`,
          `- assets: ${summary.assets.copied} copied, ${summary.assets.failed} failed`,
          `- robots.txt skipped: ${summary.robotsSkipped.join(", ") || "none"}`,
          "",
          "## Notes",
          ...(notes.length ? notes.map((n) => `- ${n}`) : ["- (none)"]),
          "",
          "## Failed assets — substitute a dimension-matched equivalent and record each here:",
          ...assetRecords
            .filter((a) => !a.ok)
            .map((a) => `- ${a.sourceUrl} — ${a.reason}`)
            .slice(0, 200),
        ].join("\n"),
      );
      context.onFileChanged(bundleDir);

      // --- optional diff (mode: "single") ------------------------------
      if (mode === "single" && input.diffAgainst) {
        summary.diffs = [];
        // `diffAgainst` is either a directory holding `<width>.png` files (the
        // `/clone` shape) or a single image file (a Figma render, one size for
        // the frame). A `.png`/`.jpg` suffix ⇒ use that one file for every width.
        const single = /\.(png|jpe?g|webp)$/i.test(input.diffAgainst);
        for (const width of widths) {
          try {
            const refPath = single
              ? input.diffAgainst
              : `${input.diffAgainst.replace(/\/+$/, "")}/${width}.png`;
            const refFile = await context.runtime.readFile(context.projectId, refPath);
            const refB64 =
              refFile.encoding === "base64"
                ? refFile.content
                : Buffer.from(refFile.content, "utf8").toString("base64");
            const shotFile = await context.runtime.readFile(
              context.projectId,
              `${bundleDir}/reference/${pathToDir("/")}/${width}.png`,
            );
            const shotB64 =
              shotFile.encoding === "base64"
                ? shotFile.content
                : Buffer.from(shotFile.content, "utf8").toString("base64");
            const page = await ctx.newPage();
            let result: { changedRatio: number; png: string };
            try {
              result = await page.evaluate<{ changedRatio: number; png: string }>(
                `(${PIXEL_DIFF})(${JSON.stringify({ ref: refB64, shot: shotB64, maxW: 1400 })})`,
              );
            } finally {
              await page.close().catch(() => undefined);
            }
            const diffFile = `${bundleDir}/diff/${pathToDir("/")}/${width}.png`;
            await context.runtime.writeFile(context.projectId, diffFile, result.png, "base64");
            summary.diffs.push({ width, changedRatio: result.changedRatio, diffFile });
          } catch (error) {
            notes.push(`diff @ ${width}px failed: ${(error as Error).message}`);
          }
        }
      }
    } catch (error) {
      return {
        output:
          error instanceof CaptureBlockedError
            ? `Capture blocked: ${error.reason}`
            : `capture_reference failed: ${(error as Error).message}`,
        isError: true,
      };
    } finally {
      await browser?.close().catch(() => undefined);
    }

    if (summary.pages.length === 0) {
      return {
        output:
          `Nothing could be captured from ${entry.href}. ${notes.join("; ") || "The page did not load."} ` +
          "If the site blocks automation, tell the user and ask whether they own it.",
        isError: true,
      };
    }

    // The summary carries page titles and text harvested from a site the user
    // does not control — mark it so the session wraps it (finding E1).
    return { output: summarize(summary), untrusted: { source: entry.hostname } };
  },
});

/** A short, stable id for an asset URL. Not crypto — just a filename. */
function simpleHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
