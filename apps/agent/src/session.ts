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

// 050 R2.1 — the exact set of paths the Architect may write, derived from the
// 048 package contract. NOT "any .md under architecture/": arbitrary Markdown
// there is not inert everywhere (MDX compilation, raw-markdown imports, doc
// generators that glob `architecture/**/*.md`). `pending-skills/` is
// deliberately absent — self-authored capability is 047 Phase 3d, gated
// separately.
const ARCHITECT_PACKAGE_FILES = new Set([
  "architecture/README.md",
  "architecture/requirements.md",
  "architecture/data-model.md",
  "architecture/api.md",
  "architecture/infrastructure.md",
  "architecture/build-plan.md",
  "architecture/build-context.md",
  "architecture/risks.md",
]);
const ARCHITECT_DECISION_RE = /^architecture\/decisions\/\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const ARCHITECT_REPORT_PATH = "architecture/report.html";

/** True when a canonicalized Architect write path is one of the allowed
 * package artifacts. */
function isArchitectPackagePath(norm: string): boolean {
  return (
    ARCHITECT_PACKAGE_FILES.has(norm) ||
    norm === ARCHITECT_REPORT_PATH ||
    ARCHITECT_DECISION_RE.test(norm)
  );
}

/** 050 R2.3 — a fail-fast advisory scan of a complete report.html for active
 * or network-capable content. NOT a security boundary (a substring scan
 * cannot be one — see the proposal); the render-time sanitiser in PlanPanel
 * is the control. This just catches the obvious cases early so the Architect
 * gets told, and so a scripted file does not linger in the workspace.
 * Returns a short description of the first problem, or null if clean. */
