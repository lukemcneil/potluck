/**
 * OpenAI pricing as of April 2026, in US dollars per million tokens.
 * Source: https://platform.openai.com/docs/pricing
 *
 * Update these when OpenAI changes prices. Each entry maps a model id
 * (or family prefix) to its standard tier rates. Cached input tokens
 * are billed at half the input rate where supported.
 */

export type ModelPricing = {
  /** $ per 1M input tokens. */
  inputPerMillion: number;
  /** $ per 1M output tokens. */
  outputPerMillion: number;
  /** $ per 1M cached input tokens (typically 50% off). */
  cachedInputPerMillion?: number;
};

const PRICING: Record<string, ModelPricing> = {
  "gpt-4o": {
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    cachedInputPerMillion: 1.25,
  },
  "gpt-4o-mini": {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cachedInputPerMillion: 0.075,
  },
  // Aliases so dated snapshots resolve to the right family.
  "gpt-4o-2024-08-06": {
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    cachedInputPerMillion: 1.25,
  },
  "gpt-4o-mini-2024-07-18": {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cachedInputPerMillion: 0.075,
  },
};

export function pricingFor(modelId: string): ModelPricing | null {
  if (PRICING[modelId]) return PRICING[modelId];
  // Fall back to family prefix match (e.g. "gpt-4o-mini-foo" -> "gpt-4o-mini").
  // Sort longest-first so "gpt-4o-mini" wins over "gpt-4o" for that input.
  const prefixes = Object.keys(PRICING).sort((a, b) => b.length - a.length);
  for (const p of prefixes) {
    if (modelId.startsWith(p)) return PRICING[p];
  }
  return null;
}

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
};

export type CostBreakdown = {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Total uncached input tokens billed at the input rate. */
  billedInputTokens: number;
  inputCost: number;
  cachedInputCost: number;
  outputCost: number;
  totalCost: number;
  /** Set when the model isn't in the pricing table (cost will be 0). */
  unknownPricing?: true;
};

export function computeCost(modelId: string, usage: Usage): CostBreakdown {
  const pricing = pricingFor(modelId);
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const billedInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);

  if (!pricing) {
    return {
      modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens,
      billedInputTokens,
      inputCost: 0,
      cachedInputCost: 0,
      outputCost: 0,
      totalCost: 0,
      unknownPricing: true,
    };
  }

  const inputCost = (billedInputTokens / 1_000_000) * pricing.inputPerMillion;
  const cachedInputCost = pricing.cachedInputPerMillion
    ? (cachedInputTokens / 1_000_000) * pricing.cachedInputPerMillion
    : (cachedInputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  return {
    modelId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens,
    billedInputTokens,
    inputCost,
    cachedInputCost,
    outputCost,
    totalCost: inputCost + cachedInputCost + outputCost,
  };
}

const dollarFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

export function formatUsd(amount: number): string {
  return dollarFmt.format(amount);
}
