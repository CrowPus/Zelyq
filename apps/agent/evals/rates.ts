/**
 * Per-model USD rates, for the eval report's cost line and nothing else.
 *
 * Hand-maintained and best-effort. Vendor pricing pages move and this file is
 * not wired to anything that would notice, so treat a figure here as "roughly
 * right, last checked when this line was edited". A model with no entry gets no
 * dollar figure in the report — tokens still print, the `$` is just omitted.
 * That is the honest failure mode; a wrong number that looks authoritative is
 * the dangerous one.
 *
 * `cacheReadFactor` / `cacheCreationFactor` are multipliers on `inputPer1M`,
 * because Anthropic (and now some others) bill cached prefix reads at 0.1× and
 * the initial cache write at 1.25×. Providers without prompt caching never emit
 * those token counts, so their factors are unused and left at 0.
 */
export interface ModelRate {
  /** USD per 1M uncached input tokens. */
  inputPer1M: number;
  /** USD per 1M output tokens. */
  outputPer1M: number;
  /** Cache-read cost as a fraction of `inputPer1M`. Anthropic: 0.1. */
  cacheReadFactor: number;
  /** Cache-write cost as a fraction of `inputPer1M`. Anthropic: 1.25. */
  cacheCreationFactor: number;
}

const ANTHROPIC_CACHE = { cacheReadFactor: 0.1, cacheCreationFactor: 1.25 };
const NO_CACHE = { cacheReadFactor: 0, cacheCreationFactor: 0 };

/**
 * Anchors: `claude-opus-5` at $5 / $25 per MTok is the figure
 * `docs/maintainance/06-measurement.md` §2 costs the suite against. The rest of
 * the Claude family follows Anthropic's long-standing list ratios. Non-Anthropic
 * entries are estimates for the models that actually appear in recorded runs.
 */
export const MODEL_RATES: Record<string, ModelRate> = {
  "claude-opus-5": { inputPer1M: 5, outputPer1M: 25, ...ANTHROPIC_CACHE },
  "claude-sonnet-5": { inputPer1M: 3, outputPer1M: 15, ...ANTHROPIC_CACHE },
  "claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15, ...ANTHROPIC_CACHE },
  "claude-haiku-4-5": { inputPer1M: 1, outputPer1M: 5, ...ANTHROPIC_CACHE },
  // Estimates — the models the suite has historically run on.
  "gpt-5.2": { inputPer1M: 1.25, outputPer1M: 10, cacheReadFactor: 0.1, cacheCreationFactor: 0 },
  "gpt-5.1": { inputPer1M: 1.25, outputPer1M: 10, cacheReadFactor: 0.1, cacheCreationFactor: 0 },
  "gemini-3.7-flash": { inputPer1M: 0.3, outputPer1M: 2.5, ...NO_CACHE },
  "gemini-2.5-flash": { inputPer1M: 0.3, outputPer1M: 2.5, ...NO_CACHE },
  "gemini-pro-latest": { inputPer1M: 1.25, outputPer1M: 10, ...NO_CACHE },
};

export interface TokenCounts {
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * The true prompt size, not the uncached remainder. On Anthropic and OpenAI
 * `tokensIn` is only the part of the prompt that missed the cache; the cached
 * reads and the one-time cache write are the rest of the same prompt.
 */
export function totalPromptTokens(counts: TokenCounts): number {
  return counts.tokensIn + counts.cacheReadTokens + counts.cacheCreationTokens;
}

/** 0–1, or `null` when the prompt had no tokens at all. */
export function cachedFraction(counts: TokenCounts): number | null {
  const total = totalPromptTokens(counts);
  return total === 0 ? null : counts.cacheReadTokens / total;
}

/** USD, or `null` when the model has no rate entry. */
export function estimateCostUsd(model: string, counts: TokenCounts): number | null {
  const rate = MODEL_RATES[model];
  if (!rate) return null;
  const input =
    counts.tokensIn * rate.inputPer1M +
    counts.cacheReadTokens * rate.inputPer1M * rate.cacheReadFactor +
    counts.cacheCreationTokens * rate.inputPer1M * rate.cacheCreationFactor;
  const output = counts.tokensOut * rate.outputPer1M;
  return (input + output) / 1_000_000;
}

/** `$1.23`, `$0.0042`, or `—` when the model is unpriced. */
export function formatUsd(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "$0";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}
