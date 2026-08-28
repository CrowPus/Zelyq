import { voiceTranscriptionSchema, ZelyqError } from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { SettingsService } from "../services/settings.js";
import type { SpeechService } from "../services/speech.js";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const SUPPORTED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);

export function registerVoiceRoutes(
  app: FastifyInstance,
  deps: { access: AccessControl; settings: SettingsService; speech: SpeechService },
): void {
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/voice/transcriptions",
    async (request) => {
      const user = deps.access.requireUser(request);
      await deps.access.requireProject(user, request.params.id, "editor");
      const input = voiceTranscriptionSchema.parse(request.body);
      const mimeType = input.mimeType.split(";", 1)[0]?.toLowerCase() ?? "";
      if (!SUPPORTED_AUDIO_TYPES.has(mimeType)) {
        throw ZelyqError.badRequest(`Unsupported voice recording type: ${mimeType || "unknown"}.`);
      }

      const audio = decodeBase64(input.data);
      if (audio.length === 0) throw ZelyqError.badRequest("That voice recording is empty.");
      if (audio.length > MAX_AUDIO_BYTES) {
        throw ZelyqError.badRequest("That voice recording is larger than the 10MB limit.");
      }

      const provider = await deps.settings.value("speechProvider");
      const model = await deps.settings.value("speechModel");
      const apiKey = await deps.settings.speechApiKeyFor(provider);
      const text = await deps.speech.transcribe({ provider, model, apiKey }, { audio, mimeType });
      return { text };
    },
  );
}

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw ZelyqError.badRequest("That voice recording was not valid base64.");
  }
  return Buffer.from(normalized, "base64");
}
