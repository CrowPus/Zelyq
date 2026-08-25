import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeDriver } from "@zelyq/runtime";

const START = "<!-- zelyq:inspector:start -->";
const END = "<!-- zelyq:inspector:end -->";
/** What marks a project as already having the script — see `038`/`039`. */
const MARKER = "zelyq:inspector:activate";

/**
 * The element-inspector bridge script, read out of the template file
 * itself rather than duplicated as a second, hand-maintained copy here —
 * see `039` in the council notes. One source of truth: the block in
 * `templates/vite-react/index.html`, between its own sentinel comments.
 * Re-read each call rather than cached — this only runs once per preview
 * start, not a hot path, and not worth the test-isolation cost a
 * process-lifetime cache would add for a file read this cheap.
 */
export async function extractInspectorScript(templatesDir: string): Promise<string | null> {
  try {
    const html = await fs.readFile(path.join(templatesDir, "vite-react", "index.html"), "utf8");
    const start = html.indexOf(START);
    const end = html.indexOf(END);
    if (start === -1 || end === -1 || end < start) return null;
    return html.slice(start, end + END.length);
  } catch {
    return null;
  }
}

/**
 * Patches a project's `index.html` with the inspector bridge script if it
 * doesn't already have one — see `039`. Covers every project regardless of
 * how it came to exist: made from an older template, `git clone`d in, or
 * hand-edited since. Best-effort by design: any failure here — no
 * `index.html`, no `</body>` to inject before, a read/write error — is
 * swallowed, never a reason a preview fails to start. An inspector button
 * that quietly does nothing on an unusual project is an acceptable gap;
 * a preview that refuses to start over it would not be.
 */
export async function ensureInspectorScript(
  runtime: RuntimeDriver,
  templatesDir: string,
  projectId: string,
): Promise<void> {
  try {
    const script = await extractInspectorScript(templatesDir);
    if (!script) return;

    const file = await runtime.readFile(projectId, "index.html");
    if (file.truncated || file.encoding !== "utf8") return;
    if (file.content.includes(MARKER)) return; // already has it — new project, or patched before
    if (!file.content.includes("</body>")) return; // nothing sane to inject before

    const patched = file.content.replace("</body>", `${script}\n  </body>`);
    await runtime.writeFile(projectId, "index.html", patched, "utf8");
  } catch {
    // No index.html, a runtime error, whatever — see the doc comment above.
  }
}
