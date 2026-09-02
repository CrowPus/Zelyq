import type { AgentEvent } from "@zelyq/core";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { Effort, ProviderId } from "../src/providers/index.js";
import { AgentSession } from "../src/session.js";
import { runCheck } from "./checks.js";
import type { CaseResult, Check, EvalCase } from "./types.js";
import { diff, fingerprint, linkModules, loadTemplateFiles } from "./workspace.js";

/**
 * The turn produced nothing measurable: the model was never reached. A case
 * that ran partway and *then* hit a rate limit did real work and is still
 * scored — the line that matters is whether anything ran at all.
 */
export function neverRan(result: CaseResult): boolean {
  return result.error !== null && result.rounds === 0 && result.tokensIn === 0;
}

export interface RunOptions {
  runtime: RuntimeDriver;
  baseRoot: string;
  template: string;
  provider: ProviderId;
  model: string;
  effort: Effort;
  apiKey: string;
  /** Endpoint, for a provider speaking the OpenAI dialect. */
  baseUrl?: string;
  maxIterations: number;
  /** Wall-clock ceiling for one case. A hung turn must not hang the suite. */
  timeoutMs: number;
  /** Leave the project on disk afterwards so a failure can be inspected. */
  keep: boolean;
  log: (message: string) => void;
  /** Runs the scope-discipline criterion: the same cases, the same checks,
   * Engineer Mode on instead of off. See `run.ts`'s `--engineer-mode`
   * flag. */
  engineerMode?: boolean;
  engineerModeSkill?: { body: string; resources: string[] };
}

/**
 * Runs one case end to end: a fresh project, one prompt, then the checks.
 *
 * The turn is driven through `AgentSession` directly rather than over HTTP.
 * What is being measured is the prompt, the tools, and the loop — putting the
 * agent's own web server in the path would add a moving part without adding
 * anything to measure.
 */
