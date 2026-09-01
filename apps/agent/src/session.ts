import { posix as pathPosix } from "node:path";
import {
  type AgentEvent,
  type Message,
  newId,
  type Preview,
  type PromptAttachment,
  parseTopology,
  type ToolCall,
} from "@zelyq/core";
import type { RuntimeDriver } from "@zelyq/runtime";
import {
  ALL_TOOLS,
  cinematicPassTool,
  designPassTool,
  dispatchTaskTool,
  executeTool,
  opsPassTool,
  qaPassTool,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
  toolDefinitions,
  type ZelyqTool,
} from "@zelyq/tools";
import {
  ARCHITECT_DRIFT_MARKER,
  ARCHITECT_READY_MARKER,
  ARCHITECT_WRITE_ROOT,
  buildSystemPrompt,
  designReferencesBlock,
  ENGINEER_MODE_PURPOSE_MARKER,
  withAgents,
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

/** Running any of these in a turn flips Engineer Mode from its "build"
 * phase into its "finish" phase. The distinction matters only once the
 * new-file checkpoint is reached: in build phase the checkpoint freezes
 * every mutating tool (the model is still inventing scope); in finish
 * phase it has stopped writing new files, started looking at the running
 * app, and is now typechecking and tuning what it built — so `edit_file`
 * and `run_command` on files that already exist are allowed back, while a
 * genuinely-new `write_file` and `delete_file` stay refused. You cannot
 * reach finish phase without first stopping to verify, which is the whole
 * point — see the `finishPhase` handling in `run()`. */
const VERIFICATION_TOOL_NAMES = new Set([
  "start_preview",
  "view_preview",
  "preview_logs",
  "inspect_page",
  "check_console_errors",
  "check_network_failures",
  "accessibility_audit",
  "test_responsive_layout",
  "typecheck_project",
  "lint_project",
  "verify",
]);

// Architect Mode plans but does not build. Writes are allowed only under
// `architecture/`, and nothing executes.
const ARCHITECT_WRITE_TOOLS = new Set(["write_file", "edit_file", "delete_file"]);
const ARCHITECT_BLOCKED_TOOLS = new Set(["run_command", "start_preview"]);

// The exact set of paths the Architect may write. NOT "any file under
// architecture/": arbitrary Markdown there is not inert everywhere (MDX
// compilation, raw-markdown imports, doc generators that glob
// `architecture/**/*.md`), and only `topology.json` is a known-safe data file.
// `pending-skills/` is deliberately absent — self-authored capability is gated
// separately. The interview does not gate this set — the Architect decides
// when it has enough and moves on; writing a decision record while a question
// is still open is its call, not a refusal.
const ARCHITECT_PACKAGE_FILES = new Set([
  "architecture/README.md",
  "architecture/requirements.md",
  "architecture/data-model.md",
  "architecture/api.md",
  "architecture/infrastructure.md",
  "architecture/backend.md",
  "architecture/build-plan.md",
  "architecture/build-context.md",
  "architecture/risks.md",
  // The design system spec. The Architect seeds a real first draft; the
  // Designer agent owns and deepens it. Required for a package to be ready.
  "architecture/DESIGN.md",
  // The system design as structured data — rendered as the live diagram.
  "architecture/topology.json",
  // 060 — the AI-integration spec, when the design uses a language model.
  "architecture/ai.md",
  // Specialist-owned specs the Architect first-drafts when they apply.
  "architecture/OPERATIONS.md",
  "architecture/QA.md",
]);
// The design guide's canonical paths. `architecture/DESIGN.md` for a
// project that has an Architect package; root `DESIGN.md` otherwise (an
// Engineer-only project must not sprout an architecture/ folder).
const DESIGN_MD_PATHS = new Set(["architecture/DESIGN.md", "DESIGN.md"]);
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

/** A fail-fast advisory scan of a complete report.html for active or
 * network-capable content. NOT a security boundary (a substring scan cannot
 * be one); the render-time sanitiser in PlanPanel is the control. This just
 * catches the obvious cases early so the Architect gets told, and so a
 * scripted file does not linger in the workspace. Returns a short
 * description of the first problem, or null if clean. */
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
 *                 package file
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

// Orchestration caps. Hard, enforced here, not in prose. Every dispatched
// builder is bounded; the whole run is bounded on top of that.
const SUBAGENT_MAX_TURNS = 25;
const SUBAGENT_MAX_TOKENS = 200_000;
const SUBAGENT_WALLCLOCK_MS = 5 * 60_000;
const ORCH_MAX_SUBAGENTS = 20;
const ORCH_MAX_TOKENS = 2_000_000;
// Auto Mode's hard ceiling for ONE auto run. Any one hit stops the run; it
// hands back exactly like a manual pass-cap stop, with the actual totals.
// Deliberately low so a bad plan is a manageable bill.
const AUTO_MAX_PASSES = 6;
const AUTO_MAX_TOKENS = 6_000_000;
const AUTO_MAX_WALLCLOCK_MS = 30 * 60_000;

// A transient model failure (provider overloaded / rate-limited / connection
// dropped) is retried this many times, backing off 0.8s → 1.6s → 3.2s,
// before it surfaces as a visible error.
const MODEL_RETRY_MAX = 3;
const MODEL_RETRY_BASE_MS = 800;
// A builder takes at most this many named files. A task with more is refused
// at dispatch, forcing the Architect to split it before a bounded builder
// chokes on it.
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
 * `npm install` and its equivalents. Without this list, `run_command`'s
 * reactive new-file detection counts `package-lock.json` toward the same
 * six-file budget as a file the model actually invented, costing it one of
 * its six slots for something it didn't choose to create. Excluded by
 * basename, not path, since these always live at the project root. */
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
  /** 066 — one-line stack summary for the `<project>` block. Absent ⇒ the
   * built-in `React 19 + Vite + Tailwind` line, so a vite-react session's
   * prompt is byte-identical to before. */
  stack?: string;
  /** 066 — a stack skill whose body is force-woven into turn one (the same
   * mechanism Engineer Mode uses for `senior-software-engineering`). Set from
   * `template.json`'s `agentSkill`; absent for vite-react. */
  stackSkill?: { body: string };
  provider: ProviderId;
  model: string;
  effort: Effort;
  apiKey: string;
  /** When this is `"subscription"`, `apiKey` above is a CLI-sourced OAuth
   * token, not a classic API key. */
  authMode?: AuthMode;
  /** Endpoint for a provider speaking the OpenAI dialect. */
  baseUrl?: string;
  /** Anthropic only — the `anthropic-workspace-id` header for an
   * identity-linked API key. Inherited by dispatched child sessions. */
  anthropicWorkspaceId?: string;
  /**
   * A capability to apply Supabase migrations and verify the
   * backend *through the server* (the agent never holds the Management
   * credential). Present only when a Supabase resource is linked to this
   * project. Inherited by dispatched builders/verifiers.
   */
  supabaseBridge?: { url: string; token: string };
  /**
   * The linked project's public Supabase config (URL + publishable key) —
   * merged into the preview env so the built app connects to the real
   * backend. Both values are public; no secret here.
   */
  supabasePreviewEnv?: Record<string, string>;
  runtime: RuntimeDriver;
  maxIterations: number;
  history?: Message[];
  /** The name/description catalog only. Empty when nothing loaded. */
  skills?: Array<{ name: string; description: string }>;
  /** Full body lookup for a `/`-selected skill that must be woven in — a
   * separate field from `skills` above so the prompt catalog never has to
   * carry every skill's full text just to build a two-line list. */
  resolveSkillBody?: (name: string) => { body: string } | undefined;
  /** `engineerModeSkill` is the `senior-software-engineering` skill's body
   * and resource listing, resolved by the caller the same way
   * `resolveSkillBody` already is — absent when that skill wasn't found at
   * boot, in which case the mode's four directives still apply on their own. */
  engineerMode?: boolean;
  engineerModeSkill?: { body: string; resources: string[] };
  /** Architect Mode. Mutually exclusive with `engineerMode` (the server
   * rejects both). When on, this session interviews and designs only: writes
   * outside `architecture/` and every execution tool are refused at the tool
   * boundary below. `architectModeSkill` is the `report-page-design` skill
   * for the report render. */
  architectMode?: boolean;
  architectModeSkill?: { body: string; resources: string[] };
  /** 056 — the rendered design reference catalog (one line per reference)
   * and the `Agent.md` UI-craft checklist. The Architect prompt lists the
   * catalog under its DESIGN.md step and inlines `agentMd`; the Engineer
   * prompt inlines `agentMd`; the verifier and Designer children get
   * `agentMd` appended to their system prompt as a gate. */
  designRefCatalogText?: string;
  agentMd?: string;
  /** 060 — the AI provider knowledge catalog (one line per provider) and the
   * integration MUST/SHOULD/NEVER rules. Rendered as `<ai_providers>` in the
   * Architect and Engineer prompts; a lean specialist child does not get it. */
  aiProviderCatalogText?: string;
  aiProvidersAgentMd?: string;
  /** Auto Mode. Only honoured with `architectMode`. */
  autoMode?: boolean;
  /** The lean builder profile. A dispatched builder runs with a compact
   * hand-written system prompt (this field) instead of the full
   * `buildSystemPrompt` weave, and only the tools named in `toolNames`. Cuts
   * per-turn overhead so a whole build fits in the run budget. */
  systemPrompt?: string;
  toolNames?: string[];
  /** A structural write scope for a specialist child. When set, every
   * write_file / edit_file / delete_file whose normalized path fails this
   * predicate is refused at the tool boundary, and a shell command that
   * creates an out-of-scope file trips the turn's checkpoint. The Designer
   * child runs with `designerPathAllowed`. */
  writeAllowlist?: (normPath: string) => boolean;
  /** Packages a specialist child may `npm install`. Only consulted when
   * `writeAllowlist` is set; an empty/absent set with `writeAllowlist`
   * present means NO installs are allowed. */
  installAllowlist?: Set<string>;
  /** 061 — a genuinely-new file whose normalized path this accepts is NOT
   * counted toward Engineer Mode's NEW_FILE_CHECKPOINT. The Cinematic
   * engineer's child sets it so `ffmpeg`'s bulk frame output under
   * `public/cinematic/**` cannot freeze the turn. */
  newFileCheckpointExempt?: (normPath: string) => boolean;
  /** 061 — a `run_command` whose command matches this is refused at the tool
   * boundary (the Cinematic engineer's scoped shell: no git, no network). */
  cmdDeny?: RegExp;
  /** Overridable so tests can run the loop without a network or an API key. */
  providerFactory?: ProviderFactory;
}

// The only tools a dispatched builder gets. No plugin catalogue, no
// use_skill, no preview tools (the Architect owns the preview). Just enough
// to read the project, write code, and run a command.
const BUILDER_TOOL_NAMES = [
  "list_files",
  "read_file",
  "search_files",
  "write_file",
  "edit_file",
  "delete_file",
  "run_command",
  // No-ops (they refuse) unless a Supabase resource is linked;
  // when it is, the backend builder applies its migration itself.
  "supabase_apply_migration",
  "supabase_verify_backend",
  "supabase_deploy_function",
];

// The verifier dispatch gets the preview and page-inspection tools back on
// top of the builder set (so it can actually see whether the app runs, the
// way Engineer Mode does), plus whatever extra plugin tools the plan named
// for design / a11y / security checks.
const VERIFIER_EXTRA_TOOL_NAMES = [
  "start_preview",
  "preview_logs",
  "view_preview",
  "check_console_errors",
  "check_network_failures",
  "inspect_page",
  "typecheck_project",
  "lint_project",
  "supabase_verify_backend",
];

// The builder's whole system prompt. It gets ONE specified task with
// acceptance criteria, a project brief, and a file map; it does not need
// the interview/scope-negotiation machinery of the full agent prompt.
const BUILDER_SYSTEM_PROMPT = `You are a builder on a software team. You are given ONE task from an approved build plan, with acceptance criteria, a project brief, and a list of files that already exist.

Do exactly that task:
- Read the brief and the relevant existing files before you write anything.
- Match the stack and conventions already in the project. Do not introduce a new framework, state library, or build tool.
- Write the code for this task and only this task. Do not build features the task does not name. Do not refactor unrelated code.
- Keep the project building. If there is a typecheck or build script, run it after your changes and fix what you broke. Install a dependency only if the task genuinely needs it.
- Wire your work in: if you add a component or module the app is meant to use, connect it to the entry point or the place the plan says it belongs — do not leave it orphaned.
- Never invent API keys, secrets, or backend URLs. Build against clearly-marked placeholder data and note what the user must supply.
- If the task is a Supabase backend task (from backend.md): write \`supabase/migrations/0001_init.sql\` to backend.md (RLS on every table, grants revoked and re-granted, one policy per operation), then apply it with \`supabase_apply_migration({ name, path })\` and check it with \`supabase_verify_backend\`; fix any FAIL in the SQL and re-apply. Wire \`@supabase/supabase-js\` from \`src/lib/supabase.ts\` reading \`import.meta.env.VITE_SUPABASE_URL\` / \`VITE_SUPABASE_PUBLISHABLE_KEY\`. The publishable key is the only Supabase key the browser gets — never put an \`sb_secret_*\` or \`service_role\` key in \`src/\`, \`.env.example\`, or anywhere committed. Do not add a server, a \`dev\`/\`start\` script for one, or a backend framework. If \`supabase_apply_migration\` is not available, no backend is linked — say so and stop; do not tell the user to run SQL by hand.

When done, state in two or three sentences what you changed and whether each acceptance criterion is met. If you could not finish, say exactly what remains.`;

// The verifier's whole system prompt. It runs AFTER the last build task. It
// verifies the project ACTUALLY WORKS the way a senior engineer would before
// signing off — and fixes the loose ends the build left. Modelled on what
// Engineer Mode does when a user asks it to finish a half-built app:
// preview, inspect the running page, typecheck/build, then read and fix
// component by component until it runs.
const VERIFIER_SYSTEM_PROMPT = `You are the verifier. A team of builders just finished a project from an approved plan. Your job is to make sure it ACTUALLY WORKS end to end — the way a senior engineer checks their own work before signing off — and to write the few project-level files a finished project needs. You may fix what is broken; you do not add new features.

Verify it for real, in this order:
1. Run the project's typecheck and build commands (npm run typecheck, npm run build, or what the project declares). Read the real output. A non-zero exit is a FAIL.
2. start_preview. Then check_console_errors and inspect_page against the RUNNING app. Confirm it renders the real application — not the starter template, not a blank page, not an error overlay. Read preview_logs if it does not come up.
3. Walk the core flows the Definition of Done names — the main screens and the primary action of each. Use view_preview / inspect_page with a \`path\` to reach a screen that is not the landing route; never edit routing to see one. A blank screen, a control that does nothing, a route that 404s, or a thrown console error means that flow FAILS.
4. Run any design / accessibility / security tool you were given. Note each finding. If any visible text names a specific real place, product, or person, confirm the adjacent image plausibly depicts it — a caption-to-image mismatch is a FAIL, reported with the screen and what you saw.
   If the project has a \`supabase/migrations/\` folder, run \`supabase_verify_backend\` and record each check; any FAIL there is a FAIL here. (If the tool is unavailable, no Supabase backend is linked — note that and move on.)

When you find something broken:
- If it is small — a broken or missing import, a type error, a missing prop, an unwired route, a component that never mounts, a name that does not match — FIX it, then re-run the checks. This is expected: a real verification pass ties off the loose ends the build left. Read the file first, make the smallest change, move on.
- If it is large, or you are running out of budget, stop fixing and mark that item FAIL with the exact error.

Then create or correct the finishing files: .env.example (every env var the code and design need, one per line with a comment, NO real values); a real root README.md replacing the template's (what it is, how to run it, env vars, scripts, one paragraph of architecture linking architecture/report.html); the CI config for a known stack, with an "unverified, generated from the design" header; .gitignore additions. Triage design/security findings into architecture/risks.md under a dated "## Verification findings" heading, each with a consequence and a decision.

If you were given <ui_guidelines>, run its OBSERVABLE rules against the running app and the source: a visible :focus-visible style (no bare outline:none); inputs with a value have an onChange; navigation uses <a>/<Link> not <div onClick>; prefers-reduced-motion honoured; no transitions on layout props and no "transition: all"; images have explicit width/height (no layout shift); icon-only buttons have an aria-label; native semantics before ARIA; <title> matches the page; empty and error states are designed; truncating flex children have min-w-0; numbers that compare use tabular-nums; a dark theme sets color-scheme. Fix a small failure in scope; a real failure you cannot fix is a checklist FAIL.

Then return a COMPLETION CHECKLIST — one line per Definition-of-Done item AND one line per UI-guidelines rule you checked, PASS / FAIL / N/A, each with a one-line reason that names what you ACTUALLY OBSERVED (the command output, what the page showed), never what should be true. Do not mark PASS anything you did not run and see pass. If the app does not render, the build fails, or a UI-guidelines rule FAILs and you could not fix it, the overall result is NOT VERIFIED — say that plainly at the top. End with the live preview URL, or "preview not running: <reason>".`;

