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
