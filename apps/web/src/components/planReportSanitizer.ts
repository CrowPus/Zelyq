/**
 * Turns a model-authored `architecture/report.html` into a safe,
 * self-contained document to drop into a `sandbox=""` iframe.
 *
 * Three things happen here, and the order matters:
 *   1. the raw HTML is parsed with the browser's real HTML parser (not a
 *      regex) and walked with an explicit allow-policy — every element,
 *      attribute, and URL not on the list is dropped;
 *   2. its `<style>` blocks are carried through a CSS scrub that removes
 *      `@import` and any remote `url(...)`;
 *   3. the result is assembled into a fresh document whose FIRST `<head>`
 *      child is a `default-src 'none'` CSP `<meta>`, so nothing the model
 *      wrote can contribute a resource load before the policy is in force.
 *
 * The sandboxed iframe and that CSP are the load-bearing controls; this
 * sanitiser is the third independent layer. The model's file is never
 * trusted because it "passed" — it is treated as hostile input every render.
 */

export const REPORT_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";

// Elements that may appear in the report body. Anything else is unwrapped
// (its children are kept) unless it is in DROP_SUBTREE below.
const ALLOWED_ELEMENTS = new Set([
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "wbr",
]);

// Elements dropped whole, children and all — active, embedding, or
// head-only content that has no place in a passive report body.
const DROP_SUBTREE = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "link",
  "meta",
  "base",
  "title",
  "noscript",
  "template",
  "svg",
  "math",
  "canvas",
  "audio",
  "video",
  "source",
  "track",
  "applet",
  "frame",
  "frameset",
  "portal",
]);

const ALLOWED_ATTRS = new Set([
  "class",
  "id",
  "colspan",
  "rowspan",
  "scope",
  "headers",
  "lang",
  "dir",
  "title",
  "alt",
  "width",
  "height",
  "datetime",
  "align",
  "valign",
]);

/** true when a URL value is safe for this passive document: a data-image URI
 * or a same-document fragment. Everything else (http(s), //, javascript:,
 * relative paths, other data: types) is rejected. */
function isSafeUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith("#")) return true;
  if (v.startsWith("data:image/")) return true;
  return false;
}

/** Remove `@import` and remote `url(...)` from a CSS string. Inline CSS is
 * allowed by the CSP (`style-src 'unsafe-inline'`) but must not reach out. */
export function scrubCss(css: string): string {
  return css
    .replace(/@import[^;]+;?/gi, "")
    .replace(/url\(\s*(['"]?)\s*(?:https?:|\/\/)[^)]*\1\s*\)/gi, "none")
    .replace(/expression\s*\(/gi, "void(")
    .replace(/javascript:/gi, "");
}

function scrubElement(el: Element): void {
  // Attributes: keep the allowlist; keep `style` only after scrubbing; keep
  // `href`/`src` only when they are a safe URL.
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (name === "style") {
      const cleaned = scrubCss(attr.value);
      if (cleaned.trim()) el.setAttribute("style", cleaned);
      else el.removeAttribute("style");
      continue;
    }
    if ((name === "href" || name === "src") && el.tagName.toLowerCase() === "a") {
      if (!isSafeUrl(attr.value)) el.removeAttribute(attr.name);
      continue;
    }
    if (name === "src" && el.tagName.toLowerCase() === "img") {
      if (!isSafeUrl(attr.value)) el.removeAttribute(attr.name);
      continue;
    }
    if (!ALLOWED_ATTRS.has(name)) el.removeAttribute(attr.name);
  }
}

function walk(node: Node): void {
  const children = [...node.childNodes];
  for (const child of children) {
    if (child.nodeType === 8 /* comment */) {
      child.remove();
      continue;
    }
    if (child.nodeType !== 1 /* element */) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP_SUBTREE.has(tag)) {
      el.remove();
      continue;
    }
    walk(el);
    if (!ALLOWED_ELEMENTS.has(tag)) {
      // Unknown-but-not-dangerous: unwrap, keeping already-sanitised children.
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
      continue;
    }
    scrubElement(el);
  }
}

// A small readable baseline so an under-styled report still holds together,
// and so the ASCII architecture diagrams in <pre> scroll instead of blowing
// out the page. The model's own <style> comes AFTER this and wins.
const REPORT_BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:light dark}
body{margin:0;padding:2rem clamp(1rem,4vw,3rem);max-width:64rem;margin-inline:auto;
  font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:#1a1a1a;background:#fff}
@media (prefers-color-scheme:dark){body{color:#e6e6e6;background:#0f1115}}
h1,h2,h3,h4{line-height:1.25;margin:2rem 0 .75rem}
h1{font-size:1.9rem}h2{font-size:1.45rem;border-bottom:1px solid #8884;padding-bottom:.3rem}
h3{font-size:1.15rem}
p,li{margin:.5rem 0}
a{color:#2563eb}@media (prefers-color-scheme:dark){a{color:#7ab7ff}}
table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.92rem;display:block;overflow-x:auto}
th,td{border:1px solid #8884;padding:.45rem .6rem;text-align:left;vertical-align:top}
th{background:#8881}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;
  background:#8881;padding:.1em .35em;border-radius:3px}
pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.82rem;line-height:1.4;
  background:#8881;border:1px solid #8883;border-radius:6px;padding:1rem;overflow-x:auto;white-space:pre}
pre code{background:none;padding:0}
blockquote{margin:1rem 0;padding:.25rem 1rem;border-left:3px solid #8886;color:inherit}
`;

/** Assemble the trusted skeleton: CSP first, then a readable base, then the
 * report's own scrubbed styles, then the sanitised body markup. Exported for
 * tests — pure string work, no DOM. */
export function wrapReportDoc(styleCss: string, bodyHtml: string): string {
  const style = styleCss.trim() ? `<style>${styleCss}</style>` : "";
  return (
    "<!doctype html><html><head>" +
    `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">` +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<style>${REPORT_BASE_CSS}</style>` +
    style +
    `</head><body>${bodyHtml}</body></html>`
  );
}

/** Full pipeline. Browser-only — uses the platform HTML parser. */
export function buildSafeReportDoc(rawHtml: string): string {
  if (typeof DOMParser === "undefined") {
    // No parser available (should not happen in the app). Fail closed: an
    // empty body behind the CSP rather than raw model HTML.
    return wrapReportDoc("", "<p>Report unavailable.</p>");
  }
  const parsed = new DOMParser().parseFromString(rawHtml, "text/html");

  const css = [...parsed.querySelectorAll("style")]
    .map((s) => scrubCss(s.textContent ?? ""))
    .join("\n");

  const body = parsed.body ?? parsed.createElement("body");
  walk(body);

  return wrapReportDoc(css, body.innerHTML);
}
