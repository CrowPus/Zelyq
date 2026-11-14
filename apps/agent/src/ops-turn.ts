import { z } from "zod";
import {
  baseUrlFor,
  createProvider,
  defaultModelFor,
  describeProviderError,
  isProviderId,
  modelTierFor,
  PROVIDERS,
  type ProviderFactory,
} from "./providers/index.js";
import type { ToolResult } from "./providers/types.js";

/**
 * One turn of Ops, the team's DevOps engineer. This process only runs the
 * model: everything Ops reads is written by the Zelyq server, and every tool
 * call goes back to it through the turn's bridge token, where the gate and
 * the proofs decide. Nothing here touches a machine.
 */

export const opsTurnSchema = z.object({
  provider: z.string(),
  model: z.string().default(""),
  apiKey: z.string().default(""),
  authMode: z.enum(["api_key", "subscription"]).default("api_key"),
  baseUrl: z.string().optional(),
  anthropicWorkspaceId: z.string().optional(),
  systemPrompt: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .default([]),
  message: z.string().min(1),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      input_schema: z.record(z.string(), z.unknown()),
    }),
  ),
  bridge: z.object({ url: z.string().url(), token: z.string().min(16) }),
  limits: z.object({
    rounds: z.number().int().min(1).max(200),
    tokens: z.number().int().min(1000),
    minutes: z.number().min(1).max(120),
  }),
});
export type OpsTurnInput = z.infer<typeof opsTurnSchema>;

export interface OpsTurnOutput {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  rounds: number;
  stopped: string | null;
  model: string;
}

type Fetch = typeof fetch;

export async function runOpsTurn(
  input: OpsTurnInput,
  fetchImpl: Fetch = fetch,
  /** Tests give a scripted model; normally the provider itself. */
  factory: ProviderFactory = createProvider,
): Promise<OpsTurnOutput> {
  if (!isProviderId(input.provider)) throw new Error(`Unknown provider ${input.provider}.`);
  const provider = input.provider;
  const info = PROVIDERS[provider];
  if (!input.apiKey && !info.apiKeyOptional) {
    throw new Error(`No ${info.label} API key is set. An administrator adds one in Settings.`);
  }
  const model = input.model || defaultModelFor(provider);
  // Operations work is many careful steps; a small model loops instead of converging.
  if (modelTierFor(provider, model) === "cheap") {
    throw new Error(
      `${model} is too small for Ops: it loses its way in multi-step operations work. Choose a stronger model in Settings → Ops.`,
    );
  }
  const client = factory({
    provider,
    model,
    apiKey: input.apiKey,
    authMode: input.authMode,
    ...(baseUrlFor(provider, input.baseUrl)
      ? { baseUrl: baseUrlFor(provider, input.baseUrl) }
      : {}),
    ...(input.anthropicWorkspaceId ? { anthropicWorkspaceId: input.anthropicWorkspaceId } : {}),
  });
  const conversation = client.createConversation({
    systemPrompt: input.systemPrompt,
    tools: input.tools,
    effort: "high",
    history: input.history,
  });
  conversation.addUserMessage(input.message);

  const deadline = Date.now() + input.limits.minutes * 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.limits.minutes * 60_000);
  const usage = { inputTokens: 0, outputTokens: 0 };
  const said: string[] = [];
  let rounds = 0;
  let stopped: string | null = null;
  try {
    for (;;) {
      rounds += 1;
      let text = "";
      const stream = conversation.stream(controller.signal);
      let next: Awaited<ReturnType<typeof stream.next>>;
      try {
        next = await stream.next();
        while (!next.done) {
          if (next.value.type === "text") text += next.value.text;
          next = await stream.next();
        }
      } catch (error) {
        // The provider's own words, made plain: no credits, a wrong key, overloaded.
        throw new Error(describeProviderError(provider, error));
      }
      const result = next.value;
      usage.inputTokens +=
        result.usage.inputTokens +
        (result.usage.cacheReadInputTokens ?? 0) +
        (result.usage.cacheCreationInputTokens ?? 0);
      usage.outputTokens += result.usage.outputTokens;
      if (text.trim()) said.push(text.trim());
      if (result.toolCalls.length === 0) break;

      const results: ToolResult[] = [];
      for (const call of result.toolCalls) {
        const response = await fetchImpl(`${input.bridge.url}/call`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-zelyq-ops-bridge": input.bridge.token },
          body: JSON.stringify({ tool: call.name, input: call.input }),
          signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
        }).catch((error: Error) => ({
          ok: false,
          json: async () => ({ output: error.message, isError: true }),
        }));
        const body = (await response
          .json()
          .catch(() => ({ output: "No answer from Zelyq.", isError: true }))) as {
          output?: string;
          isError?: boolean;
          error?: { message?: string } | string;
        };
        const output =
          body.output ??
          (typeof body.error === "string"
            ? body.error
            : (body.error?.message ?? "No answer from Zelyq."));
        results.push({
          id: call.id,
          name: call.name,
          output,
          isError: body.isError ?? !response.ok,
        });
      }
      conversation.addToolResults(results);

      if (rounds >= input.limits.rounds) {
        stopped = `Ops stopped after ${rounds} steps of thinking in one go, its limit for a single turn. Say "go on" to continue.`;
        break;
      }
      if (usage.inputTokens + usage.outputTokens >= input.limits.tokens) {
        stopped = 'Ops stopped: this turn used its token limit. Say "go on" to continue.';
        break;
      }
      if (Date.now() >= deadline) {
        stopped = `Ops stopped after ${input.limits.minutes} minutes, its limit for a single turn. Say "go on" to continue.`;
        break;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { text: said.at(-1) ?? "", usage, rounds, stopped, model };
}
