import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { maxVideoBytes, ZelyqError } from "@zelyq/core";

const probePath: string = createRequire(import.meta.url)("ffprobe-static").path;
const runFile = promisify(execFile);
export interface VideoMetadata {
  width: number;
  height: number;
  durationSeconds: number;
  sizeBytes: number;
  hasAudio: boolean;
}

export class VideoAssetStore {
  constructor(private readonly root: string) {}
  directory(ownerId: string) {
    if (!/^usr_[a-f0-9]{32}$/.test(ownerId)) throw ZelyqError.badRequest("Invalid video owner.");
    return path.join(this.root, ownerId);
  }
  file(ownerId: string, id: string) {
    if (!/^(vid|vrf)_[a-f0-9]{32}$/.test(id)) throw ZelyqError.badRequest("Invalid video asset.");
    return path.join(this.directory(ownerId), `${id}.${id.startsWith("vrf_") ? "png" : "mp4"}`);
  }
  async saveReference(ownerId: string, id: string, bytes: Buffer) {
    await fs.mkdir(this.directory(ownerId), { recursive: true, mode: 0o700 });
    await fs.writeFile(this.file(ownerId, id), bytes, { mode: 0o600, flag: "wx" });
  }
  readReference(ownerId: string, id: string) {
    return fs.readFile(this.file(ownerId, id));
  }
  async probe(file: string): Promise<VideoMetadata> {
    const { stdout } = await runFile(
      probePath,
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        "mov",
        "-probesize",
        "10000000",
        "-analyzeduration",
        "10000000",
        "-show_entries",
        "format=duration,size,format_name:stream=codec_type,codec_name,width,height,pix_fmt",
        "-of",
        "json",
        file,
      ],
      { timeout: 15000, maxBuffer: 128 * 1024, windowsHide: true },
    );
    const data = JSON.parse(stdout);
    const streams = data.streams as Array<{
      codec_type: string;
      codec_name: string;
      width: number;
      height: number;
      pix_fmt: string;
    }>;
    const video = streams?.find((stream) => stream.codec_type === "video");
    const audio = streams?.filter((stream) => stream.codec_type === "audio") ?? [];
    const duration = Number(data.format?.duration);
    const size = Number(data.format?.size);
    if (
      video?.codec_name !== "h264" ||
      !["yuv420p", "yuvj420p"].includes(video.pix_fmt) ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 20 ||
      !Number.isFinite(size) ||
      size <= 0 ||
      size > maxVideoBytes ||
      video.width < 1 ||
      video.height < 1 ||
      video.width > 4096 ||
      video.height > 4096 ||
      audio.some((stream) => stream.codec_name !== "aac")
    )
      throw new Error("The provider returned an unsupported or invalid video.");
    return {
      width: video.width,
      height: video.height,
      durationSeconds: duration,
      sizeBytes: size,
      hasAudio: audio.length > 0,
    };
  }
  async existing(ownerId: string, id: string) {
    try {
      return await this.probe(this.file(ownerId, id));
    } catch {
      return null;
    }
  }
  async saveVideo(
    ownerId: string,
    id: string,
    token: string,
    response: Response,
    signal: AbortSignal,
    stillOwned: () => Promise<boolean>,
  ) {
    if (!response.body) throw new Error("The provider returned no video bytes.");
    const length = Number(response.headers.get("content-length"));
    if (length > maxVideoBytes) {
      await response.body.cancel();
      throw new Error("Video exceeds the storage limit.");
    }
    const target = this.file(ownerId, id);
    await fs.mkdir(this.directory(ownerId), { recursive: true, mode: 0o700 });
    const temp = `${target}.${token}.tmp`;
    let bytes = 0;
    try {
      await pipeline(
        Readable.fromWeb(response.body as never),
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.length;
            callback(
              bytes > maxVideoBytes ? new Error("Video exceeds the storage limit.") : null,
              chunk,
            );
          },
        }),
        createWriteStream(temp, { mode: 0o600, flags: "wx" }),
        { signal },
      );
      const metadata = await this.probe(temp);
      if (!(await stillOwned())) throw new Error("Video job is no longer owned by this worker.");
      await fs.rename(temp, target);
      return metadata;
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  stream(ownerId: string, id: string, range?: { start: number; end: number }) {
    return createReadStream(this.file(ownerId, id), range);
  }
  async remove(ownerId: string, id: string) {
    await fs.rm(this.file(ownerId, id), { force: true });
  }
  async removeUser(ownerId: string) {
    await fs.rm(this.directory(ownerId), { recursive: true, force: true });
  }
}
