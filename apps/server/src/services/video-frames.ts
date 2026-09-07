import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import {
  type FrameExportInput,
  type FrameFormat,
  frameExtensions,
  frameFileName,
  maxFrameSetBytes,
  ZelyqError,
} from "@zelyq/core";
import type { VideoMetadata } from "./video-assets.js";

/**
 * Splitting a finished clip into the numbered image sequence a scroll-scrub
 * hero needs. The output shape is the one `skills/cinematic-web` already
 * reads — `frame_%04d.<ext>`, a poster, and a manifest.
 *
 * ffmpeg is packaged, not assumed present on the host, exactly as `ffprobe` is
 * for probing. It is run with the same guards: no network protocols, a hard
 * timeout, a bounded output buffer.
 */

const ffmpegPath: string = createRequire(import.meta.url)("ffmpeg-static");
const runFile = promisify(execFile);

/** Long enough for 240 frames at 1920, short enough that a wedged process is
 *  not a permanent worker. The child is killed when it expires. */
const EXTRACT_TIMEOUT_MS = 120_000;
/** Wide enough for a retina library card, small enough to be free. */
const POSTER_WIDTH = 640;

/** Per-format encoder settings. libwebp's `-q:v` is 0-100 quality; mjpeg's is
 *  2-31 where lower is better; AVIF uses a CRF. PNG is lossless. */
function encoderArgs(format: FrameFormat): string[] {
  switch (format) {
    case "webp":
      // NOT the default encoder: left alone, ffmpeg picks `libwebp_anim` and
      // writes ONE animated WebP instead of a sequence — a silent wrong
      // answer rather than an error.
      return ["-c:v", "libwebp", "-q:v", "75"];
    case "jpeg":
      return ["-c:v", "mjpeg", "-q:v", "3"];
    case "avif":
      return ["-c:v", "libaom-av1", "-crf", "34", "-b:v", "0", "-cpu-used", "6"];
    case "png":
      return ["-c:v", "png"];
  }
}

export interface ExtractedFrames {
  format: FrameFormat;
  count: number;
  width: number;
  height: number;
  fps: number;
  sizeBytes: number;
}

export class VideoFrameStore {
  constructor(private readonly root: string) {}

  /** In-flight poster work, so two viewers of the same card do not both run
   *  ffmpeg for the same frame. */
  private readonly posters = new Map<string, Promise<string>>();

  private ownerDirectory(ownerId: string) {
    if (!/^usr_[a-f0-9]{32}$/.test(ownerId)) throw ZelyqError.badRequest("Invalid video owner.");
    return path.join(this.root, ownerId);
  }
  /** `<vid>.frames/` beside the clip it came from. */
  directory(ownerId: string, generationId: string) {
    if (!/^vid_[a-f0-9]{32}$/.test(generationId))
      throw ZelyqError.badRequest("Invalid video asset.");
    return path.join(this.ownerDirectory(ownerId), `${generationId}.frames`);
  }
  /**
   * A file inside the set. Two independent guards, because one of them being
   * loosened later should not be enough to escape the directory:
   *
   * 1. `name` must match a permitted shape — `frame_%04d.<ext>`, `poster.<ext>`
   *    or `manifest.json` — an allowlist, not a denylist of bad characters.
   * 2. The resolved path must still be inside the set's own directory. This
   *    holds whatever the first check admits, and is what actually makes the
   *    traversal impossible rather than merely unlikely.
   */
  file(ownerId: string, generationId: string, name: string, format: FrameFormat) {
    if (!frameFileName(name, format)) throw ZelyqError.notFound("Frame", name);
    const directory = path.resolve(this.directory(ownerId, generationId));
    const resolved = path.resolve(directory, name);
    if (resolved !== path.join(directory, path.basename(resolved)))
      throw ZelyqError.notFound("Frame", name);
    if (!resolved.startsWith(`${directory}${path.sep}`)) throw ZelyqError.notFound("Frame", name);
    return resolved;
  }

  async remove(ownerId: string, generationId: string) {
    await fs.rm(this.directory(ownerId, generationId), { recursive: true, force: true });
  }

  stream(ownerId: string, generationId: string, name: string, format: FrameFormat) {
    return createReadStream(this.file(ownerId, generationId, name, format));
  }

  async read(ownerId: string, generationId: string, name: string, format: FrameFormat) {
    return fs.readFile(this.file(ownerId, generationId, name, format));
  }

  /** The library thumbnail for a clip. Deliberately a mid-clip frame, not the
   *  first one: an opening frame is often a fade-in from black and makes every
   *  card look identical. (The frame *set* keeps frame_0001 as its poster,
   *  because there it must match what the scroll-scrub canvas paints first.) */
  posterFile(ownerId: string, generationId: string) {
    if (!/^vid_[a-f0-9]{32}$/.test(generationId))
      throw ZelyqError.badRequest("Invalid video asset.");
    return path.join(this.ownerDirectory(ownerId), `${generationId}.poster.webp`);
  }

