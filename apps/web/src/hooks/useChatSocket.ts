import type { AgentEvent, AttachmentRef, Message, ServerMessage, ToolCall } from "@zelyq/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Body,
  onRest,
  onThinking,
  onToolEnd,
  onToolStart,
  onTurnStart,
  RESTING,
} from "../lib/posture";

/** One line of a specialist child agent's live activity (the Designer, the
 * verifier). Shown as a labelled sub-thread under the streaming turn. */
export interface AgentActivity {
  agent: "designer" | "devops" | "security" | "cinematic" | "verifier" | "builder";
  phase: "start" | "step" | "end";
  title: string;
  detail?: string;
}

export interface ChatState {
  status: "connecting" | "open" | "closed";
  messages: Message[];
  /** The assistant turn currently streaming, if any. */
  streaming: {
    messageId: string;
    text: string;
    thinking: string;
    toolCalls: ToolCall[];
    activity: AgentActivity[];
  } | null;
  busy: boolean;
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  /** Prompt tokens read from the provider cache this session. */
  cacheReadTokens: number;
  /**
   * The browser a tool is driving right now, if any. Only the newest frame is
   * kept: this is a live view, so a backlog of stale frames is worse than none,
   * and holding them would grow without bound on a long clone.
   */
  browser: {
    callId: string;
    label: string;
    frame: string | null;
    width: number;
    height: number;
    /** False once the tool closed this browser, while the last frame stays up. */
    live: boolean;
  } | null;
  /**
   * What the agent is doing, as a posture rather than a log line. Derived from
   * the same tool stream the transcript is built from — it is a reading of the
   * events, never a separate signal that could disagree with them.
   */
  body: Body;
}

export const INITIAL: ChatState = {
  status: "connecting",
  messages: [],
  streaming: null,
  busy: false,
  error: null,
  tokensIn: 0,
  tokensOut: 0,
  cacheReadTokens: 0,
  browser: null,
  body: RESTING,
};

/**
 * Owns the project's WebSocket and folds the event stream into render state.
 *
 * The reducer below is the mirror image of the gateway's persistence logic:
 * both consume the same events, one into a database row and one into React
 * state. Keeping them symmetrical is why a refresh shows exactly what was on
 * screen before it.
 */
