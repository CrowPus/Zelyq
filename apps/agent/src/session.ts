import { posix as pathPosix } from "node:path";
import {
  type AgentEvent,
  type Message,
  newId,
  type Preview,
  type PromptAttachment,
  type ToolCall,
} from "@zelyq/core";
import type { RuntimeDriver } from "@zelyq/runtime";
import {
  ALL_TOOLS,
  dispatchTaskTool,
  executeTool,
  type ToolContext,
  type ToolResult,
  toolDefinitions,
} from "@zelyq/tools";
import {
  ARCHITECT_DRIFT_MARKER,
  ARCHITECT_INTERVIEW_DONE_MARKER,
  ARCHITECT_READY_MARKER,
  ARCHITECT_WRITE_ROOT,
  buildSystemPrompt,
  ENGINEER_MODE_PURPOSE_MARKER,
  withPlugins,
  withSkills,
} from "./prompt.js";
import {
  type AuthMode,
  type Conversation,
  classifyProviderError,
  createProvider,
  describeAvailableModels,
  describeProviderError,
  type Effort,
  type ProviderFactory,
  type ProviderId,
} from "./providers/index.js";

/** Every tool that can change the project, refused once Engineer Mode's
 * new-file checkpoint is reached — see the `checkpointReached` comment in
 * `run()`. `delete_file` is included for the same reason the others are:
 * once checkpointed, nothing about the project should change, not only
 * file creation. Read-only tools (`read_file`, `list_files`,
 * `search_files`, preview inspection) are deliberately absent — the model
 * can still look at what exists to write an accurate summary. */
const MUTATING_TOOL_NAMES = new Set(["write_file", "edit_file", "delete_file", "run_command"]);

// 048 — Architect Mode. It plans; it does not build. Writes are allowed only
// under `architecture/`, and nothing executes.
const ARCHITECT_WRITE_TOOLS = new Set(["write_file", "edit_file", "delete_file"]);
const ARCHITECT_BLOCKED_TOOLS = new Set(["run_command", "start_preview"]);
// The only package files the Architect may touch before it has written the
// "Interview complete:" line. Everything else under `architecture/` — the
// decisions, the data model, the API surface, the build plan — stays refused
// until the interview is closed, so the interview cannot be skipped by
// dumping the whole design in one turn.
const ARCHITECT_INTERVIEW_WRITABLE = new Set([
  "architecture/requirements.md",
  "architecture/README.md",
]);

/** True when `toolCall` is not allowed in Architect Mode: an execution tool,
 * or a write whose canonicalized path escapes `architecture/`. Path is
 * normalized first so `architecture/../src/x` and `./architecture/../x`
 * cannot slip through the prefix check. */
function architectModeBlock(name: string, input: Record<string, unknown>): "exec" | "scope" | null {
  if (ARCHITECT_BLOCKED_TOOLS.has(name)) return "exec";
  if (ARCHITECT_WRITE_TOOLS.has(name)) {
    const raw = typeof input.path === "string" ? input.path : "";
    const norm = pathPosix.normalize(raw);
    if (
      raw === "" ||
      pathPosix.isAbsolute(norm) ||
      norm === ".." ||
      norm.startsWith("../") ||
      !(norm === "architecture" || norm.startsWith(ARCHITECT_WRITE_ROOT))
    ) {
      return "scope";
    }
  }
  return null;
}

// 047 Phase 3 — orchestration caps. Hard, enforced here, not in prose. Every
// dispatched builder is bounded; the whole run is bounded on top of that.
const SUBAGENT_MAX_TURNS = 25;
const SUBAGENT_MAX_TOKENS = 200_000;
const SUBAGENT_WALLCLOCK_MS = 5 * 60_000;
const ORCH_MAX_SUBAGENTS = 20;
const ORCH_MAX_TOKENS = 2_000_000;

/** Pick a concrete model for a task's tier. Falls back to the session's own
 * model when the tier is absent or no available model matches it — never
 * silently down-routes to something that isn't there. */
function modelForTier(
  tier: "strong" | "standard" | "cheap" | undefined,
  provider: ProviderId,
  sessionModel: string,
  available: ReturnType<typeof describeAvailableModels>,
): string {
  if (!tier) return sessionModel;
  const here = available.find((p) => p.provider === provider && p.available);
  const match = here?.models.find((m) => m.tier === tier);
  return match?.value ?? sessionModel;
}

/** Lockfiles a package manager writes as a normal side effect of
 * `npm install` and its equivalents — found live: `run_command`'s
 * reactive new-file detection was counting `package-lock.json` toward
 * the same six-file budget as an actually-invented file, silently
 * costing the model one of its six slots for something it didn't choose
 * to create. Excluded by basename, not path, since these always live at
 * the project root. */
const GENERATED_LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
]);

export interface SessionOptions {
  sessionId: string;
  projectId: string;
  projectName: string;
  template: string;
  provider: ProviderId;
  model: string;
  effort: Effort;
  apiKey: string;
  /** See `045` in the council notes — `apiKey` above is a CLI-sourced OAuth
   * token, not a classic key, when this is `"subscription"`. */
  authMode?: AuthMode;
  /** Endpoint for a provider speaking the OpenAI dialect. */
  baseUrl?: string;
  runtime: RuntimeDriver;
  maxIterations: number;
  history?: Message[];
  /** The name/description catalog only — see `042`. Empty when nothing loaded. */
  skills?: Array<{ name: string; description: string }>;
  /** Full body lookup for `044`'s guaranteed `/`-selected weaving — a
   * separate field from `skills` above so the prompt catalog never has to
   * carry every skill's full text just to build a two-line list. */
  resolveSkillBody?: (name: string) => { body: string } | undefined;
  /** ZED-0001, Phase 1. `engineerModeSkill` is the `senior-software-engineering`
   * skill's body and resource listing, resolved by the caller the same way
   * `resolveSkillBody` already is — absent when that skill wasn't found at
   * boot, in which case the mode's four directives still apply on their own. */
  engineerMode?: boolean;
  engineerModeSkill?: { body: string; resources: string[] };
  /** 048 — Architect Mode, Phase 1. Mutually exclusive with `engineerMode`
   * (the server rejects both). When on, this session interviews and designs
   * only: writes outside `architecture/` and every execution tool are
   * refused at the tool boundary below. `architectModeSkill` is the
   * `report-page-design` skill for the report render. */
  architectMode?: boolean;
  architectModeSkill?: { body: string; resources: string[] };
  /** Overridable so tests can run the loop without a network or an API key. */
  providerFactory?: ProviderFactory;
}

