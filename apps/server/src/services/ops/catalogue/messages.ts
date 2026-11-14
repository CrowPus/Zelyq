import { z } from "zod";
import type { OpsAction } from "../actions.js";

const tellInput = z
  .object({
    message: z.string().trim().min(1, "Say what the message says.").max(1500),
    where: z.enum(["telegram", "slack", "any"]).default("any"),
  })
  .strict();

/**
 * "Send me a message on Telegram about crowpus": Ops writes it and sends it to the person
 * who asked, in their own linked chat. Never to anyone else, never to a shared channel.
 */
const messageMe: OpsAction<z.infer<typeof tellInput>> = {
  name: "message_me",
  description:
    'Send the person you are talking with a message in their own linked chat, when they ask for one ("send me a Telegram about crowpus", "message me on Slack when it is done"). Look up what they asked about first and write the message yourself: short, plain, with what you found. It goes only to that person. where: "telegram", "slack", or "any" (each chat they linked). If their chat is not linked, tell them what the result says to do.',
  input: tellInput,
  risk: "change",
  freeUse: true,
  words: (inputs) =>
    `Send you a message${inputs.where === "any" ? "" : ` on ${inputs.where === "telegram" ? "Telegram" : "Slack"}`}`,
  undo: () => null,
  async run(ctx, inputs) {
    const job = ctx.jobId ? await ctx.services.store.ops.jobs.findById(ctx.jobId) : null;
    if (!job?.askedBy)
      return {
        ok: false,
        summary: "A message goes to the person who asked, in a conversation on the Ops page.",
      };
    try {
      const went = await ctx.services.channels.tellPerson(
        ctx.teamId,
        job.askedBy,
        { title: "From Ops", lines: [inputs.message], link: null },
        inputs.where,
      );
      return {
        ok: true,
        summary: `Sent to your ${went.map((kind) => (kind === "telegram" ? "Telegram" : "Slack")).join(" and ")}.`,
      };
    } catch (error) {
      return { ok: false, summary: (error as Error).message };
    }
  },
};

export const MESSAGE_ACTIONS = [messageMe] as unknown as OpsAction[];