export async function runCase(evalCase: EvalCase, options: RunOptions): Promise<CaseResult> {
  const { runtime, log } = options;
  const projectId = `eval-${evalCase.id}-${Date.now().toString(36)}`;
  const startedAt = Date.now();

  const result: CaseResult = {
    id: evalCase.id,
    title: evalCase.title,
    tags: evalCase.tags,
    intact: false,
    done: false,
    clean: false,
    checks: [],
    rounds: 0,
    toolCalls: 0,
    toolErrors: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    filesChanged: [],
    reply: "",
    durationMs: 0,
    error: null,
  };

  try {
    const { root } = await runtime.ensureProject(projectId);
    await runtime.scaffold(
      projectId,
      await loadTemplateFiles(options.template, {
        projectName: evalCase.title,
        projectSlug: evalCase.id,
        projectId,
      }),
    );
    if (evalCase.setup?.length) await runtime.scaffold(projectId, evalCase.setup);
    await linkModules(options.baseRoot, root);

    const before = await fingerprint(runtime, projectId);

    const session = new AgentSession({
      sessionId: `evalsession-${projectId}`,
      projectId,
      projectName: evalCase.title,
      template: options.template,
      provider: options.provider,
      model: options.model,
      effort: options.effort,
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.engineerMode ? { engineerMode: true } : {}),
      ...(options.engineerModeSkill ? { engineerModeSkill: options.engineerModeSkill } : {}),
      runtime,
      maxIterations: evalCase.maxIterations ?? options.maxIterations,
    });

    const timer = setTimeout(() => {
      result.error = `timed out after ${Math.round(options.timeoutMs / 1000)}s`;
      session.abort();
    }, options.timeoutMs);

    const emit = (event: AgentEvent): void => {
      switch (event.type) {
        case "usage":
          // One `usage` event per model round-trip; the counts are cumulative.
          result.rounds += 1;
          result.tokensIn = event.tokensIn;
          result.tokensOut = event.tokensOut;
          // Absent on providers without prompt caching — keep the last non-zero
          // rather than clobbering with an undefined-coalesced 0.
          result.cacheReadTokens = event.cacheReadTokens ?? result.cacheReadTokens;
          result.cacheCreationTokens = event.cacheCreationTokens ?? result.cacheCreationTokens;
          break;
        case "text.delta":
          result.reply += event.text;
          break;
        case "tool.start":
          result.toolCalls += 1;
          break;
        case "tool.end":
          if (event.call.isError) result.toolErrors += 1;
          break;
        case "error":
          result.error ??= `${event.code}: ${event.message}`;
          break;
        case "aborted":
          result.error ??= "aborted";
          break;
      }
    };

    try {
      await session.run(evalCase.prompt, emit);
    } finally {
      clearTimeout(timer);
    }

    // The model was never reached — a bad key, a provider/model mismatch, an
    // endpoint that 404s. Every critical check passes on the pristine template
    // by construction, so running them here would report `intact 100%` about a
    // model that did nothing. `errored` is a distinct outcome from done /
    // intact / clean; leave the checks empty and let the report classify it.
    if (result.error && neverRan(result)) {
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    const after = await fingerprint(runtime, projectId);
    result.filesChanged = diff(before, after);

    const context = {
      runtime,
      projectId,
      before,
      after,
      changed: result.filesChanged,
      toolCalls: result.toolCalls,
      reply: result.reply,
    };
    // A case that asked for work must have produced some. Appended rather than
    // written into every case, so it cannot be forgotten when a case is added.
    //
    // Exempt: a case asserting `no_writes` is expecting nothing, and a case
    // marked `noChangeIsValid` is passed by asking a question or by using a
    // tool rather than the filesystem. Without that second exemption this
    // check marks down the exact restraint those cases exist to reward.
    const expectsNoWrites = evalCase.checks.some((check) => check.kind === "no_writes");
    const changeRequired = !expectsNoWrites && !evalCase.noChangeIsValid;
    const checks: Check[] = changeRequired
      ? [...evalCase.checks, { kind: "changed_something" }]
      : [...evalCase.checks];

    // A case that asserts `preview` is asserting that the app runs, and
    // `preview` cannot tell a running app from a white screen. Appended next to
    // it rather than written into each case, for the same reason: a check that
    // has to be remembered is one that will be missed.
    const wantsPreview = evalCase.checks.some((check) => check.kind === "preview");
    if (wantsPreview) checks.push({ kind: "renders" });

    // Engineer Mode's own promises about the final message, on a turn that
    // acts (F3 / 06-measurement.md §3). Without these the `--engineer-mode`
    // A/B measures the model, not the mode — the 2026-08-26 run returned pure
    // noise (6/6/8 off vs 7/8/6 on) because nothing checked what the mode adds.
    // Only appended when the mode is on, so a normal run is unaffected.
    if (options.engineerMode && changeRequired) {
      checks.push(
        {
          kind: "reply_matches",
          pattern: "^\\s*Purpose:",
          why: "Engineer Mode: the final message opens with the Purpose line",
        },
        {
          kind: "reply_matches",
          pattern: "[Aa]ssum(e|ed|ption|ptions)\\b",
          why: "Engineer Mode: the final message names what was assumed",
        },
        {
          kind: "reply_matches",
          pattern: "[Vv]erif(y|ied|ication)\\b",
          why: "Engineer Mode: the final message names what was verified",
        },
      );
    }

    for (const check of checks) {
      result.checks.push(await runCheck(check, context));
    }

    // Three numbers, and the distinction between them is the whole point.
    // `intact` says the app still runs; `done` says the work was done. An agent
    // that changes nothing scores intact and not done, which is the truth.
    result.intact = result.checks.every((check) => !check.critical || check.ok);
    result.done = result.checks.every((check) => check.cosmetic || check.ok);
    result.clean = result.checks.every((check) => check.ok);
  } catch (error) {
    result.error ??= (error as Error).message;
  } finally {
    result.durationMs = Date.now() - startedAt;
    await runtime.stopPreview(projectId).catch(() => undefined);
    if (!options.keep) await runtime.removeProject(projectId).catch(() => undefined);
    else log(`kept ${projectId}`);
  }

  return result;
}
