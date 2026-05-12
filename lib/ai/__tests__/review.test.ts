import { describe, expect, it } from "vitest";

import { buildReviewPayload, ingredientNeedsReview, stepNeedsReview } from "../review";
import type { Discrepancy } from "../discrepancies";
import type { ExtractedRecipe } from "@/lib/validators";

function ing(
  name: string,
  opts: {
    quantity?: string | null;
    unit?: string | null;
    note?: string | null;
    confidence?: "high" | "low";
  } = {},
) {
  return {
    quantity: opts.quantity ?? null,
    unit: opts.unit ?? null,
    name,
    note: opts.note ?? null,
    confidence: opts.confidence ?? ("high" as const),
  };
}

function step(body: string, confidence: "high" | "low" = "high") {
  return { body, confidence };
}

function recipe(partial: Partial<ExtractedRecipe>): ExtractedRecipe {
  return {
    title: "Test",
    description: null,
    ingredients: [ing("salt", { quantity: "1", unit: "tsp" })],
    steps: [step("Mix.")],
    prepMinutes: null,
    cookMinutes: null,
    servings: null,
    mealType: null,
    cuisine: null,
    suggestedDiets: [],
    suggestedTags: [],
    ...partial,
  };
}

describe("buildReviewPayload", () => {
  it("returns rows with no flags when nothing was flagged", () => {
    const r = recipe({
      ingredients: [ing("salt", { quantity: "1", unit: "tsp" })],
      steps: [step("Mix.")],
    });
    const out = buildReviewPayload(r, []);
    expect(out.ingredients).toHaveLength(1);
    expect(out.ingredientFlags[0].lowConfidence).toBe(false);
    expect(ingredientNeedsReview(out.ingredientFlags[0])).toBe(false);
    expect(stepNeedsReview(out.stepFlags[0])).toBe(false);
  });

  it("attaches lowConfidence from the model's self-marking", () => {
    const r = recipe({
      ingredients: [
        ing("salt", { quantity: "1", unit: "tsp", confidence: "low" }),
      ],
    });
    const out = buildReviewPayload(r, []);
    expect(out.ingredientFlags[0].lowConfidence).toBe(true);
    expect(ingredientNeedsReview(out.ingredientFlags[0])).toBe(true);
  });

  it("attaches a mismatch flag with the verifier's reading", () => {
    const r = recipe({
      ingredients: [ing("salt", { quantity: "1", unit: "tsp" })],
    });
    const discrepancies: Discrepancy[] = [
      {
        kind: "ingredient_mismatch",
        index: 0,
        fieldsDiffering: ["unit"],
        original: { quantity: "1", unit: "tsp", name: "salt", note: null },
        check: { quantity: "1", unit: "tbsp", name: "salt", note: null },
        reason: "Verification pass read this as 1 tbsp salt.",
      },
    ];
    const out = buildReviewPayload(r, discrepancies);
    const flag = out.ingredientFlags[0];
    expect(flag.mismatch).not.toBeNull();
    expect(flag.mismatch?.check.unit).toBe("tbsp");
    expect(flag.mismatch?.fieldsDiffering).toEqual(["unit"]);
    expect(ingredientNeedsReview(flag)).toBe(true);
  });

  it("splices in verifier-added ingredients at the suggested position", () => {
    const r = recipe({
      ingredients: [
        ing("salt", { quantity: "1", unit: "tsp" }),
        ing("flour", { quantity: "2", unit: "cups" }),
      ],
    });
    const discrepancies: Discrepancy[] = [
      {
        kind: "ingredient_missing_from_original",
        suggestedIndex: 1,
        check: { quantity: "1", unit: "tsp", name: "vanilla", note: null },
        reason: "Verification pass found vanilla.",
      },
    ];
    const out = buildReviewPayload(r, discrepancies);
    expect(out.ingredients.map((x) => x.name)).toEqual([
      "salt",
      "vanilla",
      "flour",
    ]);
    // Vanilla is the new injected row; the others stay clean.
    expect(out.ingredientFlags[0].injected).toBeNull();
    expect(out.ingredientFlags[1].injected).not.toBeNull();
    expect(out.ingredientFlags[2].injected).toBeNull();
    expect(ingredientNeedsReview(out.ingredientFlags[1])).toBe(true);
  });

  it("inserts multiple verifier additions in order with shifting positions", () => {
    const r = recipe({
      ingredients: [ing("salt"), ing("flour"), ing("butter")],
    });
    const discrepancies: Discrepancy[] = [
      {
        kind: "ingredient_missing_from_original",
        suggestedIndex: 0,
        check: { quantity: null, unit: null, name: "olive oil", note: null },
        reason: "Verification pass found olive oil.",
      },
      {
        kind: "ingredient_missing_from_original",
        suggestedIndex: 2,
        check: { quantity: null, unit: null, name: "garlic", note: null },
        reason: "Verification pass found garlic.",
      },
    ];
    const out = buildReviewPayload(r, discrepancies);
    expect(out.ingredients.map((x) => x.name)).toEqual([
      "olive oil",
      "salt",
      "flour",
      "garlic",
      "butter",
    ]);
    // Positions get re-numbered so the form sees a clean sequence.
    expect(out.ingredients.map((x) => x.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it("flags only-in-original ingredients", () => {
    const r = recipe({
      ingredients: [ing("salt"), ing("MSG")],
    });
    const discrepancies: Discrepancy[] = [
      {
        kind: "ingredient_only_in_original",
        index: 1,
        original: { quantity: null, unit: null, name: "MSG", note: null },
        reason: "Verification pass didn't see this.",
      },
    ];
    const out = buildReviewPayload(r, discrepancies);
    expect(out.ingredientFlags[0].onlyInOriginal).toBeNull();
    expect(out.ingredientFlags[1].onlyInOriginal).not.toBeNull();
  });

  it("handles step text divergence + step injection", () => {
    const r = recipe({
      steps: [step("Bake at 350F."), step("Cool.")],
    });
    const discrepancies: Discrepancy[] = [
      {
        kind: "step_text_diverges",
        index: 0,
        original: "Bake at 350F.",
        check: "Bake at 425F.",
        reason: "Verification pass read this differently.",
      },
      {
        kind: "step_missing_from_original",
        suggestedIndex: 2,
        check: "Garnish with parsley.",
        reason: "Verification pass found this step.",
      },
    ];
    const out = buildReviewPayload(r, discrepancies);
    expect(out.steps.map((s) => s.body)).toEqual([
      "Bake at 350F.",
      "Cool.",
      "Garnish with parsley.",
    ]);
    expect(out.stepFlags[0].textDiverges?.check).toBe("Bake at 425F.");
    expect(out.stepFlags[2].injected).not.toBeNull();
  });

  it("doesn't crash on out-of-bounds discrepancy indices", () => {
    const r = recipe({
      ingredients: [ing("salt")],
    });
    const discrepancies: Discrepancy[] = [
      {
        kind: "ingredient_mismatch",
        index: 99,
        fieldsDiffering: ["unit"],
        original: { quantity: null, unit: null, name: "salt", note: null },
        check: { quantity: null, unit: "tbsp", name: "salt", note: null },
        reason: "...",
      },
    ];
    expect(() => buildReviewPayload(r, discrepancies)).not.toThrow();
  });
});
