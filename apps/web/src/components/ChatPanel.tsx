import { useMutation } from "@tanstack/react-query";
import type { Message, ToolCall } from "@zelyq/core";
import { ArrowUp, ChevronRight, CircleAlert, Square } from "lucide-react";
import { type FormEvent, lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ChatState } from "../hooks/useChatSocket";
import { api } from "../lib/api";
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
/**
 * The composer is a fixed height and scrolls. It used to grow with its content,
 * which moved the send button out from under the cursor mid-sentence — the
 * control you are reaching for should not migrate while you type.
 */
const COMPOSER_HEIGHT = 72;

interface Props {
  chat: ChatState & { send(message: string): void; abort(): void };
  model?: string;
  projectId: string;
  /** Editors and above. The server checks again on the restore call. */
  canEdit: boolean;
  /** The project on disk changed, so the file tree and preview are stale. */
  onReverted(): void;
  /**
   * Open a file showing what this turn did to it. `after` is the snapshot taken
   * before the *following* turn — the project as this turn left it. Null when
   * this is the newest turn, where "as it left it" is simply the file now.
   */
  onOpenDiff(path: string, before: string, after: string | null): void;
}

export function ChatPanel({ chat, model, projectId, canEdit, onReverted, onOpenDiff }: Props) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The deps are the trigger, not inputs: scroll when a message lands or the
  // stream grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the trigger, not inputs
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages.length, chat.streaming?.text]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || chat.busy) return;
    chat.send(message);
    setDraft("");
    textareaRef.current?.focus();
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-border-default bg-surface">
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

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain break-words">
        {chat.messages.length === 0 && !chat.streaming && (
          <div className="px-4 py-8">
            <p className="text-xs leading-relaxed text-fg-secondary">
              Describe what you want built. Be specific about the pages, the data, and how it should
              look — the agent reads the project, makes the changes, and starts the preview.
            </p>
          </div>
        )}

        <div className="flex flex-col">
          {chat.messages.map((message, index) => (
            <MessageRow
              key={message.id}
              message={message}
              nextSnapshotId={nextSnapshotAfter(chat.messages, index)}
              projectId={projectId}
              canEdit={canEdit}
              onReverted={onReverted}
              onOpenDiff={onOpenDiff}
            />
          ))}

          {chat.streaming && (
            <MessageRow
              streaming
              nextSnapshotId={null}
              projectId={projectId}
              canEdit={canEdit}
              onReverted={onReverted}
              onOpenDiff={onOpenDiff}
              message={{
                id: chat.streaming.messageId,
                sessionId: "",
                role: "assistant",
                content: chat.streaming.text,
                thinking: chat.streaming.thinking,
                toolCalls: chat.streaming.toolCalls,
                // The snapshot is attached when the turn is persisted; nothing
                // to undo while it is still running.
                snapshotId: null,
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
        <div className="rounded-md border border-border-default bg-surface transition-[border-color,box-shadow] duration-150 focus-within:border-focus focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--focus)_26%,transparent)]">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event);
            }}
            placeholder="Describe a change…"
            aria-label="Message the agent"
            style={{ height: COMPOSER_HEIGHT }}
            className="w-full resize-none overflow-y-auto bg-transparent px-2.5 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none"
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

function MessageRow({
  message,
  streaming,
  nextSnapshotId,
  projectId,
  canEdit,
  onReverted,
  onOpenDiff,
}: {
  message: Message;
  streaming?: boolean;
  nextSnapshotId: string | null;
  projectId: string;
  canEdit: boolean;
  onReverted(): void;
  onOpenDiff(path: string, before: string, after: string | null): void;
}) {
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

      {!streaming && (
        <TurnFooter
          message={message}
          nextSnapshotId={nextSnapshotId}
          projectId={projectId}
          canEdit={canEdit}
          onReverted={onReverted}
          onOpenDiff={onOpenDiff}
        />
      )}
    </div>
  );
}

/**
 * What this turn changed, and a way back.
 *
 * The file list is read off the tool calls rather than diffed: the transcript
 * already records every write and edit, so this costs nothing and is exactly as
 * accurate as what the agent actually did.
 */
/**
 * The project as a turn left it is the snapshot taken before the next one.
 * Comparing a turn against the file *now* was the original mistake: on any turn
 * but the newest it showed everything that happened since, which reads as
 * "the agent rewrote the whole file".
 */
function nextSnapshotAfter(messages: Message[], index: number): string | null {
  for (let i = index + 1; i < messages.length; i++) {
    const id = messages[i]?.snapshotId;
    if (id) return id;
  }
  return null;
}

function TurnFooter({
  message,
  nextSnapshotId,
  projectId,
  canEdit,
  onReverted,
  onOpenDiff,
}: {
  message: Message;
  nextSnapshotId: string | null;
  projectId: string;
  canEdit: boolean;
  onReverted(): void;
  onOpenDiff(path: string, before: string, after: string | null): void;
}) {
  const [confirming, setConfirming] = useState(false);

  const changed = [
    ...new Set(
      message.toolCalls
        .filter((call) => ["write_file", "edit_file", "delete_file"].includes(call.name))
        .map((call) => String(call.input.path ?? ""))
        .filter(Boolean),
    ),
  ];

  const revert = useMutation({
    mutationFn: () => api.restoreSnapshot(projectId, message.snapshotId as string),
    onSuccess: () => {
      setConfirming(false);
      onReverted();
    },
  });

  if (changed.length === 0) return null;

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border-default pt-2 text-2xs text-fg-muted">
      <span className="font-medium">
        {changed.length} file{changed.length === 1 ? "" : "s"} changed
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap gap-x-2">
        {changed.map((file) =>
          message.snapshotId ? (
            <button
              key={file}
              type="button"
              onClick={() => onOpenDiff(file, message.snapshotId as string, nextSnapshotId)}
              className="truncate font-mono text-fg-secondary underline decoration-dotted underline-offset-2 hover:text-fg"
              title={`See what changed in ${file}`}
            >
              {file}
            </button>
          ) : (
            <span key={file} className="truncate font-mono">
              {file}
            </span>
          ),
        )}
      </span>

      {/* Turns from before automatic snapshots have nothing to go back to. */}
      {canEdit && message.snapshotId && !confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="shrink-0 text-fg-secondary underline underline-offset-2 hover:text-fg"
        >
          Undo this turn
        </button>
      )}

      {confirming && (
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-warning">Put the files back as they were before this turn?</span>
          <button
            type="button"
            disabled={revert.isPending}
            onClick={() => revert.mutate()}
            className="text-danger underline underline-offset-2 disabled:opacity-50"
          >
            {revert.isPending ? "Undoing…" : "Undo"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="underline underline-offset-2"
          >
            Cancel
          </button>
        </span>
      )}

      {revert.isError && (
        <span className="shrink-0 text-danger">{(revert.error as Error).message}</span>
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
