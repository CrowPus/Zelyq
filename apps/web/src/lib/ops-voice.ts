import { useCallback, useEffect, useRef, useState } from "react";
import { preferredRecordingMimeType } from "./voice";

/**
 * Talking to Ops (072 §2.11): you speak, it answers in writing and aloud.
 * Listening records the microphone and turns it into text with Zelyq's own
 * voice input; speaking uses the browser's built-in voice, so nothing outside
 * is needed. In hands-free mode, recording stops by itself when you stop
 * talking, and starts again once Ops has finished speaking.
 */

const MAX_RECORDING_MS = 60_000;
/** How long a quiet stretch ends what you said, once you have said something. */
const SILENCE_MS = 1600;
/** Below this loudness (0–1) is quiet. */
const QUIET = 0.02;

export type ListenState = "idle" | "requesting" | "recording" | "transcribing";

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The microphone: press to talk, or hands-free with an end found by silence. */
export function useListening(
  transcribe: (input: { mimeType: string; data: string }) => Promise<{ text: string }>,
  onText: (text: string) => void,
) {
  const [state, setState] = useState<ListenState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timers = useRef<number[]>([]);
  const audio = useRef<AudioContext | null>(null);
  const mounted = useRef(true);

  const release = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    recorder.current = null;
    void audio.current?.close().catch(() => undefined);
    audio.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      release();
    };
  }, [release]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(
    async (handsFree = false) => {
      setError(null);
      if (!window.isSecureContext) {
        setError("Talking needs a secure connection (https). Open Zelyq over https and try again.");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setError("This browser cannot record from the microphone.");
        return;
      }
      setState("requesting");
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!mounted.current) {
          for (const track of media.getTracks()) track.stop();
          return;
        }
        stream.current = media;
        const mimeType = preferredRecordingMimeType();
        const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
        recorder.current = rec;
        const chunks: Blob[] = [];
        rec.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        rec.onstop = () => {
          const type = rec.mimeType || chunks[0]?.type || mimeType || "audio/webm";
          const recorded = new Blob(chunks, { type });
          release();
          if (!mounted.current) return;
          if (recorded.size === 0) {
            setState("idle");
            return;
          }
          setState("transcribing");
          void toBase64(recorded)
            .then((data) => transcribe({ mimeType: type, data }))
            .then(({ text }) => {
              if (!mounted.current) return;
              setState("idle");
              if (text.trim()) onText(text.trim());
            })
            .catch((caught: unknown) => {
              if (!mounted.current) return;
              setState("idle");
              setError(
                caught instanceof Error ? caught.message : "Could not understand the recording.",
              );
            });
        };
        rec.start(250);
        setState("recording");
        timers.current.push(window.setTimeout(stop, MAX_RECORDING_MS));

        if (handsFree) {
          // Ends what you said when you have spoken and then stay quiet a moment.
          const context = new AudioContext();
          audio.current = context;
          const analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          context.createMediaStreamSource(media).connect(analyser);
          const samples = new Float32Array(analyser.fftSize);
          let spoke = false;
          let quietSince = performance.now();
          const listen = () => {
            if (recorder.current !== rec || rec.state !== "recording") return;
            analyser.getFloatTimeDomainData(samples);
            let sum = 0;
            for (const value of samples) sum += value * value;
            const loudness = Math.sqrt(sum / samples.length);
            const now = performance.now();
            if (loudness > QUIET) {
              spoke = true;
              quietSince = now;
            } else if (spoke && now - quietSince > SILENCE_MS) {
              stop();
              return;
            }
            requestAnimationFrame(listen);
          };
          requestAnimationFrame(listen);
        }
      } catch (caught) {
        release();
        setState("idle");
        setError(
          caught instanceof DOMException && caught.name === "NotAllowedError"
            ? "Microphone access was refused. Allow it in the browser's site settings and try again."
            : "Could not use the microphone.",
        );
      }
    },
    [onText, release, stop, transcribe],
  );

  return { state, error, start, stop };
}

/**
 * What is read aloud from a reply: its opening sentence (Ops starts every
 * reply with one that sums it up), without the marks Markdown adds.
 */
export function spokenPart(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_#>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
  const first = plain.split(/\n\s*\n/)[0] ?? plain;
  const sentence = /^[\s\S]*?[.!?](\s|$)/.exec(first)?.[0] ?? first;
  return sentence.trim().slice(0, 400);
}

/** Says something with the browser's own voice; calls back when done (or at once when it cannot). */
export function speak(text: string, onEnd?: () => void): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
