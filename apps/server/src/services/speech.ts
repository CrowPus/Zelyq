import { ZelyqError } from "@zelyq/core";

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const TRANSCRIPTION_TIMEOUT_MS = 60_000;

export interface SpeechConfig {
  provider: string;
  model: string;
  apiKey: string;
}

export interface SpeechInput {
  audio: Buffer;
  mimeType: string;
}

type Fetch = typeof fetch;

/** Transcribes audio with the configured speech provider. */
export class SpeechService {
  constructor(private readonly fetchImpl: Fetch = fetch) {}

  async transcribe(config: SpeechConfig, input: SpeechInput): Promise<string> {
    if (!config.apiKey) {
      throw ZelyqError.badRequest(
        `Voice input needs an API key for ${config.provider}. Add it in Settings or the server environment.`,
      );
    }
    if (!config.model) {
      throw ZelyqError.badRequest("Voice input needs a transcription model in Settings.");
    }

    switch (config.provider) {
      case "openai":
        return await this.transcribeOpenAI(config, input);
      default:
        throw ZelyqError.badRequest(
          `Voice input provider "${config.provider}" is not available in this Zelyq build.`,
        );
    }
  }

  private async transcribeOpenAI(config: SpeechConfig, input: SpeechInput): Promise<string> {
    const form = new FormData();
    form.append("model", config.model);
    form.append("response_format", "json");
    form.append(
      "file",
      new Blob([Uint8Array.from(input.audio)], { type: input.mimeType }),
      `recording.${extensionFor(input.mimeType)}`,
    );

    let response: Response;
    try {
      response = await this.fetchImpl(OPENAI_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new ZelyqError("runtime_unavailable", "Voice transcription timed out. Try again.");
      }
      throw new ZelyqError(
        "runtime_unavailable",
        "Could not reach the voice transcription service.",
      );
    }

    const body = await readBoundedText(response, MAX_RESPONSE_BYTES);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw ZelyqError.badRequest(
          "OpenAI rejected the voice API key. Check the OpenAI key in Settings or OPENAI_API_KEY.",
        );
      }
      if (response.status === 429) {
        throw new ZelyqError(
          "rate_limited",
          "OpenAI is rate-limiting voice transcription. Try again shortly.",
        );
      }
      throw new ZelyqError(
        "model_error",
        `OpenAI voice transcription failed (HTTP ${response.status}). Check the voice provider and model in Settings.`,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new ZelyqError("model_error", "The voice transcription service returned invalid data.");
    }

    const text =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { text?: unknown }).text === "string"
        ? (payload as { text: string }).text.trim()
        : "";
    if (!text) throw ZelyqError.badRequest("No speech was detected in that recording.");
    return text;
  }
}

function extensionFor(mimeType: string): string {
  const normalized = mimeType.split(";", 1)[0]?.toLowerCase();
  return (
    {
      "audio/webm": "webm",
      "audio/ogg": "ogg",
      "audio/mp4": "m4a",
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
    }[normalized ?? ""] ?? "webm"
  );
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new ZelyqError("model_error", "The voice transcription response was too large.");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ZelyqError("model_error", "The voice transcription response was too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
