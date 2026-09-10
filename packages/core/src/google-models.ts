import type { Effort, ModelOption } from "./models.js";

/**
 * The Gemini catalog, built from a live `/v1beta/models` listing and probed
 * against `:generateContent` on 2026-09-10 — not from recall. Two things that
 * probe settled, both of which a guess would have got wrong:
 *
 * 1. The 2.5 family **rejects `thinkingLevel`** outright ("Thinking level is
 *    not supported for this model") and must be given `thinkingBudget`
 *    instead. Everything 3.x and every `-latest` alias accepts `thinkingLevel`.
 * 2. Valid `thinkingBudget` ranges differ per model: 2.5 Pro takes 128-32768,
 *    2.5 Flash Lite takes 512-24576, and 2.5 Flash accepts any value.
 *
 * There is no 3.x "pro" beyond `gemini-3.1-pro-preview`; the pro line is
 * reached through `gemini-pro-latest`. Image, TTS, transcribe, robotics,
 * computer-use and omni variants are deliberately absent — this agent needs
 * multi-step tool calling, and those are not that.
 *
 * Prices are absent on purpose: the models endpoint does not carry them and
 * nothing here verified them. The eval report keeps its own hand-checked
 * Gemini rates rather than inheriting a guess.
 */
export interface GoogleModel extends ModelOption {
  /**
   * How thinking depth is expressed. `level` is the modern
   * `thinkingConfig.thinkingLevel`; `budget` is `thinkingConfig.thinkingBudget`
   * and is the **only** shape the 2.5 family accepts.
   */
  thinking: "level" | "budget";
  /** Inclusive `thinkingBudget` bounds, for `thinking: "budget"` models. */
  budgetRange?: readonly [number, number];
  contextWindow?: number;
  maxOutputTokens?: number;
}

const ONE_M = 1_048_576;
const OUT = 65_536;

export const GOOGLE_DEFAULT_MODEL = "gemini-pro-latest";
export const GOOGLE_AUTO_MODEL = "auto";

export const GOOGLE_MODELS: GoogleModel[] = [
  {
    value: "gemini-pro-latest",
    label: "Gemini Pro (latest)",
    description: "Best · tracks Google's current Pro",
    group: "recommended",
    tier: "strong",
    thinking: "level",
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
  {
    value: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    description: "Balanced · newest Flash",
    group: "recommended",
    tier: "standard",
    thinking: "level",
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
  {
    value: "gemini-flash-latest",
    label: "Gemini Flash (latest)",
    description: "Fast · tracks Google's current Flash",
    group: "recommended",
    tier: "standard",
    thinking: "level",
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
  {
    value: "gemini-flash-lite-latest",
    label: "Gemini Flash Lite (latest)",
    description: "Fastest · cheapest for simple work",
    group: "recommended",
    tier: "cheap",
    thinking: "level",
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
  {
    value: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (preview)",
    description: "Advanced · pinned Pro preview",
    group: "previous",
    tier: "strong",
    thinking: "level",
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
  {
    value: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    group: "previous",
    tier: "standard",
    thinking: "level",
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
  {
    value: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    group: "previous",
    tier: "standard",
    thinking: "level",
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
  {
    value: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    group: "previous",
    tier: "standard",
    thinking: "level",
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
  {
    value: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    group: "previous",
    tier: "cheap",
    thinking: "level",
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
  {
    value: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    group: "previous",
    tier: "cheap",
    thinking: "level",
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
  {
    value: "gemini-3-flash-preview",
    label: "Gemini 3 Flash (preview)",
    group: "previous",
    tier: "standard",
    thinking: "level",
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
  // The 2.5 family: `thinkingLevel` is a 400 on every one of these.
  {
    value: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    group: "legacy",
    tier: "strong",
    thinking: "budget",
    budgetRange: [128, 32_768],
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
  {
    value: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    group: "legacy",
    tier: "standard",
    thinking: "budget",
    budgetRange: [0, 24_576],
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
  {
    value: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    group: "legacy",
    tier: "cheap",
    thinking: "budget",
    budgetRange: [512, 24_576],
    contextWindow: ONE_M,
    maxOutputTokens: OUT,
  },
];

export function googleModel(id: string): GoogleModel | undefined {
  return GOOGLE_MODELS.find((model) => model.value === id);
}

/** Zelyq's five effort levels onto Gemini's three thinking levels. */
export function googleThinkingLevel(effort: Effort): "LOW" | "MEDIUM" | "HIGH" {
  if (effort === "low") return "LOW";
  if (effort === "medium") return "MEDIUM";
  // high, xhigh and max all map to Gemini's deepest setting.
  return "HIGH";
}

/** Where each effort level sits within a model's own budget range. */
const budgetFraction: Record<Effort, number> = {
  low: 0.1,
  medium: 0.3,
  high: 0.6,
  xhigh: 0.8,
  max: 1,
};

export interface GoogleThinking {
  includeThoughts: true;
  thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
  thinkingBudget?: number;
}

/**
 * The `thinkingConfig` for a model, decided in one place.
 *
 * Sending `thinkingLevel` to every Gemini model — which is what this provider
 * used to do — fails outright on the 2.5 family, and `gemini-2.5-pro` was the
 * configured default. A budget model gets a value scaled into its own valid
 * range instead, because those ranges are not the same.
 */
export function googleThinkingConfig(id: string, effort: Effort): GoogleThinking {
  const model = googleModel(id);
  // An unknown or newer custom ID gets the modern shape rather than a guess at
  // a budget range that may not apply to it.
  if (!model || model.thinking === "level")
    return { includeThoughts: true, thinkingLevel: googleThinkingLevel(effort) };

  const [min, max] = model.budgetRange ?? [128, 24_576];
  const span = max - min;
  const budget = Math.round(min + span * budgetFraction[effort]);
  return { includeThoughts: true, thinkingBudget: Math.min(max, Math.max(min, budget)) };
}

export function availableGoogleModels(ids: readonly string[]): GoogleModel[] {
  const available = new Set(ids);
  return GOOGLE_MODELS.filter((model) => available.has(model.value));
}

export function chooseGoogleAutoModel(models: readonly ModelOption[]): string | undefined {
  const preferred = [
    GOOGLE_DEFAULT_MODEL,
    "gemini-3.1-pro-preview",
    "gemini-3.8-flash",
    "gemini-flash-latest",
    "gemini-3.7-flash",
    "gemini-flash-lite-latest",
  ];
  return (
    preferred.find((id) => models.some((model) => model.value === id)) ??
    models.find((model) => model.value !== GOOGLE_AUTO_MODEL)?.value
  );
}

export function withGoogleAuto(models: readonly ModelOption[]): ModelOption[] {
  return models.length
    ? [
        {
          value: GOOGLE_AUTO_MODEL,
          label: "Auto",
          description: "Best available balance · prefers Gemini Pro (latest)",
          group: "recommended",
        },
        ...models,
      ]
    : [];
}
