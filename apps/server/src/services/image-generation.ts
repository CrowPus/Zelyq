import { createHash } from "node:crypto";
import {
  type ImageCapabilities,
  type ImageGeneration,
  type ImageGenerationInput,
  type ImageHistory,
  type ImageJobStatus,
  type ImageProviderId,
  imageProviderIds,
  imageSizes,
  isImageJobActive,
  maxImageReferenceBytes,
  maxImageReferences,
  newId,
  ZelyqError,
} from "@zelyq/core";
import type { ImageJobRow, Store } from "@zelyq/db";
import type { ImageAssetStore } from "./image-assets.js";
import { imageProvider, imageProviders } from "./image-providers/index.js";
import { normalizeImage } from "./image-providers/normalize.js";
import { type ImageProvider, ImageProviderError, inspectPng } from "./image-providers/shared.js";
import type { SettingsService } from "./settings.js";

/** Defaults an operator can change. Ten per hour was sized for one person
 *  clicking Generate; once the build agent shares the same budget it is too
 *  low, and the right number depends on a provider's prices and an operator's
 *  wallet — neither of which this repository can know. */
const DEFAULT_HOURLY_LIMIT = 30;
const DEFAULT_SESSION_LIMIT = 6;
const LIBRARY_LIMIT = 200;
const LEASE_MS = 10 * 60_000;

