import type { SettingsService } from "../settings.js";
import type { StorageConfig } from "./app-sleep.js";

/** Server settings → Storage, as AppSleep reads it (on every use, so a change needs no restart). */
export async function storageConfig(settings: SettingsService): Promise<StorageConfig> {
  const kind = await settings.value("storageKind");
  return {
    kind: kind === "s3" || kind === "folder" ? kind : "off",
    endpoint: await settings.value("storageEndpoint"),
    region: await settings.value("storageRegion"),
    bucket: await settings.value("storageBucket"),
    accessKeyId: await settings.value("storageAccessKeyId"),
    secretAccessKey: await settings.value("storageSecretAccessKey"),
    prefix: await settings.value("storagePrefix"),
    pathStyle: (await settings.value("storagePathStyle")) === "true",
    folder: await settings.value("storageFolder"),
  };
}
