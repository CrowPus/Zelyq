import { z } from "zod";

export const videoProviderIds = ["google", "xai"] as const;
export type VideoProviderId = (typeof videoProviderIds)[number];
export const videoProviderCatalog = {
  google: { label: "Google", models: [{ value: "veo-3.1-generate-preview", label: "Veo 3.1" }] },
  xai: {
    label: "xAI",
    models: [{ value: "grok-imagine-video-1.5", label: "Grok Imagine Video 1.5" }],
  },
} as const;
export const maxVideoReferenceBytes = 8 * 1024 * 1024;
export const maxVideoBytes = 200 * 1024 * 1024;
export const videoLibraryBytes = 5 * 1024 ** 3;
export const videoLibraryLimit = 100;
export const videoIdSchema = z.string().regex(/^vid_[a-f0-9]{32}$/);
export const videoReferenceIdSchema = z.string().regex(/^vrf_[a-f0-9]{32}$/);
export const videoGenerationInputSchema = z
  .object({
    provider: z.enum(videoProviderIds),
    model: z.string().min(1).max(100),
    mode: z.enum(["text-to-video", "image-to-video"]),
    prompt: z.string().trim().min(1).max(4000),
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
    durationSeconds: z.number().int().min(1).max(15),
    resolution: z.enum(["480p", "720p", "1080p"]),
    audio: z.boolean(),
    referenceId: videoReferenceIdSchema.optional(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export type VideoGenerationInput = z.infer<typeof videoGenerationInputSchema>;
/**
 * Frame export. The shape here is dictated by what the scroll-scrub recipe
 * already reads (skills/cinematic-web/recipes/scroll-video-scrub.md) — a
 * numbered sequence, a poster, and a manifest — so the two halves fit without
 * a translation step.
 */
export const frameFormats = ["webp", "jpeg", "png", "avif"] as const;
export type FrameFormat = (typeof frameFormats)[number];
export const frameExtensions: Record<FrameFormat, string> = {
  webp: "webp",
  jpeg: "jpg",
  png: "png",
  avif: "avif",
};
/** The recipe targets 90-140; below ~90 the scrub visibly steps. */
export const defaultFrameCount = 120;
export const minFrameCount = 8;
export const maxFrameCount = 240;
/** "Size to the largest canvas box the layout renders, capped ~1600-1920." */
export const defaultFrameWidth = 1600;
export const minFrameWidth = 320;
export const maxFrameWidth = 1920;
/** A set that exceeds this is discarded rather than half-kept. */
export const maxFrameSetBytes = 250 * 1024 * 1024;

export const frameExportInputSchema = z
  .object({
    format: z.enum(frameFormats).default("webp"),
    count: z.number().int().min(minFrameCount).max(maxFrameCount).default(defaultFrameCount),
    width: z.number().int().min(minFrameWidth).max(maxFrameWidth).default(defaultFrameWidth),
  })
  .strict();
export type FrameExportInput = z.infer<typeof frameExportInputSchema>;

export interface VideoFrameSet {
  generationId: string;
  format: FrameFormat;
  count: number;
  width: number;
  height: number;
  fps: number;
  sizeBytes: number;
  createdAt: string;
  /** Application URLs, all owner-authenticated. */
  manifestUrl: string;
  posterUrl: string;
  zipUrl: string;
  /** Every frame's URL, in order. */
  frameUrls: string[];
}

/** The file a `:name` route segment may address. Never build a path from raw
 *  user input — match it against this first. */
export function frameFileName(name: string, format: FrameFormat): boolean {
  const ext = frameExtensions[format];
  return (
    name === "manifest.json" ||
    name === `poster.${ext}` ||
    new RegExp(`^frame_\\d{4}\\.${ext}$`).test(name)
  );
}

export type VideoStatus =
  | "queued"
  | "submitting"
  | "generating"
  | "saving"
  | "succeeded"
  | "failed"
  | "unknown"
  | "cancelled";
export const isVideoActive = (status: VideoStatus) =>
  ["queued", "submitting", "generating", "saving"].includes(status);
export interface VideoModelCapability {
  id: VideoProviderId;
  label: string;
  model: string;
  modelLabel: string;
  configured: boolean;
  ratios: VideoGenerationInput["aspectRatio"][];
  durations: number[];
  resolutions: VideoGenerationInput["resolution"][];
  audio: "always" | "optional";
}
export function videoModelCapability(
  id: VideoProviderId,
): Omit<VideoModelCapability, "configured"> {
  const provider = videoProviderCatalog[id];
  return {
    id,
    label: provider.label,
    model: provider.models[0].value,
    modelLabel: provider.models[0].label,
    ratios: id === "google" ? ["16:9", "9:16"] : ["16:9", "9:16", "1:1"],
    durations: id === "google" ? [4, 6, 8] : Array.from({ length: 15 }, (_, i) => i + 1),
    resolutions: id === "google" ? ["720p", "1080p"] : ["480p", "720p", "1080p"],
    audio: id === "google" ? "always" : "optional",
  };
}
/** Shared validation keeps visible controls and billable request validation aligned. */
export function videoInputError(input: VideoGenerationInput): string | null {
  const cap = videoModelCapability(input.provider);
  if (input.model !== cap.model) return "Choose a supported video model.";
  if (!cap.ratios.includes(input.aspectRatio))
    return "This model does not support that aspect ratio.";
  if (!cap.durations.includes(input.durationSeconds))
    return "This model does not support that duration.";
  if (!cap.resolutions.includes(input.resolution))
    return "This model does not support that resolution.";
  if (input.provider === "google" && input.resolution === "1080p" && input.durationSeconds !== 8)
    return "Veo 1080p requires an 8-second clip.";
  if (cap.audio === "always" && !input.audio) return "This model always generates audio.";
  if (input.mode === "image-to-video" && !input.referenceId)
    return "Add a starting image to animate.";
  if (input.mode === "text-to-video" && input.referenceId)
    return "Switch to Animate image to use a starting image.";
  return null;
}
export interface VideoReference {
  id: string;
  url: string;
  width: number;
  height: number;
  sizeBytes: number;
}
export interface VideoGeneration {
  id: string;
  input: VideoGenerationInput;
  status: VideoStatus;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  canReconcile: boolean;
  reference: VideoReference | null;
  asset: {
    url: string;
    /** A still from the middle of the clip, generated on first request. Every
     *  finished video has one, including text-to-video with no starting image. */
    posterUrl: string;
    width: number;
    height: number;
    durationSeconds: number;
    sizeBytes: number;
    hasAudio: boolean;
    mimeType: "video/mp4";
  } | null;
}
export interface VideoCapabilities {
  provider: VideoProviderId;
  providers: VideoModelCapability[];
  hourlyLimit: number;
  libraryLimit: number;
  maxReferenceBytes: number;
}
export interface VideoHistory {
  generations: VideoGeneration[];
  nextCursor: string | null;
}
