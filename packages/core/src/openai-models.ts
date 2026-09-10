import type { Effort, ModelOption } from "./models.js";

/** Verified against the official model catalog on 2026-09-10.
 * https://developers.openai.com/api/docs/models
 * Shared by the agent, Settings, and the project chat selector. */
export interface OpenAIModel extends ModelOption {
  reasoning: readonly Effort[];
  aliases?: readonly string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  inputPricePerMillion?: number;
  cachedInputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

const currentEfforts = ["low", "medium", "high", "xhigh", "max"] as const;
const extendedEfforts = ["low", "medium", "high", "xhigh"] as const;
const baseEfforts = ["low", "medium", "high"] as const;
export const OPENAI_DEFAULT_MODEL = "gpt-5.6-terra";
export const OPENAI_AUTO_MODEL = "auto";
export const OPENAI_MODELS: OpenAIModel[] = [
  {
    value: "gpt-6-astra",
    label: "GPT-6 Astra",
    description: "Best · hardest engineering tasks",
    group: "recommended",
    tier: "strong",
    reasoning: currentEfforts,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    inputPricePerMillion: 10,
    cachedInputPricePerMillion: 1,
    outputPricePerMillion: 50,
  },
  {
    value: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    description: "Coding agent · multi-file implementation",
    group: "recommended",
    tier: "strong",
    reasoning: extendedEfforts,
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    inputPricePerMillion: 1.75,
    cachedInputPricePerMillion: 0.175,
    outputPricePerMillion: 14,
  },
  {
    value: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    description: "Advanced · complex coding and debugging",
    group: "recommended",
    tier: "strong",
    reasoning: currentEfforts,
    aliases: ["gpt-5.6"],
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    inputPricePerMillion: 4,
    cachedInputPricePerMillion: 0.4,
    outputPricePerMillion: 20,
  },
  {
    value: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    description: "Balanced · default for everyday builds",
    group: "recommended",
    tier: "standard",
    reasoning: currentEfforts,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    inputPricePerMillion: 2,
    cachedInputPricePerMillion: 0.2,
    outputPricePerMillion: 12,
  },
  {
    value: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    description: "Fast · inexpensive, focused tasks",
    group: "recommended",
    tier: "cheap",
    reasoning: currentEfforts,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    inputPricePerMillion: 0.2,
    cachedInputPricePerMillion: 0.02,
    outputPricePerMillion: 1.2,
  },
  {
    value: "gpt-5.5",
    label: "GPT-5.5",
    group: "previous",
    tier: "strong",
    reasoning: extendedEfforts,
  },
  {
    value: "gpt-5.5-pro",
    label: "GPT-5.5 Pro",
    description: "Deep reasoning · higher cost",
    group: "previous",
    tier: "strong",
    reasoning: ["medium", "high", "xhigh"],
  },
  {
    value: "gpt-5.4",
    label: "GPT-5.4",
    group: "previous",
    tier: "strong",
    reasoning: extendedEfforts,
  },
  {
    value: "gpt-5.4-pro",
    label: "GPT-5.4 Pro",
    description: "Deep reasoning · higher cost",
    group: "previous",
    tier: "strong",
    reasoning: ["medium", "high", "xhigh"],
  },
  {
    value: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    group: "previous",
    tier: "standard",
    reasoning: extendedEfforts,
  },
  {
    value: "gpt-5.4-nano",
    label: "GPT-5.4 Nano",
    group: "previous",
    tier: "cheap",
    reasoning: extendedEfforts,
  },
  {
    value: "gpt-5.2",
    label: "GPT-5.2",
    group: "legacy",
    tier: "strong",
    reasoning: extendedEfforts,
  },
  { value: "gpt-5.1", label: "GPT-5.1", group: "legacy", tier: "strong", reasoning: baseEfforts },
  {
    value: "gpt-5-mini",
    label: "GPT-5 Mini",
    group: "legacy",
    tier: "standard",
    reasoning: baseEfforts,
  },
  {
    value: "gpt-5-nano",
    label: "GPT-5 Nano",
    group: "legacy",
    tier: "cheap",
    reasoning: baseEfforts,
  },
];

export function openAIModel(model: string): OpenAIModel | undefined {
  return (
    OPENAI_MODELS.find((entry) => entry.value === model || entry.aliases?.includes(model)) ??
    OPENAI_MODELS.find(
      (entry) =>
        model.startsWith(`${entry.value}-`) &&
        /^\d{4}-\d{2}-\d{2}$/.test(model.slice(entry.value.length + 1)),
    )
  );
}

/** Unknown/custom models get no guessed reasoning parameter. */
export function openAIReasoningEffort(model: string, requested: Effort): Effort | undefined {
  const supported = openAIModel(model)?.reasoning;
  if (!supported?.length) return undefined;
  if (supported.includes(requested)) return requested;
  const rank = currentEfforts.indexOf(requested);
  return (
    [...supported].reverse().find((effort) => currentEfforts.indexOf(effort) <= rank) ??
    supported[0]
  );
}

/** Prefer exact IDs; when only an alias is listed, send that actual alias. */
export function availableOpenAIModels(ids: readonly string[]): OpenAIModel[] {
  const available = new Set(ids);
  return OPENAI_MODELS.flatMap((model) => {
    const value = available.has(model.value)
      ? model.value
      : model.aliases?.find((id) => available.has(id));
    return value ? [{ ...model, value }] : [];
  });
}

export function chooseOpenAIAutoModel(models: readonly ModelOption[]): string | undefined {
  const preferred = [
    OPENAI_DEFAULT_MODEL,
    "gpt-5.6-sol",
    "gpt-5.6",
    "gpt-6-astra",
    "gpt-5.3-codex",
    "gpt-5.6-luna",
  ];
  return (
    preferred.find((id) => models.some((model) => model.value === id)) ??
    models.find((model) => model.value !== OPENAI_AUTO_MODEL)?.value
  );
}

export function withOpenAIAuto(models: readonly ModelOption[]): ModelOption[] {
  return models.length
    ? [
        {
          value: OPENAI_AUTO_MODEL,
          label: "Auto",
          description: "Best available balance · prefers GPT-5.6 Terra",
          group: "recommended",
        },
        ...models,
      ]
    : [];
}