// The Designer specialist. Dispatched AFTER a clean verification (or, in
// Engineer Mode, on the user's explicit ask via design_pass). Same mechanism
// as the verifier; different mandate: make a WORKING app look senior-designed.
// It adds no features, no routes, no backend changes — a structural write
// allowlist (designerPathAllowed) limits it to client UI files, and a fixed
// dependency allowlist limits what it may install.
// Every specialist (Designer, DevOps, Security/QA) surveys the project,
// authors or deepens its spec file, AND implements it. A pass that hits a
// ceiling returns partial with honest NOT DONE lines; "keep going" or a
// second pass continues against the now-written spec (cheaper).
const SPECIALIST_MAX_TURNS = 40;
const SPECIALIST_MAX_TOKENS = 600_000;
const SPECIALIST_WALLCLOCK_MS = 18 * 60_000;

// The builder's file/shell set minus delete_file (a polish pass does not
// remove files), plus the preview + page-inspection tools so it can SEE the
// rendered UI, plus typecheck/lint so it can keep the app green. Any design /
// a11y plugin tools the caller names come on top via input.tools.
const DESIGNER_TOOL_NAMES = [
  "list_files",
  "read_file",
  "search_files",
  "write_file",
  "edit_file",
  "run_command",
  "start_preview",
  "preview_logs",
  "view_preview",
  "inspect_page",
  "check_console_errors",
  "check_network_failures",
  "typecheck_project",
  "lint_project",
  // 056 — so the Designer can read the reference the Architect chose (or
  // pick one, when it authors DESIGN.md from scratch).
  "use_design_ref",
  // 057 — real imagery without guessing: a searched, downloaded, and
  // shown-back photo, or a labelled placeholder. Only present when the
  // image-assets plugin is loaded; harmless in the filter when it is not.
  "fetch_reference_image",
  "generate_placeholder_asset",
];

// The only extra dependencies the Designer may install — styling utilities and
// icon/animation helpers, never a framework or a component mega-library the
// project did not choose. Anything else is refused at the run_command
// boundary; package.json itself is outside the write allowlist, so the
// Designer cannot hand-edit deps around this either.
const DESIGNER_DEP_ALLOW = new Set([
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
  "tailwindcss-animate",
  "lucide-react",
  "@radix-ui/react-icons",
  "@heroicons/react",
]);

// The Security/QA agent needs a test runner to write tests that actually
// run. These are test INFRASTRUCTURE (dev-only), not application
// dependencies — the QA agent's tools, the same way the styling utilities
// above are the Designer's. Application deps still go in the review for the
// Engineer.
const QA_DEP_ALLOW = new Set([
  "vitest",
  "@vitest/coverage-v8",
  "@vitest/ui",
  "jsdom",
  "happy-dom",
  "@testing-library/react",
  "@testing-library/dom",
  "@testing-library/jest-dom",
  "@testing-library/user-event",
  "@playwright/test",
  "playwright",
]);

// A package-install shell command: `npm i pkg`, `npm install pkg`, `pnpm add
// pkg`, `yarn add pkg`, `bun add pkg`. Captures the argument list after the
// verb so it can be checked against DESIGNER_DEP_ALLOW.
const INSTALL_CMD_RE =
  /\b(?:npm(?:\s+install|\s+i|\s+add)|pnpm\s+(?:install|i|add)|yarn\s+add|bun\s+add)\b([^\n&|;]*)/i;

/** The Designer's structural write scope: client UI files only. Anything
 * that does not match is refused at the tool boundary in the child session, so
 * a "make it pretty" pass can never touch the server, the schema, config, CI,
 * or secrets. Path is normalized by the caller. */
