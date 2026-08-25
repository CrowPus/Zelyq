import { useMutation } from "@tanstack/react-query";
import type { AttachmentRef, Message, ToolCall } from "@zelyq/core";
import { ArrowUp, ChevronRight, CircleAlert, Paperclip, Square, X } from "lucide-react";
import { type FormEvent, lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ChatState } from "../hooks/useChatSocket";
import { api } from "../lib/api";
import { type ModelChoice, ModelPicker } from "./ModelPicker";
import { IconButton, Kbd, StatusDot } from "./ui";
import { ZelyqThinking } from "./ZelyqThinking";

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
  chat: ChatState & {
    send(
      message: string,
      override?: { provider?: string; model?: string; attachments?: AttachmentRef[] },
    ): void;
    abort(): void;
  };
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
  /** Picked from the composer's own model control — see `033`. Null means
   * the instance default, unchanged. */
  const [modelChoice, setModelChoice] = useState<ModelChoice | null>(null);
  /** Uploaded and ready to send with the next prompt — see `037`. */
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Follow the stream, unless the reader has scrolled up to look at something.
   * Yanking somebody back to the bottom while they are reading is worse than
   * not following at all.
   */
  const following = useRef(true);
  const contentRef = useRef<HTMLDivElement>(null);

  /**
   * Pinned by watching the content's height rather than guessing which values
   * imply it changed. A tool row grows when it finishes and gains a duration,
   * and markdown renders a frame later — neither alters anything worth putting
   * in a dependency list, and both used to leave the view behind.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;

    const pin = () => {
      if (following.current) scroller.scrollTop = scroller.scrollHeight;
    };
    const observer = new ResizeObserver(pin);
    observer.observe(content);
    pin();
    return () => observer.disconnect();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if ((!message && attachments.length === 0) || chat.busy || uploading > 0) return;
    chat.send(message, {
      ...(modelChoice ? { provider: modelChoice.provider, model: modelChoice.model } : {}),
      ...(attachments.length ? { attachments } : {}),
    });
    setDraft("");
    setAttachments([]);
    setUploadError(null);
    textareaRef.current?.focus();
  }

  async function attachFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadError(null);
    const files = Array.from(fileList);
    setUploading((count) => count + files.length);
    for (const file of files) {
      try {
        const data = await fileToBase64(file);
        const { attachment } = await api.uploadAttachment(projectId, {
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          data,
        });
        setAttachments((previous) => [...previous, attachment]);
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : "Could not attach that file.");
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-border-default bg-surface">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border-default px-3">
        <StatusDot
          tone={chat.busy ? "warning" : chat.status === "open" ? "success" : "danger"}
          pulse={chat.busy}
        />
        <h2 className="text-xs font-medium text-fg">Agent</h2>
        {/* The picker's own choice is the truth once one is made — showing the
            instance default here too would contradict it. */}
        {modelChoice ? (
          <span className="truncate font-mono text-2xs text-fg-muted" title="Picked for this chat">
            {modelChoice.label}
          </span>
        ) : (
          model && (
            <span
              className="truncate font-mono text-2xs text-fg-muted"
              title="Instance default — pick a model below to use something else"
            >
              {model}
            </span>
          )
        )}
        {chat.tokensIn + chat.tokensOut > 0 && (
          <span className="ml-auto shrink-0 font-mono text-2xs text-fg-muted tabular-nums">
            {formatTokens(chat.tokensIn)} / {formatTokens(chat.tokensOut)}
          </span>
        )}
      </header>

      <div
        ref={scrollerRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          // A little slack, so a pixel of rounding does not count as "scrolled away".
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain break-words"
      >
        <div ref={contentRef}>
          {chat.messages.length === 0 && !chat.streaming && (
            <div className="px-4 py-8">
              <p className="text-xs leading-relaxed text-fg-secondary">
                Describe what you want built. Be specific about the pages, the data, and how it
                should look — the agent reads the project, makes the changes, and starts the
                preview.
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
                  attachments: [],
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
        </div>
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-border-default p-2.5">
        <div className="rounded-md border border-border-default bg-surface transition-[border-color,box-shadow] duration-150 focus-within:border-focus focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--focus)_26%,transparent)]">
          {(attachments.length > 0 || uploading > 0) && (
            <div className="flex flex-wrap gap-1.5 px-2.5 pt-2">
              {attachments.map((attachment) => (
                <span
                  key={attachment.id}
                  className="flex items-center gap-1.5 rounded-md border border-border-default bg-surface-subtle py-1 pr-1 pl-2 text-2xs text-fg-secondary"
                >
                  <span className="max-w-32 truncate font-mono">{attachment.filename}</span>
                  <span className="text-fg-muted tabular-nums">
                    {formatBytes(attachment.sizeBytes)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.filename}`}
                    onClick={() =>
                      setAttachments((previous) => previous.filter((a) => a.id !== attachment.id))
                    }
                    className="rounded-sm p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
              {uploading > 0 && (
                <span className="flex items-center gap-1 rounded-md border border-border-default bg-surface-subtle px-2 py-1 text-2xs text-fg-muted">
                  Attaching {uploading} file{uploading === 1 ? "" : "s"}…
                </span>
              )}
            </div>
          )}
          {uploadError && <p className="px-2.5 pt-2 text-2xs text-danger">{uploadError}</p>}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,text/*,.md,.json,.csv,.log,.ts,.tsx,.js,.jsx,.py,.yaml,.yml"
            className="hidden"
            onChange={(event) => {
              void attachFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Plain Enter sends, matching every other chat surface people
              // already use daily — Shift+Enter is what's reserved for a
              // newline, not the other way around.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit(event);
              }
            }}
            placeholder="Describe a change…"
            aria-label="Message the agent"
            style={{ height: COMPOSER_HEIGHT }}
            className="w-full resize-none overflow-y-auto bg-transparent px-2.5 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex items-center gap-2">
              <IconButton
                size="sm"
                label="Attach a file"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={13} strokeWidth={2} />
              </IconButton>
              <ModelPicker value={modelChoice} onChange={setModelChoice} />
              <span className="flex items-center gap-1 text-2xs text-fg-muted">
                <Kbd>↵</Kbd>
                to send
                <span className="mx-0.5 text-fg-muted/60">·</span>
                <Kbd>⇧</Kbd>
                <Kbd>↵</Kbd>
                new line
              </span>
            </div>
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
                disabled={!draft.trim() && attachments.length === 0}
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
        {/* Optional, not just typed that way: a message can arrive from a
            server that hasn't restarted since this field was added — a
            stale build, a rolling deploy, a cached response — and the UI
            must not crash the whole panel over a field one message doesn't
            have. */}
        {(message.attachments?.length ?? 0) > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {message.attachments?.map((attachment) =>
              IMAGE_MIME_TYPES.has(attachment.mimeType) ? (
                <img
                  key={attachment.id}
                  src={api.attachmentUrl(projectId, attachment.id)}
                  alt={attachment.filename}
                  title={attachment.filename}
                  className="h-16 w-16 rounded-md border border-border-default object-cover"
                />
              ) : (
                <span
                  key={attachment.id}
                  className="flex items-center gap-1 rounded-md border border-border-default bg-surface px-2 py-1 text-2xs text-fg-secondary"
                >
                  <Paperclip size={11} strokeWidth={2} className="shrink-0 text-fg-muted" />
                  <span className="max-w-40 truncate font-mono">{attachment.filename}</span>
                </span>
              ),
            )}
          </div>
        )}
        {message.content && (
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-fg">
            {message.content}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="border-b border-border-default px-4 py-3 last:border-b-0">
      {streaming && (
        <ZelyqThinking
          size={22}
          // active, not conditionally rendered: once a tool call or the
          // first token arrives the indicator should finish assembling and
          // dissolve on its own next loop boundary, not vanish mid-frame.
          active={message.toolCalls.length === 0 && !message.content}
        />
      )}
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

/**
 * `btoa` needs a plain string, and spreading a large `Uint8Array` straight
 * into `String.fromCharCode` blows the call stack on anything past a few MB
 * — so it's built up in chunks instead.
 */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
