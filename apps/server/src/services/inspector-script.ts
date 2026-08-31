import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeDriver } from "@zelyq/runtime";

const START = "<!-- zelyq:inspector:start -->";
const END = "<!-- zelyq:inspector:end -->";
/** What marks a project as already having the script, in any form. */
const MARKER = "zelyq:inspector:activate";
/** The Expo web template references the bridge as a static asset instead. */
const EXPO_ASSET = "zelyq-inspector.js";
const EXPO_TAG = `<script src="/${EXPO_ASSET}" defer></script>`;

/**
 * The element-inspector bridge, in the two shapes a project can carry it:
 *
 * - `extractInspectorScript` — the full `<!-- start -->…<!-- end -->` block,
 *   for injecting before `</body>` of a plain `index.html` (the Vite path).
 * - `extractInspectorJs` — the raw IIFE, for a project that serves it as a
 *   static file and references it with a `<script src>` (the Expo web path).
 *
 * Both read from `templates/_shared/` — one source of truth. The Vite
 * template keeps an inline copy for standalone use; a test asserts it is
 * byte-identical to `_shared/inspector.html`, and that `_shared/inspector.html`
 * embeds `_shared/inspector.js` verbatim.
 *
 * Re-read each call rather than cached — this runs once per preview start,
 * not a hot path, and a process-lifetime cache would only add test-isolation
 * cost for a file read this cheap.
 */
export async function extractInspectorScript(templatesDir: string): Promise<string | null> {
  try {
    const html = await fs.readFile(path.join(templatesDir, "_shared", "inspector.html"), "utf8");
    const start = html.indexOf(START);
    const end = html.indexOf(END);
    if (start === -1 || end === -1 || end < start) return null;
    return html.slice(start, end + END.length);
  } catch {
    return null;
  }
}

export async function extractInspectorJs(templatesDir: string): Promise<string | null> {
  try {
    const js = await fs.readFile(path.join(templatesDir, "_shared", "inspector.js"), "utf8");
    return js.trim() ? js : null;
  } catch {
    return null;
  }
}

/**
 * Patches a project so the element inspector works in its preview, if it
 * doesn't already. Covers every project regardless of how it came to exist:
 * an older template, `git clone`d in, or hand-edited since.
 *
 * Two shapes:
 * - a plain `index.html` (Vite, CRA, static) — inject the full block before
 *   `</body>`;
 * - an Expo Router web project (`app/+html.tsx`, no `index.html`) — write
 *   `public/zelyq-inspector.js` and add a `<script src>` to `+html.tsx`.
 *
 * Best-effort by design: any failure here — no target file, no `</body>` to
 * inject before, a read/write error — is swallowed, never a reason a preview
 * fails to start. An inspector button that quietly does nothing on an unusual
 * project is an acceptable gap; a preview that refuses to start over it is not.
 */
export async function ensureInspectorScript(
  runtime: RuntimeDriver,
  templatesDir: string,
  projectId: string,
): Promise<void> {
  const patchedIndexHtml = await tryPatchIndexHtml(runtime, templatesDir, projectId);
  if (patchedIndexHtml) return;
  await tryPatchExpoHtml(runtime, templatesDir, projectId);
}

async function tryPatchIndexHtml(
  runtime: RuntimeDriver,
  templatesDir: string,
  projectId: string,
): Promise<boolean> {
  try {
    const script = await extractInspectorScript(templatesDir);
    if (!script) return false;

    const file = await runtime.readFile(projectId, "index.html");
    if (file.truncated || file.encoding !== "utf8") return false;
    if (file.content.includes(MARKER)) return true; // already has it
    if (!file.content.includes("</body>")) return false;

    const patched = file.content.replace("</body>", `${script}\n  </body>`);
    await runtime.writeFile(projectId, "index.html", patched, "utf8");
    return true;
  } catch {
    // No index.html, or a runtime error — fall through to the Expo shape.
    return false;
  }
}

async function tryPatchExpoHtml(
  runtime: RuntimeDriver,
  templatesDir: string,
  projectId: string,
): Promise<void> {
  try {
    const shell = await runtime.readFile(projectId, "app/+html.tsx");
    if (shell.truncated || shell.encoding !== "utf8") return;
    if (shell.content.includes(EXPO_ASSET)) return; // already references it
    if (!shell.content.includes("</body>")) return;

    const js = await extractInspectorJs(templatesDir);
    if (!js) return;

    // The static asset first, so the reference it adds below resolves.
    await runtime.writeFile(projectId, `public/${EXPO_ASSET}`, js, "utf8");

    const patched = shell.content.replace("</body>", `  ${EXPO_TAG}\n      </body>`);
    await runtime.writeFile(projectId, "app/+html.tsx", patched, "utf8");
  } catch {
    // No +html.tsx, a read-only runtime, whatever — see the doc comment above.
  }
}
