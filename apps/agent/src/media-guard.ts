import type { FileEntry } from "@zelyq/core";
import type { RuntimeDriver } from "@zelyq/runtime";

/**
 * The person's own media — the video they uploaded, the photo they placed from
 * Studio, the font they dropped in — is not the agent's to transform.
 *
 * Found live: asked to add social buttons to a footer, the agent noticed
 * letterboxing in the hero video, ran cropdetect over it a dozen times,
 * overwrote the poster, then re-encoded the video — cropped to 1600×900,
 * upscaled back to 1920×1080 — and moved the result over the original. The
 * prompt's <scope> forbade inventing work; it did not stop "fixing" something
 * noticed along the way, and nothing at all stopped a shell command from
 * destroying the original. A rule the model can talk itself past is not a
 * guard, so this is the guard: every media file that existed when the request
 * arrived is watched, and one that changes when the request was not about
 * media is put back from the snapshot taken before the turn — immediately,
 * and the model is told to report and ask instead.
 *
 * SVG is not watched: in practice it is code the agent writes and edits, and
 * guarding it would refuse ordinary icon work.
 */
const MEDIA_FILE =
  /\.(png|jpe?g|gif|webp|avif|bmp|ico|tiff?|heic|mp4|webm|mov|m4v|avi|mkv|ogv|mp3|wav|ogg|m4a|aac|flac|woff2?|ttf|otf|pdf)$/i;

/** Folders whose files are build output or regenerated wholesale on request
 *  (the Cinematic engineer's frame sequences), never the person's originals. */
const NOT_ORIGINALS = /^(node_modules|dist|build|\.next|\.expo|coverage)\/|^public\/cinematic\//;

/**
 * What a request has to say for a kind of file to be fair game. Per kind, not
 * "is this request about media at all": "add social media buttons" mentions
 * media and is about the footer, and "make the hero video full width" frees
 * the video without freeing every photo in the project.
 *
 * Generous on purpose — a false "yes" leaves one file unguarded for one
 * request, which is how it worked before; a false "no" undoes work the person
 * asked for.
 */
const KINDS: Array<{ files: RegExp; words: RegExp }> = [
  {
    files: /\.(mp4|webm|mov|m4v|avi|mkv|ogv)$/i,
    words: /\b(videos?|clips?|footage|movies?|films?|mp4|webm|mov|reels?)\b/i,
  },
  {
    files: /\.(png|jpe?g|gif|webp|avif|bmp|ico|tiff?|heic)$/i,
    words:
      /\b(images?|photos?|pictures?|pics?|png|jpe?g|webp|gif|avif|posters?|thumbnails?|banners?|wallpapers?|favicons?|logos?|screenshots?|illustrations?|artwork|backgrounds?)\b/i,
  },
  { files: /\.(mp3|wav|ogg|m4a|aac|flac)$/i, words: /\b(audio|sounds?|music|songs?|mp3|wav)\b/i },
  { files: /\.(woff2?|ttf|otf)$/i, words: /\b(fonts?|typefaces?|typography)\b/i },
  { files: /\.pdf$/i, words: /\b(pdfs?|documents?|brochures?)\b/i },
];

/**
 * Words that only ever mean editing media free every kind: the request is the
 * job. Broad verbs — replace, convert, optimise — are left out: "replace the
 * button text" and "optimise page speed" are not about anyone's video, and a
 * request that is ("replace the hero video") names the kind anyway.
 */
const TRANSFORM =
  /\b(crop|cropped|resize|resized|compress|re-?encode|transcode|downscale|upscale|ffmpeg|letterbox(ed|ing)?)\b/i;

/**
 * Whether this request may change this file. True when it names the file, asks
 * for a media transformation, or talks about this kind of media.
 */
