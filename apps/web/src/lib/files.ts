/**
 * A `File`'s bytes as base64 — shared between the chat composer's
 * attachments and the Settings page's skill upload, rather than kept as
 * ChatPanel's own local helper once a second real caller needed it.
 *
 * Chunked rather than one `String.fromCharCode(...bytes)` call: spreading
 * every byte of a large file into that call at once blows the call stack.
 */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Turns a folder's picked files into the `{ path, data }[]` a skill upload
 * sends. A pure function, extracted out of `SkillUploadControl` so the
 * path-stripping logic is testable without
 * rendering a component: `webkitRelativePath` looks like
 * "my-skill/SKILL.md", and every file gets that same top-level folder name
 * stripped, so the server sees paths rooted at the skill's own content —
 * "SKILL.md", "references/detail.md" — the same shape reading one straight
 * out of `skills/` on disk would produce.
 *
 * Takes a plain `File[]`, never a live `FileList` — a `FileList` is a *live*
 * view onto an `<input>`'s current selection, and resetting that input
 * (needed so the same folder can be picked twice in a row) clears it
 * immediately. Passed across an async boundary, a `FileList` can be read
 * back empty by the time this actually runs — the bug this shape exists to
 * make impossible, where every upload silently sends zero files and fails
 * schema validation with no indication why.
 */
export async function buildSkillUploadFiles(
  files: File[],
): Promise<Array<{ path: string; data: string }>> {
  // Typed as always a string, but not every runtime actually guarantees
  // that — defensive here rather than trusting the type, the same way a
  // value crossing any other real boundary would be.
  const rootFolder = (files[0]?.webkitRelativePath || "").split("/")[0];
  return Promise.all(
    files.map(async (file) => ({
      path:
        rootFolder && file.webkitRelativePath
          ? file.webkitRelativePath.slice(rootFolder.length + 1)
          : file.name,
      data: await fileToBase64(file),
    })),
  );
}

/**
 * Largest single file an upload will attempt.
 *
 * The server's body limit is 16 MiB (`app.ts`). A file travels as base64
 * inside JSON, which costs about 4 bytes for every 3 — so the raw ceiling is
 * nearer 12 MiB, and that is before the path and the JSON wrapper. 10 MiB
 * leaves room and, more importantly, is a number that can be explained: a
 * rejection here says what the limit is, instead of the request dying at the
 * body parser with nothing useful to show the person who dragged the file in.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Where a dropped file lands: the destination folder plus the path the file
 * carried with it (a name for a loose file, `icons/logo.svg` for one dragged
 * inside a folder).
 *
 * Pure, and defensive about the parts it does not control. A dropped entry's
 * relative path comes from the browser, and a project path is used to write to
 * disk — so `..` segments are dropped rather than escaped-and-hoped-for, and
 * separators are normalised. Returns "" when nothing usable is left, which the
 * caller treats as "skip this entry".
 */
export function uploadTargetPath(destDir: string, relativePath: string): string {
  const clean = (value: string) =>
    value
      .replace(/\\/g, "/")
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment && segment !== "." && segment !== "..")
      .join("/");
  const dir = clean(destDir);
  const rel = clean(relativePath);
  if (!rel) return "";
  return dir ? `${dir}/${rel}` : rel;
}

/** One file picked up from a drop or a file picker, with where it came from. */
export interface DroppedFile {
  /** Path relative to what was dropped — "logo.png", or "icons/logo.png". */
  relativePath: string;
  file: File;
}

/**
 * Everything under a dropped `DataTransfer`, folders walked recursively.
 *
 * `dataTransfer.files` alone is not enough: dropping a FOLDER puts one entry
 * in `items` and nothing useful in `files`, so a folder drop would silently do
 * nothing. `webkitGetAsEntry()` is the only way to see inside one, and it must
 * be called synchronously while the drop event is still being handled — after
 * an await the items are detached and read back empty.
 */
export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<DroppedFile[]> {
  // Captured synchronously, before any await, for the reason above.
  const entries = Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.() ?? null);

  if (entries.every((entry) => entry === null)) {
    // A browser with no entry API still gives a flat file list for loose files.
    return Array.from(dataTransfer.files).map((file) => ({ relativePath: file.name, file }));
  }

  const out: DroppedFile[] = [];
  const walk = async (entry: FileSystemEntry | null, prefix: string): Promise<void> => {
    if (!entry) return;
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
      );
      if (file) out.push({ relativePath: prefix ? `${prefix}/${entry.name}` : entry.name, file });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // `readEntries` returns a BATCH, not the whole directory — it must be
    // called until it answers with an empty array or large folders arrive
    // silently truncated.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(resolve, () => resolve([])),
      );
      if (batch.length === 0) break;
      for (const child of batch) {
        await walk(child, prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    }
  };

  for (const entry of entries) await walk(entry, "");
  return out;
}

/**
 * The MIME type to render a file inline as, or null when it is not something
 * a browser can display.
 *
 * Extension-based on purpose: the bytes already arrived as base64 and sniffing
 * them would mean decoding a multi-megabyte string in the render path to learn
 * something the filename already says. SVG is deliberately absent — an inline
 * `data:image/svg+xml` is a script execution context, and a project's own
 * uploaded SVG is exactly the untrusted input you would not want running in
 * the editor's origin.
 */
export function inlineImageMimeType(path: string): string | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const byExt: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
  };
  return byExt[ext] ?? null;
}
