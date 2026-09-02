import { useMutation, useQuery } from "@tanstack/react-query";
import type { AttachmentRef, Message, ToolCall } from "@zelyq/core";
import {
  ArrowRight,
  ArrowUp,
  ChevronRight,
  CircleAlert,
  Compass,
  Copy,
  Crosshair,
  Film,
  GraduationCap,
  HardHat,
  Infinity as InfinityIcon,
  Info,
  Mic,
  Paperclip,
  Puzzle,
  Sparkles,
  Square,
  Users,
  X,
} from "lucide-react";
import { type FormEvent, lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentActivity, ChatState } from "../hooks/useChatSocket";
import { api } from "../lib/api";
import {
  buildCloneDirective,
  CLONE_SKILL,
  parseCloneCommand,
  parseCloneMessage,
} from "../lib/clone-command";
import { continueLabel, detectContinuePrompt } from "../lib/continuePrompt";
import { parseFigmaCommand, parseFigmaMessage } from "../lib/figma-command";
import { fileToBase64 } from "../lib/files";
import { describeElement, type SelectedElement, withPointedElement } from "../lib/inspector";
import {
  findSlashCommand,
  matchByPrefix,
  replaceSlashCommand,
  SLASH_COMMANDS,
  type SlashMenuCommand,
} from "../lib/slash-menu";
import { SPECIALISTS, type Specialist } from "../lib/specialists";
import { insertTranscript, preferredRecordingMimeType } from "../lib/voice";
import { AgentPresence } from "./AgentPresence";
import { type ModelChoice, ModelPicker } from "./ModelPicker";
import { IconButton, Kbd, Spinner, StatusDot } from "./ui";

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
const MAX_RECORDING_MS = 2 * 60 * 1000;

interface Props {
  chat: ChatState & {
    send(
      message: string,
      override?: {
        provider?: string;
        model?: string;
        attachments?: AttachmentRef[];
        skills?: string[];
        plugins?: string[];
        agents?: string[];
      },
    ): void;
    abort(): void;
  };
  model?: string;
  /** What `/` in the composer offers. Name and description only; a skill's
   * full body never reaches the browser. */
  skills: Array<{ name: string; description: string }>;
  /** Loaded plugin tool names — offered in the `/` menu the same way skills
   * are. Picking one can only ever produce a strong instruction naming the
   * tool, never a content guarantee the way a skill's body is — a plugin is
   * a function, not text — but it is still a real per-message choice. */
  plugins: string[];
  projectId: string;
  /** Editors and above. The server checks again on the restore call. */
  canEdit: boolean;
  /** Clicked in the preview with the inspector on. Null when nothing is
   * currently pointed at. */
  pointedElement: SelectedElement | null;
  onClearPointedElement(): void;
  /** The project on disk changed, so the file tree and preview are stale. */
  onReverted(): void;
  /**
   * Open a file showing what this turn did to it. `after` is the snapshot taken
   * before the *following* turn — the project as this turn left it. Null when
   * this is the newest turn, where "as it left it" is simply the file now.
   */
  onOpenDiff(path: string, before: string, after: string | null): void;
}

