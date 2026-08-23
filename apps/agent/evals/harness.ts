import type { AgentEvent } from "@zelyq/core";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { Effort, ProviderId } from "../src/providers/index.js";
import { AgentSession } from "../src/session.js";
import { runCheck } from "./checks.js";
import type { CaseResult, EvalCase } from "./types.js";
import { diff, fingerprint, linkModules, loadTemplateFiles } from "./workspace.js";

export interface RunOptions {
  runtime: RuntimeDriver;
  baseRoot: string;
  template: string;
  provider: ProviderId;
  model: string;
  effort: Effort;
  apiKey: string;
  maxIterations: number;
  /** Wall-clock ceiling for one case. A hung turn must not hang the suite. */
  timeoutMs: number;
  /** Leave the project on disk afterwards so a failure can be inspected. */
  keep: boolean;
  log: (message: string) => void;
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
    works: false,
    clean: false,
    checks: [],
    rounds: 0,
    toolCalls: 0,
    toolErrors: 0,
    tokensIn: 0,
    tokensOut: 0,
    filesChanged: [],
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

    const after = await fingerprint(runtime, projectId);
    result.filesChanged = diff(before, after);

    const context = {
      runtime,
      projectId,
      before,
      after,
      changed: result.filesChanged,
      toolCalls: result.toolCalls,
    };
    for (const check of evalCase.checks) {
      result.checks.push(await runCheck(check, context));
    }

    result.works = result.checks.every((check) => !check.critical || check.ok);
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
