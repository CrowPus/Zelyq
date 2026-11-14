import { z } from "zod";
import type { OpsTouch } from "../access.js";
import type { OpsAction } from "../actions.js";
import { GUARD_KINDS, type GuardKind } from "../memory.js";
import { inTheirWords } from "../review.js";

const subject = z
  .string()
  .trim()
  .regex(
    /^(app:[a-z0-9][a-z0-9-]{0,39}|environment:[a-z][a-z0-9-]{0,39}|machine:[A-Za-z0-9._-]{1,63})$/,
    'What it is about: "app:shop", "environment:production" or "machine:box".',
  );

/** A sheet is about one thing: reading it needs that thing seen, writing it needs it too. */
function subjectTouch(value: string): OpsTouch[] {
  const [kind, name] = value.split(":", 2) as [string, string];
  if (!name) return [];
  if (kind === "environment") return [{ kind: "environment", name, need: "see" }];
  if (kind === "machine") return [{ kind: "machine", name, need: "see" }];
  if (kind === "app") return [{ kind: "project", name, need: "see" }];
  return [];
}

/**
 * A sheet about something that exists and was not given to Ops: refused.
 * Sheets are named after an app as it runs, or a machine's name made plain,
 * so the name alone is not enough; this asks the same question recall does.
 */
function notGiven(subject: string) {
  return {
    ok: false,
    summary: `${subject} is about something not given to Ops. A team admin gives it in Ops → Access.`,
  };
}

const readInput = z.object({ subject }).strict();
const readSheet: OpsAction<z.infer<typeof readInput>> = {
  name: "read_sheet",
  touches: async (_ctx, inputs) => subjectTouch(inputs.subject),
  description:
    "What you know about an app, an environment or a machine: its operations sheet (how it is built, configured, deployed, restored; what it depends on; what to do when it breaks).",
  input: readInput,
  risk: "read",
  words: (inputs) => `Read the operations sheet of ${inputs.subject}`,
  async run(ctx, inputs) {
    if (!(await ctx.seesSubject())(inputs.subject)) return notGiven(inputs.subject);
    const sheet = await ctx.services.store.ops.sheets.find(ctx.teamId, inputs.subject);
    return sheet
      ? { ok: true, summary: `${inputs.subject}, version ${sheet.version}.`, data: sheet.body }
      : { ok: true, summary: `There is no sheet for ${inputs.subject} yet.`, data: null };
  },
};

const writeInput = z.object({ subject, body: z.string().min(1).max(20_000) }).strict();
const writeSheet: OpsAction<z.infer<typeof writeInput>> = {
  name: "write_sheet",
  touches: async (_ctx, inputs) => subjectTouch(inputs.subject),
  description:
    "Write or update an operations sheet so someone else (or you, next time) can run this tomorrow: what it is, how it is built and deployed, its variables by name, its database, how to restore it, what to do when it breaks. Every version is kept.",
  input: writeInput,
  risk: "change",
  freeUse: true,
  words: (inputs) => `Write down how ${inputs.subject} runs`,
  undo: (inputs) => `Put ${inputs.subject}'s sheet back to its previous version`,
  async run(ctx, inputs) {
    if (!(await ctx.seesSubject())(inputs.subject)) return notGiven(inputs.subject);
    const sheet = await ctx.services.memory.writeSheet(
      ctx.teamId,
      inputs.subject,
      inputs.body,
      "ops",
    );
    return { ok: true, summary: `Wrote ${inputs.subject}'s sheet (version ${sheet.version}).` };
  },
  async prove(ctx, inputs) {
    const sheet = await ctx.services.store.ops.sheets.find(ctx.teamId, inputs.subject);
    return {
      kind: "sheet_saved",
      target: inputs.subject,
      ok: sheet?.body === inputs.body.slice(0, 20_000),
      detail: sheet ? `Version ${sheet.version}.` : "Not found.",
    };
  },
};

const recallInput = z.object({ about: z.string().trim().min(2).max(300) }).strict();
const recall: OpsAction<z.infer<typeof recallInput>> = {
  name: "recall",
  description:
    'Search everything you remember for some words — lessons, the team\'s wishes, sheets, past jobs: "have I seen this error before?".',
  input: recallInput,
  risk: "read",
  words: (inputs) => `Remember anything about "${inputs.about}"`,
  async run(ctx, inputs) {
    const found = await ctx.services.memory.recall(
      ctx.teamId,
      inputs.about,
      await ctx.seesSubject(),
    );
    return { ok: true, summary: `${found.length} things remembered.`, data: found };
  },
};