export function requestCoversFile(request: string, path: string): boolean {
  // "social media" is a footer, not a file.
  const text = request.replace(/social[\s-]+media/gi, " ");
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const stem = base.replace(/\.[^.]+$/, "");
  const lower = text.toLowerCase();
  if (
    lower.includes(base) ||
    (stem.length >= 3 && new RegExp(`\\b${escapeRegExp(stem)}\\b`).test(lower))
  )
    return true;
  if (TRANSFORM.test(text)) return true;
  return KINDS.some((kind) => kind.files.test(path) && kind.words.test(text));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isWatchedMedia(path: string): boolean {
  return MEDIA_FILE.test(path) && !NOT_ORIGINALS.test(path);
}

function signature(entry: FileEntry): string {
  return `${entry.size ?? -1}:${entry.modifiedAt ?? ""}`;
}

export interface MediaGuardResult {
  /** Changed or removed, and put back from the snapshot. */
  restored: string[];
  /** Changed or removed, and could not be put back. */
  lost: string[];
}

export class MediaGuard {
  private constructor(
    private readonly runtime: Pick<RuntimeDriver, "listFiles" | "restoreSnapshotFile">,
    private readonly projectId: string,
    private readonly snapshotId: string | null,
    private readonly baseline: Map<string, string>,
  ) {}

  /**
   * Start watching for one request: every media file the request does not
   * cover. Null when there is nothing to watch.
   */
  static async start(
    runtime: Pick<RuntimeDriver, "listFiles" | "restoreSnapshotFile">,
    projectId: string,
    snapshotId: string | null,
    request: string,
  ): Promise<MediaGuard | null> {
    const entries = await runtime.listFiles(projectId, { depth: 32 }).catch(() => []);
    const baseline = new Map<string, string>();
    for (const entry of entries) {
      if (
        entry.type === "file" &&
        isWatchedMedia(entry.path) &&
        !requestCoversFile(request, entry.path)
      )
        baseline.set(entry.path, signature(entry));
    }
    return baseline.size ? new MediaGuard(runtime, projectId, snapshotId, baseline) : null;
  }

  /** Put back whatever was touched since the request began. */
  async check(): Promise<MediaGuardResult> {
    const result: MediaGuardResult = { restored: [], lost: [] };
    if (this.baseline.size === 0) return result;
    const entries = await this.runtime.listFiles(this.projectId, { depth: 32 }).catch(() => null);
    if (!entries) return result;
    const now = new Map(
      entries.filter((entry) => entry.type === "file").map((entry) => [entry.path, entry]),
    );
    for (const [path, before] of this.baseline) {
      const current = now.get(path);
      if (current && signature(current) === before) continue;
      if (!this.snapshotId) {
        result.lost.push(path);
        this.baseline.delete(path);
        continue;
      }
      try {
        await this.runtime.restoreSnapshotFile(this.projectId, this.snapshotId, path);
        result.restored.push(path);
      } catch {
        result.lost.push(path);
        this.baseline.delete(path);
      }
    }
    if (result.restored.length) {
      // A restored file has a new timestamp; watch it from here, or the next
      // check would "restore" it again.
      const after = await this.runtime.listFiles(this.projectId, { depth: 32 }).catch(() => []);
      for (const entry of after) {
        if (result.restored.includes(entry.path)) this.baseline.set(entry.path, signature(entry));
      }
    }
    return result;
  }
}

/** What the model is told, in the conversation, after a check that acted. */
export function mediaGuardMessage({ restored, lost }: MediaGuardResult): string {
  const names = (paths: string[]) =>
    paths.slice(0, 6).join(", ") + (paths.length > 6 ? ` and ${paths.length - 6} more` : "");
  const parts: string[] = [
    "STOP — you changed the user's own media, which this request did not ask for.",
  ];
  if (restored.length)
    parts.push(
      `${names(restored)} ${restored.length === 1 ? "has" : "have"} been put back exactly as it was before this turn.`,
    );
  if (lost.length)
    parts.push(
      `${names(lost)} could not be put back automatically — tell the user plainly which file you changed, so they can restore it from the snapshot before this turn.`,
    );
  parts.push(
    "Do not modify, re-encode, crop, resize, compress, convert, move over or delete existing images, " +
      "videos, audio, fonts or documents unless the user's request is about that media. If you noticed a " +
      "problem with one (black bars, wrong size, heavy file), finish what was asked and mention it in your " +
      "final message as a suggestion, and let the user decide.",
  );
  return parts.join(" ");
}