export function useChatSocket(projectId: string, onFilesChanged?: (paths: string[]) => void) {
  const [state, setState] = useState<ChatState>(INITIAL);
  const socketRef = useRef<WebSocket | null>(null);
  const filesChangedRef = useRef(onFilesChanged);
  filesChangedRef.current = onFilesChanged;

  useEffect(() => {
    // A long-lived idle dev WebSocket eventually drops — a laptop sleeps, a
    // browser tab is backgrounded and its heartbeat timer throttled, an
    // intermediary reaps the idle socket. Without this the UI stuck on "closed"
    // until a manual page refresh. Reconnect with exponential backoff; the
    // server replays history on `connected`, so state re-hydrates on its own.
    let disposed = false;
    let attempt = 0;
    let heartbeat: number | undefined;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws/projects/${projectId}`);
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        setState((previous) => ({ ...previous, status: "open", error: null }));
      };

      socket.onclose = () => {
        window.clearInterval(heartbeat);
        if (disposed) return;
        setState((previous) => ({ ...previous, status: "connecting", busy: false }));
        const delay = Math.min(1000 * 2 ** attempt, 15_000) + Math.random() * 1000;
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };

      // `onerror` is always followed by `onclose`; let that drive the retry and
      // just surface a message here.
      socket.onerror = () => {
        setState((previous) => ({ ...previous, error: "Connection lost — reconnecting…" }));
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage;
        setState((previous) => reduce(previous, message, filesChangedRef.current));
      };

      heartbeat = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, 25_000);
    };

    setState(INITIAL);
    connect();

    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(heartbeat);
      socketRef.current?.close();
    };
  }, [projectId]);

  const send = useCallback(
    (
      message: string,
      override?: {
        provider?: string;
        model?: string;
        attachments?: AttachmentRef[];
        /** Picked from the composer's `/` picker. Names only. */
        skills?: string[];
        /** Picked from the same `/` menu's Plugins section. */
        plugins?: string[];
        /** Picked from the same `/` menu's Agents section — specialist names. */
        agents?: string[];
        /** Engineer Mode toggle. */
        engineerMode?: boolean;
        /** Architect Mode toggle. */
        architectMode?: boolean;
        /** Auto Mode toggle. Only with architectMode. */
        autoMode?: boolean;
      },
    ) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          type: "prompt",
          message,
          ...(override?.provider ? { provider: override.provider } : {}),
          ...(override?.model ? { model: override.model } : {}),
          // The wire only ever carries the ids the server already has —
          // the full refs below are for the local echo's own display.
          ...(override?.attachments?.length
            ? { attachments: override.attachments.map((a) => a.id) }
            : {}),
          ...(override?.skills?.length ? { skills: override.skills } : {}),
          ...(override?.plugins?.length ? { plugins: override.plugins } : {}),
          ...(override?.agents?.length ? { agents: override.agents } : {}),
          ...(override?.engineerMode ? { engineerMode: true } : {}),
          ...(override?.architectMode ? { architectMode: true } : {}),
          ...(override?.autoMode ? { autoMode: true } : {}),
        }),
      );
      setState((previous) => ({
        ...previous,
        busy: true,
        error: null,
        messages: [
          ...previous.messages,
          {
            id: `local_${Date.now()}`,
            sessionId: "",
            role: "user",
            content: message,
            thinking: null,
            toolCalls: [],
            attachments: override?.attachments ?? [],
            // Mirror what the server will persist, so the sent bubble shows
            // its `/` mentions the moment it appears, not only after reload.
            mentions:
              override?.skills?.length || override?.agents?.length || override?.plugins?.length
                ? {
                    skills: override.skills ?? [],
                    agents: override.agents ?? [],
                    plugins: override.plugins ?? [],
                  }
                : null,
            tokensIn: 0,
            tokensOut: 0,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
    },
    [],
  );

  const abort = useCallback(() => {
    socketRef.current?.send(JSON.stringify({ type: "abort" }));
  }, []);

  return useMemo(() => ({ ...state, send, abort }), [state, send, abort]);
}

export function reduce(
  state: ChatState,
  message: ServerMessage,
  onFilesChanged?: (paths: string[]) => void,
): ChatState {
  switch (message.type) {
    case "connected":
      // Also covers a reconnect: resync to server history, drop any streaming
      // turn we lost the tail of.
      return {
        ...state,
        status: "open",
        error: null,
        busy: false,
        streaming: null,
        browser: null,
        body: RESTING,
        messages: message.history,
      };

    case "pong":
      return state;

    case "turn.start":
      return {
        ...state,
        busy: true,
        error: null,
        body: onTurnStart(),
        streaming: {
          messageId: message.messageId,
          text: "",
          thinking: "",
          toolCalls: [],
          activity: [],
        },
      };

    case "agent.activity":
      return state.streaming
        ? {
            ...state,
            streaming: {
              ...state.streaming,
              activity: [
                ...state.streaming.activity,
                {
                  agent: message.agent,
                  phase: message.phase,
                  title: message.title,
                  ...(message.detail ? { detail: message.detail } : {}),
                },
              ],
            },
          }
        : state;

    case "text.delta":
      // Prose is the model working without a tool, which is the same state as
      // the gap between two calls: thinking. This is what makes the pause after
      // the last tool legible instead of looking like the agent has stalled.
      return state.streaming
        ? {
            ...state,
            body: onThinking(state.body, Date.now()),
            streaming: { ...state.streaming, text: state.streaming.text + message.text },
          }
        : state;

    case "thinking.delta":
      return state.streaming
        ? {
            ...state,
            streaming: { ...state.streaming, thinking: state.streaming.thinking + message.text },
          }
        : state;

    case "tool.start":
    case "tool.end": {
      if (!state.streaming) return state;
      const toolCalls = [...state.streaming.toolCalls];
      const index = toolCalls.findIndex((call) => call.id === message.call.id);
      if (index === -1) toolCalls.push(message.call);
      else toolCalls[index] = message.call;
      const body =
        message.type === "tool.start"
          ? onToolStart(state.body, message.call, Date.now())
          : onToolEnd(state.body, message.call);
      return { ...state, body, streaming: { ...state.streaming, toolCalls } };
    }

    case "files.changed":
      onFilesChanged?.(message.paths);
      return state;

    case "browser.open":
      return {
        ...state,
        browser: {
          callId: message.callId,
          label: message.label,
          // One capture opens a page per viewport width, so open/close repeats
          // several times in a row. Carrying the last frame across means the
          // panel updates instead of blinking empty between them.
          frame: state.browser?.frame ?? null,
          width: state.browser?.width ?? 0,
          height: state.browser?.height ?? 0,
          live: true,
        },
      };

    case "browser.frame":
      // A frame from a call the panel is not showing is stale by definition.
      if (state.browser?.callId !== message.callId) return state;
      return {
        ...state,
        browser: {
          ...state.browser,
          frame: message.data,
          width: message.width,
          height: message.height,
        },
      };

    case "browser.close":
      // The last frame stays on screen; only the LIVE badge goes out. The panel
      // itself is cleared when the turn ends, so a finished capture leaves the
      // page it ended on visible rather than vanishing.
      if (state.browser?.callId !== message.callId) return state;
      return { ...state, browser: { ...state.browser, live: false } };

    case "usage":
      return {
        ...state,
        tokensIn: message.tokensIn,
        tokensOut: message.tokensOut,
        cacheReadTokens: message.cacheReadTokens ?? state.cacheReadTokens,
      };

    case "turn.end": {
      const finished: Message = message.message ?? {
        id: message.messageId,
        sessionId: message.sessionId,
        role: "assistant",
        content: state.streaming?.text ?? "",
        thinking: state.streaming?.thinking ?? null,
        toolCalls: state.streaming?.toolCalls ?? [],
        attachments: [],
        tokensIn: 0,
        tokensOut: 0,
        createdAt: new Date().toISOString(),
      };
      return {
        ...state,
        busy: false,
        streaming: null,
        browser: null,
        body: onRest(state.body, Date.now()),
        messages: [...state.messages, { ...finished, toolCalls: state.streaming?.toolCalls ?? [] }],
      };
    }

    case "aborted":
      return {
        ...state,
        busy: false,
        streaming: null,
        browser: null,
        body: onRest(state.body, Date.now()),
        messages: state.streaming
          ? [
              ...state.messages,
              {
                id: state.streaming.messageId,
                sessionId: "",
                role: "assistant",
                content: `${state.streaming.text}\n\n_Stopped._`,
                thinking: null,
                toolCalls: state.streaming.toolCalls,
                attachments: [],
                tokensIn: 0,
                tokensOut: 0,
                createdAt: new Date().toISOString(),
              },
            ]
          : state.messages,
      };

    case "error":
      return {
        ...state,
        busy: false,
        streaming: null,
        // Rest, but keep the strain: a turn that ended in an error should not
        // look the same as one that ended cleanly.
        body: { ...onRest(state.body, Date.now()), tension: Math.max(0.5, state.body.tension) },
        error: message.message,
      };

    default:
      return state;
  }
}

export type { AgentEvent };
