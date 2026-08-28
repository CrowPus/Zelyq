import type { AgentEvent, AttachmentRef, Message, ServerMessage, ToolCall } from "@zelyq/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** One line of a specialist child agent's live activity (the Designer, the
 * verifier). Shown as a labelled sub-thread under the streaming turn. */
export interface AgentActivity {
  agent: "designer" | "devops" | "security" | "verifier" | "builder";
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
}

const INITIAL: ChatState = {
  status: "connecting",
  messages: [],
  streaming: null,
  busy: false,
  error: null,
  tokensIn: 0,
  tokensOut: 0,
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
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/projects/${projectId}`);
    socketRef.current = socket;
    setState(INITIAL);

    socket.onopen = () => setState((previous) => ({ ...previous, status: "open" }));
    socket.onclose = () => setState((previous) => ({ ...previous, status: "closed", busy: false }));
    socket.onerror = () =>
      setState((previous) => ({ ...previous, error: "Lost connection to the server." }));

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      setState((previous) => reduce(previous, message, filesChangedRef.current));
    };

    const heartbeat = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
    }, 25_000);

    return () => {
      window.clearInterval(heartbeat);
      socket.close();
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

function reduce(
  state: ChatState,
  message: ServerMessage,
  onFilesChanged?: (paths: string[]) => void,
): ChatState {
  switch (message.type) {
    case "connected":
      return { ...state, status: "open", messages: message.history };

    case "pong":
      return state;

    case "turn.start":
      return {
        ...state,
        busy: true,
        error: null,
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
      return state.streaming
        ? { ...state, streaming: { ...state.streaming, text: state.streaming.text + message.text } }
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
      return { ...state, streaming: { ...state.streaming, toolCalls } };
    }

    case "files.changed":
      onFilesChanged?.(message.paths);
      return state;

    case "usage":
      return { ...state, tokensIn: message.tokensIn, tokensOut: message.tokensOut };

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
        messages: [...state.messages, { ...finished, toolCalls: state.streaming?.toolCalls ?? [] }],
      };
    }

    case "aborted":
      return {
        ...state,
        busy: false,
        streaming: null,
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
      return { ...state, busy: false, streaming: null, error: message.message };

    default:
      return state;
  }
}

export type { AgentEvent };
