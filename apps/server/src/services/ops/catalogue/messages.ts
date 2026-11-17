import { z } from "zod";
import type { OpsAction } from "../actions.js";

const WHERE = ["telegram", "slack", "email", "any"] as const;
const NAME: Record<string, string> = { telegram: "Telegram", slack: "Slack", email: "email" };

const tellInput = z
  .object({
    message: z.string().trim().min(1, "Say what the message says.").max(4000),
    /** A short line for an email's subject; the first words of the message when empty. */
    subject: z.string().trim().max(120).optional(),
    where: z.enum(WHERE).default("any"),
  })
  .strict();

/**
 * "Send me a Telegram about crowpus", "email me the same": Ops writes it and sends it to the
 * person who asked, by their own linked chat or to their own email address. Never to anyone
 * else, never to a shared channel.
 */
const messageMe: OpsAction<z.infer<typeof tellInput>> = {
  name: "message_me",
  description:
    'Send the person you are talking with a message when they ask for one: by Telegram, Slack, or email ("send me a Telegram about crowpus", "email me the same", "message me when it is done"). Look up what they asked about first and write the message yourself: plain, with what you found. It goes only to that person: their linked chat, or the email address of their Zelyq account. where: "telegram", "slack", "email", or "any" (each chat they linked; email when none is). If it cannot be sent, tell them exactly what the result says to do.',
  input: tellInput,
  risk: "change",
  freeUse: true,
  onlyTellsTheAsker: true,
  words: (inputs) =>
    `Send you a message${inputs.where === "any" ? "" : inputs.where === "email" ? " by email" : ` on ${NAME[inputs.where]}`}`,
  undo: () => null,
  async run(ctx, inputs) {
    // In a job: the person who asked. From an outside agent: the person it works for.
    const job = ctx.jobId ? await ctx.services.store.ops.jobs.findById(ctx.jobId) : null;
    const askedBy = job ? job.askedBy : ctx.person;
    if (!askedBy)
      return {
        ok: false,
        summary: "A message goes to the person who asked, in a conversation on the Ops page.",
      };
    const subject =
      inputs.subject || (inputs.message.split("\n")[0] ?? "").slice(0, 80) || "A message from Ops";

    const byEmail = async () => {
      if (!(await ctx.services.mail.configured(ctx.teamId)))
        throw new Error(
          "Email is not set up yet: a team admin fills in Team settings → Email (or, for the whole server, a Zelyq admin in Settings → Email) and sends a test there.",
        );
      const user = await ctx.services.store.users.findById(askedBy);
      if (!user?.email) throw new Error("Your account has no email address.");
      const result = await ctx.services.mail.send(
        {
          to: [user.email],
          subject: `Ops: ${subject}`,
          text: `${inputs.message}\n\n— Ops, your DevOps engineer in Zelyq`,
        },
        ctx.teamId,
      );
      if (result.sent === 0) throw new Error("The mail server did not take it; try again later.");
    };
    const byChat = (where: "telegram" | "slack" | "any") =>
      ctx.services.channels.tellPerson(
        ctx.teamId,
        askedBy,
        { title: "From Ops", lines: [inputs.message], link: null },
        where,
      );

    try {
      if (inputs.where === "email") {
        await byEmail();
        return { ok: true, summary: "Sent to your email." };
      }
      if (inputs.where !== "any") {
        const went = await byChat(inputs.where);
        return {
          ok: true,
          summary: `Sent to your ${went.map((kind) => NAME[kind]).join(" and ")}.`,
        };
      }
      // Any: each linked chat; email when none is linked.
      const went = await byChat("any").catch(() => [] as string[]);
      if (went.length > 0)
        return {
          ok: true,
          summary: `Sent to your ${went.map((kind) => NAME[kind]).join(" and ")}.`,
        };
      await byEmail();
      return { ok: true, summary: "Sent to your email (no chat is linked)." };
    } catch (error) {
      return { ok: false, summary: (error as Error).message };
    }
  },
};

export const MESSAGE_ACTIONS = [messageMe] as unknown as OpsAction[];