function designerPathAllowed(norm: string): boolean {
  if (norm === "" || pathPosix.isAbsolute(norm) || norm === ".." || norm.startsWith("../")) {
    return false;
  }
  // The Designer owns the design guide. This is the ONLY doc it may write;
  // every other architecture/* path stays refused below.
  if (DESIGN_MD_PATHS.has(norm)) return true;
  // Never server/data/build-tooling code, even when it lives under src/.
  if (/^src\/(server|api|backend|db|database|prisma|lib\/server|trpc|routes\/api)\b/.test(norm)) {
    return false;
  }
  if (
    /^(server|api|backend|prisma|migrations|db|scripts|\.github)\//.test(norm) ||
    /\.(prisma|sql)$/.test(norm) ||
    /^(package\.json|tsconfig.*\.json|vite\.config\.[a-z]+|\.env.*)$/.test(norm)
  ) {
    return false;
  }
  // Allowed: client UI source, stylesheets, the entry HTML, styling config,
  // and design assets.
  if (/^src\/.*\.(tsx|jsx|ts|js|css|scss|sass)$/.test(norm)) return true;
  if (/^src\/(assets|styles|theme|design|ui)\//.test(norm)) return true;
  if (norm === "index.html" || norm === "src/index.css" || norm === "src/App.css") return true;
  if (/\.css$/.test(norm)) return true;
  if (/^(tailwind|postcss)\.config\.(js|cjs|mjs|ts)$/.test(norm)) return true;
  return false;
}

/** What the Designer's review must COVER — passed as the acceptance criteria
 * when it is called through `design_pass` (Engineer Mode has no build-plan to
 * draw them from). This is a coverage list, NOT a template to hand back: the
 * deliverable is the changed files; the review is evidence of them. */
const DESIGN_DOD = [
  "the design system (colour ROLES, type scale, spacing rhythm, radius, elevation) — coherent and applied;",
  "visual hierarchy on each primary screen — the main message and action obvious;",
  "state coverage — empty, loading, error, success actually styled, not just the happy path;",
  "accessibility — AA contrast, a visible focus style, non-colour state cues, target sizes;",
  "responsiveness — intentional at a narrow and a wide viewport;",
  "the generic-AI-look removed on the main user journeys;",
  "the app still renders and typechecks after the changes.",
].join(" ");

// The shape of DESIGN.md. Given to the child so an authored guide is
// complete and uniformly structured. The Designer fills it with REAL values
// (hex, a type scale, spacing steps), never placeholders.
const DESIGN_MD_TEMPLATE = `# Design System — <project name>

## Product & feel
One paragraph: what it is, who it's for, the intended personality (e.g. "precise, calm, trustworthy"), the density (compact / comfortable / spacious).

## Principles
3–5 lines specific to this product. Not generic.

## Colour
Semantic ROLES with real values (hex or HSL), light and dark where the product has both:
- bg, surface, surface-raised, border
- fg, fg-muted
- primary, primary-fg
- accent
- success, warning, danger
- focus-ring
Say which roles carry meaning (status) vs. decoration.

## Typography
- Families: display / body / mono, each with a fallback stack.
- Scale: each step — size · line-height · weight — and where it's used.
- Tabular figures where numbers are compared.

## Spacing & layout
The spacing scale, container widths, the grid, section rhythm.

## Radius & elevation
The radius steps; the border/shadow elevation language.

## Components
buttons (variants, sizes, states) · inputs · cards · nav · tables · badges/chips · dialogs — each in terms of the tokens above.

## States
How empty / loading / skeleton / error / success / disabled look.

## Motion
Durations, easings, what animates and what doesn't, reduced-motion behaviour.

## Accessibility
Contrast targets, the focus style, target sizes, non-colour state cues.

## Iconography
The set, sizes, stroke.

## Do / Don't
The generic-AI-look tells to avoid, named for THIS product.

## Implementation
Where the tokens live in code (src/index.css @theme / Tailwind config / a theme.ts) and how components consume them.
`;

const DESIGNER_SYSTEM_PROMPT = `You are the Designer — a senior product/UI designer. Design is your project: you own the design system, you write it down, and you make the app match it. The app already runs; your job is to CHANGE FILES so it looks and feels like a senior design team shipped it, and to leave it still running.

The deliverable is the diff (DESIGN.md + the code that implements it). A pass that changes no files at all is a FAILURE. A pass that writes only DESIGN.md has written the guide but NOT implemented it — say so plainly, do not call that done.

Hard boundaries (the tool layer enforces them):
- Write ONLY client UI files — components, styles, theme/tokens, the entry HTML, Tailwind/PostCSS config, design assets — PLUS the design guide (architecture/DESIGN.md, or DESIGN.md at the repo root if there is no architecture/ folder). Writes to the server, the database/schema, build config, package.json, .env, or any other architecture/* file are refused.
- Add NO features, NO routes, NO data-flow changes, NO new screens.
- Install a dependency only from this set if you genuinely need it: clsx, tailwind-merge, class-variance-authority, tailwindcss-animate, lucide-react, @radix-ui/react-icons, @heroicons/react. Prefer what is installed.
- A problem that is NOT visual/UI — a broken API call, a data bug, a server error — you REPORT in the review, you do not fix it. Stay in your lane.

Work in this order:

1. SURVEY. list_files; read the entry points, components, and current styles; start_preview; view_preview + inspect_page on EVERY primary screen; run any design/accessibility plugin tool you were given. Write yourself a short list: what exists, what is generic / inconsistent / unstyled / broken. Make no claims before this.

2. OWN THE GUIDE — write architecture/DESIGN.md (or DESIGN.md at the repo root if there is no architecture/ folder) BEFORE you edit a single component or style file. A pass that edits code before DESIGN.md exists is rejected as an ungoverned restyle — the guide comes first, always.
   - If it exists: read it. Critique it against what this project actually needs — you are the design authority, a thin or wrong draft is expected to be deepened. Fill in real tokens (hex, a type scale, spacing steps), fix choices that don't fit the product, add missing component/state coverage. If a human has hand-edited it, RESPECT those edits — refine around them, do not overwrite blind. Write the improved file back.
   - If it does NOT exist: author it from the project. First, if you have a <design_references> list and use_design_ref, pick the reference closest to this product's category and personality, read it, and base the system on it — ADAPTED (rename to this domain, drop what does not apply, recolour to the product's own identity), never skinned as that brand, never its logo. Record at the top of DESIGN.md: 'Adapted from the "<slug>" reference — <what was kept / changed>', or 'Designed from first principles — no reference fit'. Use this structure, REAL values, no placeholders:
${DESIGN_MD_TEMPLATE}
   Either way, DESIGN.md after this step is the contract the rest of the pass implements and is judged against. Write it fully before step 3.

3. IMPLEMENT DESIGN.md. Put the tokens in the real place (src/index.css @theme / Tailwind config / a theme file). Then bring the app onto the system, screen by screen: hierarchy → density → state coverage (empty / loading / error / success) → responsiveness → motion. Write the changes.

4. FIX the UI issues you found in the survey: broken layouts, console errors, unstyled default controls, contrast failures, missing states. Non-UI issues go in the review, not the diff.

5. KEEP IT GREEN. After each meaningful change: typecheck/build, reload the preview, check_console_errors. A blank screen, a console error, or a red typecheck is something you broke — fix or revert it before moving on.

When done, re-check the running preview, then return a DESIGN REVIEW:
- FIRST line: "DESIGN.md <created|refined> — <one-line summary: the palette, the type choice, the key moves>". If you used a reference, name it and what you adapted.
- Then, for EACH area below, one line — PASS (naming the screen/file you changed and what the screenshot showed) / FAIL / NOT DONE. Never PASS something you did not change or did not see rendered. If you implemented nothing, every area is NOT DONE and the top line is NOT VERIFIED.
- Areas: ${DESIGN_DOD}
- Then a UI GUIDELINES block: if you were given <ui_guidelines>, one line per observable rule you can check from the running preview or the source — PASS / FAIL / N-A with what you saw. A FAIL you can fix in scope, fix it; otherwise it is a FAIL that blocks "done" (or a recorded exception with a reason).
- Then 2–4 concrete before/after notes naming actual screens.
- Then any non-UI issues you found, for the Engineer.
- End with the live preview URL (or "preview not running: <reason>").`;

type Emit = (event: AgentEvent) => void;

// ===========================================================================
// The DevOps and Security/QA specialists. Same machine as the Designer: a
// dispatched bounded child, a curated tool set, injected skill bodies, a
// structural write allowlist, an owned spec file it surveys / authors /
// implements, and the same honesty gates. Only the prompt, the tools, the
// write scope, and the owned file differ.
// ===========================================================================

/** The specialist names, in menu order. Exported so the composer's
 * `/agent` list (`apps/web`) and `withAgents`' hint table (`prompt.ts`)
 * can be drift-checked against the one true set. */
export const SPECIALIST_KINDS = ["designer", "devops", "security", "cinematic"] as const;
type SpecialistKind = (typeof SPECIALIST_KINDS)[number];

/** 064 — the pass tool that runs each specialist. An `/agent` pick grants the
 * matching one for the session (`grantSpecialistTools`), which is what makes
 * `/agent designer` dispatch a real Designer in default mode instead of
 * leaving the model to impersonate one. Keyed by the same names the composer's
 * `/agent` menu and `withAgents`' hint table use — the drift check covers all
 * three. */
const SPECIALIST_PASS_TOOLS: Record<SpecialistKind, ZelyqTool> = {
  designer: designPassTool,
  devops: opsPassTool,
  security: qaPassTool,
  cinematic: cinematicPassTool,
};

const DEVOPS_MD_PATHS = new Set(["architecture/OPERATIONS.md", "OPERATIONS.md"]);
const QA_MD_PATHS = new Set([
  "architecture/QA.md",
  "QA.md",
  "architecture/SECURITY.md",
  "SECURITY.md",
]);

const DEVOPS_TOOL_NAMES = [
  "list_files",
  "read_file",
  "search_files",
  "write_file",
  "edit_file",
  "run_command",
  "typecheck_project",
  "lint_project",
  "document_environment",
  "detect_missing_secret_declarations",
  "deployment_check",
  "deployment_environment_report",
  "build_artifact_report",
  "inspect_dockerfile",
  "inspect_compose_file",
  "container_security_report",
  "git_status",
];

const QA_TOOL_NAMES = [
  "list_files",
  "read_file",
  "search_files",
  "write_file",
  "edit_file",
  "run_command",
  "typecheck_project",
  "lint_project",
  "discover_tests",
  "run_targeted_tests",
  "summarize_test_failures",
  "coverage_report",
  "security_scan",
  "dependency_report",
  "container_security_report",
  "accessibility_audit",
  "detect_missing_secret_declarations",
  "quality_report",
];

/** The DevOps agent's structural write scope: operational / deploy files,
 * plus its own OPERATIONS.md. NEVER application code, a real .env, or a
 * package.json key other than `scripts` (checked separately in the turn
 * loop). Path is normalized by the caller. */
function devopsPathAllowed(norm: string): boolean {
  if (norm === "" || pathPosix.isAbsolute(norm) || norm === ".." || norm.startsWith("../")) {
    return false;
  }
  if (DEVOPS_MD_PATHS.has(norm)) return true;
  if (/^src\//.test(norm)) return false; // never application code
  if (/^architecture\//.test(norm)) return false; // OPERATIONS.md handled above
  if (/^\.env(\.|$)/.test(norm) && !/\.example$/.test(norm)) return false; // no real .env
  if (
    /^\.github\/(workflows|actions)\//.test(norm) ||
    /^Dockerfile(\.[a-z0-9.-]+)?$/i.test(norm) ||
    norm === ".dockerignore" ||
    /^docker-compose(\.[a-z0-9.-]+)?\.ya?ml$/.test(norm) ||
    /^\.env(\.[a-z0-9.-]+)?\.example$/.test(norm) ||
    norm === ".env.example" ||
    norm === ".gitignore" ||
    norm === ".nvmrc" ||
    norm === "vercel.json" ||
    norm === "netlify.toml" ||
    norm === "fly.toml" ||
    /^railway\.(json|toml)$/.test(norm) ||
    norm === "Procfile" ||
    /^scripts\//.test(norm) ||
    norm === "package.json" // scripts-block-only, enforced in the turn loop
  ) {
    return true;
  }
  return false;
}

/** The Security/QA agent's structural write scope: test files, its own
 * QA.md / SECURITY.md, and risks.md for triage. NEVER application code or
 * package.json (a needed test dep is named in the review). */
function qaPathAllowed(norm: string): boolean {
  if (norm === "" || pathPosix.isAbsolute(norm) || norm === ".." || norm.startsWith("../")) {
    return false;
  }
  if (QA_MD_PATHS.has(norm)) return true;
  if (norm === "architecture/risks.md") return true;
  if (/^architecture\//.test(norm)) return false;
  if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(norm)) return true;
  if (/(^|\/)(__tests__|__mocks__|tests?|e2e|cypress)\//.test(norm)) return true;
  if (
    /^(vitest|jest|playwright|cypress)\.config\.[a-z]+$/.test(norm) ||
    /^vitest\.setup\.[a-z]+$/.test(norm) ||
    /^(test|tests)\/setup\.[a-z]+$/.test(norm)
  ) {
    return true;
  }
  return false;
}

const OPERATIONS_MD_TEMPLATE = `# Operations — <project name>

## Environments
Which environments exist (local, preview, production), and what differs between them.

## Configuration & secrets
Every environment variable the code and the design need — name, purpose, where it is set, whether it is a secret. Point at .env.example. NO real values here.

## CI pipeline
The jobs (.github/workflows/ci.yml): lint, typecheck, test, build — each matching a real package.json script. Caching. What blocks a merge. Marked "unverified — generated from the design".

## Containers
If the design targets a container: the Dockerfile strategy (multi-stage, non-root, healthcheck), the .dockerignore, docker-compose for local. If not: "not containerised — <why>".

## Deploy
The target the design names (static host / container / platform), the build command and output dir, how a deploy is triggered, and rollback.

## Health & observability
The health endpoint (path, what it checks), where logs and metrics would go. Stubs + notes, not a wired service.

## Runbook
The three or four things an operator does: run locally, run the tests, build for production, roll back.
`;

const QA_MD_TEMPLATE = `# Quality — <project name>

## Test plan
Which layers apply to THIS project and why:
- unit — the logic worth testing (utils, hooks, reducers, pure functions).
- component — the important components: render, the primary interaction, the empty/loading/error states.
- integration — the core user flows.
- e2e — only if the project genuinely warrants it and the harness supports it.
The coverage target, and how to run the whole suite.

## Coverage
What is covered now (added this pass), what is deliberately not, and why.

## Security review
Method: security_scan, dependency audit, secret scan, (container scan if containerised), input/auth review.
Findings — one row each: description · severity (critical|high|medium|low) · decision (accepted / needs-Engineer / fixed-by-report). Cross-referenced in architecture/risks.md.

## Result
CLEARED, or NOT CLEARED — a security_scan FAIL or a critical/high dependency vulnerability means NOT CLEARED.
`;

const DEVOPS_SYSTEM_PROMPT = `You are the DevOps engineer. Operations is your project: you own OPERATIONS.md — the environments, config and secrets, the CI pipeline, containers, deploy targets, rollback, health, and a short runbook — and you make the repo match it.

The deliverable is the diff (OPERATIONS.md + the CI/container/env files that implement it). A pass that changes no files is a FAILURE. A pass that writes only OPERATIONS.md has written the spec but not implemented it — say so.

Hard boundaries (the tool layer enforces them):
- Write ONLY operational files: OPERATIONS.md, .github/workflows/**, Dockerfile*, .dockerignore, docker-compose*.yml, .env.example, .gitignore, .nvmrc, deploy config (vercel.json / netlify.toml / fly.toml / railway.* / Procfile), scripts/**, and the "scripts" block of package.json. Application code under src/, a real .env, the data model, and other architecture/* files are refused.
- Do NOT add dependencies. Do NOT change any package.json key except "scripts". A dependency the setup needs is NAMED IN YOUR REVIEW for the Engineer.
- Do NOT run a deployment. You write config; you do not ship.
- A problem that is NOT operational — an application bug, a broken API — you REPORT in the review, you do not fix it.

Work in this order:
1. SURVEY. Read package.json scripts, the build output, any existing .github/ / Dockerfile / vite.config / .env*. Run document_environment, detect_missing_secret_declarations, deployment_environment_report. Read the design's architecture/infrastructure.md if it exists.
2. OWN OPERATIONS.md (architecture/OPERATIONS.md, or OPERATIONS.md at the repo root if there is no architecture/ folder) — write it BEFORE the other files. Deepen the draft, or author it from the project using this structure with REAL values (the actual env vars, the actual scripts, the target the design names):
${OPERATIONS_MD_TEMPLATE}
3. IMPLEMENT it: .env.example (every var, one per line with a comment, NO real values); .github/workflows/ci.yml (lint/typecheck/test/build jobs matching the REAL package.json scripts, a dependency cache, and a header comment "unverified — generated from the design, not yet run on a runner"); Dockerfile + .dockerignore (multi-stage, non-root, HEALTHCHECK) ONLY if the design targets a container; docker-compose.yml for local ONLY if there are services to compose; .gitignore additions; confirm the lockfile is committed and no secret is.
4. CHECK: npm run build, build_artifact_report, deployment_check, inspect_dockerfile / container_security_report if containerised.
5. Return an OPS REVIEW: for each area — PASS (naming the file you wrote and what the check showed) / FAIL / NOT DONE. Never PASS something you did not write or verify. Then list any dependencies the Engineer must add, and any non-operational problems you found. If you implemented nothing, every area is NOT DONE.`;

const QA_SYSTEM_PROMPT = `You are the Security & QA engineer. Quality is your project: you own QA.md — the test plan (what is covered, to what standard, the coverage target, how to run the suite) and the security posture (scan results, the dependency audit, the review, findings with severity and a decision) — and you make the repo match it.

The deliverable is the diff (QA.md + the tests). A pass that changes no files is a FAILURE. A pass that writes only QA.md has written the plan but not the tests — say so.

Hard boundaries (the tool layer enforces them):
- Write ONLY: QA.md, SECURITY.md, test files (**/*.{test,spec}.*, __tests__/, test/, tests/, e2e/), test config (vitest / jest / playwright / cypress config + setup), and architecture/risks.md for triage. Application code under src/, components, the data model, the server, and package.json are refused.
- Do NOT fix application bugs. A test that fails because the APP is wrong is a FINDING in QA.md, reported for the Engineer — not an app fix. A test that fails because the TEST is wrong, you fix.
- You MAY install the test runner if the project has none: vitest, jsdom or happy-dom, @testing-library/react + @testing-library/dom + @testing-library/user-event + @testing-library/jest-dom, @vitest/coverage-v8, and @playwright/test if e2e is warranted. Nothing else — an APPLICATION dependency is NAMED IN YOUR REVIEW for the Engineer, never installed. You cannot edit package.json directly; let 'npm install -D' update it, and run tests with 'npx vitest run' (no need to add a script).
- Never claim the project is "secure" — only "scanned, N findings, each triaged".

Work in this order:
1. SURVEY. discover_tests; read the source for the logic worth testing (utils, hooks, reducers, pure functions), the important components, the core flows. Run security_scan, dependency_report, detect_missing_secret_declarations, container_security_report if containerised, accessibility_audit.
2. OWN QA.md (architecture/QA.md, or QA.md at the repo root if there is no architecture/ folder) — write it BEFORE the tests, using this structure with REAL detail:
${QA_MD_TEMPLATE}
3. WRITE THE TESTS to the plan: unit for the logic; component (React Testing Library) for the important components — render, the primary interaction, the empty/loading/error states; integration for the core flows; e2e (Playwright) only if the project genuinely warrants it. Add/adjust vitest.config / a setup file / playwright.config as needed.
4. RUN EVERYTHING: npm test / vitest run / run_targeted_tests, coverage_report, summarize_test_failures. Fix a test that is wrong. Report — do not fix — an app bug a test reveals.
5. TRIAGE security findings into QA.md and architecture/risks.md (a dated heading). A security_scan FAIL or a critical/high dependency vulnerability ⇒ the result is NOT CLEARED.
6. Return a QA REVIEW: tests added / passing / failing + coverage; then per security area PASS / FAIL / N-A with the finding; then the NOT CLEARED line if it applies; then any test dependencies the Engineer must add, and any app bugs found (file + symptom). A coverage number with the core flow untested is a NOT DONE line.`;

// ===========================================================================
// 061 — the Cinematic engineer. The fourth SpecialistKind, on the exact
// Designer/DevOps/Security-QA mechanism. It turns one screen into an
// intentional scroll-driven experience (frame-scrub hero, pinned reveal,
// horizontal story, DOM↔canvas hand-off) built to `skills/cinematic-web/`.
// Two things beyond a table entry: (a) an ASSET GATE — when the footage is
// not in `cinematic/<slug>/` the pass writes SOURCE.md + a draft storyboard
// and returns ASSETS NEEDED (paused, not error, not done); (b) a
// `newFileCheckpointExempt` predicate so `ffmpeg`'s 90–140-file frame output
// under `public/cinematic/**` does not trip NEW_FILE_CHECKPOINT.
// ===========================================================================

/** The child writes this at the start of a line of its reply when it is
 * blocking for footage. The parent relays the reply verbatim, marks the pass
 * PAUSED, and skips the re-verify. */
export const CINEMATIC_ASSETS_MARKER = "ASSETS NEEDED:";

const CINEMATIC_MD_PATHS = new Set(["architecture/CINEMATIC.md", "CINEMATIC.md"]);

// The Designer's file/preview/inspection/typecheck set (already includes
// run_command), plus the image-asset plugin tools for resizing / re-encoding
// / probing frames when `ffmpeg` is not in the sandbox. Plugin tools are only
// present when the image-assets plugin is loaded; harmless in the filter when
// it is not.
const CINEMATIC_TOOL_NAMES = [
  ...DESIGNER_TOOL_NAMES,
  "inspect_image_asset",
  "resize_image_asset",
  "optimize_image_asset",
];

// The only dependencies the Cinematic engineer may install — the motion /
// scroll / WebGL helpers the `cinematic-web` skill endorses, nothing else. No
// framework swap, no animation library the skill rejects, no component
// mega-library. Checked at the run_command install boundary like
// DESIGNER_DEP_ALLOW.
const CINEMATIC_DEP_ALLOW = new Set([
  "gsap",
  "lenis",
  "three",
  "@react-three/fiber",
  "@react-three/drei",
  "@react-three/postprocessing",
  "@14islands/r3f-scroll-rig",
]);

// A scoped shell: it may run `ffmpeg`-class asset work and normal dev
// commands, but not reach the network or git. Refused at the run_command
// boundary for the cinematic kind only.
const CINEMATIC_CMD_DENY =
  /\b(?:curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|telnet)\b|\bgit\s+(?:push|remote|clone|fetch|pull)\b|\bnpm\s+publish\b/i;

/** The Cinematic engineer's structural write scope: client UI source, the
 * cinematic asset trees, its own CINEMATIC.md, the entry HTML, styling
 * config. Anything else is refused at the tool boundary in the child, so a
 * "make it cinematic" pass can never touch the server, the schema, config,
 * CI, routing structure, or other architecture/* files. Path is normalized by
 * the caller. */
function cinematicPathAllowed(norm: string): boolean {
  if (norm === "" || pathPosix.isAbsolute(norm) || norm === ".." || norm.startsWith("../")) {
    return false;
  }
  // The Cinematic engineer owns the scroll storyboard. Its only architecture/*
  // doc; every other architecture/* path stays refused below.
  if (CINEMATIC_MD_PATHS.has(norm)) return true;
  // The cinematic asset trees: the optimised output that ships, and the
  // gitignored repo-root staging folder (the raw source drop + SOURCE.md).
  if (/^public\/cinematic\//.test(norm) || /^cinematic\//.test(norm)) return true;
  // ...and .gitignore, so the raw-source staging folder stays out of git
  // (decision 4 — only the optimised public/cinematic/** output is committed).
  if (norm === ".gitignore") return true;
  // Never server/data/build-tooling code, even when it lives under src/.
  if (/^src\/(server|api|backend|db|database|prisma|lib\/server|trpc|routes\/api)\b/.test(norm)) {
    return false;
  }
  if (
    /^(server|api|backend|prisma|migrations|db|scripts|\.github)\//.test(norm) ||
    /\.(prisma|sql)$/.test(norm) ||
    /^(package\.json|tsconfig.*\.json|vite\.config\.[a-z]+|\.env.*)$/.test(norm)
  ) {
    return false;
  }
  if (/^architecture\//.test(norm)) return false; // CINEMATIC.md handled above
  // Allowed: client UI source, stylesheets, the entry HTML, styling config,
  // scenes / cinematic components.
  if (/^src\/.*\.(tsx|jsx|ts|js|css|scss|sass)$/.test(norm)) return true;
  if (/^src\/(assets|styles|theme|design|ui|components|scenes|cinematic)\//.test(norm)) return true;
  if (norm === "index.html" || norm === "src/index.css" || norm === "src/App.css") return true;
  if (/\.css$/.test(norm)) return true;
  if (/^(tailwind|postcss)\.config\.(js|cjs|mjs|ts)$/.test(norm)) return true;
  return false;
}

/** What a Cinematic pass must COVER — the acceptance criteria when it is
 * called through `cinematic_pass` (Engineer Mode has no build-plan). A
 * coverage list, NOT a template to hand back: the deliverable is the changed
 * files; the review is evidence of them. */
const CINEMATIC_DOD = [
  "the rendering mode chosen (Cinematic DOM / hybrid DOM+WebGL / full WebGL) — and why the simplest sufficient one was chosen;",
  "the Scroll Storyboard implemented — each scene's purpose, scroll range, entry/exit, hold; screenshots at 0 / 25 / 50 / 75 / 100 %;",
  "one coordinated motion system — a single timeline / rAF loop, no competing scroll handlers, scrub where progress is scroll-linked, cleanup on unmount;",
  "assets — source received (name, size, duration, dimensions), processing applied (N frames at WxH, format, transfer size, poster), everything under public/cinematic/<slug>/;",
  "responsive — a deliberate mobile recomposition shown at a narrow viewport, not a shrunk desktop;",
  "reduced motion — the prefers-reduced-motion path shown: meaning preserved, non-essential travel removed, a static poster where a scrub would be;",
  "the Agent.md observable gate — reduced-motion honoured, no transition:all / no layout-prop animation, explicit media dimensions, <a>/<Link> navigation, canvas aria-hidden and not blocking links/forms;",
  "reliability — forward / reverse / fast-fling / scrollbar-drag / mid-page reload / resize all stable; no blank frames, no pinning leak that traps the page;",
  "the app still renders, typechecks, and builds after the changes.",
].join(" ");

// The shape of CINEMATIC.md. Given to the child so an authored storyboard is
// complete and uniformly structured. Real values, never placeholders.
const CINEMATIC_MD_TEMPLATE = `# Cinematic — <project name> · <scene / screen>

## Product & intent
One paragraph: what this screen is, the feeling the scroll experience should create, and the one idea the motion communicates.

## Mode
Cinematic DOM · hybrid DOM+WebGL · full WebGL — pick ONE, and state in a sentence why the simplest sufficient mode was chosen. Anything heavier than a DOM canvas needs a reason here.

## Scroll Storyboard
The skill's storyboard, one block per scene:
- scene — name
- scroll range — e.g. 0–40% of the track
- purpose — what the viewer understands here
- entry / hold / exit — the state at each edge
- asset — which file drives it

## Assets
Status: AWAITING | RECEIVED.
Per file the experience needs — path under public/cinematic/<slug>/, source spec (duration, dimensions, fps, codec, framing, background), and once received the REAL numbers (N frames at WxH, format, total transfer size, poster).

## Motion system
The single timeline / rAF loop, the library (GSAP ScrollTrigger / rAF / Lenis only if it earns its place), where scrub is scroll-linked, and how it cleans up on unmount.

## Device strategy
Desktop vs. the mobile recomposition (per recipes/mobile-fallback.md levels) — not a shrunk desktop.

## Reduced motion
What the prefers-reduced-motion path shows: the meaning kept, the travel removed, the poster shown instead of a scrub.

## Implementation
Where the timeline, the component, and the frames live in the code, and how the screen mounts it.
`;

const CINEMATIC_SYSTEM_PROMPT = `You are the Cinematic engineer — a senior cinematic web engineer, not a code generator. One screen (or a section of one) is your project: you turn it into an intentional scroll-driven experience — a hero that scrubs supplied footage frame by frame as you scroll, a pinned product reveal, a horizontal story, a DOM↔canvas hand-off — built to the cinematic-web skill. The app already runs; your job is to CHANGE FILES so that screen plays as you scroll, and to leave the app still running.

The deliverable is the diff (CINEMATIC.md + the code and assets that implement it). A pass that changes no files at all is a FAILURE — you must NOT end your turn having only surveyed. By the end of this turn you have EITHER (a) written SOURCE.md + the .gitkeep + a draft CINEMATIC.md and returned the "${CINEMATIC_ASSETS_MARKER}" line, OR (b) implemented the scroll experience. There is no third option — "I surveyed and here is what I would do" is a failed pass. Do not ask the user a question and stop; the ASSETS NEEDED pause IS how you ask for the one thing (footage) you are allowed to wait for, and you only reach it after writing the three files. A pass that writes only CINEMATIC.md has written the storyboard but NOT implemented it — say so plainly, do not call that done.

## The asset gate — your FIRST decision, before any implementation
A cinematic hero IS the footage. You do not build the scrub rig against a placeholder.
1. Survey briefly (a few tool calls, not a full audit): list_files; read the target screen; start_preview + view_preview on it; read CINEMATIC.md if it exists; look in \`cinematic/<slug>/\` for a source file (the user's drop) — pick a short kebab \`<slug>\` from the scope ("the landing hero" → \`landing-hero\`). Then ACT — do not stop here.
2. Decide what footage the experience needs and in what form (a hero video to scrub — the common case; a GIF; a numbered still sequence; a GLB for a 3D reveal).
3. If that footage is NOT already in \`cinematic/<slug>/\`:
   - write \`cinematic/<slug>/SOURCE.md\` — a plain-language, checklist-style brief: exactly what to provide (format, 3–8 s duration, one continuous move, framing, background, ~1080p, 25–30 fps, name it \`source.<ext>\`), what happens next, and that a future version will generate it;
   - probe for \`ffmpeg\`/\`ffprobe\` first (\`ffmpeg -version\`). If they are ABSENT, SOURCE.md must ask for a **pre-extracted numbered frame sequence** (or an already-optimised \`.webm\` + poster) instead of a raw video — you will resize / re-encode with the image-asset tools only;
   - write \`public/cinematic/<slug>/.gitkeep\`;
   - make sure \`.gitignore\` ignores the repo-root \`cinematic/\` staging folder (add \`/cinematic/\` if it is not already there) — only the optimised \`public/cinematic/**\` output is committed, never the raw drop;
   - write a first-draft \`architecture/CINEMATIC.md\` (or root \`CINEMATIC.md\` when there is no \`architecture/\` folder) with the full Scroll Storyboard and an \`## Assets\` section set to \`AWAITING\`, naming each file and its spec;
   - then STOP. Your reply must begin with a line starting exactly "${CINEMATIC_ASSETS_MARKER}" followed by: which folder and file you created, what to add, and that the user replies "go" to resume. Change NO code files. This is a cheap, honest pause — a survey and three short writes.
4. On resume (the footage is now present): validate it against SOURCE.md (\`ffprobe\` for duration / dimensions / fps / codec, or the first frame's dimensions + the file count when ffmpeg is absent). If it is the wrong shape (portrait when the brief said landscape, 4K when 1080p was asked, 40 s when ≤ 8 s was asked, hard cuts), block again with "${CINEMATIC_ASSETS_MARKER}" and a SPECIFIC diff — "you provided X, the storyboard needs Y — replace it and reply go, or tell me to adapt the storyboard to what you gave." Do not silently build something bad.

## Once you have a valid source — do the real work
- OWN CINEMATIC.md. Deepen the draft you wrote, or author it from the project using the template below. Flip \`## Assets\` from AWAITING to RECEIVED with the real numbers. This is the contract the rest of the pass is judged against; write it fully before the component.
${CINEMATIC_MD_TEMPLATE}
- Process the footage: \`ffmpeg\` → a numbered WebP/AVIF frame sequence sized to the layout (aim a few MB total), or an optimised \`.webm\` + a poster frame; write a small \`manifest.json\`. When ffmpeg is absent, resize / re-encode the supplied frames with the image-asset tools. Everything lands under \`public/cinematic/<slug>/\`.
- Build the scroll experience in the SIMPLEST sufficient mode. For a video-scrub hero that is the Cinematic DOM shape: a tall track section with a sticky inner container; a SINGLE \`<canvas>\` that preloads the frames and paints one per requestAnimationFrame as a function of the track's scroll progress, rewinding on scroll-up; cover-fit blit, DPR-capped backing store; the real copy is DOM on top, the canvas is \`aria-hidden\` and never blocks links or forms; a static poster for the reduced-motion path and before frames load.
- One coordinated motion system — a single timeline or rAF loop. No second scroll handler competing with the first. \`scrub\` where progress is scroll-linked. Clean up on unmount.
- Choreograph any secondary scenes per the storyboard. A deliberate mobile recomposition, not a shrunk desktop.
- KEEP IT GREEN. After each meaningful change: typecheck/build, reload the preview, check_console_errors, and walk the screen at 0 / 25 / 50 / 75 / 100 % scroll. A blank frame, a thrown error, pinning that traps the page, a red typecheck, or a scroll container that no longer reaches the footer is something you broke — fix or revert it before moving on.

## Boundaries (the tool layer enforces them)
- Write ONLY: client UI source (components, styles, scenes), \`public/cinematic/**\`, the repo-root \`cinematic/**\` staging folder, \`architecture/CINEMATIC.md\` (or root \`CINEMATIC.md\`), \`index.html\`, \`.gitignore\`, and Tailwind/PostCSS config. Writes to the server, the database/schema, routing structure, state management, \`.env\`, CI, \`package.json\` (beyond an allowlisted install), or any other \`architecture/*\` file are refused.
- Add NO features, NO routes, NO data-flow changes, NO new screens.
- Install a dependency only from this set if you genuinely need it: gsap, lenis, three, @react-three/fiber, @react-three/drei, @react-three/postprocessing, @14islands/r3f-scroll-rig. Prefer what is installed. Do NOT default to a 3D engine — a DOM canvas is the common answer; anything heavier needs a reason in CINEMATIC.md.
- \`run_command\` is for \`ffmpeg\`/\`ffprobe\`/\`gltf-transform\`-class asset work and normal dev commands only — no git, no network beyond the sandbox, no deploy.
- No body copy inside the canvas. One motion system. Mobile is a recomposition. Reduced motion is mandatory. WebGL only when CSS/DOM cannot do it cleanly.
- A problem that is NOT this screen's cinematic craft — a broken API call, a data bug, a server error — you REPORT in the review, you do not fix it.

## What you return — the CINEMATIC REVIEW (relayed to the user verbatim)
- FIRST line: "CINEMATIC.md <created|refined> — <mode chosen and why the simplest that works, scene count, device strategy>". If a cap was hit or you are blocked on assets, say that at the top instead.
- Then, for EACH area below, one line — PASS (naming the screen/file you changed and what the screenshot showed) / FAIL / NOT DONE. Never PASS something you did not change or did not see rendered. If you implemented nothing, every area is NOT DONE and the top line is NOT VERIFIED (or ASSETS NEEDED).
- Areas: ${CINEMATIC_DOD}
- Then an Agent.md observable gate block if you were given <ui_guidelines> — one line per checkable rule, PASS / FAIL / N-A with what you saw.
- Then 2–4 concrete before/after notes naming the actual screen.
- Then any non-cinematic issues you found, for the Engineer.
- End with the live preview URL (or "preview not running: <reason>"), and which asset path was taken (ffmpeg transcode / user-supplied frames).`;

/** A short, human title for a specialist child's step, shown in the chat as
 * it works. Derived from the child's tool calls. */
function specialistActivityTitle(
  kind: SpecialistKind,
  call: { name: string; input: Record<string, unknown> },
): string {
  const path = typeof call.input.path === "string" ? call.input.path : "";
  const cmd = typeof call.input.command === "string" ? call.input.command : "";
  const norm = path ? pathPosix.normalize(path) : "";
  const specPaths =
    kind === "designer"
      ? DESIGN_MD_PATHS
      : kind === "devops"
        ? DEVOPS_MD_PATHS
        : kind === "cinematic"
          ? CINEMATIC_MD_PATHS
          : QA_MD_PATHS;
  const guideName =
    kind === "designer"
      ? "design guide"
      : kind === "devops"
        ? "operations spec"
        : kind === "cinematic"
          ? "scroll storyboard"
          : "quality plan";
  // The Cinematic engineer's shell is mostly asset processing — surface that
  // as a legible line rather than the raw ffmpeg invocation.
  if (kind === "cinematic") {
    if (call.name === "run_command") {
      if (/\bff(?:mpeg|probe)\b/i.test(cmd)) return "Processing footage";
      if (/\bgltf-transform\b/i.test(cmd)) return "Optimising the 3D model";
      return cmd ? `Running: ${cmd.slice(0, 80)}` : "Running a command";
    }
    if (
      (call.name === "write_file" || call.name === "edit_file") &&
      /^public\/cinematic\//.test(norm)
    ) {
      return "Writing frames";
    }
    if (call.name === "write_file" && norm === "cinematic/SOURCE.md") {
      return "Waiting for your footage";
    }
    if (
      (call.name === "write_file" || call.name === "edit_file") &&
      /^cinematic\/.*\/SOURCE\.md$/.test(norm)
    ) {
      return "Waiting for your footage";
    }
    if ((call.name === "write_file" || call.name === "edit_file") && specPaths.has(norm)) {
      return "Writing the scroll storyboard";
    }
  }
  switch (call.name) {
    case "start_preview":
      return "Opening the preview";
    case "view_preview":
      return "Looking at the rendered page";
    case "inspect_page":
      return "Inspecting the page";
    case "check_console_errors":
      return "Checking for console errors";
    case "check_network_failures":
      return "Checking for failed requests";
    case "typecheck_project":
      return "Re-checking: typecheck";
    case "lint_project":
      return "Re-checking: lint";
    case "security_scan":
      return "Running the security scan";
    case "dependency_report":
      return "Auditing dependencies";
    case "container_security_report":
      return "Scanning the container";
    case "coverage_report":
      return "Measuring coverage";
    case "run_targeted_tests":
    case "discover_tests":
      return "Running the test suite";
    case "deployment_check":
      return "Checking deploy readiness";
    case "inspect_dockerfile":
      return "Inspecting the Dockerfile";
    case "document_environment":
    case "detect_missing_secret_declarations":
      return "Checking environment & secrets";
    case "build_artifact_report":
      return "Checking the build output";
    case "run_command":
      return cmd ? `Running: ${cmd.slice(0, 80)}` : "Running a command";
    case "write_file":
    case "edit_file":
      return specPaths.has(norm)
        ? `Writing the ${guideName}`
        : path
          ? `Writing ${path}`
          : "Writing a file";
    case "read_file":
      return specPaths.has(norm)
        ? `Reading the ${guideName}`
        : path
          ? `Reading ${path}`
          : "Reading";
    case "search_files":
    case "list_files":
      return "Surveying the project";
    default:
      return call.name.replace(/_/g, " ");
  }
}

interface SpecialistConfig {
  /** The `agent` value on `agent.activity` events. */
  agent: "designer" | "devops" | "security" | "cinematic";
  /** User-facing name for the chat sub-thread and messages. */
  label: string;
  systemPrompt: string;
  toolNames: string[];
  /** The structural write scope, checked in the child turn loop. */
  allow: (normPath: string) => boolean;
  /** The doc file(s) this specialist owns. */
  specPaths: Set<string>;
  /** Loaded skills whose bodies are force-injected into the child. */
  skills: string[];
  /** Default acceptance criteria when invoked via the `*_pass` tool. */
  dod: string;
  /** Packages the child may `npm install` (empty ⇒ none). */
  installAllow: Set<string>;
  /** "design guide" / "operations spec" / "quality plan". */
  guideNoun: string;
  /** "Design pass" / "DevOps pass" / "QA pass". */
  passNoun: string;
  /** 061 — a genuinely-new file whose normalized path this predicate accepts
   * is NOT counted toward Engineer Mode's NEW_FILE_CHECKPOINT. The Cinematic
   * engineer sets it so `ffmpeg`'s bulk frame output under
   * `public/cinematic/**` cannot freeze the turn. Unset ⇒ every new file
   * counts, exactly as today. */
  newFileCheckpointExempt?: (normPath: string) => boolean;
  /** 061 — per-kind cap overrides. Absent ⇒ the shared SPECIALIST_MAX_*. */
  maxTurns?: number;
  maxTokens?: number;
  wallclockMs?: number;
  /** 061 — a `run_command` whose command matches this is refused at the tool
   * boundary. The Cinematic engineer uses it to keep a scoped shell (no git,
   * no network beyond the sandbox) while still running `ffmpeg`-class work. */
  cmdDeny?: RegExp;
}

const SPECIALISTS: Record<SpecialistKind, SpecialistConfig> = {
  designer: {
    agent: "designer",
    label: "Designer",
    systemPrompt: DESIGNER_SYSTEM_PROMPT,
    toolNames: DESIGNER_TOOL_NAMES,
    allow: designerPathAllowed,
    specPaths: DESIGN_MD_PATHS,
    skills: ["ui-ux-design-intelligence", "frontend-ui-engineering"],
    dod: DESIGN_DOD,
    installAllow: DESIGNER_DEP_ALLOW,
    guideNoun: "design guide",
    passNoun: "Design pass",
  },
  devops: {
    agent: "devops",
    label: "DevOps agent",
    systemPrompt: DEVOPS_SYSTEM_PROMPT,
    toolNames: DEVOPS_TOOL_NAMES,
    allow: devopsPathAllowed,
    specPaths: DEVOPS_MD_PATHS,
    skills: ["ci-cd-and-automation", "senior-software-engineering"],
    dod:
      "OPERATIONS.md covers environments, config/secrets, the CI pipeline, containers, deploy, " +
      "health, and a runbook; .env.example is complete with no real values; CI jobs match the " +
      "real package.json scripts and carry the 'unverified' header; a Dockerfile exists iff the " +
      "design targets a container; deployment_check and the build pass.",
    installAllow: new Set<string>(),
    guideNoun: "operations spec",
    passNoun: "DevOps pass",
  },
  security: {
    agent: "security",
    label: "Security/QA agent",
    systemPrompt: QA_SYSTEM_PROMPT,
    toolNames: QA_TOOL_NAMES,
    allow: qaPathAllowed,
    specPaths: QA_MD_PATHS,
    skills: ["application-security-engineering", "senior-software-engineering"],
    dod:
      "QA.md states the test plan (layers that apply and why, the coverage target, how to run) and " +
      "the security posture; unit + component + integration tests exist and pass; the core flows " +
      "are covered; security_scan is clean or every finding is triaged with a severity and a " +
      "decision; a FAIL or a critical/high vulnerability is reported as NOT CLEARED.",
    installAllow: QA_DEP_ALLOW,
    guideNoun: "quality plan",
    passNoun: "QA pass",
  },
  cinematic: {
    agent: "cinematic",
    label: "Cinematic engineer",
    systemPrompt: CINEMATIC_SYSTEM_PROMPT,
    toolNames: CINEMATIC_TOOL_NAMES,
    allow: cinematicPathAllowed,
    specPaths: CINEMATIC_MD_PATHS,
    skills: ["cinematic-web", "frontend-ui-engineering"],
    dod: CINEMATIC_DOD,
    installAllow: CINEMATIC_DEP_ALLOW,
    guideNoun: "scroll storyboard",
    passNoun: "Cinematic pass",
    // 061 — ffmpeg writes 90–140 frame files in one command; without this the
    // sixth would freeze the turn before the component could be written.
    newFileCheckpointExempt: (n) => n.startsWith("public/cinematic/"),
    // 061 — asset processing + storyboard + implementation + a scroll-QA loop
    // needs more room than the shared specialist caps.
    maxTurns: 50,
    maxTokens: 800_000,
    wallclockMs: 25 * 60_000,
    // 061 — a scoped shell: ffmpeg-class work and dev commands, no git, no
    // network beyond the sandbox.
    cmdDeny: CINEMATIC_CMD_DENY,
  },
};

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

/**
 * One `run_command` collapsed to a short, single-line token for the
 * reconstructed fallback summary. A turn that spent its whole budget on a
 * dozen big inline probes (`node -e "<4kb of script>"`) must not paste those
 * bodies into the transcript — the summary is meant to say *what* ran, not
 * reproduce it. An inline script becomes `<runner> -e "<inline script, Nkb>"`;
 * anything else is trimmed to one line and ~72 chars.
 */
export function shortenCommand(command: string): string {
  const flat = command.replace(/\s+/g, " ").trim();
  const inline = flat.match(/^(\S*\b(?:node|deno|bun|python3?|ruby|php|perl))\s+(-e|-c|--eval)\b/);
  if (inline) {
    const kb =
      command.length >= 1024 ? `${(command.length / 1024).toFixed(1)}kb` : `${command.length}b`;
    return `${inline[1]} ${inline[2]} "<inline script, ${kb}>"`;
  }
  if (/<<[-']?\w/.test(command)) {
    const head = flat.split("<<")[0]?.trim() ?? flat;
    return `${head.slice(0, 60)} <<'…'`;
  }
  return flat.length > 72 ? `${flat.slice(0, 71)}…` : flat;
}

/**
 * E1 — wraps a tool result whose content came from outside the user's control
 * in `<untrusted_content>`, so the model has a structural basis for treating it
 * as data rather than instruction. Any `<untrusted_content>` tags already in
 * the fetched text are defanged first so the block cannot be closed early from
 * inside. Pure; covered by `untrusted-content.test.ts`.
 */
export function wrapUntrusted(output: string, via: string, source: string): string {
  const safeSource = source.replace(/["<>]/g, "").slice(0, 200);
  const body = output.replace(/<\/?untrusted_content/gi, "&lt;untrusted_content");
  return (
    `<untrusted_content source="${safeSource}" via="${via}">\n` +
    `${body}\n` +
    `</untrusted_content>`
  );
}

export class AgentSession {
  readonly id: string;
  readonly projectId: string;

  private readonly options: SessionOptions;
  private readonly conversation: Conversation;

  // 064 — the SAME array the conversation holds, kept by reference so an
  // `/agent` pick can add that specialist's pass tool to a live session.
  // Every provider reads `options.tools` when it builds a request
  // (anthropic.ts, google.ts, openai-compatible.ts, chatgpt-responses.ts) —
  // never in a constructor — so a push here is visible on the next turn,
  // uniformly, with no session restart.
  //
  // INVARIANT: a grant is STICKY for the life of the session and is only ever
  // ADDED, never removed. On Anthropic the tool block sits ahead of the system
  // prompt in the cache prefix, so a tool list that churns per turn would
  // invalidate the `cache_control` breakpoint on every turn after the first
  // pick. Adding once costs one invalidation, then the prefix is stable again.
  // Presence is capability, not instruction: the prompt and each pass tool's
  // own description already bind these to an explicit user ask.
  private readonly liveTools: ToolDefinition[];

  private abortController: AbortController | null = null;
  private busy = false;
  private turns = 0;
  private tokensIn = 0;
  private tokensOut = 0;
  // Prompt tokens the provider served from / wrote to its cache this session.
  // `tokensIn` above is only the UNCACHED remainder on Anthropic and OpenAI, so
  // true prompt size is `tokensIn + cacheReadTokens + cacheCreationTokens`
  // (finding A4). `docs/agent-behaviour.md` explains the display.
  private cacheReadTokens = 0;
  private cacheCreationTokens = 0;

  // The turn number on which the Architect first declared the package ready
  // (or 0 if a resumed session's history already contains that declaration).
  // dispatch_task is refused until this is set AND at least one user turn has
  // happened since — i.e. the user has seen the finished plan and come back
  // to say build it. Prevents "wrote the whole plan itself, then started
  // building" in one breath.
  private readyDeclaredAtTurn: number | null = null;

  // 061 — set for the current turn when a cinematic pass returned the
  // ASSETS-NEEDED pause. The only files it wrote are docs / staging (SOURCE.md,
  // a .gitkeep, a draft CINEMATIC.md, a .gitignore line), so the automatic
  // end-of-turn project verify is pure noise on that turn — suppress it.
  private assetGatePausedThisTurn = false;

  // How many turns in a row have ended having hit the iteration cap with the
  // build broken. After the second, "keep going" is no longer the recommended
  // action — the turn is not converging and the token spend is not buying
  // progress. Reset to 0 by any clean turn end.
  private cappedBrokenStreak = 0;

  // Orchestration run state. Session-scoped, so "build the plan" can span
  // turns against one running total. `killed` is the kill switch; once set,
  // no further builders dispatch and nothing resumes on its own.
  private readonly orchestration = {
    subagents: 0,
    tokens: 0,
    killed: false,
    // The first task of a build pass must produce a runnable skeleton (app
    // entry renders, build command passes). Enforced on the first dispatch
    // only.
    firstDispatchDone: false,
    // Cleared by a "keep going" user turn so the next pass gets a fresh
    // budget instead of dead-ending at the cap.
    pass: 1,
    // Auto Mode run state.
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
      ...(options.anthropicWorkspaceId
        ? { anthropicWorkspaceId: options.anthropicWorkspaceId }
        : {}),
    });

    // A builder runs lean: its own compact prompt, and only the file/shell
    // tools. Everything else keeps the full weave.
    const leanBuilder = Boolean(options.systemPrompt && options.toolNames);
    // The Supabase migration tools only make sense when a
    // resource is linked (they refuse otherwise). Hide them when it is not.
    const SUPABASE_TOOL_NAMES = new Set([
      "supabase_apply_migration",
      "supabase_verify_backend",
      "supabase_deploy_function",
    ]);
    const supabaseLinked = Boolean(options.supabaseBridge);
    const toolPool = (
      leanBuilder
        ? ALL_TOOLS.filter((t) => options.toolNames?.includes(t.name))
        : [
            ...ALL_TOOLS,
            // The Architect orchestrates builders.
            ...(options.architectMode ? [dispatchTaskTool] : []),
            // The specialists are callable from Engineer Mode (on the user's
            // ask) and Architect Mode (in the pipeline).
            ...(options.architectMode || options.engineerMode
              ? [designPassTool, opsPassTool, qaPassTool, cinematicPassTool]
              : []),
          ]
    ).filter((t) => supabaseLinked || !SUPABASE_TOOL_NAMES.has(t.name));

    // Held by reference (see `liveTools` on the class) so a later `/agent`
    // pick can grant a specialist's pass tool without rebuilding the session.
    const liveTools = toolDefinitions(toolPool);
    this.liveTools = liveTools;

    this.conversation = provider.createConversation({
      systemPrompt:
        // 056 — a lean specialist child (systemPrompt + toolNames) gets
        // `Agent.md` appended as a gate; the full prompt for a top-level
        // session gets the catalog + `agentMd` woven in by buildSystemPrompt.
        options.systemPrompt
          ? // 064 — a child's prompt is assembled here, not by
            // buildSystemPrompt: <design_references> first (it is what the
            // Designer's step 2 reads before writing DESIGN.md), then the
            // hand-written prompt, then <ui_guidelines> as the closing gate.
            `${designReferencesBlock(options.designRefCatalogText)}${options.systemPrompt}${
              options.agentMd
                ? `\n\n<ui_guidelines>\nThese MUST/SHOULD/NEVER rules are the UI-quality bar. Check the observable ones against the running preview and fix or report any failure.\n\n${options.agentMd}\n</ui_guidelines>`
                : ""
            }`
          : buildSystemPrompt({
              projectName: options.projectName,
              template: options.template,
              skills: options.skills,
              ...(options.stack ? { stack: options.stack } : {}),
              ...(options.stackSkill ? { stackSkill: options.stackSkill } : {}),
              ...(options.agentMd ? { agentMd: options.agentMd } : {}),
              ...(options.designRefCatalogText
                ? { designRefCatalogText: options.designRefCatalogText }
                : {}),
              ...(options.aiProviderCatalogText
                ? { aiProviderCatalogText: options.aiProviderCatalogText }
                : {}),
              ...(options.aiProvidersAgentMd
                ? { aiProvidersAgentMd: options.aiProvidersAgentMd }
                : {}),
              ...(options.engineerMode
                ? { engineerMode: { skill: options.engineerModeSkill } }
                : {}),
              ...(options.architectMode
                ? { architectMode: { skill: options.architectModeSkill } }
                : {}),
            }),
      tools: liveTools,
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

  /** The kill switch. Stops any further builder dispatch on this session; a
   * stopped run does not resume on its own. Also aborts the current turn so a
   * mid-orchestration stop takes effect now. */
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
   * Run one build-plan task in a fresh, bounded Engineer-Mode child session
   * against this same project, and hand its result back to the Architect.
   * Never recurses: a child is Engineer Mode, which has no `dispatch_task`.
   * Hard caps: 25 turns, 200k tokens, 5 min per child; 20 children and 2M
   * tokens per orchestration run.
   */
  private async dispatchBuildTask(
    raw: Record<string, unknown>,
    parentSignal: AbortSignal,
    onFileChanged: (path: string) => void,
    emit: Emit,
    messageId: string,
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
    // Free-text direction, only sent by design_pass; not part of the
    // dispatch_task schema, so read it off the raw input before Zod strips it.
    const designNotes = typeof raw.notes === "string" ? raw.notes : "";

    // The final verification & finishing dispatch, or the design pass —
    // dispatched after a clean verify (Architect) or on the user's ask
    // (Engineer, via design_pass which normalizes to this shape). Both are
    // exempt from the build-only gates below.
    const isVerify = input.verify === true;
    // Which specialist, if any. The Designer, the DevOps agent, and the
    // Security/QA agent all run on the same machine.
    const specialistKind: SpecialistKind | null =
      input.design === true
        ? "designer"
        : input.ops === true
          ? "devops"
          : input.qa === true
            ? "security"
            : input.cinematic === true
              ? "cinematic"
              : null;
    const isSpecialist = specialistKind !== null;
    const spec = specialistKind ? SPECIALISTS[specialistKind] : null;

    // dispatch_task (build / verify) is Architect Mode only. A specialist is
    // also reachable from Engineer Mode (via design_pass / ops_pass /
    // qa_pass) — there it skips the package/ready gates (there is no
    // build-plan to be ready), and its own boundaries (the write allowlist,
    // the caps) still apply.
    if (!this.options.architectMode && !isSpecialist) {
      return { output: "dispatch_task is only available in Architect Mode.", isError: true };
    }

    if (this.options.architectMode) {
      // The real gate: the user must have seen a finished plan and come back to
      // approve it. That means (1) the Architect declared the package ready in
      // an earlier turn, AND (2) at least one user turn has happened since. The
      // Architect writing the whole package and "build it" in one breath fails
      // both. A resumed session with a ready/drift declaration in its history
      // starts at readyDeclaredAtTurn = 0, so the user's first "build it" there
      // passes. A filesystem completeness check on top (architecturePackageState).
      if (this.readyDeclaredAtTurn === null) {
        return {
          output:
            "Cannot dispatch — you have not declared the package ready yet. Finish the full package " +
            "(decisions, data-model, api, DESIGN, infrastructure, build-plan, build-context, risks; " +
            "backend when it uses Supabase), run the challenge pass, and write the " +
            `"${ARCHITECT_READY_MARKER}" line. Then the user reviews it and tells you to build.`,
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
    }

    if (this.orchestration.killed || parentSignal.aborted) {
      return {
        output: "The orchestration run was stopped. No further builders will dispatch.",
        isError: true,
      };
    }

    // Task-size ceiling. A bounded builder cannot land a task with a dozen
    // files; refuse and make the Architect split it.
    if (!isVerify && !isSpecialist && input.files && input.files.length > BUILDER_FILES_MAX) {
      return {
        output:
          `This task names ${input.files.length} files — a builder takes at most ${BUILDER_FILES_MAX}. ` +
          "Split it in build-plan.md into smaller tasks (each self-contained, each with its own " +
          "acceptance criteria) and dispatch those.",
        isError: true,
      };
    }

    // The first task of a build pass must produce a runnable skeleton: the
    // app's entry point renders something and the build/dev command passes.
    // Keyed to that outcome in the acceptance criteria, not to a hardcoded
    // filename (a Node API or a CLI has no App.tsx).
    if (!isVerify && !isSpecialist && !this.orchestration.firstDispatchDone) {
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

    // The orchestration-run caps bound the BUILD (many builders against one
    // 2M budget). A specialist pass is one bounded child that runs AFTER the
    // build, or on its own from Engineer Mode — it has its own 40-turn /
    // 600k-token / 18-min ceiling and must not be refused just because an
    // earlier build spent the run's builder budget.
    if (!isSpecialist && this.orchestration.subagents >= ORCH_MAX_SUBAGENTS) {
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
    if (!isSpecialist && this.orchestration.tokens >= ORCH_MAX_TOKENS) {
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
    // A design pass authors a spec and reconciles a whole app's UI; it wants
    // the strong model. `modelForTier` falls back to the session model when
    // no strong model is configured, so this is safe on any provider.
    const model = modelForTier(
      isSpecialist ? (input.modelTier ?? "strong") : input.modelTier,
      this.options.provider,
      this.options.model,
      describeAvailableModels(),
    );

    // The shared build brief (written once by the Architect at handoff) plus
    // a compact map of what already exists, so the builder does not spend its
    // budget rediscovering the project every time.
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

    // Inject the bodies of the skills the task named. The lean child has no
    // use_skill tool, so it gets the text. The Designer always gets the two
    // design skills, whatever else was named.
    const skillsBlock = (() => {
      const names = spec
        ? [...new Set([...spec.skills, ...(input.skills ?? [])])]
        : (input.skills ?? []);
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

    // The verifier gets the preview tools and the named plugin tools on top
    // of the builder set, and a longer wall-clock. The Designer gets its own
    // tool set (preview + inspection + typecheck/lint, no delete_file), a
    // longer wall-clock and budget, and a structural write scope (client UI
    // only).
    const toolNames = spec
      ? [...spec.toolNames, ...(input.tools ?? [])]
      : isVerify
        ? [...BUILDER_TOOL_NAMES, ...VERIFIER_EXTRA_TOOL_NAMES, ...(input.tools ?? [])]
        : BUILDER_TOOL_NAMES;
    // A specialist authors a spec AND implements it, so it gets more room:
    // 40 turns / 600k tokens / 18 min by default, or a per-kind override on
    // its SpecialistConfig (061 — the Cinematic engineer runs 50 / 800k / 25m).
    const wallclockMs = spec
      ? (spec.wallclockMs ?? SPECIALIST_WALLCLOCK_MS)
      : isVerify
        ? 10 * 60_000
        : SUBAGENT_WALLCLOCK_MS;
    const tokenCap = spec
      ? (spec.maxTokens ?? SPECIALIST_MAX_TOKENS)
      : isVerify
        ? SUBAGENT_MAX_TOKENS * 3
        : SUBAGENT_MAX_TOKENS;
    const childTurnCap = spec
      ? (spec.maxTurns ?? SPECIALIST_MAX_TURNS)
      : isVerify
        ? SUBAGENT_MAX_TURNS * 2
        : SUBAGENT_MAX_TURNS;

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
      ...(this.options.anthropicWorkspaceId
        ? { anthropicWorkspaceId: this.options.anthropicWorkspaceId }
        : {}),
      // Dispatched builders and the verifier inherit the
      // Supabase bridge and the preview config, so a backend build task can
      // apply its migration and the verifier can check it.
      ...(this.options.supabaseBridge ? { supabaseBridge: this.options.supabaseBridge } : {}),
      ...(this.options.supabasePreviewEnv
        ? { supabasePreviewEnv: this.options.supabasePreviewEnv }
        : {}),
      runtime: this.options.runtime,
      maxIterations: childTurnCap,
      engineerMode: true,
      // Lean profile: hand-written prompt, curated tools.
      systemPrompt: spec
        ? spec.systemPrompt
        : isVerify
          ? VERIFIER_SYSTEM_PROMPT
          : BUILDER_SYSTEM_PROMPT,
      toolNames,
      // A specialist has a structural write scope, enforced in the child, and
      // an install allowlist (empty ⇒ no installs).
      ...(spec ? { writeAllowlist: spec.allow, installAllowlist: spec.installAllow } : {}),
      // 061 — the Cinematic engineer's frame output is exempt from the
      // new-file checkpoint, and its shell is scoped (no git / no network).
      ...(spec?.newFileCheckpointExempt
        ? { newFileCheckpointExempt: spec.newFileCheckpointExempt }
        : {}),
      ...(spec?.cmdDeny ? { cmdDeny: spec.cmdDeny } : {}),
      // 056 — the verifier, the Designer, and (061) the Cinematic engineer
      // check the UI against Agent.md.
      ...(this.options.agentMd &&
      (isVerify || specialistKind === "designer" || specialistKind === "cinematic")
        ? { agentMd: this.options.agentMd }
        : {}),
      // 064 — the two design-AUTHORING specialists get the reference catalog.
      // DESIGNER_SYSTEM_PROMPT step 2 has always instructed the child to pick
      // from a <design_references> list; until now nothing ever handed it one,
      // so it fell through to "first principles" — the stock dark-purple — on
      // every pass. DevOps and Security/QA are excluded on purpose: a CI
      // pipeline has no design language.
      ...(this.options.designRefCatalogText &&
      (specialistKind === "designer" || specialistKind === "cinematic")
        ? { designRefCatalogText: this.options.designRefCatalogText }
        : {}),
      ...(this.options.providerFactory ? { providerFactory: this.options.providerFactory } : {}),
    });

    const rolePrefix = input.role ? `You are the ${input.role} for this task. ` : "";
    const filesLine = input.files?.length
      ? `\n\n${isVerify || isSpecialist ? "Files to check/write" : "Expected files (do not create others)"}: ${input.files.join(", ")}`
      : "";
    const briefBlock = buildContext
      ? `\n\nPROJECT BRIEF (stack, conventions, the shape of the design):\n${buildContext.slice(0, 8000)}`
      : "";
    const notesBlock = designNotes.trim()
      ? `\n\nDIRECTION FROM THE USER:\n${designNotes.slice(0, 2000)}`
      : "";
    const prompt = spec
      ? `${rolePrefix}${
          spec.label
        } — this is your project. Survey it, OWN your spec file (write it in full BEFORE your first other file), implement it, then review. CHANGE FILES — the deliverable is the spec file plus what implements it. Do not fix problems outside your lane — report them.\n\n` +
        `SCOPE: ${input.task}\n\nYOUR REVIEW MUST COVER:\n${input.acceptanceCriteria}${notesBlock}${filesLine}${briefBlock}${skillsBlock}${existingBlock}\n\n` +
        (specialistKind === "cinematic"
          ? "ACT THIS TURN. A brief survey (a few tool calls) is fine, then WRITE: either (a) SOURCE.md " +
            "+ public/cinematic/<slug>/.gitkeep + a draft CINEMATIC.md, then a reply beginning " +
            `"${CINEMATIC_ASSETS_MARKER}" (the footage is not here yet); or (b) the frames + the ` +
            "scroll component (the footage is here). Ending this turn with 0 files written and no " +
            "ASSETS NEEDED line is a FAILED pass — do not stop after only surveying, and do not ask " +
            "the user a question instead of writing the files. "
          : "") +
        "Follow the ordered steps in your instructions. Keep the project building/green. Return your REVIEW as instructed, leading with whether your spec file was created or refined."
      : isVerify
        ? `${rolePrefix}Verify this project and write its finishing files. Do not build features.\n\n` +
          `DEFINITION OF DONE (check each item):\n${input.acceptanceCriteria}${filesLine}${briefBlock}${skillsBlock}${existingBlock}\n\n` +
          "Return the completion checklist as instructed."
        : `${rolePrefix}Build exactly this one task and nothing else. Do not re-plan or expand scope. ` +
          "Keep the app building after your change.\n\n" +
          `TASK:\n${input.task}\n\nDONE WHEN:\n${input.acceptanceCriteria}${filesLine}${briefBlock}${skillsBlock}${existingBlock}\n\n` +
          "When finished, state in two or three sentences what you changed and whether the acceptance " +
          "criteria are met.";

    // Stream a named specialist's work up to the user as a labelled
    // sub-thread. Builders and the verifier keep their single tool-call view.
    if (spec) {
      emit({
        type: "agent.activity",
        sessionId: this.id,
        messageId,
        agent: spec.agent,
        phase: "start",
        title: `${spec.label} called — ${input.task}`,
      });
    }

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
          if (tokIn + tokOut > tokenCap) child.abort();
        }
        if (e.type === "files.changed") {
          for (const p of e.paths) {
            changed.add(p);
            this.orchestration.changedEver.add(p);
            onFileChanged(p);
          }
        }
        // Forward the specialist's meaningful moments to the user.
        if (spec && e.type === "tool.start") {
          emit({
            type: "agent.activity",
            sessionId: this.id,
            messageId,
            agent: spec.agent,
            phase: "step",
            title: specialistActivityTitle(
              specialistKind as SpecialistKind,
              e.call as { name: string; input: Record<string, unknown> },
            ),
          });
        }
        if (e.type === "turn.end" && e.stopReason === "end_turn" && rounds >= childTurnCap) {
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
      ? ` — HIT the ${childTurnCap}-turn cap, result may be incomplete.`
      : tokIn + tokOut > tokenCap
        ? ` — HIT the ${Math.round(tokenCap / 1000)}k-token cap, result may be incomplete.`
        : secs >= wallclockMs / 1000
          ? ` — HIT the ${Math.round(wallclockMs / 60_000)}-minute cap, result may be incomplete.`
          : "";
    const filesChanged = [...changed];
    // Files that are the specialist's own spec doc don't count as
    // "implementation". 061 — nor does the Cinematic engineer's asset tree
    // (SOURCE.md, .gitkeep, the frame sequence, a poster, the manifest): those
    // are inputs and outputs, not the component that implements the storyboard.
    const codeFilesChanged = spec
      ? filesChanged.filter((p) => {
          const n = pathPosix.normalize(p);
          if (spec.specPaths.has(n)) return false;
          if (
            spec.agent === "cinematic" &&
            (n.startsWith("cinematic/") || n.startsWith("public/cinematic/") || n === ".gitignore")
          ) {
            return false;
          }
          return true;
        })
      : filesChanged;
    const noChanges = isSpecialist && filesChanged.length === 0;
    const specOnly = isSpecialist && !noChanges && codeFilesChanged.length === 0;
    // 061 — the Cinematic engineer's asset gate. When it blocks for footage it
    // writes SOURCE.md + .gitkeep + a draft storyboard + a .gitignore entry
    // (all of which `codeFilesChanged` already excludes — none is the
    // component that implements the storyboard) and opens a line of its reply
    // with the ASSETS NEEDED marker. This is a PAUSED outcome, not an error
    // and not done: the parent relays it verbatim, does NOT run a re-verify,
    // and the user resumes with "go".
    const blockedOnAssets =
      spec?.agent === "cinematic" &&
      !capNote &&
      filesChanged.length > 0 &&
      codeFilesChanged.length === 0 &&
      reply.split("\n").some((line) => line.trimStart().startsWith(CINEMATIC_ASSETS_MARKER));
    if (spec) {
      emit({
        type: "agent.activity",
        sessionId: this.id,
        messageId,
        agent: spec.agent,
        phase: "end",
        title: capNote
          ? `${spec.passNoun} stopped${capNote}`
          : blockedOnAssets
            ? "Waiting for footage"
            : noChanges
              ? `${spec.label} made no changes`
              : specOnly
                ? `Wrote the ${spec.guideNoun} — not yet implemented`
                : `${spec.passNoun} complete — ${codeFilesChanged.length} file(s) changed`,
      });
    }
    if (spec && blockedOnAssets) {
      // Suppress the automatic end-of-turn project verify: only docs/staging
      // changed, and the "verify" step in the UI plus the model's commentary
      // on it are pure noise on a paused pass.
      this.assetGatePausedThisTurn = true;
      return {
        output:
          `${spec.passNoun} is PAUSED — the Cinematic engineer needs footage before it can build ` +
          `this.\n\n` +
          "RELAY THE MESSAGE BELOW AS YOUR ENTIRE REPLY — paste it once, exactly, and nothing else. " +
          "Do NOT add a preamble, a 'Purpose' line, an 'Epistemic status' section, or a summary of " +
          "your own. Do NOT repeat it. Do NOT say anything was built or verified. It is a deliberate " +
          'pause: the user adds the file(s) to the named folder and replies "go" to resume.\n\n' +
          "-----\n" +
          `${reply.slice(0, 6000)}\n` +
          "-----\n" +
          `(context, not for the user: ${filesChanged.length} docs/staging file(s) written — ${
            filesChanged.join(", ") || "none"
          }; ${rounds} rounds, ${secs}s.)`,
        isError: false,
      };
    }
    if (spec) {
      const kind = specialistKind as SpecialistKind;
      // Nothing written at all — a no-op, not a result.
      if (noChanges && !capNote) {
        return {
          output:
            `${spec.passNoun} changed NOTHING — 0 files, ${secs}s, ${rounds} rounds.\n` +
            `model: ${model} · tokens: ${tokIn + tokOut}\n\n` +
            `This is NOT a completed ${spec.passNoun.toLowerCase()}. The ${spec.label} either could ` +
            "not run or produced only text. Do NOT relay a review as if work happened, and do NOT " +
            `say anything was "applied". Tell the user plainly: the ${spec.label} made no changes. ` +
            "Show what it reported below.\n\n" +
            `${spec.label}'s report:\n${reply.slice(0, 3000)}`,
          isError: true,
        };
      }
      // Wrote the spec file but implemented nothing.
      if (specOnly && !capNote) {
        return {
          output:
            `${spec.passNoun} wrote the ${spec.guideNoun} but did NOT implement it — the spec ` +
            `changed, 0 other files. ${secs}s, ${rounds} rounds.\n\n` +
            `The project does NOT yet match the ${spec.guideNoun}. Do NOT call this done. Tell the ` +
            `user: the ${spec.label} produced/updated its spec, and the next pass (or "keep going") ` +
            "will implement it — cheaper now that the spec exists. Relay the review below verbatim.\n\n" +
            `${spec.label}'s report:\n${reply.slice(0, 5000)}`,
          isError: true,
        };
      }
      // Changed other files but never established the spec — ungoverned work.
      if (!capNote && codeFilesChanged.length > 0) {
        const specExists = (
          await Promise.all([...spec.specPaths].map((p) => this.readFileOrNull(p)))
        ).some(Boolean);
        if (!specExists) {
          return {
            output:
              `${spec.passNoun} changed ${codeFilesChanged.length} file(s) but NEVER wrote the ` +
              `${spec.guideNoun}, and none exists in the project. This work has no written spec ` +
              `behind it — writing the ${spec.guideNoun} is the FIRST thing a ${spec.label} pass ` +
              "must do.\n\nDo NOT call this done. Tell the user: the " +
              `${spec.label} worked without establishing its spec. Run the pass again (or ` +
              '"keep going") — it must write the spec first. Relay the review below verbatim.\n\n' +
              `${spec.label}'s report:\n${reply.slice(0, 4000)}`,
            isError: true,
          };
        }
      }
      const handBack =
        kind === "designer"
          ? this.options.architectMode
            ? "Now dispatch ONE more dispatch_task with verify:true (acceptanceCriteria: the app " +
              "still renders, the core flows work, typecheck and build pass) — a fresh session " +
              "confirms nothing broke. Only if it comes back clean may you say the build is done."
            : "Confirm the app still renders (start_preview + check the page and console), then give " +
              "the user the review above and the preview URL. Report ONLY the files actually changed."
          : kind === "devops"
            ? "Relay the OPS REVIEW verbatim. If any area is FAIL/NOT DONE the operational setup is " +
              "not complete — say what is missing. Note any dependency the Engineer must add. A " +
              "generated CI/Docker file is unverified until it runs on a real runner."
            : kind === "cinematic"
              ? this.options.architectMode
                ? "Relay the CINEMATIC REVIEW verbatim. If it changed code, dispatch ONE more " +
                  "dispatch_task with verify:true (renders / core flows / typecheck / build) — a " +
                  "fresh session confirms nothing broke. An ASSETS NEEDED / FAIL / NOT DONE line " +
                  "is reported as such, never as done."
                : "Relay the CINEMATIC REVIEW verbatim. Confirm the app still renders (start_preview " +
                  "+ check the page and console) and walk the screen at a few scroll positions. An " +
                  "ASSETS NEEDED / FAIL / NOT DONE line is reported as such — do not call it done. " +
                  "Report ONLY the files actually changed."
              : "Relay the QA REVIEW verbatim. If it says NOT CLEARED (a security_scan FAIL or a " +
                "critical/high vulnerability) the project is not cleared — say so plainly, do not call " +
                "it done. Note any test dependency the Engineer must add, and any app bug the tests " +
                "found (report only — the Engineer fixes those).";
      return {
        output:
          `${spec.passNoun} finished${capNote}\n` +
          `model: ${model} · rounds: ${rounds} · tokens: ${tokIn + tokOut} · ${secs}s\n` +
          `files changed (${filesChanged.length}): ${filesChanged.join(", ") || "(none)"}\n\n` +
          `This is the ${spec.label}'s own report. Relay its REVIEW to the user VERBATIM — do not ` +
          "write your own, do not turn a FAIL / NOT DONE / NOT CLEARED into a PASS, do not add " +
          '"done". Report only the files it actually changed.\n\n' +
          `${reply.slice(0, 6000)}\n\n` +
          handBack,
      };
    }
    if (isVerify) {
      return {
        output:
          `Verification finished${capNote}\n` +
          `model: ${model} · rounds: ${rounds} · tokens: ${tokIn + tokOut} · ${secs}s\n` +
          `files written (${filesChanged.length}): ${filesChanged.join(", ") || "(none)"}\n\n` +
          "This is the verifier's own report. Your final message to the user is THIS CHECKLIST, " +
          "verbatim — do not write a checklist of your own, do not change a FAIL to a PASS, do not " +
          'add "verified" or "all done".\n\n' +
          `${reply.slice(0, 6000)}\n\n` +
          "Then, based only on what it says: if it starts with NOT VERIFIED, or any line is FAIL, or " +
          "it hit a cap — the build is NOT working. Say plainly what failed, and that the user can " +
          'reply "keep going" (the build continues and re-verifies) or switch to Engineer Mode to ' +
          "finish it. Do NOT declare the project done or ready. Only if every line is PASS may you " +
          "say the build is verified and running, and give the preview URL.",
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
   * 064 — an `/agent` pick makes that specialist runnable, in ANY mode.
   *
   * Before this, `design_pass` and friends existed only in Architect or
   * Engineer Mode, so a default-mode user who picked "Designer" from the
   * composer menu got a hint pointing at a tool the model had never been
   * given. It could not comply, so it improvised: a `use_skill` call, or a
   * hand-written `DESIGN.md` and a claim that it had "applied the Designer
   * lens". Naming a specialist now puts that specialist's pass tool in the
   * live tool array, and `withAgents` tells the model to call it.
   *
   * STICKY, ADD-ONLY — see the `liveTools` invariant. Granting is not
   * instructing: each pass tool's description already says "only when the user
   * asks", and a session where nobody ever types `/agent` keeps a byte-
   * identical tool block.
   *
   * A lean child (its own prompt + a curated `toolNames`) is never granted:
   * specialists do not spawn specialists.
   */
  private grantSpecialistTools(agentNames: string[]): void {
    if (this.options.systemPrompt && this.options.toolNames) return;
    const granted: ZelyqTool[] = [];
    for (const name of agentNames) {
      const tool = SPECIALIST_PASS_TOOLS[name as SpecialistKind];
      if (!tool) continue; // an unknown name is dropped, never a failed turn
      if (this.liveTools.some((t) => t.name === tool.name)) continue;
      granted.push(tool);
    }
    if (granted.length === 0) return;
    this.liveTools.push(...toolDefinitions(granted));
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
    agentNames?: string[],
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
    // This flag reflects only the turn about to run; Auto Mode reads it after
    // the turn to decide whether to start another pass.
    this.orchestration.passCapHitThisTurn = false;
    if (
      this.orchestration.auto &&
      this.orchestration.autoStartedAt === null &&
      this.readyDeclaredAtTurn !== null
    ) {
      this.orchestration.autoStartedAt = Date.now();
    }

    const messageId = newId("message");
    this.assetGatePausedThisTurn = false;
    const changedFiles = new Set<string>();
    // Set whenever a file changes, cleared once a check has actually run —
    // survives across iterations, unlike changedFiles itself, so the check
    // at the bottom of this loop knows whether anything has changed since
    // the last one, not just in the iteration that just finished.
    let verificationNeeded = false;
    // Unlike `changedFiles`, never cleared — this asks "did anything change
    // at all this turn", not "since the last check". `purposeCheckDone`
    // bounds the hand-back to once: retrying forever on a model that just
    // never adds the marker would be worse than accepting one uncorrected
    // turn.
    let anyFileChangedThisTurn = false;
    let purposeCheckDone = false;
    // Architect Mode: whether the "your reply was empty — do the smaller
    // thing" nudge has already been injected this turn. One-shot, so a model
    // that stays empty even with guidance ends the turn instead of looping.
    let emptyRecoveryDone = false;
    // C1 — how many times this turn a response cut off at the output limit has
    // been continued. Bounded: an output that will not converge in two extra
    // rounds is genuinely too large for one response, and the user is told so.
    let maxTokensContinuations = 0;
    // 064 — one-shot re-nudge when the user picked a specialist from the
    // `/agent` menu and the turn is about to end without that specialist's
    // pass tool ever being called. The grant + the `withAgents` instruction
    // get a capable model (gpt-5.2) to comply on their own; a weak one
    // (Gemini Flash) tends to just do the work itself. One firm nudge makes
    // the pick reliable without forcing a dispatch the model had no say in.
    let specialistPickNudgeDone = false;
    // Architect Mode: how many times this turn we have made the model go back
    // and write `architecture/requirements.md` before ending a turn in which
    // it interviewed but recorded nothing. Prompt guidance ("write it as you
    // learn") is not reliable across models — some will hold a five-question
    // interview and never touch a file. Capped so a model that cannot write
    // still ends the turn.
    let requirementsNudges = 0;
    // Architect Mode: how many times this turn we have sent the model back to
    // finish an incomplete package (a required file missing or a stub) before
    // letting it wrap up. Capped so a model that keeps stalling still ends.
    let packageNudges = 0;
    // A turn that keeps calling tools every iteration never reaches either
    // check above, or the loop's normal exit — it just falls out when
    // `iteration` reaches `maxIterations`, whatever `assistantText` holds at
    // that point. On a run that spent its whole per-turn budget on tool calls
    // and never wrote a final message, that's nothing, and the user is left
    // staring at a blank reply after real work happened. `stoppedByBreak`
    // tells the two paths apart: set at both of the loop's internal `break`s
    // (a refusal, and the ordinary "nothing left to do" exit) so the code
    // after the loop can tell "the model chose to stop" from "the budget ran
    // out mid-work" and only synthesize a fallback in the latter case, or
    // whenever the model's own text is empty regardless of why.
    let stoppedByBreak = false;
    // A refusal already carries its own `error` event with the model's
    // reason — the fallback synthesis below must not run on top of it, or a
    // refusal ends up with a "finished without providing a summary" body
    // underneath it, which reads as a quiet normal ending sitting under a
    // refusal banner. Also lets `turn.end`'s `stopReason` say "refusal"
    // honestly instead of the generic "end_turn".
    let refused = false;
    // C1 — set when the turn ends because a response was still being cut off at
    // the output limit after two continuations. `turn.end` reports it so the UI
    // can say "the answer was too long to finish" instead of showing a
    // truncated response as complete.
    let truncatedByMaxTokens = false;
    // Structural cap on invented scope. Correct decomposition for a
    // reasonably-scoped small feature runs about 6-7 files; a vague prompt
    // that turns into three imagined subsystems blows past that by an order
    // of magnitude before anything stops it. Counted as distinct
    // genuinely-new paths — a file that existed before this turn started
    // never counts, no matter which tool touches it, so a legitimate rewrite
    // of App.tsx is never mistaken for invented scope.
    //
    // Refusing only the write that crosses the checkpoint, while leaving
    // `edit_file` and everything else open, does not stop the model — it
    // just removes the option to decompose properly, and the model crams
    // several components' worth of code into the one file it can still
    // touch. `checkpointReached` instead ends the turn's ability to change
    // anything at all the moment the checkpoint is hit — the model's only
    // remaining job is to say what it built and stop. Reaching the
    // checkpoint is expected on real, larger work, not a failure — the
    // user's next prompt continues it, with a fresh per-turn budget.
    const NEW_FILE_CHECKPOINT = 6;
    const newFilesThisTurn = new Set<string>();
    let checkpointReached = false;
    // Once the checkpoint is reached, this decides whether the freeze is
    // total (build phase — still inventing files) or partial (finish phase
    // — a verification tool has run this turn, so `edit_file` and
    // `run_command` on existing files come back for typecheck-and-tune
    // work; a new-path `write_file` and `delete_file` stay refused). Set
    // after a batch that ran a VERIFICATION_TOOL_NAMES tool; revoked if a
    // shell command then creates new files (scope through the back door).
    let finishPhase = false;
    const existingFilesAtTurnStart =
      this.options.engineerMode || this.options.architectMode
        ? await this.listAllFilePaths()
        : new Set<string>();
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
    // "keep going" starts a fresh build pass: reset the run budget so a build
    // that stopped at the token cap can continue instead of dead-ending. The
    // kill switch is not reset by this.
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
    // A weak model can get stuck calling the exact same tool with the exact
    // same input dozens of times (a `search_files` loop that finds nothing,
    // over and over). Each round costs real model tokens. After this many
    // identical calls in one turn, refuse it and tell the model to change
    // approach or stop.
    const IDENTICAL_CALL_LIMIT = 5;
    const identicalCallCounts = new Map<string, number>();
    // The same loop also happens with the pattern *varied*: read/search/edit
    // the same big file over and over, never converging (seen on a 1000-line
    // store file with a weak model). Count every read/search/edit against the
    // file's path; past the limit, refuse further work on THAT path this turn.
    const PATH_CHURN_LIMIT = 8;
    const pathChurnCounts = new Map<string, number>();
    let assistantText = "";
    let thinkingText = "";

    emit({ type: "turn.start", sessionId: this.id, messageId, at: new Date().toISOString() });

    // A `/`-selected skill or plugin is guaranteed, not offered: woven into
    // what the model sees, the same way attachment text already is by the
    // time this reaches the agent; the transcript's record of what was typed
    // is a server-side concern, untouched by this. Plugins wrap first
    // (innermost, closest to the original message) since a plugin pick is
    // only ever a one-line instruction, not real content — skills then wrap
    // the whole thing so their full bodies read first.
    const withPluginInstruction = pluginNames?.length
      ? withPlugins(userMessage, pluginNames)
      : userMessage;
    // 064 — an `/agent` pick is a dispatch, not a pointer: grant the named
    // specialist's pass tool for the session BEFORE the hint is woven, so the
    // tool `withAgents` names is genuinely in the pool by the time the model
    // reads the instruction. Woven between the plugin line and the skill
    // bodies so a named skill still reads first.
    if (agentNames?.length) this.grantSpecialistTools(agentNames);
    // 064 — the pass tools this pick is expected to produce a call to, for
    // the end-of-turn backstop below. Empty for a lean child (no pick) or an
    // unrecognised name.
    const pickedPassTools =
      this.options.systemPrompt && this.options.toolNames
        ? []
        : (agentNames ?? [])
            .map((name) => SPECIALIST_PASS_TOOLS[name as SpecialistKind]?.name)
            .filter((name): name is string => Boolean(name));
    const withAgentHint = agentNames?.length
      ? withAgents(withPluginInstruction, agentNames)
      : withPluginInstruction;
    const messageForModel =
      skillNames?.length && this.options.resolveSkillBody
        ? withSkills(withAgentHint, skillNames, this.options.resolveSkillBody)
        : withAgentHint;

    this.conversation.addUserMessage(messageForModel, attachments);

    const toolContext: ToolContext = {
      projectId: this.projectId,
      runtime: this.options.runtime,
      signal,
      onFileChanged: (path) => changedFiles.add(path),
      log: () => undefined,
      ...(this.options.supabaseBridge ? { supabaseBridge: this.options.supabaseBridge } : {}),
      ...(this.options.supabasePreviewEnv
        ? { supabasePreviewEnv: this.options.supabasePreviewEnv }
        : {}),
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
        //     made" with no way forward (observed: the Architect stalling
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
        this.cacheReadTokens += result.usage.cacheReadInputTokens ?? 0;
        this.cacheCreationTokens += result.usage.cacheCreationInputTokens ?? 0;
        emit({
          type: "usage",
          sessionId: this.id,
          tokensIn: this.tokensIn,
          tokensOut: this.tokensOut,
          ...(this.cacheReadTokens > 0 ? { cacheReadTokens: this.cacheReadTokens } : {}),
          ...(this.cacheCreationTokens > 0
            ? { cacheCreationTokens: this.cacheCreationTokens }
            : {}),
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

        // C1 — the response was cut off at the output-token limit, not
        // finished. With no tool calls it would otherwise fall straight into
        // the end-of-turn path and be reported as complete. Ask the model to
        // continue from where it stopped; bounded to two extra rounds.
        if (result.stopReason === "max_tokens" && result.toolCalls.length === 0) {
          if (maxTokensContinuations < 2) {
            maxTokensContinuations += 1;
            this.conversation.addUserMessage(
              "Your previous response was cut off at the output length limit before it finished. " +
                "Continue from exactly where you stopped — do not repeat anything you already wrote " +
                "and do not restart. If the remaining output is inherently too large for one " +
                "response, produce a shorter version that is complete instead.",
            );
            continue;
          }
          emit({
            type: "error",
            sessionId: this.id,
            code: "max_tokens",
            message:
              "The response was too long to finish in one turn, even after continuing. " +
              "What is above is partial — ask for a shorter version or break the request up.",
            fatal: false,
          });
          stoppedByBreak = true;
          truncatedByMaxTokens = true;
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

          // A shape check, not a semantic one: this confirms the purpose
          // marker is present somewhere in what the model said this turn,
          // never that the sentence after it is actually a good account of
          // the turn's purpose. Checked against the whole turn's accumulated
          // text rather than isolating one "final" message, since iterations
          // don't mark that boundary today.
          if (
            this.options.engineerMode &&
            // A lean builder already has one specified task; the "state the
            // purpose" hand-back is Engineer-Mode-for-a-human noise here.
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

          // The model produced nothing at all this turn — no text, no tools —
          // even after the retry ceiling. In Architect Mode this is almost
          // always a stall on the big report.html render. Nudge it ONCE with
          // explicit un-stick guidance (do the smaller thing; the report is
          // not a gate) rather than ending the turn dead.
          if (
            this.options.architectMode &&
            !emptyRecoveryDone &&
            assistantText.trim().length === 0 &&
            toolCalls.length === 0
          ) {
            emptyRecoveryDone = true;
            this.conversation.addUserMessage(
              "Your last response was empty. Do not attempt the same large output again. If you were " +
                "rendering architecture/report.html and it is too big for one response: write a SHORT " +
                "version covering the key sections, or write it section by section — or skip it for now. " +
                "The package under architecture/ is what matters, not the report. If the package is " +
                'otherwise complete and you have not yet, write the "' +
                ARCHITECT_READY_MARKER +
                '" line now. Never reply with nothing — do the smaller thing.',
            );
            continue;
          }

          // 064 — the user picked a specialist from the `/agent` menu, its
          // pass tool was granted for this turn, and the turn is ending
          // without a single call to it. One firm re-nudge, then let the
          // turn end — a model that still refuses after this has made its
          // choice, and looping would be worse. Not mode-gated: the whole
          // point is the default mode where the founder hit this.
          if (
            pickedPassTools.length > 0 &&
            !specialistPickNudgeDone &&
            !pickedPassTools.some((name) => toolCalls.some((call) => call.name === name))
          ) {
            specialistPickNudgeDone = true;
            const list = pickedPassTools.map((name) => `\`${name}\``).join(" and ");
            const one = pickedPassTools.length === 1;
            this.conversation.addUserMessage(
              `The user picked ${one ? "a specialist" : "specialists"} from the /agent menu and you ` +
                `have ${list} available this turn, but you have not called ${one ? "it" : "them"}. ` +
                `Running the pass is what they asked for — not doing the work yourself, not loading a ` +
                `skill, not writing that specialist's file by hand. Call ${list} now. If a pass is ` +
                `genuinely not warranted for this request, say so in one sentence instead of finishing ` +
                `without one.`,
            );
            continue;
          }

          // Architect Mode: the model interviewed (it produced text) but there
          // is still no `architecture/requirements.md` on disk. That file is a
          // deliverable from the first substantive exchange — a five-question
          // interview that writes nothing is the failure this catches. Send it
          // back to write the file, in this same turn, before it replies.
          if (
            this.options.architectMode &&
            requirementsNudges < 2 &&
            !anyFileChangedThisTurn &&
            assistantText.trim().length > 0 &&
            (await this.readFileOrNull(`${ARCHITECT_WRITE_ROOT}requirements.md`)) === null
          ) {
            requirementsNudges += 1;
            this.conversation.addUserMessage(
              "You replied without recording anything. `architecture/requirements.md` still does not " +
                "exist. Write it NOW — everything you have learned and every decision taken so far, " +
                "structured, with a short 'settled / open' list at the top — then continue. It is a " +
                "deliverable from the first exchange, not something you write up at the end. Do not " +
                "send another message until that file is written.",
            );
            continue;
          }

          // Architect Mode: the model is wrapping up the package (a build plan
          // exists, or it wrote the "ready" line) but the package is not
          // actually complete — a required file is missing or a stub. Send it
          // back with the exact list, in this same turn. Prompt guidance that
          // a file is "required" does not hold on its own across models.
          if (
            this.options.architectMode &&
            packageNudges < 3 &&
            assistantText.trim().length > 0 &&
            ((await this.readFileOrNull(`${ARCHITECT_WRITE_ROOT}build-plan.md`)) !== null ||
              assistantText.includes(ARCHITECT_READY_MARKER))
          ) {
            const state = await this.architecturePackageState();
            if (!state.ready) {
              packageNudges += 1;
              this.conversation.addUserMessage(
                `The package is not finished: ${state.reason} Write what is missing NOW, fully and ` +
                  "for real (no stubs, no placeholders), then continue. Do not present the plan or " +
                  `write the "${ARCHITECT_READY_MARKER}" line until every required file exists.`,
              );
              continue;
            }
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
              !existingFilesAtTurnStart.has(toolCall.input.path) &&
              // 061 — a specialist child may exempt a path prefix from the
              // new-file count (the Cinematic engineer's `public/cinematic/**`
              // frame output, which ffmpeg writes in bulk).
              !this.options.newFileCheckpointExempt?.(pathPosix.normalize(toolCall.input.path))
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
            //
            // The one exception: in the finish phase (a verification tool
            // has run this turn — see `finishPhase`), `edit_file`,
            // `run_command`, and a `write_file` onto a file that already
            // exists come back, so a correctly-scoped pass can typecheck
            // and tune what it built in the same turn instead of handing
            // back work it could not verify. A genuinely-new `write_file`
            // (`path !== undefined`) and `delete_file` stay refused — that
            // is the actual anti-invented-scope control, and it is
            // untouched. The regression in the checkpointReached comment
            // happened because the hatch was open *during build*; gating
            // it behind "stopped to verify first" closes that path.
            const finishPhaseException =
              this.options.engineerMode &&
              checkpointReached &&
              finishPhase &&
              (toolCall.name === "edit_file" ||
                toolCall.name === "run_command" ||
                (toolCall.name === "write_file" && path === undefined));
            const blockedByCheckpoint =
              this.options.engineerMode &&
              checkpointReached &&
              MUTATING_TOOL_NAMES.has(toolCall.name) &&
              !finishPhaseException;
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
            // Architect Mode plans only. Refuse execution tools and any write
            // outside `architecture/`, at the boundary, before the real tool
            // runs.
            const architectBlock = this.options.architectMode
              ? architectModeBlock(toolCall.name, toolCall.input as Record<string, unknown>)
              : null;
            // A specialist child with a structural write scope.
            // Refuse a write/edit/delete outside the allowlist; refuse a
            // package install of anything off the install allowlist (empty ⇒
            // all installs refused); refuse a package.json write that touches
            // any key but `scripts`. Before the real tool runs.
            const scopeBlock: "path" | "dep" | "pkgjson" | "cmd" | null = await (async (): Promise<
              "path" | "dep" | "pkgjson" | "cmd" | null
            > => {
              const allow = this.options.writeAllowlist;
              if (!allow) return null;
              if (
                toolCall.name === "write_file" ||
                toolCall.name === "edit_file" ||
                toolCall.name === "delete_file"
              ) {
                const raw =
                  typeof (toolCall.input as { path?: unknown }).path === "string"
                    ? (toolCall.input as { path: string }).path
                    : "";
                const norm = pathPosix.normalize(raw);
                if (!allow(norm)) return "path";
                // The DevOps agent's only package.json access is the
                // `scripts` block. Compare the parsed result against the
                // current file and refuse if any other top-level key moved.
                if (norm === "package.json" && toolCall.name === "write_file") {
                  const next = (toolCall.input as { content?: unknown }).content;
                  if (typeof next === "string") {
                    const prev = await this.readFileOrNull("package.json");
                    if (prev) {
                      try {
                        const a = JSON.parse(prev) as Record<string, unknown>;
                        const b = JSON.parse(next) as Record<string, unknown>;
                        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
                        for (const k of keys) {
                          if (k === "scripts") continue;
                          if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return "pkgjson";
                        }
                      } catch {
                        return "pkgjson"; // unparseable — refuse rather than guess
                      }
                    }
                  }
                }
                return null;
              }
              if (toolCall.name === "run_command") {
                const cmd =
                  typeof (toolCall.input as { command?: unknown }).command === "string"
                    ? (toolCall.input as { command: string }).command
                    : "";
                // 061 — a specialist may run a scoped shell: the Cinematic
                // engineer gets `ffmpeg`-class work and dev commands, but no
                // git and no network beyond the sandbox.
                if (this.options.cmdDeny?.test(cmd)) return "cmd";
                const m = INSTALL_CMD_RE.exec(cmd);
                if (!m) return null;
                const installAllow = this.options.installAllowlist ?? new Set<string>();
                const pkgs = (m[1] ?? "")
                  .split(/\s+/)
                  .map((s) => s.trim())
                  .filter((s) => s && !s.startsWith("-") && s !== "install" && s !== "add");
                return pkgs.every((p) => installAllow.has(p.replace(/@[\d^~].*$/, "")))
                  ? null
                  : "dep";
              }
              return null;
            })();
            // A write/edit to architecture/report.html is checked on the
            // COMPLETE resulting file, not the tool input, so active content
            // cannot be assembled across edit_file calls or survive from a
            // prior version. Snapshot the current file first so a failed
            // check rolls back.
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
            const haltBlocked =
              isHaltRequest &&
              (toolCall.name === "dispatch_task" ||
                toolCall.name === "design_pass" ||
                toolCall.name === "ops_pass" ||
                toolCall.name === "qa_pass" ||
                toolCall.name === "cinematic_pass");
            // 055 follow-up — refuse the same exact call repeated past the
            // limit. Read-only tools only: a repeated write/edit/dispatch has
            // its own gates, and this must never block a legitimate retry of
            // a mutation the model just fixed.
            const callSignature = `${toolCall.name}:${JSON.stringify(toolCall.input)}`;
            const priorIdentical = identicalCallCounts.get(callSignature) ?? 0;
            identicalCallCounts.set(callSignature, priorIdentical + 1);
            const isReadishTool =
              toolCall.name === "read_file" ||
              toolCall.name === "search_files" ||
              toolCall.name === "list_files" ||
              toolCall.name === "grep";
            const identicalCallCapped = priorIdentical >= IDENTICAL_CALL_LIMIT && isReadishTool;
            // Per-path churn: read/search/edit against one path, however the
            // input varies. Past the limit, refuse further work on that path.
            const churnPath =
              typeof (toolCall.input as { path?: unknown }).path === "string" &&
              (isReadishTool || toolCall.name === "edit_file" || toolCall.name === "write_file")
                ? pathPosix.normalize((toolCall.input as { path: string }).path)
                : null;
            const priorChurn = churnPath ? (pathChurnCounts.get(churnPath) ?? 0) : 0;
            if (churnPath) pathChurnCounts.set(churnPath, priorChurn + 1);
            const pathChurnCapped = churnPath !== null && priorChurn >= PATH_CHURN_LIMIT;
            const preOutcome = identicalCallCapped
              ? {
                  output:
                    `You have already run this exact ${toolCall.name} call ${priorIdentical} times ` +
                    "this turn and gotten the same result each time. Repeating it will not change " +
                    "anything. Change approach — read a different file, use a different pattern, or " +
                    "act on what you already know — or stop and report what you have. This exact " +
                    "call is refused for the rest of the turn.",
                  isError: true,
                }
              : pathChurnCapped
                ? {
                    output:
                      `You have read / searched / edited "${churnPath}" ${priorChurn} times this ` +
                      "turn without converging. Stop working this file: either the change is larger " +
                      "than one turn — say so plainly and stop, the user's next message continues it " +
                      "— or you are going in circles. Do NOT read, search, or edit this file again " +
                      "this turn. Write your summary of what stands now.",
                    isError: true,
                  }
                : haltBlocked
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
                  : toolCall.name === "dispatch_task"
                    ? await this.dispatchBuildTask(
                        toolCall.input as Record<string, unknown>,
                        signal,
                        toolContext.onFileChanged,
                        emit,
                        messageId,
                      )
                    : toolCall.name === "design_pass" ||
                        toolCall.name === "ops_pass" ||
                        toolCall.name === "qa_pass" ||
                        toolCall.name === "cinematic_pass"
                      ? await this.dispatchBuildTask(
                          (() => {
                            const kind: SpecialistKind =
                              toolCall.name === "design_pass"
                                ? "designer"
                                : toolCall.name === "ops_pass"
                                  ? "devops"
                                  : toolCall.name === "cinematic_pass"
                                    ? "cinematic"
                                    : "security";
                            const inp = toolCall.input as { scope?: unknown; notes?: unknown };
                            return {
                              task:
                                typeof inp.scope === "string" && inp.scope.trim()
                                  ? inp.scope
                                  : kind === "cinematic"
                                    ? "the hero of the current screen"
                                    : "the whole project",
                              acceptanceCriteria: SPECIALISTS[kind].dod,
                              ...(typeof inp.notes === "string" ? { notes: inp.notes } : {}),
                              [kind === "designer"
                                ? "design"
                                : kind === "devops"
                                  ? "ops"
                                  : kind === "cinematic"
                                    ? "cinematic"
                                    : "qa"]: true,
                            };
                          })(),
                          signal,
                          toolContext.onFileChanged,
                          emit,
                          messageId,
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
                                    "requirements.md, data-model.md, api.md, DESIGN.md, infrastructure.md, backend.md, " +
                                    "build-plan.md, build-context.md, risks.md, OPERATIONS.md, QA.md, " +
                                    "decisions/NNNN-<slug>.md, and report.html. Nothing else — no config, no code, no scripts."
                                  : `Architect Mode may only write under ${ARCHITECT_WRITE_ROOT} — refusing "${toolCall.name}" ` +
                                    `on "${String((toolCall.input as { path?: unknown }).path ?? "")}". Put the design in ` +
                                    `${ARCHITECT_WRITE_ROOT}; the builder writes application code, not you.`,
                            isError: true,
                          }
                        : scopeBlock
                          ? {
                              output:
                                scopeBlock === "path"
                                  ? `This specialist has a fixed write scope — refusing "${toolCall.name}" on ` +
                                    `"${String((toolCall.input as { path?: unknown }).path ?? "")}". It writes only its ` +
                                    "own spec file and the files it is allowed to implement (see your instructions) — " +
                                    "not application code, the data model, the server, or other architecture/* files. " +
                                    "A change outside that scope goes in your review as a report, not the diff."
                                  : scopeBlock === "pkgjson"
                                    ? "Refusing this package.json write — a specialist may change the `scripts` block " +
                                      "only, nothing else (no dependencies, no config). Name what you need in your review " +
                                      "for the Engineer to add."
                                    : scopeBlock === "cmd"
                                      ? `Refusing "${toolCall.name}" — this specialist's shell is scoped to asset work ` +
                                        "(ffmpeg / ffprobe / gltf-transform) and normal dev commands. No git, no network " +
                                        "fetches, no deploy. Do the asset processing with the tools you have, or note in " +
                                        "your review what you could not do."
                                      : "Refusing this install — this specialist does not add dependencies. Name the " +
                                        "package you need in your review for the Engineer to add, and work with what is " +
                                        "already in package.json.",
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
                                  : finishPhase
                                    ? `Engineer Mode's ${NEW_FILE_CHECKPOINT}-file checkpoint holds for NEW files and deletes — ` +
                                      `refusing "${toolCall.name}"${path ? ` on "${path}"` : ""}. You're past the checkpoint and ` +
                                      "into the finish phase: edit_file and run_command on files that already exist still work, " +
                                      "so use them to typecheck, build, preview, and tune what you built. A new file here means " +
                                      "this is bigger than one turn — stop, summarize what exists, and let the next message " +
                                      "continue it with a fresh checkpoint."
                                    : `Engineer Mode's ${NEW_FILE_CHECKPOINT}-file checkpoint was already reached this turn — ` +
                                      `refusing to run "${toolCall.name}". Nothing else will run this turn. Write your summary ` +
                                      "now instead.",
                                isError: true,
                              }
                            : await executeTool(toolContext, toolCall.name, toolCall.input);
            // Validate the whole report.html after the write. This is a
            // fail-fast advisory (the render-time sanitiser in PlanPanel is
            // the authoritative control); on a trip it rolls the file back
            // and tells the model why.
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
              // E1 — content the tool fetched from outside the user's control
              // is wrapped so the model treats it as data, not instruction.
              // Done here, once, rather than in each of ~80 tools.
              output: outcome.untrusted
                ? wrapUntrusted(outcome.output, toolCall.name, outcome.untrusted.source)
                : outcome.output,
              isError: outcome.isError ?? false,
              images: outcome.images,
            };
          }),
        );

        this.conversation.addToolResults(results);

        // Enter the finish phase once a verification tool has run this turn.
        // From here on, if the checkpoint is (or becomes) reached, the freeze
        // is partial rather than total — see `finishPhase` and
        // `finishPhaseException` above. Detected after the batch, so a
        // verification tool and an `edit_file` in the *same* batch still see
        // the pre-checkpoint state; the model gets its edit through on the
        // next batch. Only meaningful in Engineer Mode.
        if (
          this.options.engineerMode &&
          !finishPhase &&
          result.toolCalls.some((call) => VERIFICATION_TOOL_NAMES.has(call.name))
        ) {
          finishPhase = true;
        }

        // `run_command` can write a file through an arbitrary shell command
        // just as well as `write_file` can, and the pre-flight checks above
        // don't see it. The first `run_command` that crosses the checkpoint
        // cannot be refused ahead of time — the files exist by the time the
        // command finishes — so this is reactive: count whatever appeared,
        // and if that pushes past the checkpoint, set `checkpointReached` so
        // every mutating tool is refused from here on, the same as the
        // write_file path already does. A single command that creates many
        // files at once can still get past the checkpoint before this
        // catches up; the message telling the model what happened, and that
        // nothing else runs this turn, is the limit of what an after-the-fact
        // check can promise.
        if (
          this.options.engineerMode &&
          result.toolCalls.some((call) => call.name === "run_command")
        ) {
          const currentFiles = await this.listAllFilePaths();
          const newlyAppeared = [...currentFiles].filter(
            (filePath) =>
              !existingFilesAtTurnStart.has(filePath) &&
              !newFilesThisTurn.has(filePath) &&
              !GENERATED_LOCKFILE_NAMES.has(filePath) &&
              // 061 — ffmpeg's bulk frame output under `public/cinematic/**`
              // is exempt from the new-file checkpoint count.
              !this.options.newFileCheckpointExempt?.(pathPosix.normalize(filePath)),
          );
          // A specialist with a write scope (the Designer) must not create
          // out-of-scope files through the shell either. This is reactive —
          // the file exists by the time the command returns — so it trips
          // the checkpoint and says plainly what happened.
          const allow = this.options.writeAllowlist;
          if (allow) {
            const outOfScope = newlyAppeared.filter(
              (p) => !allow(pathPosix.normalize(p)) && !GENERATED_LOCKFILE_NAMES.has(p),
            );
            if (outOfScope.length > 0 && !checkpointReached) {
              checkpointReached = true;
              this.conversation.addUserMessage(
                `A shell command just created ${outOfScope.length} file(s) outside the Designer's write ` +
                  `scope (${outOfScope.slice(0, 5).join(", ")}). The Designer polishes client UI only. ` +
                  "Nothing further will run this turn. Revert those files and return your checklist with " +
                  "the structural change noted, not made.",
              );
            }
          }
          if (newlyAppeared.length > 0) {
            const wasUnderCap = newFilesThisTurn.size < NEW_FILE_CHECKPOINT;
            const wasFinishPhase = finishPhase;
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
            } else if (checkpointReached && wasFinishPhase) {
              // The finish phase is for verifying and tuning what already
              // exists — not for adding scope through the shell. New files
              // appeared past the checkpoint, so close the finish phase: the
              // freeze is total again for the rest of this turn.
              finishPhase = false;
              this.conversation.addUserMessage(
                `A shell command created ${newlyAppeared.length} new file(s) after the ` +
                  `${NEW_FILE_CHECKPOINT}-file checkpoint. The finish phase is for typechecking and tuning ` +
                  "what already exists, not creating files — it is now closed for this turn. Nothing that " +
                  "changes the project will run for the rest of the turn. Summarize what exists and stop.",
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
          // so the UI and the Plan panel refresh. 061 — likewise skip it when
          // a cinematic pass just paused for assets: only docs / staging
          // changed, nothing to verify.
          if (!this.options.architectMode && !this.assetGatePausedThisTurn) {
            verificationNeeded = true;
          }
          anyFileChangedThisTurn = true;
          emit({ type: "files.changed", sessionId: this.id, paths: [...changedFiles] });
          changedFiles.clear();
        }
      }

      if (signal.aborted) {
        emit({ type: "aborted", sessionId: this.id, messageId });
        return;
      }

      // A long tool-heavy turn that legitimately built real things can still
      // end with a stored message of length zero, because the loop above
      // spent its whole budget on tool calls and never reached a point where
      // it could stop and ask the model to sum up. This is the backstop —
      // whatever the reason (the step budget ran out mid-work, or a provider
      // returned nothing) the user never sees a silent reply after real work
      // happened. Two related gaps the shape below also closes:
      //
      // 1. Checking only "is the text empty" misses the near-miss case — a
      //    turn that says one stray sentence ("Working on it.") early and
      //    then goes heads-down calling tools until the budget runs out hits
      //    the same user-visible failure (real work, no account of it) but a
      //    single sentence makes `assistantText` non-empty. Hitting the
      //    iteration cap now always appends the reconstructed summary,
      //    whether or not the model said something on the way — real text
      //    already said is kept, never discarded.
      //
      // 2. Whitespace-only text (a model that streamed nothing but blank
      //    lines) breaks the invariant this exists to protect: replacing
      //    `assistantText` outright makes the DB-persisted copy (built by the
      //    server's gateway from every `text.delta`, whitespace included) and
      //    this event's `message.content` disagree. `addition` below is
      //    always appended with `+=`, never substituted, so the delta stream
      //    this emits and the final `assistantText` stay identical by
      //    construction — the same property `apps/server/src/ws/gateway.ts`
      //    needs.
      //
      // A refusal is deliberately excluded (`!refused`): its own `error`
      // event already carries the model's stated reason, and layering
      // "finished without providing a summary" underneath it would read
      // as a quiet normal ending sitting under a refusal banner.
      const hitIterationCap = !stoppedByBreak;
      const hasRealText = assistantText.trim().length > 0;
      let addition = "";
      if (!refused && hitIterationCap) {
        // A turn that ran out of steps while still calling tools never
        // reached the end-of-turn verification path — so if it was editing
        // code, it may have left the build broken (a half-finished refactor,
        // a bad edit it was mid-way through fixing). Check now, and lead the
        // fallback with the breakage instead of a reassuring "more to do".
        let brokenNote = "";
        let brokenThisTurn = false;
        if (!this.options.architectMode && anyFileChangedThisTurn) {
          try {
            const check = await this.needsVerification(toolContext);
            if (check) {
              const outcome = await this.runVerification(toolContext, check);
              if (outcome.failed) {
                brokenThisTurn = true;
                this.cappedBrokenStreak += 1;
                brokenNote =
                  this.cappedBrokenStreak >= 2
                    ? `⚠️ The app is BROKEN, and this is the ${this.cappedBrokenStreak}${
                        this.cappedBrokenStreak === 2 ? "nd" : "th"
                      } turn in a row that has run out of steps without fixing it. It is not ` +
                      'converging — "keep going" will likely keep spending tokens without getting ' +
                      'there. The better move now is "Undo this turn" to get back to a working ' +
                      "state, then make a smaller, more specific request (or switch to a stronger " +
                      "model in the composer).\n\n" +
                      `${outcome.output.slice(0, 2000)}\n\n`
                    : "⚠️ The app is BROKEN right now — this turn ran out of steps before it " +
                      'finished. Reply "keep going" to continue the fix, or use "Undo this turn" ' +
                      "to revert.\n\n" +
                      `${outcome.output.slice(0, 2000)}\n\n`;
              }
            }
          } catch {
            // A best-effort check; never let it throw out of the fallback.
          }
        }
        if (!brokenThisTurn) this.cappedBrokenStreak = 0;
        const summary = brokenNote + this.synthesizeFallbackSummary(toolCalls, true);
        addition = hasRealText ? `\n\n${summary}` : summary;
      } else if (!refused && !hasRealText && this.options.architectMode && emptyRecoveryDone) {
        // Architect Mode: retries and the one-shot nudge both failed to get
        // anything out of the model. Give the user a real way forward
        // instead of "No changes were made".
        addition =
          "The model kept returning an empty response — usually the report render being too large " +
          "for this model. The design package under architecture/ (requirements, decisions, " +
          "data-model, api, infrastructure, build-plan, risks) is written and buildable; only " +
          'architecture/report.html may be missing or short. You can: say "skip the report" to ' +
          'proceed without it, switch to a stronger model in the composer and say "regenerate the ' +
          'report", or say "build it" — the build does not need report.html.';
      } else if (!refused && !hasRealText) {
        addition = this.synthesizeFallbackSummary(toolCalls, false);
      }
      // A turn that ended cleanly (did not hit the cap) resets the streak.
      if (!hitIterationCap) this.cappedBrokenStreak = 0;
      if (addition) {
        emit({ type: "text.delta", sessionId: this.id, messageId, text: addition });
        assistantText += addition;
      }

      // Record the turn on which the Architect first declared the package
      // ready. dispatch_task then needs a *later* user turn before it fires.
      // Only honoured when the package actually IS complete — a "ready" line
      // over a package still missing a required file does not count.
      if (
        this.options.architectMode &&
        this.readyDeclaredAtTurn === null &&
        assistantText.includes(ARCHITECT_READY_MARKER) &&
        (await this.architecturePackageState()).ready
      ) {
        this.readyDeclaredAtTurn = this.turns;
      }

      emit({
        type: "turn.end",
        sessionId: this.id,
        messageId,
        stopReason: refused
          ? "refusal"
          : truncatedByMaxTokens
            ? "max_tokens"
            : hitIterationCap
              ? "max_iterations"
              : "end_turn",
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
   * Auto Mode's between-pass decision. The server calls this after each build
   * turn: it returns `true` when another build pass should
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
    if (commands.length > 0) {
      // One line per command, each shortened — a turn that ran a dozen big
      // inline `node -e "…"` probes must not paste tens of KB of script into
      // the transcript. The point is "what ran", not "the exact bytes".
      const SHOWN = 8;
      const shown = commands.slice(0, SHOWN).map((c) => `\`${shortenCommand(c)}\``);
      if (commands.length > SHOWN) shown.push(`…and ${commands.length - SHOWN} more`);
      lines.push(`- Ran: ${shown.join(", ")}`);
    }
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
   * After a write/edit to architecture/report.html, read the whole resulting
   * file and run `reportHtmlAdvisory` on it. If it trips, roll
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
   * Whether the architecture package is complete enough to hand a task to a
   * builder. There is no interview gate any more — the Architect decides when
   * it has enough and moves on — so this is the one structural check that the
   * package is actually finished: every required file exists and is real, the
   * build plan has tasks, and a Supabase design has its `backend.md`. Checked
   * against the filesystem, so it holds on a fresh session and a resumed one
   * alike. DESIGN.md and build-context.md are in the list on purpose: a weak
   * model that narrates them without writing them is caught here.
   */
  private async architecturePackageState(): Promise<{ ready: boolean; reason: string }> {
    const files = await this.listAllFilePaths();
    const required = [
      "requirements.md",
      "data-model.md",
      "api.md",
      "DESIGN.md",
      "topology.json",
      "infrastructure.md",
      "build-plan.md",
      "build-context.md",
      "risks.md",
    ];
    const missing = required.filter((f) => !files.has(`${ARCHITECT_WRITE_ROOT}${f}`));
    if (missing.length > 0) {
      return {
        ready: false,
        reason: `The package is missing ${missing.map((f) => `architecture/${f}`).join(", ")}.`,
      };
    }
    const hasDecision = [...files].some(
      (p) => p.startsWith(`${ARCHITECT_WRITE_ROOT}decisions/`) && p.endsWith(".md"),
    );
    if (!hasDecision) {
      return { ready: false, reason: "architecture/decisions/ has no records yet." };
    }
    const plan = await this.readFileOrNull(`${ARCHITECT_WRITE_ROOT}build-plan.md`);
    // A stub or a heading with nothing under it is not a plan.
    if (
      (plan ?? "").replace(/\s+/g, "").length < 120 ||
      !/\bTask\b|\btask\b|^- /m.test(plan ?? "")
    ) {
      return { ready: false, reason: "architecture/build-plan.md has no real tasks yet." };
    }
    // DESIGN.md must be a real first draft, not a stub the model left to
    // "deepen later".
    const design = await this.readFileOrNull(`${ARCHITECT_WRITE_ROOT}DESIGN.md`);
    if ((design ?? "").replace(/\s+/g, "").length < 400) {
      return {
        ready: false,
        reason:
          "architecture/DESIGN.md is a stub — write the real design system before dispatching.",
      };
    }
    // topology.json must parse and describe a real runtime, not `{}`.
    const topoRaw = await this.readFileOrNull(`${ARCHITECT_WRITE_ROOT}topology.json`);
    const topo = topoRaw ? parseTopology(topoRaw) : null;
    if (!topo || topo.nodes.length < 2) {
      return {
        ready: false,
        reason:
          "architecture/topology.json is missing, malformed, or has fewer than two nodes — " +
          "model the real runtime (layers, nodes, edges) before dispatching.",
      };
    }
    const reqs = (await this.readFileOrNull(`${ARCHITECT_WRITE_ROOT}requirements.md`)) ?? "";
    const dataModel = (await this.readFileOrNull(`${ARCHITECT_WRITE_ROOT}data-model.md`)) ?? "";
    // A Supabase design needs its backend spec.
    if (
      !files.has(`${ARCHITECT_WRITE_ROOT}backend.md`) &&
      (/\bsupabase\b/i.test(reqs) || /\bsupabase\b/i.test(dataModel))
    ) {
      return {
        ready: false,
        reason:
          "The design uses Supabase but there is no architecture/backend.md — write the backend spec " +
          "(schema, grants, RLS, auth, key map, migration plan) before dispatching.",
      };
    }
    // 060 — a design that uses a language model needs a real ai.md.
    const usesLlm =
      /\b(openai|anthropic|\bgemini\b|mistral|\bgroq\b|\bgrok\b|openrouter|\bLLM\b|language model|chatbot|\bGPT-|\bClaude\b|ai_credentials)\b/i.test(
        `${reqs}\n${(await this.readFileOrNull(`${ARCHITECT_WRITE_ROOT}backend.md`)) ?? ""}`,
      );
    if (usesLlm) {
      const ai = await this.readFileOrNull(`${ARCHITECT_WRITE_ROOT}ai.md`);
      if ((ai ?? "").replace(/\s+/g, "").length < 300) {
        return {
          ready: false,
          reason:
            "The design uses a language model but architecture/ai.md is missing or a stub — write " +
            "the AI spec (provider, model, package, the Edge Function contract, the ai_credentials " +
            "table, error handling, the connect-your-provider state) before dispatching.",
        };
      }
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
