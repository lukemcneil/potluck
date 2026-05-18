import "server-only";

import { APICallError } from "ai";

/**
 * Recognise a "you're rate-limited / over quota" failure from any of
 * the AI provider clients we wrap. We rely on the AI SDK's typed
 * `APICallError.statusCode` first; the substring fallback exists
 * because some intermediate Promise wrapping (especially when the
 * SDK is invoked via `Promise.race` for timeouts) strips the typed
 * marker and we still want to recognise the failure.
 *
 * What counts as "rate limited":
 *   - HTTP 429 (Google's daily RPD ceiling on free tier; OpenAI's
 *     org-level minute rate limits when bursting).
 *   - Google's `RESOURCE_EXHAUSTED` status code embedded in the error
 *     message body (sometimes surfaced with a non-429 status).
 *   - Common provider phrasings: "rate limit", "quota exceeded".
 *
 * Exported so /api/extract can surface a nicer error to the user when
 * even the last model in the chain runs out of quota.
 */
export function isRateLimitError(err: unknown): boolean {
  if (APICallError.isInstance(err) && err.statusCode === 429) {
    return true;
  }
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  if (!message) return false;
  return /\b429\b|RESOURCE_EXHAUSTED|quota exceeded|rate limit/i.test(message);
}

/**
 * Try each model in `modelChain` in order. On a rate-limit failure
 * (see {@link isRateLimitError}) we move on to the next model in the
 * chain; on any other failure we propagate immediately. This is the
 * mechanism that lets us default to `gemini-2.5-flash` (smarter but
 * capped at ~20 free-tier requests per day on some accounts) and
 * gracefully degrade to `gemini-3.1-flash-lite` (a different quota
 * bucket with much higher RPD) once we burn through that day's
 * 2.5-flash budget.
 *
 * Returns the first model's result along with which model actually
 * served it, so the caller can log + bill against the right model id.
 * Throws the last error if every model in the chain is exhausted.
 *
 * Why not also fall back on schema-validation failures? Those are
 * already retried in-place by `generateObjectResilient` against the
 * same model with a tougher reminder. A schema failure that survives
 * that loop is a strong signal the model can't do this prompt, not a
 * transient hiccup, and falling further down the chain (to a
 * smaller/weaker model) usually doesn't help.
 */
export async function runWithFallback<T>(
  modelChain: readonly string[],
  label: string,
  call: (modelId: string) => Promise<T>,
): Promise<{ result: T; usedModel: string }> {
  if (modelChain.length === 0) {
    throw new Error(`runWithFallback(${label}): model chain is empty`);
  }

  let lastError: unknown;
  for (let i = 0; i < modelChain.length; i += 1) {
    const modelId = modelChain[i];
    try {
      const result = await call(modelId);
      if (i > 0) {
        console.log(
          `[ai.${label}] succeeded on fallback model ${modelId} ` +
            `(attempt ${i + 1}/${modelChain.length})`,
        );
      }
      return { result, usedModel: modelId };
    } catch (err) {
      lastError = err;
      if (!isRateLimitError(err)) {
        throw err;
      }
      const next = modelChain[i + 1];
      if (!next) {
        console.warn(
          `[ai.${label}] ${modelId} hit a 429 and no fallback models remain; giving up`,
        );
        throw err;
      }
      console.warn(
        `[ai.${label}] ${modelId} hit 429 (rate limit / quota exhausted); ` +
          `falling back to ${next}`,
      );
    }
  }

  // Unreachable — the loop either returns or throws — but TS doesn't
  // know that without a final throw.
  throw lastError ?? new Error(`runWithFallback(${label}): unreachable`);
}
