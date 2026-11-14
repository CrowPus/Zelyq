import { useCallback, useEffect, useRef, useState } from "react";
import { LiveAudio } from "./live-audio";

/**
 * Talking to Ops live: one conversation over a WebSocket to Zelyq's server,
 * which relays it to Gemini Live. You speak naturally; Ops hears you directly,
 * answers in its own voice, and works through its tools while you talk. What
 * you both say also appears as text, and is kept in the job.
 */

export type LiveStatus = "idle" | "connecting" | "live";

export interface LiveEvent {
  type: string;
  role?: string;
  text?: string;
  message?: string;
  jobId?: string;
  tool?: string;
}

export function useLiveTalk(
  teamId: string,
  handlers: {
    /** The job the conversation works in (new or continued). */
    onJob: (jobId: string) => void;
    /** Something changed in the job: read it again. */
    onChanged: () => void;
  },
) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [caption, setCaption] = useState<{ role: string; text: string } | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const audio = useRef<LiveAudio | null>(null);
  const latest = useRef(handlers);
  latest.current = handlers;

  const stop = useCallback(() => {
    const ws = socket.current;
    socket.current = null;
    try {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "end" }));
    } catch {
      // already closed
    }
    ws?.close();
    audio.current?.close();
    audio.current = null;
    setStatus("idle");
    setSpeaking(false);
    setMuted(false);
    setCaption(null);
    setWorking(null);
    latest.current.onChanged();
  }, []);

  useEffect(
    () => () => {
      socket.current?.close();
      audio.current?.close();
    },
    [],
  );

  const start = useCallback(
    (jobId: string | null) => {
      if (socket.current) stop();
      setError(null);
      setStatus("connecting");
      const sound = new LiveAudio(setSpeaking);
      audio.current = sound;
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const query = jobId ? `?job=${encodeURIComponent(jobId)}` : "";
      const ws = new WebSocket(`${scheme}://${window.location.host}/ws/ops/${teamId}${query}`);
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      ws.onmessage = (event) => {
        if (typeof event.data !== "string") {
          sound.play(event.data as ArrayBuffer);
          return;
        }
        const data = JSON.parse(event.data) as LiveEvent;
        if (data.type === "job" && data.jobId) {
          latest.current.onJob(data.jobId);
        } else if (data.type === "ready") {
          setStatus("live");
          void sound
            .start((pcm) => {
              if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
            })
            .catch((caught: unknown) => {
              setError((caught as Error).message);
              stop();
            });
        } else if (data.type === "transcript" && data.text) {
          const role = data.role ?? "";
          setCaption((current) =>
            current && current.role === role
              ? { role, text: `${current.text}${data.text}`.slice(-280) }
              : { role, text: data.text ?? "" },
          );
        } else if (data.type === "interrupted") {
          sound.stopOutput();
        } else if (data.type === "working") {
          setWorking(data.tool ?? null);
        } else if (data.type === "turn_complete" || data.type === "changed") {
          setWorking(null);
          latest.current.onChanged();
        } else if (data.type === "error" || data.type === "ended") {
          if (data.message) setError(data.message);
          stop();
        }
      };
      ws.onclose = (event) => {
        if (socket.current !== ws) return;
        if (event.code === 4401) setError("Sign in again to talk to Ops.");
        else if (event.code === 4403) setError("Talking to Ops only works from Zelyq's own page.");
        stop();
      };
      ws.onerror = () => {
        if (socket.current === ws) setError("Could not connect to Ops. Try again.");
      };
    },
    [stop, teamId],
  );

  /** Typed words into the live conversation: Ops answers by voice. */
  const say = useCallback((text: string) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "text", text }));
    return true;
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      audio.current?.mute(!current);
      return !current;
    });
  }, []);

  return { status, speaking, muted, caption, working, error, start, stop, say, toggleMute };
}
