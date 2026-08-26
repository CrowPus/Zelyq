import {
  type AgentEvent,
  type Message,
  newId,
  type Preview,
  type PromptAttachment,
  type ToolCall,
} from "@zelyq/core";
import type { RuntimeDriver } from "@zelyq/runtime";
import { executeTool, type ToolContext, toolDefinitions } from "@zelyq/tools";
import {
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
      }),
      tools: toolDefinitions(),
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
  }

  get state() {
    return {
      sessionId: this.id,
      projectId: this.projectId,
      provider: this.options.provider,
      model: this.options.model,
      effort: this.options.effort,
      engineerMode: this.options.engineerMode ?? false,
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
    const existingFilesAtTurnStart = this.options.engineerMode
      ? await this.listAllFilePaths()
      : new Set<string>();
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
            const outcome = capped
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
