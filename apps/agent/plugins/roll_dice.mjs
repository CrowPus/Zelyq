// A demo plugin — see docs/plugins.md. Uses a real zod schema, not a
// hand-rolled stand-in: `schema` is converted to JSON Schema for the model
// once per session, which needs an actual zod schema, not just something
// with a matching `safeParse` method.
import { z } from "zod";

export default [
  {
    name: "roll_dice",
    description:
      "Rolls dice — for picking a random sample, a placeholder value, or just settling an " +
      "argument. Give it how many sides each die has (default 6) and how many dice to roll " +
      "(default 1).",
    schema: z.object({
      sides: z.number().int().min(2).max(1000).default(6),
      count: z.number().int().min(1).max(20).default(1),
    }),
    async run(_context, { sides, count }) {
      const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
      const total = rolls.reduce((sum, roll) => sum + roll, 0);
      return { output: `Rolled ${count}d${sides}: ${rolls.join(", ")} (total ${total})` };
    },
  },
];
