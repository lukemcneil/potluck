import { describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";

import {
  isRateLimitError,
  runWithFallback,
} from "@/lib/ai/model-fallback";

vi.mock("server-only", () => ({}));

function make429(message = "Rate limit exceeded"): APICallError {
  return new APICallError({
    message,
    url: "https://example.test",
    requestBodyValues: {},
    statusCode: 429,
    isRetryable: false,
  });
}

describe("isRateLimitError", () => {
  it("recognises an AI-SDK APICallError with status 429", () => {
    expect(isRateLimitError(make429())).toBe(true);
  });

  it("does not match APICallError with non-429 status", () => {
    const err = new APICallError({
      message: "boom",
      url: "https://example.test",
      requestBodyValues: {},
      statusCode: 500,
      isRetryable: true,
    });
    expect(isRateLimitError(err)).toBe(false);
  });

  it("matches a plain Error whose message mentions 429", () => {
    expect(isRateLimitError(new Error("Got HTTP 429 from upstream"))).toBe(true);
  });

  it("matches Gemini's RESOURCE_EXHAUSTED phrasing", () => {
    expect(
      isRateLimitError(
        new Error('Status: RESOURCE_EXHAUSTED, message: "Quota exceeded"'),
      ),
    ).toBe(true);
  });

  it("matches 'quota exceeded' / 'rate limit' phrasings", () => {
    expect(isRateLimitError(new Error("quota exceeded for project"))).toBe(true);
    expect(isRateLimitError(new Error("rate limit hit, retry later"))).toBe(true);
  });

  it("does not match unrelated error messages", () => {
    expect(isRateLimitError(new Error("model not found"))).toBe(false);
    expect(isRateLimitError(new Error("Bad Request"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
    expect(isRateLimitError({ statusCode: 429 })).toBe(false);
  });

  it("matches a string-typed error mentioning 429", () => {
    expect(isRateLimitError("got 429 from server")).toBe(true);
  });
});

describe("runWithFallback", () => {
  it("returns the first model's result on the happy path without falling back", async () => {
    const call = vi.fn(async (modelId: string) => `ok-${modelId}`);
    const out = await runWithFallback(["a", "b"], "test", call);
    expect(out).toEqual({ result: "ok-a", usedModel: "a" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("a");
  });

  it("falls back to the next model on a 429", async () => {
    const call = vi.fn(async (modelId: string) => {
      if (modelId === "a") throw make429();
      return `ok-${modelId}`;
    });
    const out = await runWithFallback(["a", "b"], "test", call);
    expect(out).toEqual({ result: "ok-b", usedModel: "b" });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenNthCalledWith(1, "a");
    expect(call).toHaveBeenNthCalledWith(2, "b");
  });

  it("falls back through multiple 429s", async () => {
    const call = vi.fn(async (modelId: string) => {
      if (modelId === "a" || modelId === "b") throw make429();
      return `ok-${modelId}`;
    });
    const out = await runWithFallback(["a", "b", "c"], "test", call);
    expect(out).toEqual({ result: "ok-c", usedModel: "c" });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("propagates non-rate-limit errors immediately without falling back", async () => {
    const call = vi.fn(async (modelId: string) => {
      if (modelId === "a") throw new Error("model not found");
      return `ok-${modelId}`;
    });
    await expect(runWithFallback(["a", "b"], "test", call)).rejects.toThrow(
      "model not found",
    );
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("throws the last 429 when every model in the chain is exhausted", async () => {
    const call = vi.fn(async () => {
      throw make429("Daily limit reached");
    });
    await expect(runWithFallback(["a", "b"], "test", call)).rejects.toThrow(
      "Daily limit reached",
    );
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("works with a single-model chain (no fallback available)", async () => {
    const call = vi.fn(async (modelId: string) => `ok-${modelId}`);
    const out = await runWithFallback(["solo"], "test", call);
    expect(out).toEqual({ result: "ok-solo", usedModel: "solo" });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("a single-model chain that 429s throws (no fallback to try)", async () => {
    const call = vi.fn(async () => {
      throw make429();
    });
    await expect(runWithFallback(["solo"], "test", call)).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("throws synchronously when given an empty chain", async () => {
    await expect(
      runWithFallback([], "test", async () => "never"),
    ).rejects.toThrow(/empty/);
  });

  it("recognises a non-typed Error with 429 phrasing as rate-limited", async () => {
    // Defensive case: AI SDK error wrapping sometimes strips the
    // APICallError type marker; we still want to fall back.
    const call = vi.fn(async (modelId: string) => {
      if (modelId === "a") throw new Error("Upstream returned 429");
      return `ok-${modelId}`;
    });
    const out = await runWithFallback(["a", "b"], "test", call);
    expect(out).toEqual({ result: "ok-b", usedModel: "b" });
  });
});
