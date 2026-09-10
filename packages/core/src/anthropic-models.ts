import type { Effort, ModelOption } from "./models.js";

/**
 * The Claude catalog, verified against Anthropic's model reference on
 * 2026-09-10. Shared by the agent, Settings, and the project chat selector,
 * the same way `openai-models.ts` is.
 *
 * Two deliberate absences. `claude-mythos-5-1` is Project Glasswing only — an
 * ordinary account cannot call it, so offering it would be a dead entry. And
 * there is no `legacy` group: older Claude IDs are real but their exact
 * strings must be looked up rather than guessed, and a wrong ID is a silent
 * 404 rather than a helpful error. Add them when they are confirmed.
 *
 * Claude IDs carry no date suffix when you *call* them — the bare string is
 * complete and is what this catalog stores. But `/v1/models` may list a model
 * only under a dated snapshot ID (a live account lists Haiku 4.5 solely as
 * `claude-haiku-4-5-20251001`), so discovery matches aliases too. Without that,
 * exact-matching silently drops a model the account can actually use.
 */
export interface AnthropicModel extends ModelOption {
  /**
   * Effort levels the model accepts. An **empty list means the model rejects
   * `output_config.effort` outright** and no effort parameter may be sent —
   * that is Haiku 4.5, and it is load-bearing, not an oversight.
   */
  effort: readonly Effort[];
  /**
   * How thinking is configured. `adaptive` takes `{type:"adaptive"}`;
   * `always` is adaptive but cannot be turned off; `budget` is the older
   * `{type:"enabled", budget_tokens:N}` shape.
   */
  thinking: "adaptive" | "budget" | "always";
  /** Output ceiling. Streaming is always on here, which 128K requires. */
  maxOutputTokens: number;
  /** Dated snapshot IDs `/v1/models` may list this model under. */
  aliases?: readonly string[];
  contextWindow?: number;
  inputPricePerMillion?: number;
  cachedInputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

const fullEfforts = ["low", "medium", "high", "xhigh", "max"] as const;
/** Opus 4.6 and Sonnet 4.6 predate `xhigh`; sending it is a 400. */
const preXhighEfforts = ["low", "medium", "high", "max"] as const;
const effortOrder = fullEfforts;

/**
 * Unchanged from what the agent already defaulted to. Opus 5 is the documented
 * default for this API and the capability rung Zelyq builds on; Auto prefers it
 * too. Picking a cheaper balanced default would be a silent downgrade, and that
 * is the operator's decision to make, not this catalog's.
 */
export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5";
export const ANTHROPIC_AUTO_MODEL = "auto";

export const ANTHROPIC_MODELS: AnthropicModel[] = [
  {
    value: "claude-opus-5",
    label: "Claude Opus 5",
    description: "Best · agentic coding and hard debugging",
    group: "recommended",
    tier: "strong",
    effort: fullEfforts,
    thinking: "adaptive",
    maxOutputTokens: 128_000,
    contextWindow: 1_000_000,
    inputPricePerMillion: 5,
    cachedInputPricePerMillion: 0.5,
    outputPricePerMillion: 25,
  },
  {
    value: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    description: "Most capable · hardest reasoning, highest cost",
    group: "recommended",
    tier: "strong",
    effort: fullEfforts,
    thinking: "always",
    maxOutputTokens: 128_000,
    contextWindow: 1_000_000,
    inputPricePerMillion: 10,
    // A flat rate, not a multiple of input — see cacheReadFactorFor below.
    cachedInputPricePerMillion: 0.25,
    outputPricePerMillion: 50,
  },
  {
    value: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "Balanced · everyday builds",
    group: "recommended",
    tier: "standard",
    effort: fullEfforts,
    thinking: "adaptive",
    maxOutputTokens: 128_000,
    contextWindow: 1_000_000,
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
    // Rejects `output_config.effort`. Empty on purpose.
    effort: [],
    thinking: "budget",
    // The only current model without the 128K ceiling.
    maxOutputTokens: 64_000,
    // Listed only under the dated snapshot on real accounts.
    aliases: ["claude-haiku-4-5-20251001"],
    contextWindow: 200_000,
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
    maxOutputTokens: 128_000,
    contextWindow: 1_000_000,
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
    maxOutputTokens: 128_000,
    contextWindow: 1_000_000,
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
    maxOutputTokens: 128_000,
    contextWindow: 1_000_000,
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
    maxOutputTokens: 128_000,
    contextWindow: 1_000_000,
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
    maxOutputTokens: 128_000,
    contextWindow: 1_000_000,
    inputPricePerMillion: 3,
    cachedInputPricePerMillion: 0.3,
    outputPricePerMillion: 15,
  },
];

export function anthropicModel(id: string): AnthropicModel | undefined {
  return ANTHROPIC_MODELS.find(
    (model) => model.value === id || model.aliases?.includes(id) === true,
  );
}

/**
 * The output ceiling for a model. An unknown custom ID gets the conservative
 * figure rather than an optimistic one — asking for more than a model allows
 * is a 400, while asking for less only shortens a response that was never
 * going to be that long.
 */
export function anthropicMaxOutputTokens(id: string): number {
  return anthropicModel(id)?.maxOutputTokens ?? 64_000;
}

/** Step down to the highest level the model supports, never up. */
function clampEffort(supported: readonly Effort[], requested: Effort): Effort | undefined {
  if (!supported.length) return undefined;
  if (supported.includes(requested)) return requested;
  const rank = effortOrder.indexOf(requested);
  return (
    [...supported].reverse().find((effort) => effortOrder.indexOf(effort) <= rank) ?? supported[0]
  );
}

export interface AnthropicThinking {
  /** Omitted entirely when the model rejects `output_config.effort`. */
  effort?: Effort;
  thinking: { type: string; display?: string; budget_tokens?: number };
}

/**
 * The thinking half of the request, decided in one place.
 *
 * Sending `{type:"adaptive"}` plus an effort to every Claude model — which is
 * what this provider used to do — is wrong twice over: Haiku 4.5 errors on
 * `output_config.effort` at all, and `xhigh` does not exist on the 4.6 family.
 * Both were reachable from the model picker.
 */
export function anthropicThinkingConfig(
  id: string,
  requested: Effort,
  maxTokens: number,
): AnthropicThinking {
  const model = anthropicModel(id);
  // An unknown custom ID gets the safe shape and no guessed effort, matching
  // how `openAIReasoningEffort` declines to invent a parameter.
  if (!model) return { thinking: { type: "adaptive", display: "summarized" } };

  if (model.thinking === "budget") {
    // Must be at least 1024 and strictly below max_tokens.
    const budget = Math.max(1024, Math.floor(maxTokens / 2));
    return {
      thinking:
        budget < maxTokens ? { type: "enabled", budget_tokens: budget } : { type: "disabled" },
    };
  }

  const effort = clampEffort(model.effort, requested);
  return {
    ...(effort ? { effort } : {}),
    thinking: { type: "adaptive", display: "summarized" },
  };
}

/**
 * Cache reads as a fraction of the input price. Anthropic bills them at 0.1x
 * on most models, but Fable 5.1 uses a flat rate, so derive it rather than
 * assuming the multiple.
 */
export function cacheReadFactorFor(model: AnthropicModel): number {
  if (!model.inputPricePerMillion || model.cachedInputPricePerMillion === undefined) return 0;
  return model.cachedInputPricePerMillion / model.inputPricePerMillion;
}

/**
 * Keep the bare `value` even when only a dated alias was listed: the bare ID is
 * the documented one, it resolves to the same model, and it is what the rest of
 * Zelyq stores and looks config up by.
 */
export function availableAnthropicModels(ids: readonly string[]): AnthropicModel[] {
  const available = new Set(ids);
  return ANTHROPIC_MODELS.filter(
    (model) =>
      available.has(model.value) || (model.aliases?.some((id) => available.has(id)) ?? false),
  );
}

export function chooseAnthropicAutoModel(models: readonly ModelOption[]): string | undefined {
  const preferred = [
    ANTHROPIC_DEFAULT_MODEL,
    "claude-opus-4-8",
    "claude-sonnet-5",
    "claude-fable-5-1",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
  ];
  return (
    preferred.find((id) => models.some((model) => model.value === id)) ??
    models.find((model) => model.value !== ANTHROPIC_AUTO_MODEL)?.value
  );
}

export function withAnthropicAuto(models: readonly ModelOption[]): ModelOption[] {
  return models.length
    ? [
        {
          value: ANTHROPIC_AUTO_MODEL,
          label: "Auto",
          description: "Best available balance · prefers Claude Opus 5",
          group: "recommended",
        },
        ...models,
      ]
    : [];
}
