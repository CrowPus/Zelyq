import { createHash, randomUUID } from "node:crypto";
import {
  type FrameExportInput,
  type FrameFormat,
  frameExtensions,
  maxVideoBytes,
  maxVideoReferenceBytes,
  newId,
  type VideoCapabilities,
  type VideoFrameSet,
  type VideoGeneration,
  type VideoGenerationInput,
  type VideoProviderId,
  type VideoReference,
  type VideoStatus,
  videoGenerationInputSchema,
  videoInputError,
  videoLibraryLimit,
  videoModelCapability,
  videoProviderIds,
  ZelyqError,
} from "@zelyq/core";
import type { Store, VideoJobRow, VideoReferenceRow } from "@zelyq/db";
import sharp from "sharp";
import type { SettingsService } from "./settings.js";
import type { VideoAssetStore, VideoMetadata } from "./video-assets.js";
import { VideoFrameStore } from "./video-frames.js";
import { type VideoProvider, VideoProviderError, videoProviders } from "./video-providers/index.js";

const digest = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const iso = (offset = 0) => new Date(Date.now() + offset).toISOString();
const keySetting = (id: VideoProviderId) =>
  id === "google" ? "videoGoogleApiKey" : "videoXaiApiKey";
const LEASE_MS = 120000;

function referenceView(ref: VideoReferenceRow): VideoReference {
  return {
    id: ref.id,
    url: `/api/videos/references/${ref.id}`,
    width: ref.width,
    height: ref.height,
    sizeBytes: ref.sizeBytes,
  };
}
export class VideoGenerationService {
  private timer?: ReturnType<typeof setInterval>;
  private ticking: Promise<void> | null = null;
  private running = new Map<string, { controller: AbortController; work: Promise<void> }>();
  private stopped = false;
  constructor(
    private readonly store: Store,
    private readonly settings: Pick<SettingsService, "value" | "numberValue">,
    readonly assets: VideoAssetStore,
    private readonly providers: Record<VideoProviderId, VideoProvider> = videoProviders,
    private readonly pollMs = 10000,
    private readonly reportError: () => void = () => undefined,
    readonly frames: VideoFrameStore = new VideoFrameStore(assets.root),
  ) {}

  /** One extraction at a time per user: ffmpeg is CPU-bound, and a second
   *  concurrent run buys nothing but contention. */
  private readonly extracting = new Set<string>();

  /**
   * Split a finished clip into a numbered image sequence, replacing any
   * previous set. No provider and nothing billed — the limits here are disk
   * and CPU, not money.
   */
  async extractFrames(ownerId: string, id: string, input: FrameExportInput) {
    const row = await this.owned(ownerId, id);
    if (row.status !== "succeeded")
      throw new ZelyqError("conflict", "Only a finished video can be split into frames.");
    if (this.extracting.has(ownerId))
      throw new ZelyqError(
        "conflict",
        "Another frame export is already running. Wait for it to finish.",
      );
    this.extracting.add(ownerId);
    try {
      const metadata = await this.assets.existing(ownerId, id);
      if (!metadata) throw ZelyqError.notFound("Video", id);
      const extracted = await this.frames.extract(
        ownerId,
        id,
        this.assets.file(ownerId, id),
        metadata,
        input,
      );
      await this.store.videos.saveFrameSet(id, ownerId, extracted);
      return (await this.frameSet(ownerId, id))!;
    } finally {
      this.extracting.delete(ownerId);
    }
  }

  async frameSet(ownerId: string, id: string): Promise<VideoFrameSet | null> {
    await this.owned(ownerId, id);
    const row = await this.store.videos.frameSet(id, ownerId);
    if (!row) return null;
    const format = row.format as FrameFormat;
    const ext = frameExtensions[format];
    const base = `/api/videos/generations/${id}/frames`;
    return {
      generationId: id,
      format,
      count: row.count,
      width: row.width,
      height: row.height,
      fps: Number(row.fps),
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt,
      manifestUrl: `${base}/manifest.json`,
      posterUrl: `${base}/poster.${ext}`,
      zipUrl: `${base}.zip`,
      frameUrls: Array.from(
        { length: row.count },
        (_, i) => `${base}/frame_${String(i + 1).padStart(4, "0")}.${ext}`,
      ),
    };
  }

  /** The library thumbnail, made on demand and then kept. */
  async poster(ownerId: string, id: string) {
    await this.owned(ownerId, id);
    const metadata = await this.assets.existing(ownerId, id);
    if (!metadata) throw ZelyqError.notFound("Video", id);
    return this.frames.ensurePoster(ownerId, id, this.assets.file(ownerId, id), metadata);
  }

