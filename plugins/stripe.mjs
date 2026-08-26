import { z } from "zod";
import { query, request, segment } from "./lib/api.mjs";

const stripe = (context, path) =>
  request(context, {
    url: `https://api.stripe.com/v1${path}`,
    tokenEnv: "STRIPE_SECRET_KEY",
    auth: "basic",
  });
export default [
  {
    name: "stripe_products",
    description:
      "List Stripe products using STRIPE_SECRET_KEY. Read-only; prefer a restricted or test-mode key.",
    schema: z.object({
      active: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).default(25),
      starting_after: z.string().optional(),
    }),
    async run(context, input) {
      return stripe(context, `/products${query(input)}`);
    },
  },
  {
    name: "stripe_prices",
    description: "List Stripe prices, optionally filtered by product. Read-only.",
    schema: z.object({
      product: z.string().optional(),
      active: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    async run(context, input) {
      return stripe(context, `/prices${query(input)}`);
    },
  },
  {
    name: "stripe_checkout_session",
    description:
      "Retrieve one existing Stripe Checkout Session. Read-only and never creates or expires sessions.",
    schema: z.object({ session_id: z.string().min(1) }),
    async run(context, input) {
      return stripe(context, `/checkout/sessions/${segment(input.session_id)}`);
    },
  },
];
