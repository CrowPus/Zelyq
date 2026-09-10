/**
 * Reference catalog for the Anthropic work — the shape `packages/core/src/
 * anthropic-models.ts` should take, mirroring `openai-models.ts`.
 *
 * Facts cached 2026-06-24. `claude-mythos-5-1` is deliberately absent (Project
 * Glasswing only). Legacy IDs are absent because they must be looked up, never
 * guessed — Claude IDs carry no date suffix and a wrong string is a silent 404.
 */
import type { Effort } from "./models.js";

export interface AnthropicModel {
  value: string;
  label: string;
  description?: string;
  group?: "recommended" | "previous" | "legacy";
  tier?: "strong" | "standard" | "cheap";
  /**
   * Effort levels the model accepts. An empty list means the model rejects
   * `output_config.effort` outright — send no effort parameter at all.
   */
  effort: readonly Effort[];
  /**
   * How thinking is configured. `adaptive` takes `{type:"adaptive"}`;
   * `budget` takes `{type:"enabled", budget_tokens:N}` with N >= 1024 and
   * N < max_tokens; `always` is on with no way to disable it.
   */
  thinking: "adaptive" | "budget" | "always";
  contextWindow?: number;
  maxOutputTokens?: number;
  inputPricePerMillion?: number;
  cachedInputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

const fullEfforts = ["low", "medium", "high", "xhigh", "max"] as const;
/** Opus 4.6 and Sonnet 4.6 predate `xhigh`. */
const preXhighEfforts = ["low", "medium", "high", "max"] as const;

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5";
export const ANTHROPIC_AUTO_MODEL = "auto";

export const ANTHROPIC_MODELS: AnthropicModel[] = [
  {
    value: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    description: "Best · hardest reasoning and long-horizon work",
    group: "recommended",
    tier: "strong",
    effort: fullEfforts,
    thinking: "always",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputPricePerMillion: 10,
    // Flat $0.25/MTok rather than a multiple of input — see details.md.
    cachedInputPricePerMillion: 0.25,
    outputPricePerMillion: 50,
  },
  {
    value: "claude-opus-5",
    label: "Claude Opus 5",
    description: "Advanced · agentic coding",
    group: "recommended",
    tier: "strong",
    effort: fullEfforts,
    thinking: "adaptive",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputPricePerMillion: 5,
    cachedInputPricePerMillion: 0.5,
    outputPricePerMillion: 25,
  },
  {
    value: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "Balanced · default for everyday builds",
    group: "recommended",
    tier: "standard",
    effort: fullEfforts,
    thinking: "adaptive",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputPricePerMillion: 2,
    cachedInputPricePerMillion: 0.2,
    outputPricePerMillion: 10,
  },
  {
    value: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    description: "Fast · inexpensive, focused tasks",
    group: "recommended",
    tier: "cheap",
    // Rejects `output_config.effort`. This empty list is load-bearing.
    effort: [],
    thinking: "budget",
    contextWindow: 200_000,
    // maxOutputTokens deliberately omitted — read it from the Models API
    // rather than assuming the 5-series figure.
    inputPricePerMillion: 1,
    cachedInputPricePerMillion: 0.1,
    outputPricePerMillion: 5,
  },
  {
    value: "claude-fable-5",
    label: "Claude Fable 5",
    description: "Creative and character writing",
    group: "previous",
    effort: fullEfforts,
    thinking: "always",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputPricePerMillion: 10,
    outputPricePerMillion: 50,
  },
  {
    value: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    group: "previous",
    tier: "strong",
    effort: fullEfforts,
    thinking: "adaptive",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputPricePerMillion: 5,
    cachedInputPricePerMillion: 0.5,
    outputPricePerMillion: 25,
  },
  {
    value: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    group: "previous",
    tier: "strong",
    effort: fullEfforts,
    thinking: "adaptive",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputPricePerMillion: 5,
    cachedInputPricePerMillion: 0.5,
    outputPricePerMillion: 25,
  },
  {
    value: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    group: "previous",
    tier: "strong",
    effort: preXhighEfforts,
    thinking: "adaptive",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputPricePerMillion: 5,
    cachedInputPricePerMillion: 0.5,
    outputPricePerMillion: 25,
  },
  {
    value: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    group: "previous",
    tier: "standard",
    effort: preXhighEfforts,
    thinking: "adaptive",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputPricePerMillion: 3,
    cachedInputPricePerMillion: 0.3,
    outputPricePerMillion: 15,
  },
];

export function anthropicModel(id: string): AnthropicModel | undefined {
  return ANTHROPIC_MODELS.find((model) => model.value === id);
}

/**
 * The whole request fragment, decided in one place: which effort level the
 * model will actually accept, and the thinking shape that goes with it.
 * Returning `effort: undefined` means send no `output_config.effort` at all —
 * Haiku 4.5 errors on it.
 */
export function anthropicThinkingConfig(
  id: string,
  requested: Effort,
  maxTokens: number,
): { effort?: Effort; thinking: Record<string, unknown> } {
  const model = anthropicModel(id);
  // An unknown custom ID gets no guessed parameters, as with OpenAI.
  if (!model) return { thinking: { type: "adaptive", display: "summarized" } };

  if (model.thinking === "budget") {
    // Must be >= 1024 and strictly less than max_tokens.
    const budget = Math.max(1024, Math.floor(maxTokens / 2));
    return {
      thinking:
        budget < maxTokens ? { type: "enabled", budget_tokens: budget } : { type: "disabled" },
    };
  }

  return {
    effort: clampEffort(model.effort, requested),
    thinking: { type: "adaptive", display: "summarized" },
  };
}

/** Step down to the highest level the model supports, never up. */
function clampEffort(supported: readonly Effort[], requested: Effort): Effort | undefined {
  if (!supported.length) return undefined;
  if (supported.includes(requested)) return requested;
  const rank = fullEfforts.indexOf(requested);
  return (
    [...supported].reverse().find((effort) => fullEfforts.indexOf(effort) <= rank) ?? supported[0]
  );
}

export function chooseAnthropicAutoModel(models: readonly { value: string }[]): string | undefined {
  const preferred = [
    ANTHROPIC_DEFAULT_MODEL,
    "claude-opus-5",
    "claude-fable-5-1",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
  ];
  return (
    preferred.find((id) => models.some((model) => model.value === id)) ??
    models.find((model) => model.value !== ANTHROPIC_AUTO_MODEL)?.value
  );
}