type Emit = (event: AgentEvent) => void;

/**
 * One conversation about one project.
 *
 * The loop is hand-written rather than using a vendor's agent helper because
 * the UI needs three things together that none of them expose: per-token
 * streaming, a `tool.start` event emitted *before* the tool runs, and
 * cancellation that takes effect mid-tool.
 *
 * Everything vendor-specific lives behind `Conversation`, so this loop reads
 * the same whether it is driving Claude or Gemini.
 */
export class AgentSession {
  readonly id: string;
  readonly projectId: string;

  private readonly options: SessionOptions;
  private readonly conversation: Conversation;

  private abortController: AbortController | null = null;
  private busy = false;
  private turns = 0;
  private tokensIn = 0;
  private tokensOut = 0;

  // 048/047 — the turn number on which the Architect first declared the
  // package ready (or 0 if a resumed session's history already contains that
  // declaration). dispatch_task is refused until this is set AND at least one
  // user turn has happened since — i.e. the user has seen the finished plan
  // and come back to say build it. Prevents "wrote the whole plan itself,
  // then started building" in one breath.
  private readyDeclaredAtTurn: number | null = null;

  // 048/047 — set once the Architect has written the "Interview complete:"
  // line. Until then the only package files it may write are
  // architecture/requirements.md and architecture/README.md; every other
  // design file (decisions/*, data-model.md, api.md, ...) is refused. Stops
  // "raced through three interview topics, then dumped the whole package in
  // one turn".
  private interviewDoneDeclared = false;

  // 047 Phase 3 — orchestration run state. Session-scoped, so "build the plan"
  // can span turns against one running total. `killed` is the kill switch;
  // once set, no further builders dispatch and nothing resumes on its own.
  private readonly orchestration = { subagents: 0, tokens: 0, killed: false };