export function ChatPanel({
  chat,
  model,
  skills,
  plugins,
  projectId,
  canEdit,
  pointedElement,
  onClearPointedElement,
  onReverted,
  onOpenDiff,
}: Props) {
  const [draft, setDraft] = useState("");
  /** Picked from the composer's own model control. Null means the instance
   * default, unchanged. */
  const [modelChoice, setModelChoice] = useState<ModelChoice | null>(null);
  /** Uploaded and ready to send with the next prompt. */
  const [attachments, setAttachments] = useState<AttachmentRef[]>([]);
  /** Picked from the `/` menu, guaranteed to be used. */
  const [selectedSkills, setSelectedSkills] = useState<
    Array<{ name: string; description: string }>
  >([]);
  /** Picked from the `/` menu's Plugins section. Names only; there's no body
   * to hold onto the way a skill has one. */
  const [selectedPlugins, setSelectedPlugins] = useState<string[]>([]);
  /** Picked from the `/` menu's Agents section. A pointer to whose lens the
   * agent should apply, not a dispatch — the specialists still run behind
   * their own pass tools. Names only. */
  const [selectedAgents, setSelectedAgents] = useState<Specialist[]>([]);
  /** Set when a `/` command (today only `/clone`) can't be sent as typed —
   * e.g. `/clone` with no URL. Cleared on the next edit. */
  const [commandError, setCommandError] = useState<string | null>(null);
  // Per-conversation like modelChoice above, not a Settings-page default —
  // deliberately not persisted past a refresh, the
  // same reason modelChoice isn't either, so a mode this consequential is
  // never silently still on from a session someone forgot about.
  const [engineerMode, setEngineerMode] = useState(false);
  // Architect Mode. Same per-conversation, not-persisted treatment as
  // engineerMode; mutually exclusive with it in the UI (turning one on turns
  // the other off), matching the agent's own rejection of both at once.
  const [architectMode, setArchitectMode] = useState(false);
  // Auto Mode. Only meaningful with Architect Mode; turning it on turns
  // Architect on, turning Architect off turns it off.
  const [autoMode, setAutoMode] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Anchored to the info button, but rendered in a portal so the composer's
  // `overflow-hidden` ancestors cannot clip it.
  const shortcutsBtnRef = useRef<HTMLDivElement>(null);
  const [shortcutsPos, setShortcutsPos] = useState<{ left: number; bottom: number } | null>(null);
  useEffect(() => {
    if (!shortcutsOpen) return;
    const place = () => {
      const r = shortcutsBtnRef.current?.getBoundingClientRect();
      if (r) setShortcutsPos({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [shortcutsOpen]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<
    "idle" | "requesting" | "recording" | "transcribing"
  >("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  /**
   * A reply the user made while the turn was still streaming — held until the
   * turn actually stops, then sent. This is what lets someone answer an agent
   * that finished its message and is only still "busy" because a slow tool
   * (an Expo `start_preview`, say) hasn't returned, without making them hit
   * Stop first. Cleared on send, on `aborted`, or if the turn ends on its own.
   */
  const [queuedReply, setQueuedReply] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const microphoneRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
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

  /** Tracked so the slash command can be found wherever the cursor actually
   * is, not just at the end of the draft. */
  const [cursor, setCursor] = useState(0);

  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: api.getProviders,
    staleTime: 60_000,
  });
  // Only fetched once someone actually starts a `/figma` command — it gates
  // the send with "connect first" rather than letting the turn fail server-side.
  const figmaConnection = useQuery({
    queryKey: ["figma-connection"],
    queryFn: api.figmaConnection,
    enabled: /^\/figma\b/i.test(draft.trimStart()),
    staleTime: 30_000,
  });
  const modelOptions = (providers.data?.providers ?? []).flatMap((provider) =>
    provider.configured && provider.id !== "custom" && provider.models?.length
      ? provider.models.map((option) => ({
          provider: provider.id,
          model: option.value,
          label: `${provider.label} — ${option.label}`,
        }))
      : [],
  );

  // The agent has streamed a message that reads as "reply to continue" but the
  // turn is still busy (a slow tool hasn't returned). `detectContinuePrompt`
  // is the same matcher the finished-turn Continue button uses; here it runs
  // against the still-streaming text so the user can act without hitting Stop.
  const awaitingReplyWord =
    chat.streaming && !queuedReply ? detectContinuePrompt(chat.streaming.text) : null;

  // The menu is derived, not stateful — the draft and cursor together *are*
  // its open state. See lib/slash-menu.ts.
  const slashCommand = findSlashCommand(draft, cursor);
  const matchingSkills = slashCommand
    ? matchByPrefix(
        skills.filter((skill) => !selectedSkills.some((selected) => selected.name === skill.name)),
        slashCommand.query,
        (skill) => skill.name,
      )
    : [];
  const matchingModels = slashCommand
    ? matchByPrefix(modelOptions, slashCommand.query, (option) => option.label)
    : [];
  const matchingPlugins = slashCommand
    ? matchByPrefix(
        plugins.filter((name) => !selectedPlugins.includes(name)),
        slashCommand.query,
        (name) => name,
      )
    : [];
  const matchingAgents = slashCommand
    ? matchByPrefix(
        SPECIALISTS.filter(
          (specialist) => !selectedAgents.some((selected) => selected.name === specialist.name),
        ),
        slashCommand.query,
        (specialist) => specialist.name,
      )
    : [];
  const matchingCommands = slashCommand
    ? matchByPrefix(SLASH_COMMANDS, slashCommand.query, (command) => command.name)
    : [];
  const showSlashMenu =
    matchingCommands.length > 0 ||
    matchingSkills.length > 0 ||
    matchingModels.length > 0 ||
    matchingAgents.length > 0 ||
    matchingPlugins.length > 0;
  // The single flat list Enter/Tab picks the first row of — a command wins a
  // tie (it's the most deliberate pick), then skills, then the rest.
  const firstMatch: {
    kind: "command" | "skill" | "model" | "agent" | "plugin";
    index: number;
  } | null =
    matchingCommands.length > 0
      ? { kind: "command", index: 0 }
      : matchingSkills.length > 0
        ? { kind: "skill", index: 0 }
        : matchingModels.length > 0
          ? { kind: "model", index: 0 }
          : matchingAgents.length > 0
            ? { kind: "agent", index: 0 }
            : matchingPlugins.length > 0
              ? { kind: "plugin", index: 0 }
              : null;

  function selectSkill(skill: { name: string; description: string }) {
    if (!slashCommand) return;
    setSelectedSkills((previous) => [...previous, skill]);
    applySlashReplacement(slashCommand);
  }

  /** A command keeps its text: `/clone ` stays in the draft with the cursor
   * after it so the user types the URL. Not a selection like the others. */
  function selectCommand(command: SlashMenuCommand) {
    if (!slashCommand) return;
    const next = replaceSlashCommand(draft, slashCommand, command.insert);
    setDraft(next);
    setCommandError(null);
    const caret = slashCommand.start + command.insert.length;
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      setCursor(caret);
    });
  }

  function selectModelOption(option: { provider: string; model: string; label: string }) {
    if (!slashCommand) return;
    setModelChoice(option);
    applySlashReplacement(slashCommand);
  }

  function selectPlugin(name: string) {
    if (!slashCommand) return;
    setSelectedPlugins((previous) => [...previous, name]);
    applySlashReplacement(slashCommand);
  }

  function selectAgent(specialist: Specialist) {
    if (!slashCommand) return;
    setSelectedAgents((previous) => [...previous, specialist]);
    applySlashReplacement(slashCommand);
  }

  /** Removes the `/query` fragment the selection just resolved, wherever in
   * the draft it was, and puts the cursor back exactly where it stood. */
  function applySlashReplacement(command: NonNullable<typeof slashCommand>) {
    const next = replaceSlashCommand(draft, command);
    setDraft(next);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(command.start, command.start);
      setCursor(command.start);
    });
  }

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
    const nothingToSend =
      !message &&
      attachments.length === 0 &&
      !pointedElement &&
      selectedSkills.length === 0 &&
      selectedPlugins.length === 0 &&
      selectedAgents.length === 0;
    if (nothingToSend || uploading > 0 || voiceState !== "idle") return;
    if (chat.busy) {
      // The one case a message goes out while the turn is still "busy": the
      // agent has finished its message and is waiting on the user, and a slow
      // tool is all that's keeping the turn open. A plain typed reply stops
      // that step and sends once the turn clears. Anything with attachments or
      // a `/` pick needs a clean fresh turn, so those still wait.
      const plainReply =
        awaitingReplyWord &&
        message &&
        attachments.length === 0 &&
        !pointedElement &&
        !parseCloneCommand(draft) &&
        selectedSkills.length === 0 &&
        selectedPlugins.length === 0 &&
        selectedAgents.length === 0;
      if (plainReply) {
        replyWhileBusy(message);
        setDraft("");
        setCursor(0);
      }
      return;
    }
    // `/figma <link>` (proposal 068): the server pulls the design and builds
    // the directive — the client only gates. A bad link or no connection
    // blocks the send with an inline hint.
    const figma = parseFigmaCommand(draft);
    if (figma) {
      if ("error" in figma) {
        setCommandError(figma.error);
        return;
      }
      if (figmaConnection.data && !figmaConnection.data.connection) {
        setCommandError("Connect Figma in Settings first, then try /figma again.");
        return;
      }
    }

    // `/clone <url>` (proposal 067): rewrite the draft into a <clone_task>
    // directive and force-weave the replica skill. A malformed command blocks
    // the send with an inline hint rather than going out half-formed.
    const clone = parseCloneCommand(draft);
    if (clone && "error" in clone) {
      setCommandError(clone.error);
      return;
    }
    const skillNames = clone
      ? [...new Set([...selectedSkills.map((skill) => skill.name), CLONE_SKILL])]
      : selectedSkills.map((skill) => skill.name);

    // Woven in client-side, ahead of what was typed — the exact same string
    // field chat.send() already carries, nothing new downstream.
    const finalMessage = clone
      ? buildCloneDirective(clone.url, clone.rest)
      : pointedElement
        ? withPointedElement(message, pointedElement)
        : message;
    chat.send(finalMessage, {
      ...(modelChoice ? { provider: modelChoice.provider, model: modelChoice.model } : {}),
      ...(attachments.length ? { attachments } : {}),
      // Names only — the guaranteed weaving happens agent-side, from a
      // skill's already-loaded body, not from anything sent here.
      ...(skillNames.length ? { skills: skillNames } : {}),
      // Names only, too — agent-side this becomes an instruction naming the
      // tool, not real content the way a skill's body is.
      ...(selectedPlugins.length ? { plugins: selectedPlugins } : {}),
      // Names only — a pointer to whose lens to apply. The specialists still
      // run behind their own pass tools; this never dispatches one.
      ...(selectedAgents.length ? { agents: selectedAgents.map((agent) => agent.name) } : {}),
      ...(engineerMode ? { engineerMode: true } : {}),
      ...(architectMode ? { architectMode: true } : {}),
      ...(architectMode && autoMode ? { autoMode: true } : {}),
    });
    setDraft("");
    setCursor(0);
    setAttachments([]);
    setSelectedSkills([]);
    setSelectedPlugins([]);
    setSelectedAgents([]);
    setUploadError(null);
    setCommandError(null);
    onClearPointedElement();
    textareaRef.current?.focus();
  }

  /** The mode flags every send carries — a typed message, a Continue, or a
   * queued reply all use the same set. */
  function turnFlags() {
    return {
      ...(modelChoice ? { provider: modelChoice.provider, model: modelChoice.model } : {}),
      ...(engineerMode ? { engineerMode: true } : {}),
      ...(architectMode ? { architectMode: true } : {}),
      ...(architectMode && autoMode ? { autoMode: true } : {}),
    };
  }

  /** Send a bare word to carry the turn on — the "Continue" button below the
   * conversation. Same mode flags as a typed message, nothing else attached. */
  function continueTurn(word: string) {
    if (chat.busy || uploading > 0 || voiceState !== "idle") return;
    chat.send(word, turnFlags());
    textareaRef.current?.focus();
  }

  /**
   * Reply to an agent that has finished its message but whose turn is still
   * "busy" (a slow tool hasn't returned). Stop the stalled step, then send the
   * reply once the turn is actually clear — the flush effect below does the
   * second half when `busy`/`streaming` drop.
   */
  function replyWhileBusy(text: string) {
    const trimmed = text.trim();
    if (!trimmed || queuedReply) return;
    setQueuedReply(trimmed);
    chat.abort();
    textareaRef.current?.focus();
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the queue flushes on the busy→idle edge; the flags are read fresh at send time and don't need to retrigger it.
  useEffect(() => {
    if (!queuedReply || chat.busy || chat.streaming) return;
    const text = queuedReply;
    setQueuedReply(null);
    chat.send(text, turnFlags());
  }, [queuedReply, chat.busy, chat.streaming]);

  // A queued reply that never got to send — the turn errored, or the socket
  // dropped — should not sit there forever waiting for a `busy` edge that
  // won't come.
  useEffect(() => {
    if (queuedReply && chat.error) setQueuedReply(null);
  }, [queuedReply, chat.error]);

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

  function releaseMicrophone() {
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    for (const track of microphoneRef.current?.getTracks() ?? []) track.stop();
    microphoneRef.current = null;
    recorderRef.current = null;
  }

  async function startVoiceRecording() {
    setVoiceError(null);
    // Browsers expose microphone access only in secure contexts.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setVoiceError(
        "Voice input needs a secure connection. Open Zelyq over HTTPS, or reach it through " +
          "localhost (e.g. an SSH tunnel) — browsers block the microphone on plain http:// addresses.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceError("Voice input is not supported by this browser.");
      return;
    }

    setVoiceState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      microphoneRef.current = stream;
      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        recorder.onstop = null;
        releaseMicrophone();
        if (mountedRef.current) {
          setVoiceState("idle");
          setVoiceError("The browser could not record from the microphone.");
        }
      };
      recorder.onstop = () => {
        const recordedType = recorder.mimeType || chunks[0]?.type || mimeType || "audio/webm";
        const audio = new Blob(chunks, { type: recordedType });
        releaseMicrophone();
        if (!mountedRef.current) return;
        if (audio.size === 0) {
          setVoiceState("idle");
          setVoiceError("No audio was recorded. Try again and speak after recording starts.");
          return;
        }
        setVoiceState("transcribing");
        void fileToBase64(audio)
          .then((data) => api.transcribeVoice(projectId, { mimeType: recordedType, data }))
          .then(({ text }) => {
            if (!mountedRef.current) return;
            const textarea = textareaRef.current;
            const selectionStart = textarea?.selectionStart ?? draft.length;
            const selectionEnd = textarea?.selectionEnd ?? selectionStart;
            setDraft((current) => {
              const inserted = insertTranscript(current, text, selectionStart, selectionEnd);
              requestAnimationFrame(() => {
                textareaRef.current?.focus();
                textareaRef.current?.setSelectionRange(inserted.cursor, inserted.cursor);
                setCursor(inserted.cursor);
              });
              return inserted.value;
            });
            setVoiceState("idle");
          })
          .catch((error) => {
            if (!mountedRef.current) return;
            setVoiceState("idle");
            setVoiceError(error instanceof Error ? error.message : "Could not transcribe audio.");
          });
      };
      recorder.start(250);
      setVoiceState("recording");
      recordingTimerRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, MAX_RECORDING_MS);
    } catch (error) {
      releaseMicrophone();
      setVoiceState("idle");
      setVoiceError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser settings and try again."
          : "Could not access the microphone.",
      );
    }
  }

  function stopVoiceRecording() {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      if (recordingTimerRef.current !== null) {
        window.clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      for (const track of microphoneRef.current?.getTracks() ?? []) track.stop();
      microphoneRef.current = null;
      recorderRef.current = null;
    };
  }, []);

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
            {chat.cacheReadTokens > 0 && (
              <span
                title="Share of the prompt served from the model's cache (~10% of the input price)"
                className="text-success"
              >
                {" "}
                ·{" "}
                {Math.round((chat.cacheReadTokens / (chat.tokensIn + chat.cacheReadTokens)) * 100)}%
                cached
              </span>
            )}
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
                activity={chat.streaming.activity}
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

          {queuedReply && (
            <div className="mx-3 my-3 flex items-center gap-2 text-xs text-fg-secondary">
              <Spinner />
              Stopping the current step, then sending your reply…
            </div>
          )}

          {!queuedReply &&
            canEdit &&
            (() => {
              // Turn finished — the plain Continue affordance.
              if (!chat.busy && !chat.streaming) {
                const last = chat.messages[chat.messages.length - 1];
                if (last?.role !== "assistant") return null;
                const word = detectContinuePrompt(last.content);
                return word ? (
                  <ContinuePrompt label={continueLabel(word)} onClick={() => continueTurn(word)} />
                ) : null;
              }
              // Turn still "busy", but the agent has written a reply-to-continue
              // hand-off — a slow tool is all that's keeping it open. Offer the
              // same action without making the user hit Stop first.
              if (chat.streaming && awaitingReplyWord) {
                return (
                  <div className="flex flex-col items-start gap-0.5">
                    <ContinuePrompt
                      label={continueLabel(awaitingReplyWord)}
                      onClick={() => replyWhileBusy(awaitingReplyWord)}
                    />
                    <span className="mx-3 -mt-1 mb-2 max-w-md text-2xs text-fg-muted">
                      The agent finished its message and is waiting for you — this stops the current
                      step first. You can also just type a reply below.
                    </span>
                  </div>
                );
              }
              return null;
            })()}

          {chat.error && (
            <p className="mx-3 my-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-subtle px-2.5 py-2 text-xs break-words text-danger">
              <CircleAlert size={14} strokeWidth={1.75} className="mt-px shrink-0" />
              {chat.error}
            </p>
          )}
        </div>
      </div>

      <AgentPresence body={chat.body} active={Boolean(chat.streaming)} />

      <form onSubmit={submit} className="relative shrink-0 border-t border-border-default p-2.5">
        {showSlashMenu && (
          <div
            role="listbox"
            aria-label="Commands"
            className="absolute inset-x-2.5 bottom-full z-10 mb-1.5 max-h-64 overflow-y-auto rounded-md border border-border-default bg-overlay py-1 shadow-overlay"
          >
            {matchingCommands.length > 0 && (
              <SlashSection title="Command">
                {matchingCommands.map((command, index) => (
                  <button
                    key={command.name}
                    type="button"
                    className={`flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left ${
                      firstMatch?.kind === "command" && index === 0
                        ? "bg-surface-hover"
                        : "hover:bg-surface-hover"
                    }`}
                    onClick={() => selectCommand(command)}
                  >
                    <span className="flex items-center gap-1.5 font-mono text-xs text-fg">
                      <Copy size={12} strokeWidth={1.75} className="shrink-0 text-fg-muted" />/
                      {command.name}
                    </span>
                    <span className="truncate text-2xs text-fg-secondary">{command.blurb}</span>
                  </button>
                ))}
              </SlashSection>
            )}
            {matchingModels.length > 0 && (
              <SlashSection title="Model">
                {matchingModels.map((option, index) => (
                  <button
                    key={`${option.provider}:${option.model}`}
                    type="button"
                    className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left font-mono text-xs text-fg ${
                      firstMatch?.kind === "model" && index === 0
                        ? "bg-surface-hover"
                        : "hover:bg-surface-hover"
                    }`}
                    onClick={() => selectModelOption(option)}
                  >
                    {option.label}
                  </button>
                ))}
              </SlashSection>
            )}
            {matchingSkills.length > 0 && (
              <SlashSection title="Skills">
                {matchingSkills.map((skill, index) => (
                  <button
                    key={skill.name}
                    type="button"
                    className={`flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left ${
                      firstMatch?.kind === "skill" && index === 0
                        ? "bg-surface-hover"
                        : "hover:bg-surface-hover"
                    }`}
                    onClick={() => selectSkill(skill)}
                  >
                    <span className="flex items-center gap-1.5 font-mono text-xs text-fg">
                      <GraduationCap
                        size={12}
                        strokeWidth={1.75}
                        className="shrink-0 text-fg-muted"
                      />
                      {skill.name}
                    </span>
                    <span className="truncate text-2xs text-fg-secondary">{skill.description}</span>
                  </button>
                ))}
              </SlashSection>
            )}
            {matchingAgents.length > 0 && (
              <SlashSection title="Agents">
                {matchingAgents.map((specialist, index) => (
                  <button
                    key={specialist.name}
                    type="button"
                    className={`flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left ${
                      firstMatch?.kind === "agent" && index === 0
                        ? "bg-surface-hover"
                        : "hover:bg-surface-hover"
                    }`}
                    onClick={() => selectAgent(specialist)}
                  >
                    <span className="flex items-center gap-1.5 font-mono text-xs text-fg">
                      <Users size={12} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
                      {specialist.label}
                    </span>
                    <span className="truncate text-2xs text-fg-secondary">{specialist.blurb}</span>
                  </button>
                ))}
              </SlashSection>
            )}
            {matchingPlugins.length > 0 && (
              <SlashSection title="Plugins">
                {matchingPlugins.map((name, index) => (
                  <button
                    key={name}
                    type="button"
                    className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left font-mono text-xs text-fg ${
                      firstMatch?.kind === "plugin" && index === 0
                        ? "bg-surface-hover"
                        : "hover:bg-surface-hover"
                    }`}
                    onClick={() => selectPlugin(name)}
                  >
                    <Puzzle size={12} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
                    {name}
                  </button>
                ))}
              </SlashSection>
            )}
          </div>
        )}
        <div className="rounded-md border border-border-default bg-surface transition-[border-color,box-shadow] duration-150 focus-within:border-focus focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--focus)_26%,transparent)]">
          {(pointedElement ||
            attachments.length > 0 ||
            uploading > 0 ||
            selectedSkills.length > 0 ||
            selectedPlugins.length > 0 ||
            selectedAgents.length > 0) && (
            <div className="flex flex-wrap gap-1.5 px-2.5 pt-2">
              {selectedSkills.map((skill) => (
                <span
                  key={skill.name}
                  title={skill.description}
                  className="flex items-center gap-1.5 rounded-md border border-border-default bg-surface-subtle py-1 pr-1 pl-2 text-2xs text-fg-secondary"
                >
                  <GraduationCap size={11} strokeWidth={2} className="shrink-0 text-fg-muted" />
                  <span className="max-w-40 truncate font-mono">{skill.name}</span>
                  <button
                    type="button"
                    aria-label={`Don't use the ${skill.name} skill`}
                    onClick={() =>
                      setSelectedSkills((previous) => previous.filter((s) => s.name !== skill.name))
                    }
                    className="rounded-sm p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
              {selectedAgents.map((agent) => (
                <span
                  key={agent.name}
                  title={agent.blurb}
                  className="flex items-center gap-1.5 rounded-md border border-border-default bg-surface-subtle py-1 pr-1 pl-2 text-2xs text-fg-secondary"
                >
                  <Users size={11} strokeWidth={2} className="shrink-0 text-fg-muted" />
                  <span className="max-w-40 truncate font-mono">{agent.label}</span>
                  <button
                    type="button"
                    aria-label={`Don't point at the ${agent.label}`}
                    onClick={() =>
                      setSelectedAgents((previous) => previous.filter((a) => a.name !== agent.name))
                    }
                    className="rounded-sm p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
              {selectedPlugins.map((name) => (
                <span
                  key={name}
                  title={`Use the ${name} tool for this task`}
                  className="flex items-center gap-1.5 rounded-md border border-border-default bg-surface-subtle py-1 pr-1 pl-2 text-2xs text-fg-secondary"
                >
                  <Puzzle size={11} strokeWidth={2} className="shrink-0 text-fg-muted" />
                  <span className="max-w-40 truncate font-mono">{name}</span>
                  <button
                    type="button"
                    aria-label={`Don't use the ${name} tool`}
                    onClick={() =>
                      setSelectedPlugins((previous) => previous.filter((p) => p !== name))
                    }
                    className="rounded-sm p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
              {pointedElement && (
                <span className="flex items-center gap-1.5 rounded-md border border-border-default bg-surface-subtle py-1 pr-1 pl-2 text-2xs text-fg-secondary">
                  <Crosshair size={11} strokeWidth={2} className="shrink-0 text-fg-muted" />
                  <span className="max-w-40 truncate font-mono">
                    {describeElement(pointedElement)}
                  </span>
                  <button
                    type="button"
                    aria-label="Stop pointing at this"
                    onClick={onClearPointedElement}
                    className="rounded-sm p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </span>
              )}
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
          {commandError && <p className="px-2.5 pt-2 text-2xs text-danger">{commandError}</p>}
          {voiceError && <p className="px-2.5 pt-2 text-2xs text-danger">{voiceError}</p>}
          {voiceState === "recording" && (
            <p className="px-2.5 pt-2 text-2xs text-danger" role="status">
              Recording… click the microphone again to stop.
            </p>
          )}
          {voiceState === "transcribing" && (
            <p className="px-2.5 pt-2 text-2xs text-fg-muted" role="status">
              Transcribing voice…
            </p>
          )}
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
            onChange={(event) => {
              setDraft(event.target.value);
              setCursor(event.target.selectionStart ?? event.target.value.length);
              if (commandError) setCommandError(null);
            }}
            // The cursor moves on its own too — arrow keys, clicking
            // elsewhere in the text — and the menu has to track it there as
            // well, or it stays anchored to wherever it last opened.
            onKeyUp={(event) => setCursor(event.currentTarget.selectionStart ?? 0)}
            onClick={(event) => setCursor(event.currentTarget.selectionStart ?? 0)}
            onKeyDown={(event) => {
              // While the menu is showing, Enter and Tab pick its first row
              // instead of doing what they'd otherwise do — sending a turn
              // with "/shadcn" still literally in it would be exactly the
              // "hoped it noticed" failure the guaranteed weaving exists to
              // remove.
              if (showSlashMenu && (event.key === "Enter" || event.key === "Tab") && firstMatch) {
                event.preventDefault();
                if (firstMatch.kind === "command") selectCommand(matchingCommands[0]!);
                else if (firstMatch.kind === "skill") selectSkill(matchingSkills[0]!);
                else if (firstMatch.kind === "model") selectModelOption(matchingModels[0]!);
                else if (firstMatch.kind === "agent") selectAgent(matchingAgents[0]!);
                else selectPlugin(matchingPlugins[0]!);
                return;
              }
              // Plain Enter sends, matching every other chat surface people
              // already use daily — Shift+Enter is what's reserved for a
              // newline, not the other way around.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit(event);
              }
            }}
            placeholder={
              awaitingReplyWord
                ? "Reply to the agent…"
                : /^\/clone\b/i.test(draft.trimStart())
                  ? "/clone https://the-site-to-rebuild.com"
                  : /^\/figma\b/i.test(draft.trimStart())
                    ? "/figma  — paste a Figma frame's share link"
                    : "Describe a change…"
            }
            aria-label="Message the agent"
            style={{ height: COMPOSER_HEIGHT }}
            className="w-full resize-none overflow-y-auto bg-transparent px-2.5 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            {/* min-w-0 is load-bearing: a flex child's default min-width is
                its own content width, which silently blocks it from ever
                shrinking — exactly what let a long model name push the send
                button out of the panel entirely instead of the row giving
                way here first. */}
            <div className="flex min-w-0 items-center gap-2">
              <IconButton
                size="sm"
                label="Attach a file"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={13} strokeWidth={2} />
              </IconButton>
              <IconButton
                size="sm"
                variant={voiceState === "recording" ? "danger" : "ghost"}
                label={
                  voiceState === "recording"
                    ? "Stop voice recording"
                    : voiceState === "requesting"
                      ? "Requesting microphone access"
                      : voiceState === "transcribing"
                        ? "Transcribing voice"
                        : "Start voice input"
                }
                aria-pressed={voiceState === "recording"}
                disabled={chat.busy || voiceState === "requesting" || voiceState === "transcribing"}
                onClick={
                  voiceState === "recording" ? stopVoiceRecording : () => void startVoiceRecording()
                }
                className="shrink-0"
              >
                {voiceState === "recording" ? (
                  <Square size={11} strokeWidth={2.5} className="fill-current" />
                ) : (
                  <Mic size={13} strokeWidth={2} />
                )}
              </IconButton>
              <ModelPicker value={modelChoice} onChange={setModelChoice} />
              {/* Per-conversation, not persisted — see the engineerMode
                  state declaration above. */}
              <IconButton
                size="sm"
                variant={engineerMode ? "primary" : "ghost"}
                label={
                  engineerMode ? "Engineer Mode is on — click to turn off" : "Turn on Engineer Mode"
                }
                aria-pressed={engineerMode}
                onClick={() =>
                  setEngineerMode((value) => {
                    if (!value) setArchitectMode(false);
                    return !value;
                  })
                }
                className="shrink-0"
              >
                <HardHat size={13} strokeWidth={2} />
              </IconButton>
              {/* Architect Mode. Interviews and plans, writes no code. */}
              <IconButton
                size="sm"
                variant={architectMode ? "primary" : "ghost"}
                label={
                  architectMode
                    ? "Architect Mode is on — click to turn off"
                    : "Turn on Architect Mode"
                }
                aria-pressed={architectMode}
                onClick={() =>
                  setArchitectMode((value) => {
                    if (!value) setEngineerMode(false);
                    else setAutoMode(false);
                    return !value;
                  })
                }
                className="shrink-0"
              >
                <Compass size={13} strokeWidth={2} />
              </IconButton>
              {/* Auto Mode. Runs build passes back to back on its own until
                  the plan is done or a ceiling is hit. Only
                  with Architect Mode. */}
              <IconButton
                size="sm"
                variant={autoMode ? "primary" : "ghost"}
                label={
                  autoMode
                    ? "Auto Mode is on — the build runs itself; click to turn off"
                    : "Turn on Auto Mode (Architect builds the whole plan without stopping)"
                }
                aria-pressed={autoMode}
                onClick={() =>
                  setAutoMode((value) => {
                    if (!value) {
                      setArchitectMode(true);
                      setEngineerMode(false);
                    }
                    return !value;
                  })
                }
                className="shrink-0"
              >
                <InfinityIcon size={13} strokeWidth={2} />
              </IconButton>
              {/* The keyboard hints used to sit inline here and ate the
                  row's width. This button row is for controls; the hints
                  live behind an info popover, rendered in a portal so no
                  `overflow-hidden` ancestor can clip it. */}
              <div className="shrink-0" ref={shortcutsBtnRef}>
                <IconButton
                  size="sm"
                  variant={shortcutsOpen ? "primary" : "ghost"}
                  label="Keyboard shortcuts"
                  aria-expanded={shortcutsOpen}
                  onClick={() => setShortcutsOpen((v) => !v)}
                >
                  <Info size={13} strokeWidth={2} />
                </IconButton>
              </div>
            </div>
            {chat.busy ? (
              <IconButton
                size="sm"
                variant="secondary"
                label="Stop the current turn"
                onClick={chat.abort}
                className="shrink-0"
              >
                <Square size={11} strokeWidth={2.5} className="fill-current" />
              </IconButton>
            ) : (
              <IconButton
                size="sm"
                variant="primary"
                label="Send message"
                type="submit"
                disabled={
                  voiceState !== "idle" ||
                  (!draft.trim() && attachments.length === 0 && !pointedElement)
                }
                className="shrink-0"
              >
                <ArrowUp size={13} strokeWidth={2.5} />
              </IconButton>
            )}
          </div>
        </div>
      </form>

      {shortcutsOpen &&
        shortcutsPos &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close shortcuts"
              className="fixed inset-0 z-[100] cursor-default"
              onClick={() => setShortcutsOpen(false)}
            />
            <div
              role="dialog"
              aria-label="Keyboard shortcuts"
              style={{ left: shortcutsPos.left, bottom: shortcutsPos.bottom }}
              className="fixed z-[101] w-60 rounded-lg border border-border-default bg-surface p-2.5 text-2xs shadow-lg"
            >
              <p className="mb-1.5 font-medium text-fg">Keyboard</p>
              <ul className="space-y-1 text-fg-muted">
                <li className="flex items-center justify-between gap-2">
                  <span>Send message</span>
                  <span className="flex items-center gap-0.5">
                    <Kbd>↵</Kbd>
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span>New line</span>
                  <span className="flex items-center gap-0.5">
                    <Kbd>⇧</Kbd>
                    <Kbd>↵</Kbd>
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span>Commands, skills, agents, plugins</span>
                  <span className="flex items-center gap-0.5">
                    <Kbd>/</Kbd>
                  </span>
                </li>
              </ul>
            </div>
          </>,
          document.body,
        )}
    </section>
  );
}

/**
 * The read-only echo, on a sent user message, of what its `/` menu pointed
 * at — skills, specialists, plugin tools. Non-interactive: it records what
 * was named, it does not let you change a message already sent. `mentions`
 * is optional the same way `attachments` is — a row from before the field
 * existed, or a server mid-deploy, simply has nothing to show here.
 */
function MentionChips({ mentions }: { mentions?: Message["mentions"] }) {
  if (!mentions) return null;
  const rows: Array<{ key: string; icon: typeof GraduationCap; label: string }> = [
    ...(mentions.skills ?? []).map((name) => ({
      key: `skill:${name}`,
      icon: GraduationCap,
      label: name,
    })),
    ...(mentions.agents ?? []).map((name) => ({
      key: `agent:${name}`,
      icon: Users,
      label: SPECIALISTS.find((s) => s.name === name)?.label ?? name,
    })),
    ...(mentions.plugins ?? []).map((name) => ({
      key: `plugin:${name}`,
      icon: Puzzle,
      label: name,
    })),
  ];
  if (rows.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {rows.map(({ key, icon: Icon, label }) => (
        <span
          key={key}
          className="flex items-center gap-1 rounded-md border border-border-default bg-surface px-2 py-1 text-2xs text-fg-secondary"
        >
          <Icon size={11} strokeWidth={2} className="shrink-0 text-fg-muted" />
          <span className="max-w-40 truncate font-mono">{label}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * A `/clone` message carries a workflow directive the agent needs but a person
 * doesn't want to read in the transcript — show it as a compact row (the URL,
 * plus anything the user added) instead of the raw text. Anything else renders
 * as the plain typed message.
 */
function UserMessageBody({ content }: { content: string }) {
  const clone = parseCloneMessage(content);
  if (clone) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="flex w-fit items-center gap-1.5 rounded-md border border-border-default bg-surface px-2 py-1 text-2xs text-fg-secondary">
          <Copy size={11} strokeWidth={2} className="shrink-0 text-fg-muted" />
          <span className="font-mono">clone</span>
          <span className="max-w-64 truncate text-fg">{clone.url}</span>
        </span>
        {clone.rest && (
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-fg">
            {clone.rest}
          </p>
        )}
      </div>
    );
  }
  const figma = parseFigmaMessage(content);
  if (figma) {
    return (
      <span className="flex w-fit items-center gap-1.5 rounded-md border border-border-default bg-surface px-2 py-1 text-2xs text-fg-secondary">
        <Copy size={11} strokeWidth={2} className="shrink-0 text-fg-muted" />
        <span className="font-mono">figma</span>
        <span className="max-w-64 truncate text-fg">
          {figma.fileKey} · {figma.nodeId}
        </span>
      </span>
    );
  }
  return (
    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-fg">{content}</p>
  );
}

function MessageRow({
  message,
  streaming,
  activity,
  nextSnapshotId,
  projectId,
  canEdit,
  onReverted,
  onOpenDiff,
}: {
  message: Message;
  streaming?: boolean;
  activity?: AgentActivity[];
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
        <MentionChips mentions={message.mentions} />
        {message.content && <UserMessageBody content={message.content} />}
      </div>
    );
  }

  return (
    <div className="border-b border-border-default px-4 py-3 last:border-b-0">
      {activity && activity.length > 0 && <SpecialistActivity items={activity} />}
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

/**
 * A named specialist child agent (the Designer) working, shown as its own
 * labelled sub-thread so it is obvious a different agent is on the job.
 * Live only; the dispatch tool call and its full report persist on their own.
 */
const SPECIALIST_LABEL: Record<AgentActivity["agent"], string> = {
  designer: "Designer agent",
  devops: "DevOps agent",
  security: "Security/QA agent",
  cinematic: "Cinematic engineer",
  verifier: "Verifier agent",
  builder: "Builder agent",
};

const SPECIALIST_ICON: Record<AgentActivity["agent"], typeof Sparkles> = {
  designer: Sparkles,
  devops: Sparkles,
  security: Sparkles,
  cinematic: Film,
  verifier: Sparkles,
  builder: Sparkles,
};

function SpecialistActivity({ items }: { items: AgentActivity[] }) {
  const agent = items[0]?.agent ?? "designer";
  const ended = items.some((i) => i.phase === "end");
  const steps = items.filter((i) => i.phase === "step");
  const endLine = items.find((i) => i.phase === "end");
  const startLine = items.find((i) => i.phase === "start");
  const Icon = SPECIALIST_ICON[agent] ?? Sparkles;

  return (
    <div className="mb-2.5 rounded-md border border-border-default bg-surface-subtle px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-xs">
        <Icon size={13} strokeWidth={2} className="shrink-0 text-fg-secondary" />
        <span className="font-medium text-fg-secondary">{SPECIALIST_LABEL[agent]}</span>
        {!ended && <StatusDot tone="warning" pulse />}
        <span className="min-w-0 flex-1 truncate text-fg-muted">
          {ended ? endLine?.title : (startLine?.title ?? "working")}
        </span>
      </div>
      {steps.length > 0 && (
        <ol className="mt-1.5 flex flex-col gap-0.5 border-l border-border-default pl-2.5">
          {steps.map((step, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: the activity log is append-only and never reordered
              key={`${index}-${step.title}`}
              className="truncate text-2xs leading-relaxed text-fg-muted"
            >
              {step.title}
              {step.detail ? <span className="text-fg-muted"> — {step.detail}</span> : null}
            </li>
          ))}
        </ol>
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

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** One titled group in the `/` menu — Model, Skills, Plugins — grouped so
 * it is clear what kind of thing each row is, rather than an
 * undifferentiated list. */
/** The "Continue" pill under the transcript — shown when the agent asked the
 * user to reply, whether the turn has finished or is still busy on a slow tool. */
function ContinuePrompt({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="mx-3 my-3 flex justify-start">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
      >
        <ArrowRight size={13} strokeWidth={2} />
        {label}
      </button>
    </div>
  );
}

function SlashSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-1 first:mt-0">
      <div className="mt-1 border-t border-border-default first:mt-0 first:border-t-0" />
      <p className="px-2.5 pt-1.5 pb-1 text-2xs font-medium tracking-[0.04em] text-fg-muted uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}
