import type { Message, ToolCall } from "@zelyq/core";
import { ArrowUp, ChevronRight, CircleAlert, Square } from "lucide-react";
import { type FormEvent, lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ChatState } from "../hooks/useChatSocket";
import { IconButton, Kbd, StatusDot } from "./ui";

/**
 * The markdown parser is ~170 KB — larger than the rest of the application put
 * together, and only ever needed once a conversation exists. Loading it as a
 * separate chunk keeps the project list's first paint light. Until it arrives,
 * the raw text renders, so nothing flashes empty.
 */
const Markdown = lazy(() => import("./Markdown").then((module) => ({ default: module.Markdown })));

/** Two lines of room before it starts growing, and a ceiling before it takes
 * over the panel. */
const COMPOSER_MIN_HEIGHT = 52;
const COMPOSER_MAX_HEIGHT = 180;

interface Props {
  chat: ChatState & { send(message: string): void; abort(): void };
  model?: string;
}

export function ChatPanel({ chat, model }: Props) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The deps are the trigger, not inputs: scroll when a message lands or the
  // stream grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the trigger, not inputs
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages.length, chat.streaming?.text]);

  // Grow the composer with its content, between a floor and a ceiling. The
  // floor matters: measuring an empty textarea yields a single line, which
  // clipped the placeholder wherever it wrapped — a narrow screen, most often.
  // `draft` is the trigger rather than an input; the height comes from the DOM.
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft is the trigger
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(Math.max(node.scrollHeight, COMPOSER_MIN_HEIGHT), COMPOSER_MAX_HEIGHT)}px`;
  }, [draft]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || chat.busy) return;
    chat.send(message);
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = `${COMPOSER_MIN_HEIGHT}px`;
  }

  return (
    <section className="flex h-full min-h-0 flex-col border-r border-border-default bg-surface">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border-default px-3">
        <StatusDot
          tone={chat.busy ? "warning" : chat.status === "open" ? "success" : "danger"}
          pulse={chat.busy}
        />
        <h2 className="text-xs font-medium text-fg">Agent</h2>
        {model && <span className="truncate font-mono text-2xs text-fg-muted">{model}</span>}
        {chat.tokensIn + chat.tokensOut > 0 && (
          <span className="ml-auto shrink-0 font-mono text-2xs text-fg-muted tabular-nums">
            {formatTokens(chat.tokensIn)} / {formatTokens(chat.tokensOut)}
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {chat.messages.length === 0 && !chat.streaming && (
          <div className="px-4 py-8">
            <p className="text-xs leading-relaxed text-fg-secondary">
              Describe what you want built. Be specific about the pages, the data, and how it should
              look — the agent reads the project, makes the changes, and starts the preview.
            </p>
          </div>
        )}

        <div className="flex flex-col">
          {chat.messages.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}

          {chat.streaming && (
            <MessageRow
              streaming
              message={{
                id: chat.streaming.messageId,
                sessionId: "",
                role: "assistant",
                content: chat.streaming.text,
                thinking: chat.streaming.thinking,
                toolCalls: chat.streaming.toolCalls,
                tokensIn: 0,
                tokensOut: 0,
                createdAt: new Date().toISOString(),
              }}
            />
          )}
        </div>

        {chat.error && (
          <p className="mx-3 my-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs break-words text-danger">
            <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
            {chat.error}
          </p>
        )}

        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-border-default p-2.5">
        <div className="rounded-md border border-border-default bg-surface transition-colors focus-within:border-border-strong">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event);
            }}
            rows={2}
            placeholder="Describe a change…"
            aria-label="Message the agent"
            className="w-full resize-none bg-transparent px-2.5 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <span className="flex items-center gap-1 text-2xs text-fg-muted">
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
              to send
            </span>
            {chat.busy ? (
              <IconButton
                size="sm"
                variant="secondary"
                label="Stop the current turn"
                onClick={chat.abort}
              >
                <Square size={11} strokeWidth={2.5} className="fill-current" />
              </IconButton>
            ) : (
              <IconButton
                size="sm"
                variant="primary"
                label="Send message"
                type="submit"
                disabled={!draft.trim()}
              >
                <ArrowUp size={13} strokeWidth={2.5} />
              </IconButton>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}

function MessageRow({ message, streaming }: { message: Message; streaming?: boolean }) {
  if (message.role === "user") {
    return (
      <div className="border-b border-border-default bg-surface-subtle px-4 py-3">
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-fg">
          {message.content}
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-border-default px-4 py-3 last:border-b-0">
      {message.toolCalls.length > 0 && (
        <div className="mb-2.5 flex flex-col gap-px">
          {message.toolCalls.map((call) => (
            <ToolRow key={call.id} call={call} />
          ))}
        </div>
      )}
      {message.content && (
        <div className="relative">
          <Suspense
            fallback={
              <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-fg-secondary">
                {message.content}
              </p>
            }
          >
            <Markdown>{message.content}</Markdown>
          </Suspense>
          {streaming && (
            <span className="ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] animate-pulse bg-fg" />
          )}
        </div>
      )}
    </div>
  );
}

function ToolRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const done = call.result !== undefined;

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="group flex w-full items-center gap-1.5 rounded-sm py-1 pr-1 text-left transition-colors hover:bg-surface-hover"
      >
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={`shrink-0 text-fg-muted transition-transform ${open ? "rotate-90" : ""}`}
        />
        <StatusDot tone={!done ? "warning" : call.isError ? "danger" : "success"} pulse={!done} />
        <span className="shrink-0 font-mono text-fg-secondary">{call.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-fg-muted">{describe(call)}</span>
        {call.durationMs !== undefined && (
          <span className="shrink-0 font-mono text-2xs text-fg-muted tabular-nums">
            {formatDuration(call.durationMs)}
          </span>
        )}
      </button>
      {open && call.result && (
        <pre className="mt-1 mb-1 max-h-56 overflow-auto rounded-md border border-border-default bg-surface-subtle px-2.5 py-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-fg-secondary">
          {call.result}
        </pre>
      )}
    </div>
  );
}

/** Show the argument that identifies the call — usually a path. */
function describe(call: ToolCall): string {
  const input = call.input as Record<string, unknown>;
  for (const key of ["path", "command", "pattern"]) {
    if (typeof input[key] === "string") return input[key] as string;
  }
  return "";
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}