  constructor(options: SessionOptions) {
    this.id = options.sessionId;
    this.projectId = options.projectId;
    this.options = options;

    const provider = (options.providerFactory ?? createProvider)({
      provider: options.provider,
      model: options.model,
      apiKey: options.apiKey,
      ...(options.authMode ? { authMode: options.authMode } : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    });

    this.conversation = provider.createConversation({
      systemPrompt: buildSystemPrompt({
        projectName: options.projectName,
        template: options.template,
        skills: options.skills,
        ...(options.engineerMode ? { engineerMode: { skill: options.engineerModeSkill } } : {}),
        ...(options.architectMode ? { architectMode: { skill: options.architectModeSkill } } : {}),
      }),
      // Architect Mode gets dispatch_task on top of the standard set — it is
      // the only way that mode, which cannot write code, gets code written.
      tools: toolDefinitions(options.architectMode ? [...ALL_TOOLS, dispatchTaskTool] : ALL_TOOLS),
      effort: options.effort,
      history: (options.history ?? [])
        .filter(
          (message) =>
            message.role !== "system" && (message.content.trim() || message.toolCalls?.length),
        )
        .map((message) => ({
          role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: message.content,
          toolCalls: message.toolCalls,
        })),
    });

    // A resumed Architect session whose history already contains a
    // package-ready or drift-review declaration is treated as "ready" from
    // turn 0 — the user's first message in the new session can be "build it".
    if (
      options.architectMode &&
      (options.history ?? []).some(
        (m) =>
          m.role === "assistant" &&
          (m.content.includes(ARCHITECT_READY_MARKER) ||
            m.content.includes(ARCHITECT_DRIFT_MARKER)),
      )
    ) {
      this.readyDeclaredAtTurn = 0;
    }

    // A resumed Architect session whose history shows the interview was
    // already closed keeps the design files unlocked.
    if (
      options.architectMode &&
      ((options.history ?? []).some(
        (m) => m.role === "assistant" && m.content.includes(ARCHITECT_INTERVIEW_DONE_MARKER),
      ) ||
        this.readyDeclaredAtTurn === 0)
    ) {
      this.interviewDoneDeclared = true;
    }
  }

  get state() {
    return {
      sessionId: this.id,
      projectId: this.projectId,
      provider: this.options.provider,
      model: this.options.model,
      effort: this.options.effort,
      engineerMode: this.options.engineerMode ?? false,
      architectMode: this.options.architectMode ?? false,
      authMode: this.options.authMode ?? "api_key",
      busy: this.busy,
      turns: this.turns,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
    };
  }

  abort(): void {
    this.abortController?.abort();
  }

  /** 047 Phase 3 — the kill switch. Stops any further builder dispatch on this
   * session; a stopped run does not resume on its own. Also aborts the current
   * turn so a mid-orchestration stop takes effect now. */
  stopOrchestration(): void {
    this.orchestration.killed = true;
    this.abortController?.abort();
  }

  get orchestrationState() {
    return {
      subagents: this.orchestration.subagents,
      tokens: this.orchestration.tokens,
      killed: this.orchestration.killed,
      subagentCap: ORCH_MAX_SUBAGENTS,
      tokenCap: ORCH_MAX_TOKENS,
    };
  }

  /**
   * 047 Phase 3a/3b/3e/3f — run one build-plan task in a fresh, bounded
   * Engineer-Mode child session against this same project, and hand its
   * result back to the Architect. Never recurses: a child is Engineer Mode,
   * which has no `dispatch_task`. Hard caps: 25 turns, 200k tokens, 5 min per
   * child; 20 children and 2M tokens per orchestration run.
   */
  private async dispatchBuildTask(
    raw: Record<string, unknown>,
    parentSignal: AbortSignal,
    onFileChanged: (path: string) => void,
  ): Promise<ToolResult> {
    const parsed = dispatchTaskTool.schema.safeParse(raw);
    if (!parsed.success) {
      return {
        output: `dispatch_task: invalid input — ${parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
          .join("; ")}`,
        isError: true,
      };
    }
    const input = parsed.data;

    if (!this.options.architectMode) {
      return { output: "dispatch_task is only available in Architect Mode.", isError: true };
    }

    // The real gate: the user must have seen a finished plan and come back to
    // approve it. That means (1) the Architect declared the package ready in
    // an earlier turn, AND (2) at least one user turn has happened since. The
    // Architect writing the whole package and "build it" in one breath fails
    // both. A resumed session with a ready/drift declaration in its history
    // starts at readyDeclaredAtTurn = 0, so the user's first "build it" there
    // passes. A filesystem sanity check on top: build-plan.md must exist.
    if (this.readyDeclaredAtTurn === null) {
      return {
        output:
          "Cannot dispatch — you have not declared the package ready yet. Finish the interview, write " +
          `the full package (decisions, data-model, api, infrastructure, build-plan, risks), run the ` +
          `challenge pass, and write the "${ARCHITECT_READY_MARKER}" line. Then the user reviews it and ` +
          "tells you to build.",
        isError: true,
      };
    }
    if (this.turns <= this.readyDeclaredAtTurn) {
      return {
        output:
          "Cannot dispatch in the same turn you declared the package ready. Stop here, present the plan, " +
          "and wait for the user to review it and say to build. Building is never automatic.",
        isError: true,
      };
    }
    const packageState = await this.architecturePackageState();
    if (!packageState.ready) {
      return {
        output: `Cannot dispatch — ${packageState.reason} Finish the package first.`,
        isError: true,
      };
    }

    if (this.orchestration.killed || parentSignal.aborted) {
      return {
        output: "The orchestration run was stopped. No further builders will dispatch.",
        isError: true,
      };
    }
    if (this.orchestration.subagents >= ORCH_MAX_SUBAGENTS) {
      return {
        output: `Orchestration cap reached: ${ORCH_MAX_SUBAGENTS} builders already dispatched this run. Stop and report to the user — do not dispatch more.`,
        isError: true,
      };
    }
    if (this.orchestration.tokens >= ORCH_MAX_TOKENS) {
      return {
        output: `Orchestration token ceiling reached (~${(ORCH_MAX_TOKENS / 1e6).toFixed(1)}M). Stop and report to the user — do not dispatch more.`,
        isError: true,
      };
    }

    const n = ++this.orchestration.subagents;
    const model = modelForTier(
      input.modelTier,
      this.options.provider,
      this.options.model,
      describeAvailableModels(),
    );

    const child = new AgentSession({
      sessionId: `${this.id}#sub${n}`,
      projectId: this.projectId,
      projectName: this.options.projectName,
      template: this.options.template,
      provider: this.options.provider,
      model,
      effort: this.options.effort,
      apiKey: this.options.apiKey,
      ...(this.options.authMode ? { authMode: this.options.authMode } : {}),
      ...(this.options.baseUrl ? { baseUrl: this.options.baseUrl } : {}),
      runtime: this.options.runtime,
      maxIterations: SUBAGENT_MAX_TURNS,
      engineerMode: true,
      ...(this.options.engineerModeSkill
        ? { engineerModeSkill: this.options.engineerModeSkill }
        : {}),
      ...(this.options.providerFactory ? { providerFactory: this.options.providerFactory } : {}),
      ...(this.options.resolveSkillBody ? { resolveSkillBody: this.options.resolveSkillBody } : {}),
      skills: this.options.skills,
    });

    const rolePrefix = input.role ? `You are the ${input.role} for this project. ` : "";
    const filesLine = input.files?.length
      ? `\n\nExpected files: ${input.files.join(", ")}. Do not create files beyond what this task needs.`
      : "";
    const prompt =
      `${rolePrefix}Build exactly this one task and nothing else. Do not re-plan, do not expand scope.\n\n` +
      `TASK:\n${input.task}\n\nDONE WHEN:\n${input.acceptanceCriteria}${filesLine}\n\n` +
      "When finished, state briefly what you changed and whether the acceptance criteria are met.";

    let reply = "";
    let tokIn = 0;
    let tokOut = 0;
    let rounds = 0;
    let hitTurnCap = false;
    const changed = new Set<string>();
    const wallclock = setTimeout(() => child.abort(), SUBAGENT_WALLCLOCK_MS);
    const onParentAbort = () => child.abort();
    parentSignal.addEventListener("abort", onParentAbort);
    const startedAt = Date.now();
    try {
      await child.run(prompt, (e) => {
        if (e.type === "text.delta") reply += e.text;
        if (e.type === "usage") {
          tokIn = e.tokensIn;
          tokOut = e.tokensOut;
          rounds += 1;
          if (tokIn + tokOut > SUBAGENT_MAX_TOKENS) child.abort();
        }
        if (e.type === "files.changed") {
          for (const p of e.paths) {
            changed.add(p);
            onFileChanged(p);
          }
        }
        if (e.type === "turn.end" && e.stopReason === "end_turn" && rounds >= SUBAGENT_MAX_TURNS) {
          hitTurnCap = true;
        }
      });
    } finally {
      clearTimeout(wallclock);
      parentSignal.removeEventListener("abort", onParentAbort);
    }

    this.orchestration.tokens += tokIn + tokOut;
    const secs = Math.round((Date.now() - startedAt) / 1000);
    const capNote = hitTurnCap
      ? " — HIT the 25-turn cap, result may be incomplete."
      : tokIn + tokOut > SUBAGENT_MAX_TOKENS
        ? " — HIT the 200k-token cap, result may be incomplete."
        : secs >= SUBAGENT_WALLCLOCK_MS / 1000
          ? " — HIT the 5-minute cap, result may be incomplete."
          : "";
    const filesChanged = [...changed];
    return {
      output:
        `Builder #${n} finished${capNote}\n` +
        `model: ${model} · rounds: ${rounds} · tokens: ${tokIn + tokOut} · ${secs}s\n` +
        `files changed (${filesChanged.length}): ${filesChanged.join(", ") || "(none)"}\n` +
        `run total so far: ${this.orchestration.subagents}/${ORCH_MAX_SUBAGENTS} builders, ` +
        `${this.orchestration.tokens} tokens\n\n` +
        `Builder's report:\n${reply.slice(0, 3000)}\n\n` +
        "Review the changed files. Mark the task done in build-plan.md, then dispatch the next one — " +
        "or stop and report if a cap was hit or the result is wrong.",
    };
  }

  /**
   * Runs one user turn to completion, emitting events as it goes. Resolves when
   * the model stops asking for tools, the user aborts, or the iteration cap is
   * reached — expected failures become `error` events rather than throwing.
   */
  async run(
    userMessage: string,
    emit: Emit,
    attachments?: PromptAttachment[],
    skillNames?: string[],
    pluginNames?: string[],
  ): Promise<void> {
    if (this.busy) {
      emit({
        type: "error",
        sessionId: this.id,
        code: "conflict",
        message: "This session is already running a turn.",
        fatal: false,
      });
      return;
    }

    this.busy = true;
    this.turns += 1;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const messageId = newId("message");
    const changedFiles = new Set<string>();
    // Set whenever a file changes, cleared once a check has actually run —
    // survives across iterations, unlike changedFiles itself, so the check
    // at the bottom of this loop knows whether anything has changed since
    // the last one, not just in the iteration that just finished.
    let verificationNeeded = false;
    // ZED-0001, Phase 1's structural anchor. Unlike `changedFiles`, never
    // cleared — this asks "did anything change at all this turn", not
    // "since the last check". `purposeCheckDone` bounds the hand-back to
    // once, the same reason the entry calls this a shape check: retrying
    // forever on a model that just never adds the marker would be worse
    // than accepting one uncorrected turn.
    let anyFileChangedThisTurn = false;
    let purposeCheckDone = false;
    // Found live: a turn that keeps calling tools every single iteration
    // never reaches either check above, or the loop's own normal exit —
    // it just falls out when `iteration` reaches `maxIterations`, whatever
    // `assistantText` happens to hold at that point. On a run that spent
    // its whole per-turn budget on tool calls and never got to write a
    // final message, that's nothing — the user is left staring at a blank
    // reply after real work actually happened. `stoppedByBreak` tells the
    // two paths apart: set at both of the loop's own internal `break`s
    // (a refusal, and the ordinary "nothing left to do" exit) so the code
    // after the loop can tell "the model chose to stop" from "the budget
    // ran out mid-work" and only synthesize a fallback in the latter case,
    // or whenever the model's own text is empty regardless of why.
    let stoppedByBreak = false;
    // A refusal already carries its own `error` event with the model's own
    // reason — the fallback synthesis below must not run on top of it
    // (peer review: a refusal was getting a "finished without providing a
    // summary" body underneath it, which reads as a quiet normal ending
    // sitting under a refusal banner, not the actual explanation for why
    // nothing happened). Also lets `turn.end`'s own `stopReason` say
    // "refusal" honestly instead of the generic "end_turn".
    let refused = false;
    // Structural cap on invented scope, added after a live incident — see
    // ZED-0001's incident addendum. `020` in the council notes already
    // measured correct decomposition for a reasonably-scoped small feature
    // at 6-7 files; a vague prompt that turns into three imagined
    // subsystems blows past that by an order of magnitude before anything
    // stops it. Distinct genuinely-new paths — a file that already existed
    // before this turn started never counts, no matter which tool touches
    // it, so a legitimate rewrite of App.tsx is never mistaken for
    // invented scope.
    //
    // A second live incident, on a legitimate, well-specified request
    // (a four-resource admin dashboard), showed the first version of this
    // fix was still wrong in a different way: refusing only the write that
    // crosses the checkpoint, while leaving `edit_file` and everything
    // else open, does not stop the model — it just removes the option to
    // decompose properly. Blocked from creating a seventh honestly-named
    // component, it crammed six components' worth of code into the one
    // file it could still touch, growing App.tsx to hundreds of lines
    // rather than actually stopping. `checkpointReached` fixes this by
    // ending the turn's ability to change anything at all, not just create
    // new files, the moment the checkpoint is hit — the model's only
    // remaining job is to say what it built and stop, the same way a
    // human engineer checks in before continuing a large task rather than
    // forcing everything already planned into whatever is left open.
    // Reaching the checkpoint is expected on real, larger work, not a
    // failure — the user's next prompt is what continues it, with a fresh
    // per-turn budget of its own.
    const NEW_FILE_CHECKPOINT = 6;
    const newFilesThisTurn = new Set<string>();
    let checkpointReached = false;
    const existingFilesAtTurnStart =
      this.options.engineerMode || this.options.architectMode
        ? await this.listAllFilePaths()
        : new Set<string>();
    // Architect Mode: at most this many genuinely-new files under
    // `architecture/` per turn. The design and the interview are meant to be
    // incremental — a whole package produced in one turn is the "built it all
    // by itself" failure. New paths only; editing what already exists is
    // unlimited.
    const ARCHITECT_NEW_FILES_PER_TURN = 4;
    const newArchFilesThisTurn = new Set<string>();
    // Architect Mode: when the user opens their message by telling the
    // Architect to stop, wait, pause, or hold on, no builder is dispatched
    // that turn — dispatch is expensive and hard to undo, so "stop" always
    // wins over it. Writing is NOT frozen: the Architect should still be able
    // to record where things stand or drop a handoff brief into
    // requirements.md. Everything else about a stop — explaining that the
    // plan is unfinished, and, if the user insists on skipping it, telling
    // them plainly they want the Engineer not the Architect and how to switch
    // — is the model's job, guided by the prompt, not a code-level refusal.
    // Matched at the start of the message only, so "don't forget the auth
    // flow" mid-sentence is not a halt.
    const isHaltRequest =
      !!this.options.architectMode &&
      /^\s*(?:stop|wait|hold on|hold up|pause|halt|don'?t\b|no,?\s*(?:stop|wait|don'?t))\b/i.test(
        userMessage,
      );
    const toolCalls: ToolCall[] = [];
    let assistantText = "";
    let thinkingText = "";

    emit({ type: "turn.start", sessionId: this.id, messageId, at: new Date().toISOString() });

    // Guaranteed, not offered — see `044`. Woven into what the model sees,
    // the same way attachment text already is by the time this reaches the
    // agent at all; the transcript's own record of what was typed is a
    // server-side concern, untouched by this. Plugins wrap first (innermost,
    // closest to the original message) since a plugin pick is only ever a
    // one-line instruction, not real content — skills then wrap the whole
    // thing so their full bodies read first.
    const withPluginInstruction = pluginNames?.length
      ? withPlugins(userMessage, pluginNames)
      : userMessage;
    const messageForModel =
      skillNames?.length && this.options.resolveSkillBody
        ? withSkills(withPluginInstruction, skillNames, this.options.resolveSkillBody)
        : withPluginInstruction;

    this.conversation.addUserMessage(messageForModel, attachments);

    const toolContext: ToolContext = {
      projectId: this.projectId,
      runtime: this.options.runtime,
      signal,
      onFileChanged: (path) => changedFiles.add(path),
      log: () => undefined,
    };

    try {
      for (let iteration = 0; iteration < this.options.maxIterations; iteration++) {
        if (signal.aborted) break;

        const turn = this.conversation.stream(signal);
        let next = await turn.next();
        while (!next.done) {
          const event = next.value;
          if (event.type === "text") {
            assistantText += event.text;
            emit({ type: "text.delta", sessionId: this.id, messageId, text: event.text });
          } else {
            thinkingText += event.text;
            emit({ type: "thinking.delta", sessionId: this.id, messageId, text: event.text });
          }
          next = await turn.next();
        }

        const result = next.value;
        this.tokensIn += result.usage.inputTokens;
        this.tokensOut += result.usage.outputTokens;
        emit({
          type: "usage",
          sessionId: this.id,
          tokensIn: this.tokensIn,
          tokensOut: this.tokensOut,
        });

        if (result.stopReason === "refusal") {
          emit({
            type: "error",
            sessionId: this.id,
            code: "refusal",
            message: `The model declined this request${
              result.refusalReason ? ` (${result.refusalReason})` : ""
            }.`,
            fatal: false,
          });
          stoppedByBreak = true;
          refused = true;
          break;
        }

        if (result.toolCalls.length === 0) {
          if (verificationNeeded) {
            verificationNeeded = false;
            const check = await this.needsVerification(toolContext);
            if (check) {
              const call: ToolCall = { id: newId("tool"), name: "verify", input: {} };
              emit({ type: "tool.start", sessionId: this.id, messageId, call });
              const startedAt = Date.now();
              const outcome = await this.runVerification(toolContext, check);
              const finished: ToolCall = {
                ...call,
                result: outcome.output.slice(0, 4000),
                isError: outcome.failed,
                durationMs: Date.now() - startedAt,
              };
              emit({ type: "tool.end", sessionId: this.id, messageId, call: finished });
              toolCalls.push(finished);

              if (outcome.failed) {
                this.conversation.addUserMessage(
                  `Automatic verification found a problem before this turn ended:\n\n${outcome.output}\n\n` +
                    "Fix it, or explain why you can't, before finishing.",
                );
                continue;
              }
            }
          }

          // ZED-0001, Phase 1's structural anchor — see Proposed decision
          // point 3. A shape check, not a semantic one: this confirms the
          // marker is present somewhere in what the model said this turn,
          // never that the sentence after it is actually a good account of
          // the turn's purpose. Checked against the whole turn's
          // accumulated text rather than isolating one "final" message,
          // since iterations don't mark that boundary today — a simpler,
          // honestly-described check over a more precise one that would
          // need new bookkeeping to earn.
          if (
            this.options.engineerMode &&
            anyFileChangedThisTurn &&
            !purposeCheckDone &&
            !assistantText.includes(ENGINEER_MODE_PURPOSE_MARKER)
          ) {
            purposeCheckDone = true;
            this.conversation.addUserMessage(
              `Engineer Mode is on and this turn changed files, but your message never stated the ` +
                `turn's purpose. Start your final message with a line beginning exactly ` +
                `"${ENGINEER_MODE_PURPOSE_MARKER}" followed by one or two sentences on what you understood ` +
                'the goal to be and what "done" means here.',
            );
            continue;
          }
          stoppedByBreak = true;
          break;
        }

        // Tool calls in one assistant turn are independent: run them
        // concurrently and return every result together.
        const results = await Promise.all(
          result.toolCalls.map(async (toolCall) => {
            const call: ToolCall = {
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.input,
            };
            // The user hit stop while this batch was being prepared — do not
            // start any tool that has not already begun. The loop's own
            // top-of-iteration check would only catch this a round later.
            if (signal.aborted) {
              return {
                id: toolCall.id,
                name: toolCall.name,
                output: "Stopped by the user before this tool ran.",
                isError: true,
                images: undefined,
              };
            }
            emit({ type: "tool.start", sessionId: this.id, messageId, call });

            const startedAt = Date.now();
            // Structural scope cap — see the NEW_FILE_CHECKPOINT comment
            // above. Checked before the real tool runs, not after: once
            // the cap is hit this turn, it stays hit — no reopening it by
            // waiting a round, and no relying on the model reading a
            // warning and choosing to comply. `write_file` on a file that
            // already existed before this turn (including one already
            // created earlier this same turn) never counts toward the
            // cap — only a path that is genuinely new does.
            const path =
              toolCall.name === "write_file" &&
              typeof toolCall.input.path === "string" &&
              !existingFilesAtTurnStart.has(toolCall.input.path)
                ? toolCall.input.path
                : undefined;
            // Once the checkpoint is reached, every tool that changes the
            // project is refused, not only further new files — see the
            // checkpointReached comment above for why leaving `edit_file`
            // and `run_command` open the first time this shipped just
            // moved where the model crammed its remaining work, not
            // whether it did. Read-only tools (`read_file`, `list_files`,
            // `search_files`, preview inspection) stay available so the
            // model can still write an accurate summary of what exists.
            const blockedByCheckpoint =
              this.options.engineerMode &&
              checkpointReached &&
              MUTATING_TOOL_NAMES.has(toolCall.name);
            const newFileCapped =
              this.options.engineerMode &&
              !blockedByCheckpoint &&
              path !== undefined &&
              !newFilesThisTurn.has(path) &&
              newFilesThisTurn.size >= NEW_FILE_CHECKPOINT;
            if (newFileCapped) checkpointReached = true;
            if (path !== undefined && !newFileCapped && !blockedByCheckpoint) {
              newFilesThisTurn.add(path);
            }
            const capped = blockedByCheckpoint || newFileCapped;
            // Architect Mode per-turn new-file cap: at most
            // ARCHITECT_NEW_FILES_PER_TURN genuinely-new files under
            // `architecture/`. Forces the interview and the design to be
            // incremental instead of a one-turn package dump. Editing files
            // that already exist is not capped.
            const archNewPath =
              this.options.architectMode &&
              toolCall.name === "write_file" &&
              typeof toolCall.input.path === "string" &&
              toolCall.input.path.startsWith(ARCHITECT_WRITE_ROOT) &&
              !existingFilesAtTurnStart.has(toolCall.input.path) &&
              !newArchFilesThisTurn.has(toolCall.input.path)
                ? toolCall.input.path
                : undefined;
            const architectFileCapped =
              archNewPath !== undefined &&
              newArchFilesThisTurn.size >= ARCHITECT_NEW_FILES_PER_TURN;
            if (archNewPath !== undefined && !architectFileCapped) {
              newArchFilesThisTurn.add(archNewPath);
            }
            // 048 — Architect Mode plans only. Refuse execution tools and any
            // write outside `architecture/`, at the boundary, before the real
            // tool runs.
            const architectBlock = this.options.architectMode
              ? architectModeBlock(toolCall.name, toolCall.input as Record<string, unknown>)
              : null;
            // The user opened this turn telling the Architect to stop — do
            // not spawn a builder, whatever the model asked for. Writes are
            // left alone (see the isHaltRequest comment).
            const haltBlocked = isHaltRequest && toolCall.name === "dispatch_task";
            // Interview not closed yet: the only package files that may be
            // written are requirements.md and README.md.
            const archInterviewPath =
              typeof (toolCall.input as { path?: unknown }).path === "string"
                ? (toolCall.input as { path: string }).path
                : "";
            const architectInterviewGated =
              !!this.options.architectMode &&
              !this.interviewDoneDeclared &&
              (toolCall.name === "write_file" || toolCall.name === "edit_file") &&
              archInterviewPath.startsWith(ARCHITECT_WRITE_ROOT) &&
              !ARCHITECT_INTERVIEW_WRITABLE.has(archInterviewPath);
            const outcome = haltBlocked
              ? {
                  output:
                    "The user asked you to stop, so no builder is being dispatched. Talk to them: say " +
                    "where the plan stands and what is still unfinished. If they are insisting you build " +
                    "it anyway, tell them plainly that what they want now is the Engineer, not the " +
                    "Architect — you design and do not write application code — and walk them through the " +
                    "switch (turn Architect Mode off with the compass button, turn Engineer Mode on with " +
                    "the hard-hat button, describe what they want built). Do not keep interviewing or " +
                    "designing after that; the decision is theirs to act on.",
                  isError: true,
                }
              : architectInterviewGated
                ? {
                    output:
                      `The interview is not closed yet, so "${archInterviewPath}" is refused. During the ` +
                      "interview you may write only architecture/requirements.md and architecture/README.md. " +
                      "Do not just retry — talk to the user: tell them which topics are still open and that " +
                      "finishing them is what keeps the build from guessing wrong. If they want to skip the " +
                      "plan entirely, point them to the Engineer (compass button off, hard-hat button on). " +
                      "Otherwise keep asking one topic per turn, and when every topic is covered (or they " +
                      `say to proceed) write a line beginning exactly "${ARCHITECT_INTERVIEW_DONE_MARKER}" — ` +
                      "after that the decisions, data model, API, and build plan open up.",
                    isError: true,
                  }
                : architectFileCapped
                  ? {
                      output:
                        `Architect Mode created ${ARCHITECT_NEW_FILES_PER_TURN} new files under ` +
                        `${ARCHITECT_WRITE_ROOT} this turn — refusing another ("${archNewPath}"). ` +
                        "Stop here. Summarize what you wrote and, if you are still in the interview, ask " +
                        "the next question. The user's next message continues it with a fresh budget. The " +
                        "design is meant to be built up over several turns, not dumped in one.",
                      isError: true,
                    }
                  : toolCall.name === "dispatch_task"
                    ? await this.dispatchBuildTask(
                        toolCall.input as Record<string, unknown>,
                        signal,
                        toolContext.onFileChanged,
                      )
                    : architectBlock
                      ? {
                          output:
                            architectBlock === "exec"
                              ? `Architect Mode does not run commands or start previews — "${toolCall.name}" is ` +
                                "disabled for this session. You are planning, not building. Write the design into " +
                                `${ARCHITECT_WRITE_ROOT} and hand build-plan.md to the builder.`
                              : `Architect Mode may only write under ${ARCHITECT_WRITE_ROOT} — refusing "${toolCall.name}" ` +
                                `on "${String((toolCall.input as { path?: unknown }).path ?? "")}". Put the design in ` +
                                `${ARCHITECT_WRITE_ROOT}; the builder writes application code, not you.`,
                          isError: true,
                        }
                      : capped
                        ? {
                            output: newFileCapped
                              ? `Engineer Mode's ${NEW_FILE_CHECKPOINT}-file checkpoint was just reached — refusing to ` +
                                `create another new file ("${path}"). Nothing that changes the project will run for the ` +
                                "rest of this turn, not just new files. Stop here: your final message should summarize " +
                                "what exists so far, and if you're not certain this is actually what was asked, ask the " +
                                "question that would tell you. If this is genuinely larger, ongoing work, say so plainly " +
                                "— the user's next message continues it, with a fresh checkpoint of its own."
                              : `Engineer Mode's ${NEW_FILE_CHECKPOINT}-file checkpoint was already reached this turn — ` +
                                `refusing to run "${toolCall.name}". Nothing else will run this turn. Write your summary ` +
                                "now instead.",
                            isError: true,
                          }
                        : await executeTool(toolContext, toolCall.name, toolCall.input);
            const finished: ToolCall = {
              ...call,
              result: outcome.output.slice(0, 4000),
              isError: outcome.isError ?? false,
              durationMs: Date.now() - startedAt,
            };
            toolCalls.push(finished);
            emit({ type: "tool.end", sessionId: this.id, messageId, call: finished });

            return {
              id: toolCall.id,
              name: toolCall.name,
              output: outcome.output,
              isError: outcome.isError ?? false,
              images: outcome.images,
            };
          }),
        );

        this.conversation.addToolResults(results);

        // Closes the bypass a live incident found: `run_command` can write
        // a file through an arbitrary shell command just as well as
        // `write_file` can, and nothing above touches it — unless
        // `checkpointReached` already refused the call outright, which
        // only happens once this same check has already fired at least
        // once. The very first `run_command` that crosses the checkpoint
        // cannot be refused ahead of time — the files already exist by
        // the time the command finishes — so this is reactive: count
        // whatever appeared, and if that pushes past the checkpoint, set
        // `checkpointReached` so every mutating tool is refused from here
        // on, the same as the write_file path already does. A single
        // command that creates many files in one shot can still get past
        // the checkpoint before this catches up; the message telling the
        // model plainly what happened, and that nothing else will run
        // this turn, is the honest limit of what a check run only after
        // the fact can promise.
        if (
          this.options.engineerMode &&
          result.toolCalls.some((call) => call.name === "run_command")
        ) {
          const currentFiles = await this.listAllFilePaths();
          const newlyAppeared = [...currentFiles].filter(
            (filePath) =>
              !existingFilesAtTurnStart.has(filePath) &&
              !newFilesThisTurn.has(filePath) &&
              !GENERATED_LOCKFILE_NAMES.has(filePath),
          );
          if (newlyAppeared.length > 0) {
            const wasUnderCap = newFilesThisTurn.size < NEW_FILE_CHECKPOINT;
            for (const filePath of newlyAppeared) newFilesThisTurn.add(filePath);
            if (wasUnderCap && newFilesThisTurn.size >= NEW_FILE_CHECKPOINT) {
              checkpointReached = true;
              this.conversation.addUserMessage(
                `A shell command just created ${newlyAppeared.length} new file(s), bringing this turn's ` +
                  `total new files to ${newFilesThisTurn.size} — at or past the ${NEW_FILE_CHECKPOINT}-file ` +
                  "checkpoint. Nothing that changes the project will run for the rest of this turn, not just " +
                  "new files. Stop here: summarize what exists so far, and if you're not certain this is what " +
                  "was actually asked, ask the question that would tell you. If this is genuinely larger, " +
                  "ongoing work, say so plainly — the user's next message continues it, with a fresh " +
                  "checkpoint of its own.",
              );
            }
          }
        }

        if (changedFiles.size > 0) {
          verificationNeeded = true;
          anyFileChangedThisTurn = true;
          emit({ type: "files.changed", sessionId: this.id, paths: [...changedFiles] });
          changedFiles.clear();
        }
      }

      if (signal.aborted) {
        emit({ type: "aborted", sessionId: this.id, messageId });
        return;
      }

      // Found live: a 56-tool-call turn that legitimately built real
      // things still ended with a stored message of length zero, because
      // the loop above spent its whole budget on tool calls and never
      // reached a point where it could stop and ask the model to sum up.
      // This is the backstop — whatever the reason (the step budget ran
      // out mid-work, or a provider just returned nothing) the user never
      // sees a silent reply after real work happened.
      //
      // Independent review of the first version of this found two more
      // gaps in the same failure family, both fixed by the shape below:
      //
      // 1. Checking only "is the text empty" missed the near-miss case —
      //    a turn that says one stray sentence ("Working on it.") on an
      //    early iteration and then goes heads-down calling tools until
      //    the budget runs out hit the exact same user-visible failure
      //    (real work, no real account of it) but skipped the backstop
      //    entirely, since that one sentence made `assistantText`
      //    non-empty. Hitting the iteration cap now always appends the
      //    reconstructed summary, whether or not the model said something
      //    on the way — real text already said is kept, never discarded.
      //
      // 2. Whitespace-only text (a model that streamed nothing but blank
      //    lines) broke the exact invariant this exists to protect: the
      //    old code replaced `assistantText` outright, so the DB-persisted
      //    copy (built by the server's gateway from every `text.delta` it
      //    saw, whitespace included) and this event's own `message.content`
      //    disagreed. `addition` below is always appended with `+=`, never
      //    substituted, so the delta stream this emits and the final
      //    `assistantText` stay identical by construction — the same
      //    property `apps/server/src/ws/gateway.ts` needs.
      //
      // A refusal is deliberately excluded (`!refused`): its own `error`
      // event already carries the model's stated reason, and layering
      // "finished without providing a summary" underneath it would read
      // as a quiet normal ending sitting under a refusal banner.
      const hitIterationCap = !stoppedByBreak;
      const hasRealText = assistantText.trim().length > 0;
      let addition = "";
      if (!refused && hitIterationCap) {
        const summary = this.synthesizeFallbackSummary(toolCalls, true);
        addition = hasRealText ? `\n\n${summary}` : summary;
      } else if (!refused && !hasRealText) {
        addition = this.synthesizeFallbackSummary(toolCalls, false);
      }
      if (addition) {
        emit({ type: "text.delta", sessionId: this.id, messageId, text: addition });
        assistantText += addition;
      }

      // Record the turn on which the Architect first declared the package
      // ready. dispatch_task then needs a *later* user turn before it fires.
      if (
        this.options.architectMode &&
        this.readyDeclaredAtTurn === null &&
        assistantText.includes(ARCHITECT_READY_MARKER)
      ) {
        this.readyDeclaredAtTurn = this.turns;
      }

      // Once the Architect closes the interview, the design files unlock for
      // every following turn.
      if (
        this.options.architectMode &&
        !this.interviewDoneDeclared &&
        assistantText.includes(ARCHITECT_INTERVIEW_DONE_MARKER)
      ) {
        this.interviewDoneDeclared = true;
      }

      emit({
        type: "turn.end",
        sessionId: this.id,
        messageId,
        stopReason: refused ? "refusal" : hitIterationCap ? "max_iterations" : "end_turn",
        message: {
          id: messageId,
          sessionId: this.id,
          role: "assistant",
          content: assistantText,
          thinking: thinkingText || null,
          toolCalls,
          // The agent's own copy of the finished message — never carries
          // attachments of its own; those belong to the user message the
          // server already persisted, which this does not replace.
          attachments: [],
          tokensIn: this.tokensIn,
          tokensOut: this.tokensOut,
          createdAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      if (signal.aborted) {
        emit({ type: "aborted", sessionId: this.id, messageId });
        return;
      }
      emit({
        type: "error",
        sessionId: this.id,
        code: classifyProviderError(this.options.provider, error),
        message: describeProviderError(this.options.provider, error),
        fatal: false,
      });
    } finally {
      this.busy = false;
      this.abortController = null;
    }
  }

  /**
   * The backstop for a turn that ends with nothing to show for itself in
   * words, even though the tool calls themselves prove real work happened
   * — see the `hitIterationCap` comment above `turn.end`. Never claims to
   * be the model's own account: it says plainly that no summary was
   * given, and reconstructs a plain list of what actually ran from the
   * tool calls' own names and inputs. Deliberately mechanical rather than
   * a second model call — a turn that already spent its whole budget
   * calling tools should not spend more of it hoping for a summary this
   * time; a reconstructed list the user can trust is better than a maybe.
   */
  private synthesizeFallbackSummary(toolCalls: ToolCall[], hitIterationCap: boolean): string {
    const created = new Set<string>();
    const edited = new Set<string>();
    const deleted = new Set<string>();
    const commands: string[] = [];
    for (const call of toolCalls) {
      if (call.isError) continue;
      const path = typeof call.input.path === "string" ? call.input.path : undefined;
      if (call.name === "write_file" && path) created.add(path);
      else if (call.name === "edit_file" && path) edited.add(path);
      else if (call.name === "delete_file" && path) deleted.add(path);
      else if (call.name === "run_command" && typeof call.input.command === "string") {
        commands.push(call.input.command);
      }
    }

    const lines: string[] = [
      hitIterationCap
        ? "This turn hit its internal step limit before it could write a summary of what it did."
        : "This turn finished without providing a summary of what it did.",
      "Here's what changed, reconstructed from the tool calls that actually ran:",
    ];
    if (created.size > 0) lines.push(`- Created: ${[...created].join(", ")}`);
    if (edited.size > 0) lines.push(`- Edited: ${[...edited].join(", ")}`);
    if (deleted.size > 0) lines.push(`- Deleted: ${[...deleted].join(", ")}`);
    if (commands.length > 0) lines.push(`- Ran: ${commands.map((c) => `\`${c}\``).join(", ")}`);
    if (created.size === 0 && edited.size === 0 && deleted.size === 0 && commands.length === 0) {
      lines.push("- No changes were made.");
    }
    if (hitIterationCap) {
      lines.push(
        "There may be more left to do — say what you'd like next and it'll pick up from here.",
      );
    }
    return lines.join("\n");
  }

  /**
   * Every file path in the project, recursively — used only by Engineer
   * Mode's new-file checkpoint, to tell a genuinely new file apart from a
   * legitimate rewrite of something that was already there, no matter
   * which tool touches it. `listFiles`'s own default already excludes
   * `node_modules`, `.git`, and the rest of what the file tree hides.
   */
  private async listAllFilePaths(): Promise<Set<string>> {
    // `depth: 32` matches the "give me an actually complete listing"
    // convention `local.ts` already uses internally — the default (8)
    // would silently miss a pre-existing file nested deeper than that,
    // reopening exactly the bug this method exists to prevent.
    const entries = await this.options.runtime
      .listFiles(this.projectId, { depth: 32 })
      .catch(() => []);
    return new Set(entries.filter((entry) => entry.type === "file").map((entry) => entry.path));
  }

  /**
   * 047 Phase 3 — whether the architecture package is far enough along that a
   * task may be handed to a builder. A design that is still an interview has
   * no build-plan and no decision records; dispatching from it is the failure
   * this gate exists to stop. Checked against the filesystem, so it holds on a
   * fresh session and a resumed one alike.
   */
  private async architecturePackageState(): Promise<{ ready: boolean; reason: string }> {
    const files = await this.listAllFilePaths();
    if (!files.has(`${ARCHITECT_WRITE_ROOT}build-plan.md`)) {
      return { ready: false, reason: "There is no architecture/build-plan.md yet." };
    }
    const hasDecision = [...files].some(
      (p) => p.startsWith(`${ARCHITECT_WRITE_ROOT}decisions/`) && p.endsWith(".md"),
    );
    if (!hasDecision) {
      return { ready: false, reason: "architecture/decisions/ has no records yet." };
    }
    const plan = await this.options.runtime
      .readFile(this.projectId, `${ARCHITECT_WRITE_ROOT}build-plan.md`)
      .then((f) => f.content)
      .catch(() => "");
    // A stub or a heading with nothing under it is not a plan.
    if (plan.replace(/\s+/g, "").length < 120 || !/\bTask\b|\btask\b|^- /m.test(plan)) {
      return { ready: false, reason: "architecture/build-plan.md has no real tasks yet." };
    }
    return { ready: true, reason: "" };
  }

  /**
   * Whether there is anything for `runVerification` to actually do — checked
   * before emitting a `tool.start`, so a project with no typecheck/build
   * script and a preview that has not crashed produces no visible step at
   * all. Follows the same convention `detectDevCommand` uses for reading a
   * project's own `package.json` rather than assuming a command: a project
   * opened from someone's own repository is not guaranteed to have either
   * script, and guessing one is worse than checking nothing.
   */
  private async needsVerification(
    context: ToolContext,
  ): Promise<{ script: "typecheck" | "build" | null; crashedPreview: Preview | null } | null> {
    let script: "typecheck" | "build" | null = null;
    try {
      const pkg = await context.runtime.readFile(context.projectId, "package.json");
      const manifest = JSON.parse(pkg.content) as { scripts?: Record<string, string> };
      script = manifest.scripts?.typecheck ? "typecheck" : manifest.scripts?.build ? "build" : null;
    } catch {
      // No package.json, or it does not parse as one — nothing to typecheck.
    }

    const preview = await context.runtime.previewStatus(context.projectId).catch(() => null);
    const crashedPreview = preview?.status === "crashed" ? preview : null;

    if (!script && !crashedPreview) return null;
    return { script, crashedPreview };
  }

  /**
   * Runs the typecheck/build script this project actually declares, and
   * reads the preview's own log when it crashed. A preview that is merely
   * `"running"` is treated as passing — honestly, not as proof of
   * correctness: Vite recovers from many build errors without exiting, so
   * this catches a dead process, not every possible broken render.
   */
  private async runVerification(
    context: ToolContext,
    check: { script: "typecheck" | "build" | null; crashedPreview: Preview | null },
  ): Promise<{ output: string; failed: boolean }> {
    const parts: string[] = [];
    let failed = false;

    if (check.script) {
      const result = await context.runtime.exec(context.projectId, {
        command: `npm run ${check.script}`,
        timeoutMs: 120_000,
      });
      if (result.exitCode !== 0) {
        failed = true;
        const output = [result.stdout, result.stderr].filter((s) => s.trim()).join("\n");
        parts.push(`npm run ${check.script} failed (exit ${result.exitCode}):\n${output}`);
      }
    }

    if (check.crashedPreview) {
      failed = true;
      const logs = await context.runtime.previewLogs(context.projectId, 40);
      parts.push(
        `The preview crashed: ${check.crashedPreview.lastError ?? "unknown error"}\n\n${logs}`,
      );
    }

    return {
      failed,
      output: failed ? parts.join("\n\n") : "Typecheck and the preview both look fine.",
    };
  }
}
