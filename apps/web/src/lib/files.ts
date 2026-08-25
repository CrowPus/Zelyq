/**
 * A `File`'s bytes as base64 — shared between the chat composer's
 * attachments (`037`) and the Settings page's skill upload (`043`), rather
 * than kept as ChatPanel's own local helper once a second real caller
 * needed it.
 *
 * Chunked rather than one `String.fromCharCode(...bytes)` call: spreading
 * every byte of a large file into that call at once blows the call stack.
 */
export async function fileToBase64(file: File): Promise<string> {
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
 * sends — see `043` in the council notes. A pure function, extracted out of
 * `SkillUploadControl` so the path-stripping logic is testable without
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
 * back empty by the time this actually runs — the real bug this shape
 * exists to make impossible, found live: every upload silently sent zero
 * files and failed schema validation with no indication why.
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
