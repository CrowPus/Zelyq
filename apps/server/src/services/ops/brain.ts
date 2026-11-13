import { randomBytes } from "node:crypto";
import { type OpsJobDetail, opsTalkSchema, type User, ZelyqError } from "@zelyq/core";
import { z } from "zod";
import type { AgentClient } from "../agent-client.js";
import type { SettingsService } from "../settings.js";
import { OPS_WAY } from "./guide.js";
import { PLAYBOOKS } from "./playbooks.js";
import { parseReview, REVIEW_BRIEF, reviewMessage, worthReviewing } from "./review.js";
import type { OpsService } from "./service.js";

/** One turn's ceilings: Ops never runs open-ended (072 §2.3). */
const LIMITS = { rounds: 40, tokens: 1_500_000, minutes: 45 };

/** How long a bridge token lives: one turn, with room for a long pipeline run. */
const TOKEN_MS = 70 * 60_000;
/** The longest one live conversation lasts. */
const VOICE_MS = 2 * 60 * 60_000;

/** A person who keeps talking while Ops works gets answered after, up to this many times in a row. */
const FOLLOW_UPS = 3;

const planToolInput = z
  .object({
    steps: z
      .array(
        z
          .object({ action: z.string(), inputs: z.record(z.string(), z.unknown()).default({}) })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict();
const runStepInput = z.object({ step: z.number().int().min(1) }).strict();
const finishInput = z
  .object({
    outcome: z.string().trim().min(1).max(4000),
    failed: z.boolean().optional(),
    /** When steps failed but no lesson fits: why. */
    noLessonBecause: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

/**
 * Ops's brain (072 §2.3): a person talks, a turn runs. The agent service runs
 * the model; this server decides what it reads (its way of working, the
 * playbooks, its memory, the job as it stands) and answers every tool call
 * through the same gate and proofs as everything else. The conversation is
 * kept as text, so what was said aloud is on record too.
 */
export class OpsBrain {
  private readonly tokens = new Map<string, { teamId: string; jobId: string; expires: number }>();
  private readonly working = new Set<string>();
  private readonly activity = new Map<string, string[]>();
  private readonly reviewed = new Set<string>();

  constructor(
    private readonly ops: OpsService,
    private readonly settings: SettingsService,
    private readonly agent: AgentClient,
    private readonly serverUrl: string,
  ) {
    ops.liveState = (jobId) => ({
      working: this.working.has(jobId),
      activity: this.activity.get(jobId) ?? [],
    });
  }

  /** A person says something to Ops: a new job, or more in one still going. */
  async talk(user: User, teamId: string, raw: unknown): Promise<OpsJobDetail> {
    const input = opsTalkSchema.parse(raw);
    let jobId = input.jobId ?? null;
    if (jobId) {
      const job = await this.ops.getJob(user, teamId, jobId);
      if (["done", "failed", "stopped"].includes(job.stage)) jobId = null;
      else await this.ops.addPersonMessage(user, teamId, jobId, input.text);
    }
    if (!jobId) {
      const job = await this.ops.startJob(user, teamId, { request: input.text });
      jobId = job.id;
    }
    void this.run(jobId).catch(() => undefined);
    return this.ops.getJob(user, teamId, jobId);
  }

  /** Runs turns until the person's last message has an answer. */
  private async run(jobId: string): Promise<void> {
    if (this.working.has(jobId)) return; // the running turn picks the new message up after
    this.working.add(jobId);
    this.activity.set(jobId, []);
    try {
      for (let turn = 0; turn < FOLLOW_UPS; turn += 1) {
        await this.turn(jobId);
        const view = await this.ops.engineerView(jobId);
        const last = view.messages.at(-1);
        if (!last || last.role !== "person" || ["done", "failed", "stopped"].includes(view.stage))
          break;
      }
      const ended = await this.ops.engineerView(jobId);
      if (worthReviewing(ended) && !this.reviewed.has(jobId)) {
        this.reviewed.add(jobId);
        await this.review(jobId, ended).catch(() => undefined);
      }
    } finally {
      this.working.delete(jobId);
    }
  }

  /**
   * The after-job review: one short call with no tools and a fixed answer
   * shape; the server keeps only what passes its own checks.
   */
  /** The after-job review for a job that ended outside a typed turn (a live conversation). */
  async reviewEnded(jobId: string): Promise<void> {
    const ended = await this.ops.engineerView(jobId);
    if (!worthReviewing(ended) || this.reviewed.has(jobId)) return;
    this.reviewed.add(jobId);
    await this.review(jobId, ended).catch(() => undefined);
  }

  private async review(jobId: string, view: OpsJobDetail): Promise<void> {
    const teamId = (await this.ops.teamOf(jobId)) as string;
    this.activity.get(jobId)?.push("Looked back at the job");
    const result = await this.agent.opsTurn({
      ...(await this.modelConfig()),
      systemPrompt: REVIEW_BRIEF,
      history: [],
      message: reviewMessage(view, await this.ops.knownMemory(teamId)),
      tools: [],
      // No tools: this token opens nothing.
      bridge: {
        url: `${this.serverUrl.replace(/\/$/, "")}/api/ops-bridge`,
        token: randomBytes(32).toString("hex"),
      },
      limits: { rounds: 1, tokens: 120_000, minutes: 3 },
    });
    await this.ops.addTokens(jobId, result.usage.inputTokens, result.usage.outputTokens);
    const output = parseReview(result.text);
    if (output) await this.ops.applyReview(jobId, output);
  }

  private async turn(jobId: string): Promise<void> {
    const view = await this.ops.engineerView(jobId);
    const teamId = (await this.ops.teamOf(jobId)) as string;
    const engineer = await this.ops.engineers.find(teamId);
    if (!engineer || engineer.paused) {
      await this.ops.systemNote(jobId, "Ops is paused. A person resumes it on the Ops page.");
      return;
    }
    if (engineer.monthlyTokenCap !== null) {
      const used = await this.ops.engineers.tokensThisMonth(teamId);
      if (used >= engineer.monthlyTokenCap) {
        await this.ops.systemNote(
          jobId,
          `Ops has used this month's limit (${used.toLocaleString("en")} of ${engineer.monthlyTokenCap.toLocaleString("en")} tokens). An admin can raise it on the Ops page; checks and alerts keep working.`,
        );
        return;
      }
    }
    const conversation = view.messages.filter((message) => message.role !== "system");
    const lastPerson = [...conversation].reverse().find((message) => message.role === "person");
    if (!lastPerson) return;
    const history = conversation.slice(0, conversation.lastIndexOf(lastPerson)).map((message) => ({
      role: message.role === "person" ? ("user" as const) : ("assistant" as const),
      content: message.text,
    }));

    const token = randomBytes(32).toString("hex");
    this.tokens.set(token, { teamId, jobId, expires: Date.now() + TOKEN_MS });
    try {
      const model = await this.modelConfig();
      const result = await this.agent.opsTurn({
        ...model,
        systemPrompt: await this.systemPrompt(teamId, view),
        history,
        message: lastPerson.text,
        tools: this.tools(),
        bridge: { url: `${this.serverUrl.replace(/\/$/, "")}/api/ops-bridge`, token },
        limits: LIMITS,
      });
      await this.ops.addTokens(jobId, result.usage.inputTokens, result.usage.outputTokens);
      // A job it finished in this turn is answered with its outcome (the real answer, as
      // recorded); last words such as "The job is complete!" say nothing. Otherwise its
      // own last words are the reply.
      const after = await this.ops.engineerView(jobId);
      const finishedNow = Boolean(after.finishedAt && after.outcome && !view.finishedAt);
      const reply = finishedNow ? (after.outcome as string) : result.text.trim();
      if (reply) await this.ops.say(jobId, reply);
      if (result.stopped) await this.ops.systemNote(jobId, result.stopped);
    } catch (error) {
      await this.ops.systemNote(jobId, `Ops could not work on this: ${(error as Error).message}`);
    } finally {
      this.tokens.delete(token);
    }
  }

  /** The provider of Settings → Model; the model of Settings → Ops, or the provider's default. */
  private async modelConfig() {
    // Ops may think with its own provider; empty means the same as Settings → Model.
    const provider =
      (await this.settings.value("opsProvider")).trim() || (await this.settings.value("provider"));
    const chosen = (await this.settings.value("opsModel")).trim();
    const requested = chosen || (await this.settings.modelFor(provider));
    const model =
      provider === "openai"
        ? await this.settings.resolveOpenAIModel(requested)
        : provider === "anthropic"
          ? await this.settings.resolveAnthropicModel(requested)
          : provider === "google"
            ? await this.settings.resolveGoogleModel(requested)
            : requested;
    const baseUrl =
      provider === "openai"
        ? await this.settings.openAIBaseUrl()
        : provider === "anthropic"
          ? await this.settings.anthropicBaseUrl()
          : provider === "google"
            ? await this.settings.googleBaseUrl()
            : await this.settings.value("modelBaseUrl");
    const workspace =
      provider === "anthropic" ? await this.settings.value("anthropicWorkspaceId") : "";
    return {
      provider,
      model,
      apiKey: await this.settings.apiKeyFor(provider),
      authMode: await this.settings.authModeFor(provider),
      ...(baseUrl ? { baseUrl } : {}),
      ...(workspace ? { anthropicWorkspaceId: workspace } : {}),
    };
  }

  /** What Ops reads first: who it is, how it works, what it remembers, and the job as it stands. */
  private async systemPrompt(teamId: string, view: OpsJobDetail): Promise<string> {
    const memory = await this.ops.memory.openingContext(teamId);
    const steps = view.steps.length
      ? view.steps
          .map(
            (step) =>
              `${step.position + 1}. [${step.status}${step.needsApproval ? ", waits for approval" : ""}] ${step.words}${step.proof ? ` — checked: ${step.proof.ok ? "ok" : "FAILED"} (${step.proof.detail ?? step.proof.target})` : ""}${step.result ? ` — ${step.result.slice(0, 200)}` : ""}`,
          )
          .join("\n")
      : "(no plan yet)";
    return `You are Ops, this team's DevOps engineer inside Zelyq. People talk to you on the Ops page, by typing or aloud.

${OPS_WAY}

How you talk:
- Plain words for people who are not engineers. No jargon without a one-line explanation.
- Start every reply with one short sentence that sums it up: it is read aloud. Details after it, short.
- Say what you are about to do before a long step ("Running the pipeline; this takes a few minutes").
- Answer in the language the person writes in.
- Never say done, live or fixed unless the step shows "checked: ok". Use the exact word for what was checked: an environment is a place that now exists; an app is "live" only when check_deployment says it answers; a domain "works" only when check_dns leads there and check_certificate is valid.
- When a plan waits for approval, say so and ask them to press Approve after reading it. You cannot approve anything, and voice cannot approve.

How you work here:
- Your tools are the actions (each goes through Zelyq's gate and its own checks), plus propose_plan, run_step, job_state and finish_job.
- Looking is free: call the looking actions directly. Every change must be a step of a plan you propose with propose_plan (exact action names and inputs). A step that needs a person shows "waits for approval": stop and tell the person; continue when they come back.
- Carry out a planned step with run_step and its number — never by calling the action again and retyping its inputs. run_step runs exactly what was approved.
- Plan everything you will need in one plan where you can. Proposing a plan again replaces only the steps that have not run, and needs approval again: do it only when the plan must change, and say why.
- If a step is refused or fails, read why from the evidence (the run's last lines, deployment_history, app_status, machine_ports): do not try the same thing again, and do not guess a cause you have not seen. Say "I don't know yet" rather than a guess.
- Your own notes are not plan steps: call write_sheet, learn_lesson and note_wish directly when you need them. They need no approval, and a plan step for them would only be replaced.
- A question needs no plan: answer it and finish_job with the answer.
- Before you finish a job that changed anything, record it, in this order (these are your own notes: they need no approval):
  1. write_sheet for every app and environment you set up or changed: what it is, where it runs, its address and port, its variables by name, its database, the pipeline that ships it, how to roll it back.
  2. For every step that failed because of your own mistake (wrong inputs, a wrong assumption), learn_lesson with that step as evidence, and switch on a check if one fits. One lesson per mistake, said as a rule for next time.
- Then finish_job: done (only if every step is checked or was replaced by a later plan) or failed, with what is live, what was proven, and what is left for the person.

${PLAYBOOKS}

${memory ? `What you remember:\n\n${memory}\n\n` : ""}This job:
- Asked: ${view.request}
- Stage: ${view.stage}
- Plan:
${steps}`;
  }

  /** Every action, and the three tools that move a job. */
  private tools() {
    const list = this.ops.actionList.all().map((action) => {
      const schema = z.toJSONSchema(action.input as z.ZodType, { io: "input" }) as Record<
        string,
        unknown
      >;
      return {
        name: action.name,
        description: `${action.description}${typeof action.risk === "string" && action.risk === "read" ? " (Looks only.)" : " (A change: plan it first.)"}`,
        input_schema: {
          type: "object",
          properties: schema.properties ?? {},
          required: schema.required ?? [],
        },
      };
    });
    return [
      {
        name: "propose_plan",
        description:
          "Propose the plan for this job: exact actions and exact inputs, in order. A person reads it in plain words and approves what needs approval. Replaces any earlier plan.",
        input_schema: z.toJSONSchema(planToolInput, { io: "input" }) as Record<string, unknown>,
      },
      {
        name: "run_step",
        description:
          "Carry out one step of the plan, by its number, exactly as it was planned and approved. This is how every change is made.",
        input_schema: z.toJSONSchema(runStepInput, { io: "input" }) as Record<string, unknown>,
      },
      {
        name: "job_state",
        description:
          "This job as it stands: stage, the plan's steps with their status and checks, the conversation.",
        input_schema: { type: "object", properties: {} },
      },
      {
        name: "finish_job",
        description:
          "End the job: what is live, what was proven, what is left for the person. Done only if every planned step is checked; otherwise failed: true.",
        input_schema: z.toJSONSchema(finishInput, { io: "input" }) as Record<string, unknown>,
      },
      ...list,
    ];
  }

  // ------------------------------------------------------------- talking live

  /** A live voice conversation's pass to the tools, for one job, until it is closed. */
  openVoice(teamId: string, jobId: string): string {
    const token = randomBytes(32).toString("hex");
    this.tokens.set(token, { teamId, jobId, expires: Date.now() + VOICE_MS });
    this.working.add(jobId);
    this.activity.set(jobId, this.activity.get(jobId) ?? []);
    return token;
  }

  closeVoice(token: string): void {
    const grant = this.tokens.get(token);
    this.tokens.delete(token);
    if (grant) this.working.delete(grant.jobId);
  }

  /** The tools a live conversation may use: the same as typed, through the same gate. */
  voiceTools() {
    return this.tools();
  }

  /** What Ops reads before talking: the same brief as typed, and how to speak. */
  async voicePrompt(teamId: string, jobId: string): Promise<string> {
    const view = await this.ops.engineerView(jobId);
    return `${await this.systemPrompt(teamId, view)}

You are talking aloud now, live:
- Speak like a calm senior engineer on a call: short sentences, one idea at a time, plain words.
- Do nothing until you are asked. A greeting gets a short greeting back, nothing looked up.
- One answer per question: do every lookup you need first, quietly, then answer once. Do not announce each lookup, and do not end every answer with an offer or a question ("Let me know…"): answer, then wait.
- Never read out ids, hashes, JSON or long lists. When details matter (a status, log lines, a list of apps, a plan), call show_on_screen with them, then say in one sentence what is there.
- Never say something is on screen unless you just called show_on_screen for it, or it is a plan you proposed (plans and their steps appear on screen by themselves). There is no dashboard and no other section: only this conversation and its plan.
- Never say a site works, is fine, secure or set up correctly unless you checked it with a tool in this conversation (check_deployment, check_url, check_dns, check_certificate, app_status); say what you checked. Without a check, say "I haven't checked that yet" and offer to.
- If you did not catch what they said, say so and ask them to repeat it. Do not guess.
- You cannot approve anything and their voice does not approve: when a plan waits, say "It's on screen; press Approve when you've read it", then wait for them to say they did.
- The conversation is one job until the person ends it: finish_job only records your summary for then. Never say the job is closed.
- Answer in the language they speak.`;
  }

  /** Whether a bridge token belongs to a turn still going. */
  validToken(token: string | undefined): boolean {
    const grant = token ? this.tokens.get(token) : undefined;
    return Boolean(grant && grant.expires >= Date.now());
  }

  /** A tool call from the agent, by its turn's token. Returns what the model reads. */
  async bridge(
    token: string | undefined,
    requested: string,
    requestedInput: unknown,
  ): Promise<{ output: string; isError: boolean }> {
    let tool = requested;
    let input = requestedInput;
    const grant = token ? this.tokens.get(token) : undefined;
    if (!grant || grant.expires < Date.now()) {
      throw new ZelyqError("unauthorized", "This Ops turn has ended.");
    }
    const note = (text: string) => {
      const list = this.activity.get(grant.jobId) ?? [];
      list.push(text);
      this.activity.set(grant.jobId, list.slice(-30));
      // Kept with the job, so what Ops looked at can be read back later.
      void this.ops.recordActivity(grant.jobId, text).catch(() => undefined);
    };
    const out = (value: unknown, isError = false) => ({
      output: (typeof value === "string" ? value : JSON.stringify(value, null, 1)).slice(0, 16_000),
      isError,
    });
    try {
      if (tool === "propose_plan") {
        const parsed = planToolInput.parse(input);
        note(
          `Proposed a plan of ${parsed.steps.length} step${parsed.steps.length === 1 ? "" : "s"}`,
        );
        const plan = await this.ops.proposePlan(grant.jobId, parsed);
        if (!plan.ok) return out({ ok: false, issues: plan.issues }, true);
        return out({
          ok: true,
          stage: plan.job?.stage,
          steps: plan.job?.steps.map((step) => ({
            position: step.position + 1,
            words: step.words,
            needsApproval: step.needsApproval,
          })),
          note:
            plan.job?.stage === "approve"
              ? "The plan waits for a person's approval. Tell them, and stop here."
              : "The plan stands: run its steps in order.",
        });
      }
      if (tool === "run_step") {
        const { step: number } = runStepInput.parse(input);
        const view = await this.ops.engineerView(grant.jobId);
        const step = view.steps.find((candidate) => candidate.position + 1 === number);
        if (!step) return out(`There is no step ${number} in the plan.`, true);
        if (step.status !== "planned") {
          return out(`Step ${number} has already run (${step.status}). Look at job_state.`, true);
        }
        // Exactly the planned inputs, read from the plan itself.
        tool = step.action;
        input = await this.ops.stepInputs(step.id);
      }
      if (tool === "job_state") {
        const view = await this.ops.engineerView(grant.jobId);
        return out({
          stage: view.stage,
          said: view.messages
            .filter((message) => message.role === "person")
            .slice(-10)
            .map((message) => ({ messageId: message.id, text: message.text.slice(0, 300) })),
          steps: view.steps.map((step) => ({
            position: step.position + 1,
            action: step.action,
            words: step.words,
            status: step.status,
            needsApproval: step.needsApproval,
            checked: step.proof ? { ok: step.proof.ok, detail: step.proof.detail } : null,
          })),
        });
      }
      if (tool === "finish_job") {
        const parsed = finishInput.parse(input);
        // Its own mistakes are learned from before the job closes, or it says why none applies.
        const before = await this.ops.engineerView(grant.jobId);
        const failedSteps = before.steps.filter(
          (step) => step.status === "replaced" || step.status === "failed",
        );
        const lessons = await this.ops.lessonsFromJob(grant.jobId);
        if (failedSteps.length > 0 && lessons === 0 && !parsed.noLessonBecause) {
          return out(
            `Not finished yet: ${failedSteps.length} step${failedSteps.length === 1 ? "" : "s"} failed in this job (${failedSteps.map((step) => `${step.position + 1}. ${step.words}`).join("; ")}) and no lesson was recorded. For each failure that was your own mistake, learn_lesson with that step as evidence; then finish_job again. If none was your mistake, finish_job with noLessonBecause saying why.`,
            true,
          );
        }
        note(parsed.failed ? "Finished: could not complete it" : "Finished");
        const { noLessonBecause, ...finish } = parsed;
        const view = await this.ops.finish(
          grant.jobId,
          noLessonBecause
            ? { ...finish, outcome: `${finish.outcome}\n\n(No lesson: ${noLessonBecause})` }
            : finish,
          { announce: false },
        );
        return out({ stage: view.stage });
      }
      const action = this.ops.actionList.get(tool);
      if (action) {
        try {
          note(action.words(action.input.parse(input ?? {}) as never));
        } catch {
          note(tool);
        }
      }
      const result = await this.ops.perform(grant.jobId, tool, input);
      if (result.verdict.verdict !== "run") {
        return out(
          {
            done: false,
            [result.verdict.verdict === "ask" ? "waitsForPerson" : "refused"]:
              result.verdict.reason,
          },
          true,
        );
      }
      return out(
        {
          ok: result.outcome?.ok ?? false,
          summary: result.outcome?.summary,
          data: result.outcome?.data ?? undefined,
          step: result.step,
          checked: result.proof
            ? { ok: result.proof.ok, target: result.proof.target, detail: result.proof.detail }
            : undefined,
        },
        !(result.outcome?.ok ?? false),
      );
    } catch (error) {
      return out((error as Error).message, true);
    }
  }
}