function reportHtmlAdvisory(html: string): string | null {
  const s = html.toLowerCase();
  if (/<script[\s/>]/.test(s)) return "a <script> tag";
  if (/\son[a-z]+\s*=/.test(s)) return "an inline event handler (on…=)";
  if (/javascript:/.test(s)) return "a javascript: URL";
  if (/<(?:iframe|object|embed|form|base|link|meta[^>]+http-equiv)\b/.test(s))
    return "an active or embedding element";
  if (/(?:src|href|srcset|data|action|poster|xlink:href)\s*=\s*["']?\s*(?:https?:|\/\/)/.test(s))
    return "a remote resource URL";
  if (/(?:@import|url\(\s*["']?\s*(?:https?:|\/\/))/.test(s)) return "a remote CSS import or url()";
  return null;
}

/** Why `toolCall` is not allowed in Architect Mode, or null if it is:
 *  - "exec"     — an execution tool (run_command, start_preview)
 *  - "scope"    — a write whose canonicalized path is outside `architecture/`
 *  - "artifact" — a write under `architecture/` that is not an allowed
 *                 package file (050 R2.1)
 * Path is normalized first so `architecture/../src/x` and `./architecture/../x`
 * cannot slip through. */
function architectModeBlock(
  name: string,
  input: Record<string, unknown>,
): "exec" | "scope" | "artifact" | null {
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
    if (!isArchitectPackagePath(norm)) return "artifact";
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
// 051 Part B — Auto Mode's hard ceiling for ONE auto run. Any one hit stops
// the run; it hands back exactly like a manual pass-cap stop, with the
// actual totals. Deliberately low so a bad plan is a manageable bill.
const AUTO_MAX_PASSES = 6;
const AUTO_MAX_TOKENS = 6_000_000;
const AUTO_MAX_WALLCLOCK_MS = 30 * 60_000;

// A transient model failure (provider overloaded / rate-limited / connection
// dropped) is retried this many times, backing off 0.8s → 1.6s → 3.2s,
// before it surfaces as a visible error.
const MODEL_RETRY_MAX = 3;
const MODEL_RETRY_BASE_MS = 800;
// 049 Phase 1 — a builder takes at most this many named files. A task with
// more is refused at dispatch, forcing the Architect to split it before a
// bounded builder chokes on it.
const BUILDER_FILES_MAX = 5;

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
  /** 051 Part B — Auto Mode. Only honoured with `architectMode`. */
  autoMode?: boolean;
  /** 049 Phase 1 — the lean builder profile. A dispatched builder runs with
   * a compact hand-written system prompt (this field) instead of the full
   * `buildSystemPrompt` weave, and only the tools named in `toolNames`. Cuts
   * per-turn overhead so a whole build fits in the run budget. */
  systemPrompt?: string;
  toolNames?: string[];
  /** Overridable so tests can run the loop without a network or an API key. */
  providerFactory?: ProviderFactory;
}

// 049 Phase 1 — the only tools a dispatched builder gets. No plugin
// catalogue, no use_skill, no preview tools (the Architect owns the preview).
// Just enough to read the project, write code, and run a command.
const BUILDER_TOOL_NAMES = [
  "list_files",
  "read_file",
  "search_files",
  "write_file",
  "edit_file",
  "delete_file",
  "run_command",
];

// 051 Part A — the verifier dispatch gets the preview tools back on top of
// the builder set, plus whatever plugin tools the plan named for the checks.
const VERIFIER_EXTRA_TOOL_NAMES = ["start_preview", "preview_logs", "view_preview"];

// 049 Phase 1 — the builder's whole system prompt. It gets ONE specified task
// with acceptance criteria, a project brief, and a file map; it does not need
// the interview/scope-negotiation machinery of the full agent prompt.
const BUILDER_SYSTEM_PROMPT = `You are a builder on a software team. You are given ONE task from an approved build plan, with acceptance criteria, a project brief, and a list of files that already exist.

Do exactly that task:
- Read the brief and the relevant existing files before you write anything.
- Match the stack and conventions already in the project. Do not introduce a new framework, state library, or build tool.
- Write the code for this task and only this task. Do not build features the task does not name. Do not refactor unrelated code.
- Keep the project building. If there is a typecheck or build script, run it after your changes and fix what you broke. Install a dependency only if the task genuinely needs it.
- Wire your work in: if you add a component or module the app is meant to use, connect it to the entry point or the place the plan says it belongs — do not leave it orphaned.
- Never invent API keys, secrets, or backend URLs. Build against clearly-marked placeholder data and note what the user must supply.

When done, state in two or three sentences what you changed and whether each acceptance criterion is met. If you could not finish, say exactly what remains.`;

// 051 Part A — the verifier's whole system prompt. It runs AFTER the last
// build task: it does not build features, it checks the project is a
// complete, running, documented whole and writes the finishing files.
const VERIFIER_SYSTEM_PROMPT = `You are the verifier for a project a team of builders just finished. You do NOT build features. Your job is to confirm the project is a complete, running, documented whole — and to write the small set of project-level files a finished project needs.

Work through the Definition of Done you are given. For each item, actually check it:
- Run the build/typecheck/lint command the project declares. Record pass/fail with the real output.
- Start the preview and confirm it serves the actual app, not the starter template. Read preview_logs if it does not come up.
- Run each verification tool you were given (security scan, accessibility/design checks). Do not fix what they find — record each finding.
- Confirm the finishing files exist and are accurate against what was actually built, and create or correct them:
  - .env.example: every environment variable the project's code and the design need, one per line with a short comment, and NO real secret values.
  - README.md at the project root: what it is, how to run it, the env vars, the scripts, one paragraph on the architecture with a link to architecture/report.html. Replace any starter-template README.
  - the CI config the design calls for, only for a stack you have a safe template for, with a header comment saying it was generated from the design and is unverified on a real runner.
  - .gitignore additions for anything the build introduced that should not be committed.
- Triage every security-scan and design/a11y finding into architecture/risks.md under a dated "## Verification findings" heading — each with a one-line consequence and a decision (accept / must-fix / deferred).

Then return a COMPLETION CHECKLIST — one line per Definition-of-Done item, each marked PASS, FAIL, or N/A, with a one-line reason. Be honest: a FAIL is a FAIL. End with the preview URL if the app is running, or "preview not running: <reason>".`;

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

  // 050 R2.5 — the "Interview complete:" content check (a `blocked` status
  // row blocks the marker) fires at most once per session. After it has
  // refused and told the model why, a re-declared marker is honoured, so a
  // misformatted status table can never trap the user in a loop.
  private interviewCloseRefusedOnce = false;

  // 047 Phase 3 — orchestration run state. Session-scoped, so "build the plan"
  // can span turns against one running total. `killed` is the kill switch;
  // once set, no further builders dispatch and nothing resumes on its own.
  private readonly orchestration = {
    subagents: 0,
    tokens: 0,
    killed: false,
    // 049 Phase 1 — the first task of a build pass must produce a runnable
    // skeleton (app entry renders, build command passes). Enforced on the
    // first dispatch only.
    firstDispatchDone: false,
    // Cleared by a "keep going" user turn so the next pass gets a fresh
    // budget instead of dead-ending at the cap.
    pass: 1,
    // 051 Part B — Auto Mode run state.
    auto: false, // this session was created with autoMode + architectMode
    autoStartedAt: null as number | null,
    autoTokens: 0, // cumulative builder tokens across the whole auto run
    passCapHitThisTurn: false, // set when dispatch_task refuses at a pass cap
    changedEver: new Set<string>(), // every builder-changed path, for stuck-detection
    changedAtPassStart: 0,
    zeroProgressPasses: 0,
  };

  constructor(options: SessionOptions) {
    this.id = options.sessionId;
    this.projectId = options.projectId;
    this.options = options;
    this.orchestration.auto = Boolean(options.autoMode && options.architectMode);

    const provider = (options.providerFactory ?? createProvider)({
      provider: options.provider,
      model: options.model,
      apiKey: options.apiKey,
      ...(options.authMode ? { authMode: options.authMode } : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    });

    // 049 Phase 1 — a builder runs lean: its own compact prompt, and only
    // the file/shell tools. Everything else keeps the full weave.
    const leanBuilder = Boolean(options.systemPrompt && options.toolNames);
    const toolPool = leanBuilder
      ? ALL_TOOLS.filter((t) => options.toolNames?.includes(t.name))
      : options.architectMode
        ? [...ALL_TOOLS, dispatchTaskTool]
        : ALL_TOOLS;

    this.conversation = provider.createConversation({
      systemPrompt:
        options.systemPrompt ??
        buildSystemPrompt({
          projectName: options.projectName,
          template: options.template,
          skills: options.skills,
          ...(options.engineerMode ? { engineerMode: { skill: options.engineerModeSkill } } : {}),
          ...(options.architectMode
            ? { architectMode: { skill: options.architectModeSkill } }
            : {}),
        }),
      tools: toolDefinitions(toolPool),
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
      autoMode: this.orchestration.auto,
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

    // 051 Part A — the final verification & finishing dispatch. Exempt from
    // the runnable-first and file-count gates (it touches many project files
    // by design); gets the preview tools and the named plugin tools.
    const isVerify = input.verify === true;

    // 049 Phase 1 — task-size ceiling. A bounded builder cannot land a task
    // with a dozen files; refuse and make the Architect split it.
    if (!isVerify && input.files && input.files.length > BUILDER_FILES_MAX) {
      return {
        output:
          `This task names ${input.files.length} files — a builder takes at most ${BUILDER_FILES_MAX}. ` +
          "Split it in build-plan.md into smaller tasks (each self-contained, each with its own " +
          "acceptance criteria) and dispatch those.",
        isError: true,
      };
    }

    // 049 Phase 1 — the first task of a build pass must produce a runnable
    // skeleton: the app's entry point renders something and the build/dev
    // command passes. Keyed to that outcome in the acceptance criteria, not
    // to a hardcoded filename (a Node API or a CLI has no App.tsx).
    if (!isVerify && !this.orchestration.firstDispatchDone) {
      const ac = input.acceptanceCriteria.toLowerCase();
      const looksRunnable =
        /\b(build|dev server|typecheck|npm run|preview|start)\b/.test(ac) &&
        /\b(pass|passes|succeed|runs?|compiles?|renders?|no errors?|boots?|starts?)\b/.test(ac);
      const looksSkeleton =
        /\b(skeleton|walking skeleton|scaffold|app shell|entry point|renders)\b/.test(
          `${input.task} ${ac}`.toLowerCase(),
        );
      if (!looksRunnable && !looksSkeleton) {
        return {
          output:
            "The first build task must produce a RUNNABLE skeleton — the app's entry point mounts and " +
            "renders a real (if minimal) screen, and the build/dev command passes. Re-scope " +
            "build-plan.md so Task 1 is that walking skeleton (say so in its acceptance criteria), " +
            "then dispatch it. Every later task keeps the app running.",
          isError: true,
        };
      }
    }

    if (this.orchestration.subagents >= ORCH_MAX_SUBAGENTS) {
      this.orchestration.passCapHitThisTurn = true;
      return {
        output:
          `This build pass has dispatched ${ORCH_MAX_SUBAGENTS} builders. Stop here: in build-plan.md ` +
          "mark what is done, list the tasks left, and tell the user the app runs as far as it got and " +
          'to reply "keep going" for another pass (fresh budget) — or to take the remaining tasks to ' +
          "the Engineer themselves, one at a time.",
        isError: true,
      };
    }
    if (this.orchestration.tokens >= ORCH_MAX_TOKENS) {
      this.orchestration.passCapHitThisTurn = true;
      return {
        output:
          `This build pass hit its ~${(ORCH_MAX_TOKENS / 1e6).toFixed(1)}M-token budget. Stop here: in ` +
          "build-plan.md mark what is done and list the tasks left. Tell the user the app runs as far as " +
          'it got, and that replying "keep going" starts another pass with a fresh budget — or they can ' +
          "hand the remaining build-plan.md tasks to the Engineer, one at a time.",
        isError: true,
      };
    }

    const n = ++this.orchestration.subagents;
    this.orchestration.firstDispatchDone = true;
    const model = modelForTier(
      input.modelTier,
      this.options.provider,
      this.options.model,
      describeAvailableModels(),
    );

    // 049 Phase 1 — the shared build brief (written once by the Architect at
    // handoff) plus a compact map of what already exists, so the builder does
    // not spend its budget rediscovering the project every time.
    const buildContext = await this.readFileOrNull(`${ARCHITECT_WRITE_ROOT}build-context.md`);
    const existing = [...(await this.listAllFilePaths())]
      .filter((p) => !p.startsWith(ARCHITECT_WRITE_ROOT))
      .sort();
    const existingBlock = existing.length
      ? `\n\nFILES THAT ALREADY EXIST (do not recreate; read before you edit):\n${existing
          .slice(0, 200)
          .map((p) => `  ${p}`)
          .join("\n")}`
      : "\n\nThe project has no source files yet — you are laying the first ones.";

    // 051 Part A — inject the bodies of the skills the plan named for this
    // task. The lean builder has no use_skill tool, so it gets the text.
    const skillsBlock = (() => {
      const names = input.skills ?? [];
      if (!names.length || !this.options.resolveSkillBody) return "";
      const bodies = names
        .map((name) => {
          const body = this.options.resolveSkillBody?.(name)?.body;
          return body ? `### Skill: ${name}\n${body}` : "";
        })
        .filter(Boolean)
        .join("\n\n");
      return bodies ? `\n\nGUIDANCE FROM SKILLS THIS TASK NEEDS:\n${bodies.slice(0, 14000)}` : "";
    })();

    // 051 Part A — the verifier gets the preview tools and the plan's named
    // plugin tools on top of the builder set, and a longer wall-clock (build
    // + preview + several scans).
    const toolNames = isVerify
      ? [...BUILDER_TOOL_NAMES, ...VERIFIER_EXTRA_TOOL_NAMES, ...(input.tools ?? [])]
      : BUILDER_TOOL_NAMES;
    const wallclockMs = isVerify ? 10 * 60_000 : SUBAGENT_WALLCLOCK_MS;

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
      // 049 Phase 1 — lean profile: hand-written prompt, file/shell tools only.
      systemPrompt: isVerify ? VERIFIER_SYSTEM_PROMPT : BUILDER_SYSTEM_PROMPT,
      toolNames,
      ...(this.options.providerFactory ? { providerFactory: this.options.providerFactory } : {}),
    });

    const rolePrefix = input.role ? `You are the ${input.role} for this task. ` : "";
    const filesLine = input.files?.length
      ? `\n\n${isVerify ? "Files to check/write" : "Expected files (do not create others)"}: ${input.files.join(", ")}`
      : "";
    const briefBlock = buildContext
      ? `\n\nPROJECT BRIEF (stack, conventions, the shape of the design):\n${buildContext.slice(0, 8000)}`
      : "";
    const prompt = isVerify
      ? `${rolePrefix}Verify this project and write its finishing files. Do not build features.\n\n` +
        `DEFINITION OF DONE (check each item):\n${input.acceptanceCriteria}${filesLine}${briefBlock}${skillsBlock}${existingBlock}\n\n` +
        "Return the completion checklist as instructed."
      : `${rolePrefix}Build exactly this one task and nothing else. Do not re-plan or expand scope. ` +
        "Keep the app building after your change.\n\n" +
        `TASK:\n${input.task}\n\nDONE WHEN:\n${input.acceptanceCriteria}${filesLine}${briefBlock}${skillsBlock}${existingBlock}\n\n` +
        "When finished, state in two or three sentences what you changed and whether the acceptance " +
        "criteria are met.";

    let reply = "";
    let tokIn = 0;
    let tokOut = 0;
    let rounds = 0;
    let hitTurnCap = false;
    const changed = new Set<string>();
    const wallclock = setTimeout(() => child.abort(), wallclockMs);
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
            this.orchestration.changedEver.add(p);
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
    this.orchestration.autoTokens += tokIn + tokOut;
    const secs = Math.round((Date.now() - startedAt) / 1000);
    const capNote = hitTurnCap
      ? " — HIT the 25-turn cap, result may be incomplete."
      : tokIn + tokOut > SUBAGENT_MAX_TOKENS
        ? " — HIT the 200k-token cap, result may be incomplete."
        : secs >= wallclockMs / 1000
          ? ` — HIT the ${Math.round(wallclockMs / 60_000)}-minute cap, result may be incomplete.`
          : "";
    const filesChanged = [...changed];
    if (isVerify) {
      return {
        output:
          `Verification finished${capNote}\n` +
          `model: ${model} · rounds: ${rounds} · tokens: ${tokIn + tokOut} · ${secs}s\n` +
          `files written (${filesChanged.length}): ${filesChanged.join(", ") || "(none)"}\n\n` +
          `COMPLETION CHECKLIST (relay this to the user verbatim — do not summarise it into ` +
          `"all good"):\n${reply.slice(0, 4000)}\n\n` +
          "If any line is FAIL, the project is 'built, not cleared' on that point — say so plainly " +
          "and point the user at architecture/risks.md. Only claim 'done' for what the checklist " +
          "marked PASS.",
      };
    }
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
    // 051 Part B — this flag reflects only the turn about to run; Auto Mode
    // reads it after the turn to decide whether to start another pass.
    this.orchestration.passCapHitThisTurn = false;
    if (
      this.orchestration.auto &&
      this.orchestration.autoStartedAt === null &&
      this.readyDeclaredAtTurn !== null
    ) {
      this.orchestration.autoStartedAt = Date.now();
    }

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
    // 049 Phase 1 — "keep going" starts a fresh build pass: reset the run
    // budget so a build that stopped at the token cap can continue instead of
    // dead-ending. The kill switch is not reset by this.
    if (
      this.options.architectMode &&
      !this.orchestration.killed &&
      this.readyDeclaredAtTurn !== null &&
      /\b(keep going|carry on|continue building|next (build )?pass|finish the build|another pass)\b/i.test(
        userMessage,
      )
    ) {
      this.orchestration.tokens = 0;
      this.orchestration.subagents = 0;
      this.orchestration.pass += 1;
    }
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

        // A model call that comes back wrong transiently is retried a few
        // times with backoff before it becomes a visible error or a wasted
        // turn. Two shapes count as transient here:
        //   - it THREW: the provider is overloaded ("experiencing high
        //     demand"), rate-limited, or the connection dropped;
        //   - it returned NOTHING: no text, no tool calls, not a refusal —
        //     an empty completion, which is almost always a provider hiccup
        //     and otherwise leaves the user staring at "No changes were
        //     made" with no way forward (found live: the Architect stalled
        //     mid-package, every "proceed" producing an empty turn).
        // Only retried while this attempt has streamed nothing, so a
        // mid-stream failure or a real prose answer is never re-run.
        const result = await (async () => {
          for (let attempt = 0; ; attempt++) {
            let streamedThisAttempt = false;
            const backoff = async (why: string): Promise<void> => {
              const waitMs = MODEL_RETRY_BASE_MS * 2 ** attempt;
              emit({
                type: "error",
                sessionId: this.id,
                code: "retrying",
                message: `${why} — retrying (${attempt + 1}/${MODEL_RETRY_MAX}) in ${Math.round(
                  waitMs / 1000,
                )}s…`,
                fatal: false,
              });
              await new Promise((r) => setTimeout(r, waitMs));
            };
            try {
              const turn = this.conversation.stream(signal);
              let next = await turn.next();
              while (!next.done) {
                const event = next.value;
                streamedThisAttempt = true;
                if (event.type === "text") {
                  assistantText += event.text;
                  emit({ type: "text.delta", sessionId: this.id, messageId, text: event.text });
                } else {
                  thinkingText += event.text;
                  emit({ type: "thinking.delta", sessionId: this.id, messageId, text: event.text });
                }
                next = await turn.next();
              }
              const value = next.value;
              const emptyCompletion =
                !streamedThisAttempt &&
                value.toolCalls.length === 0 &&
                value.stopReason !== "refusal";
              if (emptyCompletion && !signal.aborted && attempt < MODEL_RETRY_MAX) {
                await backoff("The model returned an empty response");
                continue;
              }
              return value;
            } catch (err) {
              const code = classifyProviderError(this.options.provider, err);
              const transient =
                code === "model_error" || code === "rate_limited" || code === "connection";
              if (
                !transient ||
                streamedThisAttempt ||
                signal.aborted ||
                attempt >= MODEL_RETRY_MAX
              ) {
                throw err;
              }
              await backoff(describeProviderError(this.options.provider, err));
            }
          }
        })();
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
            // 049 Phase 1 — a lean builder already has one specified task; the
            // "state the purpose" hand-back is Engineer-Mode-for-a-human noise
            // here.
            !this.options.systemPrompt &&
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

        // 050 R2.5 — if the Architect declared the interview complete earlier
        // in THIS turn, unlock the design files now so it can start the
        // package in the same turn instead of needing another round.
        if (
          this.options.architectMode &&
          !this.interviewDoneDeclared &&
          assistantText.includes(ARCHITECT_INTERVIEW_DONE_MARKER)
        ) {
          const close = await this.validateInterviewClose();
          if (close.ok) {
            this.interviewDoneDeclared = true;
          } else if (!this.interviewCloseRefusedOnce) {
            this.interviewCloseRefusedOnce = true;
            this.conversation.addUserMessage(
              `The "${ARCHITECT_INTERVIEW_DONE_MARKER}" line was not accepted: ${close.reason} ` +
                "The design files stay locked until that is fixed.",
            );
          }
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
            // 050 R2.2 — a write/edit to architecture/report.html is checked
            // on the COMPLETE resulting file, not the tool input, so active
            // content cannot be assembled across edit_file calls or survive
            // from a prior version. Snapshot the current file first so a
            // failed check rolls back.
            const isReportWrite =
              this.options.architectMode &&
              architectBlock === null &&
              (toolCall.name === "write_file" || toolCall.name === "edit_file") &&
              typeof (toolCall.input as { path?: unknown }).path === "string" &&
              pathPosix.normalize((toolCall.input as { path: string }).path) ===
                ARCHITECT_REPORT_PATH;
            const reportPriorContent = isReportWrite
              ? await this.readFileOrNull(ARCHITECT_REPORT_PATH)
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
            const preOutcome = haltBlocked
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
                              : architectBlock === "artifact"
                                ? `Architect Mode writes only the design package under ${ARCHITECT_WRITE_ROOT} — refusing ` +
                                  `"${String((toolCall.input as { path?: unknown }).path ?? "")}". Allowed: README.md, ` +
                                  "requirements.md, data-model.md, api.md, infrastructure.md, build-plan.md, risks.md, " +
                                  "decisions/NNNN-<slug>.md, and report.html. Nothing else — no config, no code, no scripts."
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
            // 050 R2.2/R2.3 — validate the whole report.html after the write.
            // This is a fail-fast advisory (the render-time sanitiser in
            // PlanPanel is the authoritative control); on a trip it rolls the
            // file back and tells the model why.
            const outcome =
              isReportWrite && !preOutcome.isError
                ? await this.validateReportAfterWrite(preOutcome, reportPriorContent)
                : preOutcome;
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
          // Architect Mode only ever edits markdown under `architecture/` —
          // there is nothing to typecheck, and `tsc` is not even installed
          // (no `npm install` in this mode). Running the verify step here
          // just fails every turn and drags the model into explaining a
          // non-problem in its reply. The `files.changed` event still fires
          // so the UI and the Plan panel refresh.
          if (!this.options.architectMode) verificationNeeded = true;
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
      // every following turn. 050 R2.5: a marker over a status block that
      // still has a `blocked` row is refused ONCE, with a reason — after
      // that, or if the block is fine, it is honoured. Never wedges.
      if (
        this.options.architectMode &&
        !this.interviewDoneDeclared &&
        assistantText.includes(ARCHITECT_INTERVIEW_DONE_MARKER)
      ) {
        const close = await this.validateInterviewClose();
        if (close.ok) {
          this.interviewDoneDeclared = true;
        } else {
          this.interviewCloseRefusedOnce = true;
          this.conversation.addUserMessage(
            `The "${ARCHITECT_INTERVIEW_DONE_MARKER}" line was not accepted: ${close.reason} ` +
              "The design files stay locked until that is fixed.",
          );
        }
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
   * 051 Part B — Auto Mode's between-pass decision. The server calls this
   * after each build turn: it returns `true` when another build pass should
   * run on its own (the caller then does `run("keep going", …)`), and
   * `false` — after emitting the stop reason as a non-fatal `error` event —
   * when the auto run is over. Only meaningful on a session created with
   * Auto Mode; a no-op otherwise.
   */
  autoNextPass(emit: Emit): boolean {
    const o = this.orchestration;
    if (!o.auto) return false;
    // The run only auto-continues if the last turn actually hit a pass cap
    // with work still queued. Any other ending — the build finished, the
    // model stopped, a different refusal — ends the auto run.
    if (!o.passCapHitThisTurn) return false;
    o.passCapHitThisTurn = false;

    const totals =
      `(${o.pass} pass${o.pass === 1 ? "" : "es"}, ~${(o.autoTokens / 1e6).toFixed(1)}M builder tokens` +
      `${o.autoStartedAt ? `, ${Math.round((Date.now() - o.autoStartedAt) / 60_000)} min` : ""})`;
    const stop = (code: string, message: string): boolean => {
      emit({ type: "error", sessionId: this.id, code, message, fatal: false });
      return false;
    };

    if (o.killed) return stop("auto_stopped", `Auto Mode stopped by the user ${totals}.`);

    // Stuck-detection: two passes running with no new builder-changed file.
    if (o.changedEver.size <= o.changedAtPassStart) o.zeroProgressPasses += 1;
    else o.zeroProgressPasses = 0;
    if (o.zeroProgressPasses >= 2) {
      return stop(
        "auto_stuck",
        `Auto Mode stopped — two passes made no progress ${totals}. The build plan may be stuck; ` +
          "check architecture/build-plan.md, then continue manually or take it to the Engineer.",
      );
    }

    if (o.pass >= AUTO_MAX_PASSES) {
      return stop(
        "auto_ceiling",
        `Auto Mode reached the ${AUTO_MAX_PASSES}-pass ceiling ${totals}. The app runs as far as it ` +
          'got — reply "keep going" for another pass, or take the rest to the Engineer.',
      );
    }
    if (o.autoTokens >= AUTO_MAX_TOKENS) {
      return stop(
        "auto_ceiling",
        `Auto Mode reached its ~${(AUTO_MAX_TOKENS / 1e6).toFixed(0)}M-token ceiling ${totals}. ` +
          'Reply "keep going" for another pass, or take the rest to the Engineer.',
      );
    }
    if (o.autoStartedAt && Date.now() - o.autoStartedAt >= AUTO_MAX_WALLCLOCK_MS) {
      return stop(
        "auto_ceiling",
        `Auto Mode reached its ${Math.round(AUTO_MAX_WALLCLOCK_MS / 60_000)}-minute ceiling ${totals}. ` +
          'Reply "keep going" for another pass, or take the rest to the Engineer.',
      );
    }

    o.changedAtPassStart = o.changedEver.size;
    return true;
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

  /** Read a project file, or null if it does not exist / cannot be read. */
  private async readFileOrNull(filePath: string): Promise<string | null> {
    return this.options.runtime
      .readFile(this.projectId, filePath)
      .then((f) => f.content)
      .catch(() => null);
  }

  /**
   * 050 R2.2/R2.3 — after a write/edit to architecture/report.html, read the
   * whole resulting file and run `reportHtmlAdvisory` on it. If it trips, roll
   * the file back to `prior` (or delete it if there was none) and return a
   * refusal for the model. This is a fail-fast advisory only — the render-time
   * sanitiser in PlanPanel is the authoritative control — but it stops an
   * obviously-scripted report from sitting in the workspace and catches
   * content assembled across multiple edit_file calls.
   */
  private async validateReportAfterWrite(
    passOutcome: ToolResult,
    prior: string | null,
  ): Promise<ToolResult> {
    const now = await this.readFileOrNull(ARCHITECT_REPORT_PATH);
    if (now === null) return passOutcome;
    const bad = reportHtmlAdvisory(now);
    if (!bad) return passOutcome;
    try {
      if (prior === null) {
        await this.options.runtime.deleteFile(this.projectId, ARCHITECT_REPORT_PATH);
      } else {
        await this.options.runtime.writeFile(this.projectId, ARCHITECT_REPORT_PATH, prior);
      }
    } catch {
      // Best effort — even if rollback fails, PlanPanel sanitises on render.
    }
    return {
      output:
        `report.html was rejected and rolled back: it contains ${bad}. The report must be a ` +
        "passive document — no <script>, event handlers, remote URLs, embedding elements, or remote " +
        "CSS. The design's own inline CSS and data: images are fine. Rewrite it without that.",
      isError: true,
    };
  }

  /**
   * 050 R2.5 — whether an "Interview complete:" line may be honoured. The one
   * genuinely load-bearing check: a status-block table ROW whose status cell
   * is exactly `blocked` means the interview is not done. Everything else
   * about the block ("a row per topic", "assumed needs the user's go-ahead")
   * is prompt guidance, not a code gate — parsing a model-authored table
   * strictly enough to enforce that reliably is not worth wedging a session
   * over. And this check is ONE-SHOT: after it has refused once and told the
   * model why, a re-declared marker is honoured regardless, so a
   * misformatted table can never trap the user in a loop.
   */
  private async validateInterviewClose(): Promise<{ ok: boolean; reason: string }> {
    if (this.interviewCloseRefusedOnce) return { ok: true, reason: "" };
    const reqs = await this.readFileOrNull(`${ARCHITECT_WRITE_ROOT}requirements.md`);
    if (reqs === null) {
      return {
        ok: false,
        reason:
          "architecture/requirements.md does not exist yet — write it (with the per-topic status " +
          "block at the top) before declaring the interview complete.",
      };
    }
    // Only real Markdown table rows: "| cell | cell | ... |". A topic is
    // blocked only when one of its cells is exactly the word "blocked" — not
    // when some prose sentence elsewhere in the file happens to contain it.
    const blockedRow = reqs
      .split("\n")
      .filter((l) => /^\s*\|.*\|\s*$/.test(l))
      .map((l) => l.split("|").map((c) => c.trim()))
      .find((cells) => cells.some((c) => /^blocked$/i.test(c)));
    if (blockedRow) {
      const topic = blockedRow.find((c) => c && !/^blocked$/i.test(c)) ?? "a topic";
      return {
        ok: false,
        reason:
          `the status block still marks "${topic}" as blocked. Resolve it or raise it with the ` +
          "user, then re-declare — this check will not stop you a second time.",
      };
    }
    return { ok: true, reason: "" };
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