  /**
   * The poster, generated on first request and kept. Doing it lazily means
   * clips that existed before posters did get one the moment they are shown,
   * with no backfill and no migration.
   */
  async ensurePoster(
    ownerId: string,
    generationId: string,
    source: string,
    metadata: VideoMetadata,
  ): Promise<string> {
    const file = this.posterFile(ownerId, generationId);
    try {
      await fs.access(file);
      return file;
    } catch {
      // Not made yet.
    }
    const pending = this.posters.get(file);
    if (pending) return pending;
    const work = (async () => {
      const temp = `${file}.${Date.now()}.tmp`;
      try {
        await fs.mkdir(this.ownerDirectory(ownerId), { recursive: true, mode: 0o700 });
        await runFile(
          ffmpegPath,
          [
            "-v",
            "error",
            "-nostdin",
            "-protocol_whitelist",
            "file",
            "-ss",
            (metadata.durationSeconds / 2).toFixed(3),
            "-i",
            source,
            "-frames:v",
            "1",
            "-vf",
            `scale=${POSTER_WIDTH}:-2:flags=lanczos`,
            "-c:v",
            "libwebp",
            "-q:v",
            "72",
            "-f",
            "image2",
            temp,
          ],
          { timeout: 20_000, maxBuffer: 64 * 1024, windowsHide: true },
        );
        await fs.rename(temp, file);
        return file;
      } catch (error) {
        await fs.rm(temp, { force: true });
        throw error instanceof ZelyqError
          ? error
          : new ZelyqError("model_error", "No poster could be read from this video.");
      } finally {
        this.posters.delete(file);
      }
    })();
    this.posters.set(file, work);
    return work;
  }

  /**
   * Extract a sequence, replacing whatever was there. Builds into a temporary
   * directory and swaps it in, so a failure or an over-budget run never leaves
   * a half-written set that looks complete.
   */
  async extract(
    ownerId: string,
    generationId: string,
    source: string,
    metadata: VideoMetadata,
    input: FrameExportInput,
  ): Promise<ExtractedFrames> {
    const target = this.directory(ownerId, generationId);
    const staging = `${target}.building`;
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    const ext = frameExtensions[input.format];

    try {
      // fps = frames / duration, the same arithmetic the asset-pipeline
      // reference prescribes. Never below a rate that yields one frame.
      const fps = Math.max(0.1, input.count / metadata.durationSeconds);
      // Do not upscale: a 320px source asked for at 1600 would be blurry bytes.
      const width = Math.min(input.width, metadata.width);
      await runFile(
        ffmpegPath,
        [
          "-v",
          "error",
          "-nostdin",
          "-protocol_whitelist",
          "file",
          "-i",
          source,
          "-vf",
          `fps=${fps.toFixed(6)},scale=${width}:-2:flags=lanczos`,
          ...encoderArgs(input.format),
          "-frames:v",
          String(input.count),
          // Forces the image-sequence muxer; the extension alone would let a
          // single-file muxer be chosen instead.
          "-f",
          "image2",
          path.join(staging, `frame_%04d.${ext}`),
        ],
        { timeout: EXTRACT_TIMEOUT_MS, maxBuffer: 256 * 1024, windowsHide: true },
      );

      const frames = (await fs.readdir(staging))
        .filter((name) => name.startsWith("frame_") && name.endsWith(`.${ext}`))
        .sort();
      const first = frames[0];
      if (!first) throw new ZelyqError("model_error", "No frames could be read from this video.");

      let sizeBytes = 0;
      for (const name of frames) sizeBytes += (await fs.stat(path.join(staging, name))).size;

      // The poster is the first frame: first paint, and the reduced-motion
      // path, both of which the recipe requires.
      await fs.copyFile(path.join(staging, first), path.join(staging, `poster.${ext}`));
      sizeBytes += (await fs.stat(path.join(staging, `poster.${ext}`))).size;

      const height = Math.round((metadata.height / metadata.width) * width);
      const manifest = {
        slug: generationId,
        count: frames.length,
        width,
        height: height % 2 === 0 ? height : height + 1,
        frames,
        poster: `poster.${ext}`,
        fps: Number(fps.toFixed(3)),
      };
      const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
      await fs.writeFile(path.join(staging, "manifest.json"), manifestJson, { mode: 0o600 });
      sizeBytes += Buffer.byteLength(manifestJson);

      if (sizeBytes > maxFrameSetBytes)
        throw new ZelyqError(
          "conflict",
          `That would produce ${Math.round(sizeBytes / 1024 / 1024)} MB of frames, over the ${Math.round(maxFrameSetBytes / 1024 / 1024)} MB limit. Use fewer frames or a smaller width.`,
        );

      // Swap in only once the whole set is known good.
      await fs.rm(target, { recursive: true, force: true });
      await fs.rename(staging, target);
      return {
        format: input.format,
        count: frames.length,
        width: manifest.width,
        height: manifest.height,
        fps: manifest.fps,
        sizeBytes,
      };
    } catch (error) {
      if (error instanceof ZelyqError) throw error;
      const reason = error as { killed?: boolean; code?: string };
      if (reason.killed || reason.code === "ETIMEDOUT")
        throw new ZelyqError(
          "conflict",
          "Extracting frames took too long and was stopped. Try fewer frames or a smaller width.",
        );
      throw new ZelyqError("model_error", "This video could not be split into frames.");
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
}
