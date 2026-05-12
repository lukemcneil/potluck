/**
 * AI model pricing in US dollars per million tokens.
 *
 * OpenAI rates: https://platform.openai.com/docs/pricing
 * Google rates: https://ai.google.dev/pricing
 *
 * Update these when providers change prices. Each entry maps a model
 * id (or family prefix) to its standard tier rates. Cached input
 * tokens are billed at half the input rate where supported.
 *
 * Gemini has a free tier (15 RPM, 1500 req/day) — the cost ledger
 * still tracks notional spend so you can see how close you are to
 * the free-tier ceiling.
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

  // Google Gemini — paid-tier rates. Free-tier users won't actually
  // be charged anything by Google (15 RPM, 1500 req/day, 1M token
  // ceiling) but we still compute notional cost so the UI's spend
  // chart works the same way.
  "gemini-2.0-flash": {
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
  },
  "gemini-2.0-flash-lite": {
    inputPerMillion: 0.075,
    outputPerMillion: 0.3,
  },
  "gemini-1.5-flash": {
    inputPerMillion: 0.075,
    outputPerMillion: 0.3,
  },
  "gemini-2.5-flash": {
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
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

// Two formatters: one for "real money" amounts (>= $1) where 2
// decimals is plenty, and one for sub-dollar AI-extraction costs
// where we still want precision but not the 6-decimal noise that
// reads as "$0.143138". 4 fraction digits keeps tenths-of-a-cent
// resolution which is plenty for surfacing per-extraction spend.
const dollarFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const subDollarFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function formatUsd(amount: number): string {
  return Math.abs(amount) >= 1
    ? dollarFmt.format(amount)
    : subDollarFmt.format(amount);
}