  async removeFrames(ownerId: string, id: string) {
    await this.owned(ownerId, id);
    if (!(await this.store.videos.removeFrameSet(id, ownerId)))
      throw ZelyqError.notFound("Frames", id);
    await this.frames.remove(ownerId, id);
  }
  private async hourlyLimit() {
    const n = await this.settings.numberValue("videoHourlyLimit");
    return Number.isInteger(n) && n > 0 ? Math.min(n, 1000) : 5;
  }
  async capabilities(): Promise<VideoCapabilities> {
    const chosen = await this.settings.value("videoProvider");
    const providers = await Promise.all(
      videoProviderIds.map(async (id) => {
        const cap = videoModelCapability(id);
        const model = await this.settings.value(
          id === "google" ? "videoGoogleModel" : "videoXaiModel",
        );
        return {
          ...cap,
          configured:
            Boolean((await this.settings.value(keySetting(id))).trim()) && model === cap.model,
        };
      }),
    );
    return {
      provider: chosen === "xai" ? "xai" : "google",
      providers,
      hourlyLimit: await this.hourlyLimit(),
      libraryLimit: videoLibraryLimit,
      maxReferenceBytes: maxVideoReferenceBytes,
    };
  }
  private async owned(ownerId: string, id: string) {
    const row = await this.store.videos.find(id);
    if (!row || row.ownerId !== ownerId || row.deletedAt) throw ZelyqError.notFound("Video", id);
    return row;
  }
  private async present(row: VideoJobRow): Promise<VideoGeneration> {
    const input = JSON.parse(row.input) as VideoGenerationInput;
    const meta: VideoMetadata | null = row.metadata ? JSON.parse(row.metadata) : null;
    const ref = row.referenceId ? await this.store.videos.reference(row.referenceId) : null;
    return {
      id: row.id,
      input,
      status: row.status as VideoStatus,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      error: row.error,
      canReconcile: row.status === "unknown" && Boolean(row.operation),
      reference: ref ? referenceView(ref) : null,
      asset:
        row.status === "succeeded" && meta
          ? {
              ...meta,
              url: `/api/videos/assets/${row.id}`,
              // Generated on first request, so a text-to-video clip has a real
              // thumbnail instead of a grey film icon.
              posterUrl: `/api/videos/assets/${row.id}/poster`,
              mimeType: "video/mp4",
            }
          : null,
    };
  }
  async get(ownerId: string, id: string) {
    return this.present(await this.owned(ownerId, id));
  }
  async history(ownerId: string, cursor?: string) {
    const before = cursor ? await this.owned(ownerId, cursor) : undefined;
    const rows = await this.store.videos.history(ownerId, before);
    return {
      generations: await Promise.all(rows.map((row) => this.present(row))),
      nextCursor: rows.length === 25 ? rows.at(-1)!.id : null,
    };
  }
  async reference(ownerId: string, id: string) {
    const ref = await this.store.videos.reference(id);
    if (!ref || ref.ownerId !== ownerId || (ref.expiresAt && ref.expiresAt <= iso()))
      throw ZelyqError.notFound("Starting image", id);
    return referenceView(ref);
  }
  async addReference(ownerId: string, bytes: Buffer) {
    if (!bytes.length || bytes.length > maxVideoReferenceBytes)
      throw ZelyqError.badRequest("Starting images must be 8 MiB or smaller.");
    let normalized: { data: Buffer; info: { width: number; height: number } };
    try {
      const decoder = sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: "warning" });
      const meta = await decoder.metadata();
      if (
        !["png", "jpeg", "webp"].includes(meta.format ?? "") ||
        (meta.pages ?? 1) !== 1 ||
        (meta.width ?? 0) > 4096 ||
        (meta.height ?? 0) > 4096
      )
        throw new Error();
      normalized = await decoder
        .rotate()
        .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer({ resolveWithObject: true });
      if (normalized.data.length > maxVideoReferenceBytes) throw new Error();
    } catch {
      throw ZelyqError.badRequest(
        "Use a valid, single-frame PNG, JPEG, or WebP image up to 4096 × 4096 pixels.",
      );
    }
    const id = newId("videoReference");
    await this.assets.saveReference(ownerId, id, normalized.data);
    try {
      const ref = await this.store.videos.addReference({
        id,
        ownerId,
        width: normalized.info.width,
        height: normalized.info.height,
        sizeBytes: normalized.data.length,
        digest: digest(normalized.data),
        createdAt: iso(),
        expiresAt: iso(86400000),
      });
      return referenceView(ref);
    } catch (error) {
      await this.assets.remove(ownerId, id);
      throw error;
    }
  }
  async removeReference(ownerId: string, id: string) {
    const ref = await this.store.videos.removeReference(id, ownerId);
    if (!ref) throw ZelyqError.notFound("Starting image", id);
    await this.assets.remove(ownerId, id);
  }
  async submit(ownerId: string, input: VideoGenerationInput) {
    input = videoGenerationInputSchema.parse(input);
    // The request schema supplies a stable key order; include every accepted
    // field in the digest, independent of current provider defaults.
    const requestDigest = digest(JSON.stringify(input));
    const replay = (row: VideoJobRow) => {
      if (row.deletedAt || row.requestDigest !== requestDigest)
        throw new ZelyqError(
          "conflict",
          "This request key already belongs to a different or deleted video.",
        );
      return this.present(row);
    };
    const existing = await this.store.videos.findRequest(ownerId, input.idempotencyKey);
    if (existing) return replay(existing);
    const error = videoInputError(input);
    if (error) throw ZelyqError.badRequest(error);
    const cap = (await this.capabilities()).providers.find((p) => p.id === input.provider)!;
    if (!cap.configured)
      throw ZelyqError.badRequest(
        "Configure this video provider's key and model in Settings first.",
      );
    if (input.referenceId) await this.reference(ownerId, input.referenceId);
    const key = await this.settings.value(keySetting(input.provider));
    const row = await this.store.videos.create(
      {
        id: newId("videoGeneration"),
        ownerId,
        input: JSON.stringify(input),
        requestDigest,
        idempotencyKey: input.idempotencyKey,
        provider: input.provider,
        model: input.model,
        credentialDigest: digest(key),
        referenceId: input.referenceId ?? null,
        activeOwner: ownerId,
        storageBytes: maxVideoBytes,
        createdAt: iso(),
        nextPollAt: iso(),
      },
      await this.hourlyLimit(),
    );
    void this.tick();
    return replay(row);
  }
  async cancel(ownerId: string, id: string) {
    await this.owned(ownerId, id);
    if (!(await this.store.videos.cancel(id, ownerId)))
      throw new ZelyqError(
        "conflict",
        "This video has already been submitted. It cannot be cancelled locally.",
      );
    return this.get(ownerId, id);
  }
  async reconcile(ownerId: string, id: string) {
    const row = await this.owned(ownerId, id);
    if (!row.operation || row.status !== "unknown")
      throw new ZelyqError(
        "conflict",
        "This video has no unconfirmed provider operation to check.",
      );
    await this.store.videos.reconcile(id, ownerId);
    void this.tick();
    return this.get(ownerId, id);
  }
  async remove(ownerId: string, id: string, acknowledge: boolean) {
    const row = await this.owned(ownerId, id);
    if (!(await this.store.videos.remove(id, ownerId, acknowledge)))
      throw new ZelyqError(
        "conflict",
        "Wait for the video to finish, or acknowledge the unconfirmed outcome before dismissing it.",
      );
    await this.assets.remove(ownerId, id);
    // The frame set belongs to the clip; the row cascades, the files do not.
    await this.frames.remove(ownerId, id);
    if (row.referenceId) {
      try {
        await this.removeReference(ownerId, row.referenceId);
      } catch (error) {
        if (!(error instanceof ZelyqError && error.code === "conflict")) throw error;
      }
    }
  }
  start() {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), Math.min(this.pollMs, 2000));
    this.timer.unref();
    void this.tick();
  }
  async close() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const work of this.running.values()) work.controller.abort();
    await this.ticking;
    await Promise.allSettled([...this.running.values()].map((entry) => entry.work));
  }
  async tick() {
    if (this.stopped || this.ticking) return;
    this.ticking = this.scan()
      .catch(() => this.reportError())
      .finally(() => {
        this.ticking = null;
      });
    return this.ticking;
  }
  private async scan() {
    for (const ref of await this.store.videos.expiredReferences()) {
      try {
        await this.removeReference(ref.ownerId, ref.id);
      } catch {
        /* A submission may have retained it. */
      }
    }
    const requested = await this.settings.numberValue("videoConcurrency");
    const concurrency = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 10) : 2;
    for (const candidate of await this.store.videos.due(iso())) {
      if (this.stopped || this.running.size >= concurrency) break;
      if (this.running.has(candidate.id)) continue;
      const token = randomUUID();
      for (let slot = 0; slot < concurrency; slot++) {
        const row = await this.store.videos.claim(candidate, token, iso(LEASE_MS), slot);
        if (!row) continue;
        const controller = new AbortController();
        const work = this.execute(row, candidate.status === "queued", token, controller)
          .catch(() => this.reportError())
          .finally(() => this.running.delete(row.id));
        this.running.set(row.id, { controller, work });
        break;
      }
    }
  }
  private async execute(
    row: VideoJobRow,
    newlyClaimed: boolean,
    token: string,
    controller: AbortController,
  ) {
    const patch = (values: Parameters<Store["videos"]["patch"]>[2]) =>
      this.store.videos.patch(row.id, token, values);
    const finish = (
      status: "failed" | "unknown" | "succeeded",
      error: string | null,
      metadata?: VideoMetadata,
    ) =>
      patch({
        status,
        error,
        completedAt: status === "unknown" ? null : iso(),
        leaseToken: null,
        leaseUntil: null,
        ...(status === "unknown"
          ? {}
          : { activeOwner: null, workerSlot: null, storageBytes: metadata?.sizeBytes ?? 0 }),
        ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
      });
    const heartbeat = setInterval(() => {
      void patch({ leaseUntil: iso(LEASE_MS) })
        .then((owned) => {
          if (!owned) controller.abort();
        })
        .catch(() => controller.abort());
    }, 30000);
    heartbeat.unref();
    let submissionStarted = false;
    try {
      const input = JSON.parse(row.input) as VideoGenerationInput;
      const provider = this.providers[input.provider];
      const key = await this.settings.value(keySetting(input.provider));
      if (!key || digest(key) !== row.credentialDigest) {
        await finish(
          newlyClaimed ? "failed" : "unknown",
          "The video credential changed. Restore the original account credential to check an accepted job.",
        );
        return;
      }
      if (row.status === "submitting") {
        if (!newlyClaimed) {
          await finish(
            "unknown",
            "Submission was interrupted before its result could be confirmed. No replacement was generated.",
          );
          return;
        }
        let reference: Buffer | undefined;
        if (input.referenceId) {
          const bytes = await this.assets.readReference(row.ownerId, input.referenceId);
          const [w = 16, h = 9] = input.aspectRatio.split(":").map(Number);
          const height =
            input.resolution === "1080p" ? 1080 : input.resolution === "480p" ? 480 : 720;
          const width = Math.round((height * w) / h / 2) * 2;
          reference = await sharp(bytes)
            .resize(width, height, { fit: "contain", background: "#000000" })
            .png()
            .toBuffer();
        }
        // Check after potentially slow reference preparation, immediately before spending.
        if (!(await patch({ leaseUntil: iso(LEASE_MS) }))) return;
        submissionStarted = true;
        const operation = await provider.submit(
          input,
          reference,
          key,
          AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
        );
        await patch({
          operation,
          status: "generating",
          leaseToken: null,
          leaseUntil: null,
          nextPollAt: iso(this.pollMs),
          attempts: 0,
        });
        return;
      }
      if (!row.operation) {
        await finish(
          "unknown",
          "No provider operation is available to check. No replacement was generated.",
        );
        return;
      }
      if (row.status === "saving") {
        const saved = await this.assets.existing(row.ownerId, row.id);
        if (saved) {
          await finish("succeeded", null, saved);
          return;
        }
      }
      const result = await provider.lookup(
        row.operation,
        key,
        AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
      );
      if (result.status === "failed") {
        await finish("failed", result.error);
        return;
      }
      if (result.status === "pending") {
        if (Date.now() - Date.parse(row.createdAt) > 24 * 3600000) {
          await finish(
            "unknown",
            "The provider has not confirmed this video after 24 hours. Check its status before generating again.",
          );
          return;
        }
        const delay =
          Date.now() - Date.parse(row.createdAt) > 1800000
            ? Math.max(60000, this.pollMs)
            : this.pollMs;
        await patch({
          status: "generating",
          nextPollAt: iso(delay),
          leaseToken: null,
          leaseUntil: null,
          attempts: 0,
          error: null,
        });
        return;
      }
      if (!(await patch({ status: "saving" }))) return;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
      const response = await provider.download(result.url, key, signal);
      const metadata = await this.assets.saveVideo(
        row.ownerId,
        row.id,
        token,
        response,
        signal,
        async () => Boolean(await patch({ leaseUntil: iso(LEASE_MS) })),
      );
      const completed = await finish("succeeded", null, metadata);
      if (!completed) await this.assets.remove(row.ownerId, row.id);
      // Account deletion may race the final filesystem rename.
      if (!(await this.store.users.findById(row.ownerId)))
        await this.assets.removeUser(row.ownerId);
    } catch (error) {
      if (newlyClaimed) {
        const uncertain =
          submissionStarted && (!(error instanceof VideoProviderError) || error.uncertain);
        await finish(
          uncertain ? "unknown" : "failed",
          error instanceof VideoProviderError
            ? error.message
            : uncertain
              ? "The provider submission was interrupted. Its result is unconfirmed; no replacement was generated."
              : "The starting image could not be prepared. Upload it again.",
        );
      } else if (row.attempts >= 5) {
        await finish(
          "unknown",
          "Zelyq could not retrieve this result. Check the existing job again; this does not generate another video.",
        );
      } else {
        await patch({
          attempts: row.attempts + 1,
          nextPollAt: iso(Math.min(60000, this.pollMs * 2 ** row.attempts)),
          leaseToken: null,
          leaseUntil: null,
          error: "The result is temporarily unavailable. Retrying this existing job.",
        });
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
}
