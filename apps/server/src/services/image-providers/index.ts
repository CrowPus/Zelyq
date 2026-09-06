import { type ImageGenerationInput, type ImageProviderId, imageProviderCatalog } from "@zelyq/core";
import { GoogleImageProvider } from "./google.js";
import { OpenAIImageProvider } from "./openai.js";
import { XaiImageProvider } from "./xai.js";

export const imageProviders = {
  openai: {
    ...imageProviderCatalog.openai,
    apiKeySetting: "imageApiKey",
    modelSetting: "imageModel",
    qualities: ["low", "medium", "high"],
    referenceImages: true,
    adapter: new OpenAIImageProvider(),
  },
  google: {
    ...imageProviderCatalog.google,
    apiKeySetting: "imageGoogleApiKey",
    modelSetting: "imageGoogleModel",
    qualities: ["medium"],
    referenceImages: true,
    adapter: new GoogleImageProvider(),
  },
  xai: {
    ...imageProviderCatalog.xai,
    apiKeySetting: "imageXaiApiKey",
    modelSetting: "imageXaiModel",
    qualities: ["low", "medium"],
    referenceImages: false,
    adapter: new XaiImageProvider(),
  },
} satisfies Record<
  ImageProviderId,
  {
    label: string;
    models: readonly { value: string; label: string }[];
    apiKeySetting: string;
    modelSetting: string;
    qualities: ImageGenerationInput["quality"][];
    referenceImages: boolean;
    adapter: import("./shared.js").ImageProvider;
  }
>;

export function imageProvider(id: string) {
  return imageProviders[id as ImageProviderId];
}
