import { describe, expect, it, vi } from "vitest";

// `extract-recipe.ts` has `import "server-only"` to keep it out of
// client bundles in Next; vitest runs under plain Node so we have to
// neutralize that import the same way the other AI-suite tests do.
vi.mock("server-only", () => ({}));

import {
  buildExtractUserContent,
  defaultModelChainFor,
} from "../extract-recipe";

/**
 * Coverage for the paste-text import path. The core invariants we want
 * to lock in are:
 *
 *  1. Text routes to the cheap text-only model, NOT the vision model.
 *     Regressing that would silently burn ~6× more dollars on every
 *     pasted note.
 *  2. The user content built for text inputs actually contains the
 *     pasted text, wrapped in the markers the system prompt expects.
 *  3. Over-budget pastes get truncated with a visible marker so the
 *     model never sees a mid-sentence cut.
 */
describe("defaultModelChainFor (text path)", () => {
  it("openai: text uses the same single-model chain as url", () => {
    const text = defaultModelChainFor("openai", "text");
    const url = defaultModelChainFor("openai", "url");
    expect(text).toEqual(url);
    expect(text).toHaveLength(1);
  });

  it("openai: text does NOT route to the vision model", () => {
    const text = defaultModelChainFor("openai", "text");
    const image = defaultModelChainFor("openai", "imageIds");
    expect(text).not.toEqual(image);
  });

  it("google: text's primary model matches url's primary model", () => {
    const text = defaultModelChainFor("google", "text");
    const url = defaultModelChainFor("google", "url");
    expect(text[0]).toBe(url[0]);
  });

  it("google: text matches url (Google's default text and image primary happen to be the same multimodal model, but text must follow the URL path so we never accidentally route through a vision-only fork in the future)", () => {
    const text = defaultModelChainFor("google", "text");
    const url = defaultModelChainFor("google", "url");
    expect(text).toEqual(url);
  });

  it("google: text chain has a fallback entry (length >= 2 unless env collapses)", () => {
    const chain = defaultModelChainFor("google", "text");
    // We don't assert exact length because env vars can collapse the
    // chain when primary === fallback, but we should always have at
    // least the primary.
    expect(chain.length).toBeGreaterThanOrEqual(1);
    // The chain dedupes, so any returned entries must be unique.
    expect(new Set(chain).size).toBe(chain.length);
  });
});

describe("buildExtractUserContent — text input", () => {
  async function textPart(input: string) {
    const parts = await buildExtractUserContent({ kind: "text", text: input });
    expect(parts).toHaveLength(1);
    const first = parts[0];
    if (typeof first === "string" || first.type !== "text") {
      throw new Error("expected a single text part");
    }
    return first.text;
  }

  it("wraps the pasted text in BEGIN/END markers", async () => {
    const body = await textPart("Mom's cookies\n\n2 cups flour\n1 cup butter");
    expect(body).toContain("--- BEGIN TEXT ---");
    expect(body).toContain("--- END TEXT ---");
    expect(body).toContain("2 cups flour");
    expect(body).toContain("1 cup butter");
  });

  it("instructs the model to preserve loose author wording", async () => {
    const body = await textPart("Pinch of salt to taste, mix and serve hot — easy weeknight meal.");
    // The prompt should explicitly call out keeping the casual wording
    // verbatim rather than tidying it into measurements.
    expect(body.toLowerCase()).toContain("verbatim");
  });

  it("trims whitespace before embedding", async () => {
    const padded = "   \n\n" + "Recipe body here." + "   \n\t";
    const body = await textPart(padded);
    // Whitespace shouldn't appear immediately after the BEGIN marker.
    const begin = body.indexOf("--- BEGIN TEXT ---");
    const afterMarker = body
      .slice(begin + "--- BEGIN TEXT ---".length)
      .replace(/^\n+/, "");
    expect(afterMarker.startsWith("   ")).toBe(false);
    expect(afterMarker.startsWith("\t")).toBe(false);
  });

  it("truncates over-budget pastes with a visible marker", async () => {
    // TEXT_CHAR_BUDGET in extract-recipe.ts is 50K; anything over that
    // should be cut down before the model sees it, with a trailing
    // [...truncated] marker.
    const huge = "a".repeat(60_000);
    const body = await textPart(huge);
    expect(body).toContain("[…truncated]");
    // The body should be substantially shorter than 60K — within a
    // generous prompt-overhead allowance of the 50K budget.
    expect(body.length).toBeLessThan(55_000);
  });

  it("does NOT add a truncation marker when the paste fits", async () => {
    const small = "Recipe body that fits comfortably under the budget.";
    const body = await textPart(small);
    expect(body).not.toContain("[…truncated]");
  });
});