function referenceDigest(references: NonNullable<ImageGenerationInput["references"]>) {
  if (!references.length) return "";
  const hash = createHash("sha256");
  for (const reference of references) {
    hash.update(reference.mimeType);
    hash.update("\0");
    hash.update(reference.data);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function present(row: ImageJobRow): ImageGeneration {
  return {
    id: row.id,
    prompt: row.prompt,
    provider: row.provider as ImageProviderId,
    model: row.model,
    size: row.size as ImageGeneration["size"],
    quality: row.quality as ImageGeneration["quality"],
    status: row.status as ImageJobStatus,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    error: row.error,
    referenceCount: row.referenceCount ?? 0,
    source: (row.source ?? "studio") as ImageGeneration["source"],
    projectId: row.projectId ?? "",
    projectName: row.projectName ?? "",
    sessionId: row.sessionId ?? "",
    asset:
      row.status === "succeeded" && row.width && row.height && row.sizeBytes
        ? {
            url: `/api/images/assets/${row.id}`,
            width: row.width,
            height: row.height,
            sizeBytes: row.sizeBytes,
            mimeType: "image/png",
          }
        : null,
  };
}

export class ImageGenerationService {
  private timer?: ReturnType<typeof setInterval>;
  private ticking: Promise<void> | null = null;
  private running = new Map<string, { controller: AbortController; work: Promise<void> }>();
  private stopped = false;

  constructor(
    private readonly store: Store,
    private readonly settings: Pick<SettingsService, "value" | "numberValue">,
    readonly assets: ImageAssetStore,
    private readonly providerOverride?: ImageProvider,
    private readonly reportError: () => void = () => undefined,
  ) {}

  async capabilities(): Promise<ImageCapabilities> {
    const configuredDefault = await this.settings.value("imageProvider");
    const defaultProvider = imageProviderIds.includes(configuredDefault as ImageProviderId)
      ? (configuredDefault as ImageProviderId)
      : "openai";
    const providers = await Promise.all(
      imageProviderIds.map(async (id) => {
        const provider = imageProviders[id];
        const [key, model] = await Promise.all([
          this.settings.value(provider.apiKeySetting),
          this.settings.value(provider.modelSetting),
        ]);
        const selectedModel = provider.models.find((entry) => entry.value === model);
        return {
          id,
          label: provider.label,
          configured: Boolean(key.trim()) && Boolean(selectedModel),
          model,
          modelLabel: selectedModel?.label ?? model,
          qualities: provider.qualities,
          referenceImages: provider.referenceImages,
          maxReferences: provider.referenceImages ? maxImageReferences : 0,
        };
      }),
    );
    const selected = providers.find((provider) => provider.id === defaultProvider)!;
    return {
      configured: selected.configured,
      model: selected.model,
      provider: defaultProvider,
      providers,
      sizes: imageSizes,
      qualities: selected.qualities,
      maxPromptLength: 8000,
      hourlyLimit: await this.hourlyLimit(),
      libraryLimit: LIBRARY_LIMIT,
    };
  }

  /**
   * A small copy of a finished image, for showing the model what it made.
   * Capped on the long edge rather than resized to a fixed shape, so an agent
   * looking at a landscape hero is not handed a squashed square.
   */
  async preview(bytes: Buffer, maxEdge = 512): Promise<Buffer> {
    const sharp = (await import("sharp")).default;
    return sharp(bytes)
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  }

  private async hourlyLimit(): Promise<number> {
    const value = await this.settings.numberValue("imageHourlyLimit");
    return value > 0 ? value : DEFAULT_HOURLY_LIMIT;
  }

  private async sessionLimit(): Promise<number> {
    const value = await this.settings.numberValue("imageSessionLimit");
    return value > 0 ? value : DEFAULT_SESSION_LIMIT;
  }

  /**
   * The agent's way in. Same service, same limits, same library as Studio — the
   * only differences are the provenance recorded on the row and that a busy
   * slot makes the caller wait rather than fail: the agent and its user share
   * one per-user slot, and "your other image is still generating" is not
   * something the person who asked for a landing page can act on.
   */
  async submitForAgent(
    ownerId: string,
    input: ImageGenerationInput,
    origin: { projectId: string; projectName: string; sessionId: string },
    options: { waitForSlotMs?: number } = {},
  ): Promise<ImageGeneration> {
    const sessionLimit = await this.sessionLimit();
    if ((await this.store.images.countSession(origin.sessionId)) >= sessionLimit)
      throw new ZelyqError(
        "rate_limited",
        `This conversation has already generated ${sessionLimit} images, its limit. Reuse one of them, or start a new conversation.`,
      );
    const deadline = Date.now() + (options.waitForSlotMs ?? 120_000);
    for (;;) {
      try {
        return await this.submit(ownerId, input, { ...origin, source: "agent" });
      } catch (error) {
        const busy =
          error instanceof ZelyqError &&
          error.code === "conflict" &&
          /still generating/.test(error.message);
        if (!busy || Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  async submit(
    ownerId: string,
    input: ImageGenerationInput,
    origin: {
      source?: "studio" | "agent";
      projectId?: string;
      projectName?: string;
      sessionId?: string;
    } = {},
  ): Promise<ImageGeneration> {
    const existing = await this.store.images.findRequest(ownerId, input.idempotencyKey);
    if (existing) return this.replay(existing, input);
    const capabilities = await this.capabilities();
    const selected = capabilities.providers.find(
      (provider) => provider.id === (input.provider ?? capabilities.provider),
    )!;
    if (!selected.configured)
      throw new ZelyqError(
        "model_error",
        "This image provider needs an API key and a supported model. Ask an administrator to configure Image Studio in Settings.",
      );
    if (!selected.qualities.includes(input.quality))
      throw ZelyqError.badRequest(
        "This quality setting is not supported by the selected image provider.",
      );
    const requestedReferences = input.references ?? [];
    if (requestedReferences.length && !selected.referenceImages)
      throw ZelyqError.badRequest("This provider does not support reference images yet.");
    if (await this.store.images.active(ownerId))
      throw new ZelyqError(
        "conflict",
        "Your current image is still generating. Wait for it to finish before starting another.",
      );
    if (
      (await this.store.images.countRecent(
        ownerId,
        new Date(Date.now() - 3_600_000).toISOString(),
      )) >= (await this.hourlyLimit())
    )
      throw new ZelyqError(
        "rate_limited",
        `You have reached the limit of ${await this.hourlyLimit()} image requests per hour. Try again later.`,
      );
    if ((await this.store.images.countLibrary(ownerId)) >= LIBRARY_LIMIT)
      throw new ZelyqError(
        "conflict",
        "Your image library is full. Delete an older generation before creating another.",
      );
    const id = newId("imageGeneration");
    const references = await this.prepareReferences(requestedReferences);
    try {
      await Promise.all(
        references.images.map((reference, index) =>
          this.assets.saveReference(ownerId, id, index, reference.bytes),
        ),
      );
      await this.store.images.create(
        id,
        ownerId,
        input,
        selected.model,
        selected.id,
        { count: references.images.length, digest: references.digest },
        origin,
      );
    } catch (error) {
      await this.assets.remove(ownerId, id);
      const duplicate = await this.store.images.findRequest(ownerId, input.idempotencyKey);
      if (duplicate) return this.replay(duplicate, input);
      if (await this.store.images.active(ownerId))
        throw new ZelyqError(
          "conflict",
          "Your current image is still generating. Wait for it to finish before starting another.",
        );
      throw error;
    }
    const result = await this.get(ownerId, id);
    void this.tick();
    return result;
  }

  private async prepareReferences(references: NonNullable<ImageGenerationInput["references"]>) {
    if (references.length > maxImageReferences)
      throw ZelyqError.badRequest(`Use up to ${maxImageReferences} reference images.`);
    const images = await Promise.all(
      references.map(async (reference) => {
        const source = Buffer.from(reference.data, "base64");
        if (source.length > maxImageReferenceBytes)
          throw ZelyqError.badRequest("Reference images must be 8 MB or smaller.");
        return normalizeImage(reference.data);
      }),
    );
    return { images, digest: referenceDigest(references) };
  }

  private replay(row: ImageJobRow, input: ImageGenerationInput) {
    if (row.deletedAt)
      throw new ZelyqError(
        "conflict",
        "This generation was deleted. Start a new generation to create another image.",
      );
    if (
      row.prompt !== input.prompt ||
      row.size !== input.size ||
      row.quality !== input.quality ||
      row.referenceDigest !== referenceDigest(input.references ?? []) ||
      (input.provider !== undefined && row.provider !== input.provider)
    )
      throw new ZelyqError(
        "conflict",
        "This request ID already belongs to a different prompt. Start a new generation.",
      );
    return present(row);
  }

  private async owned(ownerId: string, id: string) {
    const row = await this.store.images.find(id);
    if (!row || row.ownerId !== ownerId || row.deletedAt)
      throw ZelyqError.notFound("Image generation");
    return row;
  }
  async get(ownerId: string, id: string) {
    return present(await this.owned(ownerId, id));
  }

  async history(ownerId: string, cursor?: string): Promise<ImageHistory> {
    const before = cursor ? await this.owned(ownerId, cursor) : undefined;
    const rows = await this.store.images.list(ownerId, before, 25);
    const page = rows.slice(0, 24);
    return {
      generations: page.map(present),
      nextCursor: rows.length > 24 ? page.at(-1)!.id : null,
    };
  }

  async read(ownerId: string, id: string) {
    const row = await this.owned(ownerId, id);
    if (row.status !== "succeeded") throw ZelyqError.notFound("Image");
    try {
      return await this.assets.read(ownerId, id);
    } catch {
      throw ZelyqError.notFound("Saved image");
    }
  }

  async remove(ownerId: string, id: string) {
    const row = await this.owned(ownerId, id);
    if (isImageJobActive(row.status as ImageJobStatus))
      throw new ZelyqError("conflict", "Wait for generation to finish before deleting it.");
    await this.assets.remove(ownerId, id);
    await this.store.images.remove(id);
  }

  start() {
    this.timer = setInterval(() => {
      void this.tick();
    }, 2000);
    this.timer.unref();
    void this.tick();
  }

  /** A fixed lease exceeds the bounded provider timeout and saving budget.
   * Expired submissions never return to the queue: the provider may have billed them. */
  private async recover() {
    for (const row of await this.store.images.expired(new Date().toISOString())) {
      if (this.running.has(row.id)) continue;
      if (row.status === "saving") {
        try {
          const bytes = await this.assets.read(row.ownerId, row.id);
          const size = inspectPng(bytes);
          if (
            size.width === row.width &&
            size.height === row.height &&
            bytes.length === row.sizeBytes
          ) {
            await this.store.images.finish(row.id, "succeeded");
            continue;
          }
        } catch {
          /* No complete saved output to recover. */
        }
      }
      await this.store.images.finish(
        row.id,
        "unknown",
        "Generation was interrupted before its result could be confirmed. Check provider usage before generating again.",
      );
    }
  }

  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.ticking) return this.ticking;
    this.ticking = this.pump()
      .catch(() => this.reportError())
      .finally(() => {
        this.ticking = null;
      });
    return this.ticking;
  }

  private async pump() {
    await this.recover();
    for (let slot = 0; slot < 2 && !this.stopped; slot++) {
      const next = await this.store.images.queued();
      if (!next) break;
      const row = await this.store.images.claim(
        next.id,
        slot,
        new Date(Date.now() + LEASE_MS).toISOString(),
      );
      if (!row) continue;
      const controller = new AbortController();
      const work = this.execute(row, controller.signal)
        .catch(() => this.reportError())
        .finally(() => {
          this.running.delete(row.id);
        });
      this.running.set(row.id, { controller, work });
    }
  }

  private async execute(row: ImageJobRow, signal: AbortSignal) {
    try {
      const provider = imageProvider(row.provider);
      if (!provider) throw new ImageProviderError("This image provider is no longer supported.");
      const key = await this.settings.value(provider.apiKeySetting);
      if (!key.trim())
        throw new ImageProviderError(
          "The Image Studio API key was removed. Ask an administrator to configure it in Settings.",
        );
      const references = row.referenceCount
        ? (await this.assets.readReferences(row.ownerId, row.id, row.referenceCount)).map(
            (bytes) => ({ bytes, mimeType: "image/png" as const }),
          )
        : [];
      const result = await (this.providerOverride ?? provider.adapter).generate(
        {
          prompt: row.prompt,
          size: row.size as ImageGenerationInput["size"],
          quality: row.quality as ImageGenerationInput["quality"],
          references,
        },
        row.model,
        key,
        AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)]),
      );
      const saved = await this.store.images.saving(row.id, {
        width: result.width,
        height: result.height,
        sizeBytes: result.bytes.length,
        providerRequestId: result.requestId,
        usage: result.usage,
      });
      if (!saved) return; // Account may have been removed during the provider call.
      let stored = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this.assets.save(row.ownerId, row.id, result.bytes);
          stored = true;
          break;
        } catch {
          /* Retry persistence only, never generation. */
        }
      }
      if (!stored)
        throw new ImageProviderError(
          "The image was generated but could not be saved. The provider may have charged for it. Ask an administrator to check storage.",
        );
      if (!(await this.store.images.find(row.id))) {
        await this.assets.removeUser(row.ownerId);
        return;
      }
      await this.store.images.finish(row.id, "succeeded");
    } catch (error) {
      const known = error instanceof ImageProviderError;
      await this.store.images.finish(
        row.id,
        !known || error.uncertain ? "unknown" : "failed",
        known
          ? error.message
          : "Generation could not be confirmed. Check provider usage before generating again.",
      );
    }
  }

  async close() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.ticking;
    for (const run of this.running.values()) run.controller.abort();
    await Promise.allSettled([...this.running.values()].map((run) => run.work));
  }
}
