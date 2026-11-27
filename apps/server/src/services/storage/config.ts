import { ZelyqError } from "@zelyq/core";
import { z } from "zod";
import type { SettingsService } from "../settings.js";
import type { StorageConfig } from "./app-sleep.js";
import { storeFor } from "./app-sleep.js";

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

/** The storage as set, or a plain 400 saying what to fix. */
async function configured(settings: SettingsService) {
  let found: ReturnType<typeof storeFor>;
  try {
    found = storeFor(await storageConfig(settings));
  } catch (error) {
    throw ZelyqError.badRequest((error as Error).message);
  }
  if (!found) {
    throw ZelyqError.badRequest(
      "Storage is off or not filled in. Choose where, fill it in and save first.",
    );
  }
  return found;
}

/** Test storage: writes, reads and deletes a small file there (Server settings, or the admin on a managed server). */
export async function testStorage(settings: SettingsService): Promise<{ ok: true; where: string }> {
  const found = await configured(settings);
  try {
    await found.store.check();
  } catch (error) {
    throw ZelyqError.badRequest((error as Error).message);
  }
  return { ok: true, where: found.store.label };
}

/** Puts apps not used for at least `days` days to sleep now (0: every app not open, previewing or building), and moves images and videos not opened for as long. */
export async function sleepAppsNow(
  settings: SettingsService,
  usage: { sleepIdle(options: { days?: number }): Promise<number> } | undefined,
  body: unknown,
  sweepMedia?: (days: number) => Promise<number>,
): Promise<{ slept: number; media: number }> {
  const { days } = z.object({ days: z.number().int().min(0).max(3650) }).parse(body ?? {});
  await configured(settings);
  const slept = usage ? await usage.sleepIdle({ days }) : 0;
  const media = sweepMedia ? await sweepMedia(days) : 0;
  return { slept, media };
}