const wishInput = z
  .object({
    /** The wish quoted from the person's message, word for word ("never deploy on Friday afternoon"). */
    text: z.string().trim().min(1).max(1000),
    scope: z.string().trim().default("team"),
    /** The person's message in this job it comes from. */
    messageId: z.string().min(1),
  })
  .strict();
const noteWish: OpsAction<z.infer<typeof wishInput>> = {
  name: "note_wish",
  description:
    'Remember, from now on, how a person told you they want things done ("never deploy on Friday afternoon"). Only from something a person said in this job: give its messageId, and quote their words exactly (the part that is the wish). Then tell them what you understood.',
  input: wishInput,
  risk: "change",
  freeUse: true,
  words: (inputs) => `Remember: "${inputs.text}"`,
  undo: () => "Delete the wish on the Memory tab",
  async run(ctx, inputs) {
    if (!ctx.jobId) return { ok: false, summary: "A wish comes from a job." };
    const message = (await ctx.services.store.ops.messages.listForJob(ctx.jobId)).find(
      (candidate) => candidate.id === inputs.messageId,
    );
    if (!message || message.role !== "person") {
      return { ok: false, summary: "A wish comes from what a person said in this job." };
    }
    if (!inTheirWords(inputs.text, message.text)) {
      return {
        ok: false,
        summary: "A wish is kept in the person's own words: use what they said in that message.",
      };
    }
    const wish = await ctx.services.memory.addWish(ctx.teamId, {
      text: inputs.text,
      scope: inputs.scope,
      source: "correction",
      jobId: ctx.jobId,
      createdBy: message.userId,
    });
    return { ok: true, summary: `Remembered: ${wish.text}`, data: { id: wish.id } };
  },
  async prove(ctx, _inputs, outcome) {
    const id = (outcome.data as { id?: string } | undefined)?.id ?? "";
    const wish = await ctx.services.store.ops.preferences.findById(id);
    return {
      kind: "wish_saved",
      target: id,
      ok: Boolean(wish?.active),
      detail: wish?.text ?? null,
    };
  },
};

const guardKinds = Object.keys(GUARD_KINDS) as [GuardKind, ...GuardKind[]];
const lessonInput = z
  .object({
    what: z.string().trim().min(1).max(1000),
    why: z.string().trim().min(1).max(1000),
    rule: z.string().trim().min(1).max(1000),
    scope: z.string().trim().default("team"),
    /** The failed step's number (as job_state shows it), or the messageId of what a person said. */
    evidence: z
      .object({ step: z.number().int().min(1).optional(), messageId: z.string().optional() })
      .strict(),
    guard: z
      .object({ kind: z.enum(guardKinds), params: z.record(z.string(), z.unknown()).default({}) })
      .strict()
      .optional(),
  })
  .strict();
const learnLesson: OpsAction<z.infer<typeof lessonInput>> = {
  name: "learn_lesson",
  description: `Write down what you learned so it does not happen again: what happened, why, and the rule from now on, with the evidence (the number of a step of this job that failed or was not proven, or what a person said). To make sure it cannot repeat, switch on a check Zelyq runs before such steps: ${guardKinds.join(", ")}. Only a person can switch a check off.`,
  input: lessonInput,
  risk: "change",
  freeUse: true,
  words: (inputs) =>
    `Learn: ${inputs.rule}${inputs.guard ? ` (and check it before every such step)` : ""}`,
  undo: () => "Retire the lesson on the Memory tab",
  async run(ctx, inputs) {
    if (!ctx.jobId) return { ok: false, summary: "A lesson comes from a job." };
    try {
      const { lesson, guard } = await ctx.services.memory.learn(ctx.jobId, inputs);
      return {
        ok: true,
        summary: `Learned: ${lesson.rule}${guard ? `. Zelyq now checks before such steps: ${ctx.services.memory.guardWords(guard)}.` : "."}`,
        data: { id: lesson.id },
      };
    } catch (error) {
      return { ok: false, summary: (error as Error).message };
    }
  },
  async prove(ctx, _inputs, outcome) {
    const id = (outcome.data as { id?: string } | undefined)?.id ?? "";
    const lesson = await ctx.services.store.ops.lessons.findById(id);
    return {
      kind: "lesson_saved",
      target: id,
      ok: lesson?.status === "active",
      detail: lesson?.rule ?? null,
    };
  },
};

export const MEMORY_ACTIONS = [
  readSheet,
  writeSheet,
  recall,
  noteWish,
  learnLesson,
] as unknown as OpsAction[];
