import { z } from "zod";

export const imageProviderIds = ["openai", "google", "xai"] as const;
export type ImageProviderId = (typeof imageProviderIds)[number];
export const imageProviderCatalog = {
  openai: { label: "OpenAI", models: [{ value: "gpt-image-2", label: "GPT Image 2" }] },
  google: {
    label: "Google",
    models: [
      { value: "gemini-3.1-flash-image", label: "Nano Banana 2 · Gemini 3.1 Flash Image" },
      { value: "gemini-3-pro-image", label: "Nano Banana Pro · Gemini 3 Pro Image" },
      { value: "gemini-3.1-flash-lite-image", label: "Nano Banana 2 Lite" },
    ],
  },
  xai: {
    label: "xAI",
    models: [{ value: "grok-imagine-image-2.0", label: "Grok Imagine Image 2.0" }],
  },
} as const;

export const imageSizes = ["1024x1024", "1536x1024", "1024x1536"] as const;
export const imageQualities = ["low", "medium", "high"] as const;
export const imageReferenceMimeTypes = ["image/png", "image/jpeg", "image/webp"] as const;
export const maxImageReferences = 3;
export const maxImageReferenceBytes = 8 * 1024 * 1024;
export type ImageSize = (typeof imageSizes)[number];
export type ImageQuality = (typeof imageQualities)[number];
export type ImageReferenceInput = {
  mimeType: (typeof imageReferenceMimeTypes)[number];
  data: string;
};
const imageReferenceSchema = z.object({
  mimeType: z.enum(imageReferenceMimeTypes),
  data: z
    .string()
    .min(1)
    .max(Math.ceil((maxImageReferenceBytes * 4) / 3) + 8)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
export const imageGenerationInputSchema = z
  .object({
    provider: z.enum(imageProviderIds).optional(),
    prompt: z.string().trim().min(1).max(8000),
    size: z.enum(imageSizes).default("1024x1024"),
    quality: z.enum(imageQualities).default("medium"),
    references: z.array(imageReferenceSchema).max(maxImageReferences).default([]),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export type ImageGenerationInput = {
  provider?: ImageProviderId;
  prompt: string;
  size: ImageSize;
  quality: ImageQuality;
  references?: ImageReferenceInput[];
  idempotencyKey: string;
};
export type ImageJobStatus =
  | "queued"
  | "generating"
  | "saving"
  | "succeeded"
  | "failed"
  | "unknown";
export const isImageJobActive = (status: ImageJobStatus): boolean =>
  status === "queued" || status === "generating" || status === "saving";

export const imageSources = ["studio", "agent"] as const;
export type ImageSource = (typeof imageSources)[number];

export interface ImageGeneration {
  id: string;
  provider: ImageProviderId;
  prompt: string;
  model: string;
  size: ImageGenerationInput["size"];
  quality: ImageGenerationInput["quality"];
  status: ImageJobStatus;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  referenceCount: number;
  /** Who asked: a person in Studio, or the build agent in a project. */
  source: ImageSource;
  /** Set for agent work. `projectName` is a snapshot, so history stays
   *  readable after the project is deleted. */
  projectId: string;
  projectName: string;
  sessionId: string;
  asset: {
    url: string;
    width: number;
    height: number;
    sizeBytes: number;
    mimeType: "image/png";
  } | null;
}

export interface ImageProviderCapability {
  id: ImageProviderId;
  label: string;
  configured: boolean;
  model: string;
  modelLabel: string;
  qualities: readonly ImageGenerationInput["quality"][];
  referenceImages: boolean;
  maxReferences: number;
}

export interface ImageCapabilities {
  configured: boolean;
  model: string;
  provider: ImageProviderId;
  providers: ImageProviderCapability[];
  sizes: typeof imageSizes;
  qualities: readonly ImageGenerationInput["quality"][];
  maxPromptLength: number;
  hourlyLimit: number;
  libraryLimit: number;
}

export interface ImageHistory {
  generations: ImageGeneration[];
  nextCursor: string | null;
}
