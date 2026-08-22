import type { Message, ToolCall } from "@zelyq/core";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ChatState } from "../hooks/useChatSocket";
import { Button, StatusDot } from "./ui";

interface Props {
  chat: ChatState & { send(message: string): void; abort(): void };
  /** Model answering in this project, shown so the user knows who is replying. */
  model?: string;
}

export function ChatPanel({ chat, model }: Props) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // The effect body reads nothing from these values — they are the trigger:
  // scroll to the bottom whenever a message arrives or the stream grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are the trigger, not inputs
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages.length, chat.streaming?.text]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || chat.busy) return;
    chat.send(message);
    setDraft("");
  }

  return (
    // min-h-0 is what makes the scroll region below actually scroll. Without it
    // the flex item keeps its content's min-content height, overflow-y-auto
    // never engages, and the whole page grows instead.
    <section className="flex h-full min-h-0 flex-col border-r border-slate-800 bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={chat.busy ? "busy" : chat.status === "open" ? "ok" : "error"} />
          <h2 className="text-sm font-medium text-slate-300">Agent</h2>
          {model && (
            <span className="truncate rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
              {model}
            </span>
          )}
        </div>
        {chat.tokensIn + chat.tokensOut > 0 && (
          <span className="font-mono text-xs text-slate-600">
            {chat.tokensIn.toLocaleString()} in · {chat.tokensOut.toLocaleString()} out
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
        {chat.messages.length === 0 && !chat.streaming && (
          <p className="px-2 py-8 text-sm leading-relaxed text-slate-500">
            Describe what you want built. Be specific about the pages, the data, and how it should
            look — the agent will read the project, make the changes, and start the preview.
          </p>
        )}

        {chat.messages.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}

        {chat.streaming && (
          <MessageRow
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
            streaming
          />
        )}

        {chat.error && (
          <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {chat.error}
          </p>
        )}

        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="border-t border-slate-800 p-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event);
          }}
          rows={3}
          placeholder="Add a pricing page with three tiers…"
          aria-label="Message the agent"
          className="w-full resize-none rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-slate-600">⌘↵ to send</span>
          {chat.busy ? (
            <Button type="button" variant="danger" onClick={chat.abort}>
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="primary" disabled={!draft.trim()}>
              Send
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

function MessageRow({ message, streaming }: { message: Message; streaming?: boolean }) {
  if (message.role === "user") {
    return (
      <div className="ml-8 overflow-hidden rounded-lg bg-sky-500/10 px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-sky-100">
        {message.content}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {message.toolCalls.map((call) => (
        <ToolRow key={call.id} call={call} />
      ))}
      {message.content && (
        <div className="overflow-hidden text-sm leading-relaxed break-words whitespace-pre-wrap text-slate-300">
          {message.content}
          {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-sky-400" />}
        </div>
      )}
    </div>
  );
}

function ToolRow({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const done = call.result !== undefined;

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <StatusDot status={!done ? "busy" : call.isError ? "error" : "ok"} />
        <span className="shrink-0 font-mono text-slate-300">{call.name}</span>
        <span className="min-w-0 truncate text-slate-600">{describe(call)}</span>
        {call.durationMs !== undefined && (
          <span className="ml-auto shrink-0 text-slate-700">{formatDuration(call.durationMs)}</span>
        )}
      </button>
      {open && call.result && (
        <pre className="max-h-64 overflow-auto border-t border-slate-800 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-slate-500">
          {call.result}
        </pre>
      )}
    </div>
  );
}

/** Show the argument that actually identifies the call — usually a path. */
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
