import { describe, expect, it } from "vitest";

import { diffExtractions, normalizeName } from "../discrepancies";
import type { ExtractedRecipe } from "@/lib/validators";

function ing(
  name: string,
  quantity: string | null = null,
  unit: string | null = null,
  note: string | null = null,
) {
  return { name, quantity, unit, note, confidence: "high" as const };
}

function step(body: string) {
  return { body, confidence: "high" as const };
}

function recipe(
  partial: Partial<ExtractedRecipe>,
): ExtractedRecipe {
  return {
    title: "Test",
    description: null,
    ingredients: [ing("salt", "1", "tsp")],
    steps: [step("Mix everything.")],
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

describe("normalizeName", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeName("All-Purpose Flour!")).toBe("all purpose flour");
  });

  it("collapses whitespace", () => {
    expect(normalizeName("  ripe   bananas  ")).toBe("ripe bananas");
  });

  it("strips diacritics", () => {
    expect(normalizeName("crème brûlée")).toBe("creme brulee");
  });
});

describe("diffExtractions — ingredients", () => {
  it("returns nothing when both extractions agree", () => {
    const a = recipe({
      ingredients: [ing("salt", "1", "tsp"), ing("sugar", "2", "tbsp")],
    });
    const b = recipe({
      ingredients: [ing("salt", "1", "tsp"), ing("sugar", "2", "tbsp")],
    });
    expect(diffExtractions(a, b)).toEqual([]);
  });

  it("flags an ingredient_mismatch when the unit changes (the canonical 1 tsp -> 1 tbsp salt failure mode)", () => {
    const a = recipe({ ingredients: [ing("salt", "1", "tsp")] });
    const b = recipe({ ingredients: [ing("salt", "1", "tbsp")] });
    const out = diffExtractions(a, b);
    expect(out).toHaveLength(1);
    const [d] = out;
    expect(d.kind).toBe("ingredient_mismatch");
    if (d.kind === "ingredient_mismatch") {
      expect(d.index).toBe(0);
      expect(d.fieldsDiffering).toEqual(["unit"]);
      expect(d.original.unit).toBe("tsp");
      expect(d.check.unit).toBe("tbsp");
      expect(d.reason).toMatch(/tbsp/);
    }
  });

  it("flags an ingredient_mismatch when the quantity changes", () => {
    const a = recipe({ ingredients: [ing("flour", "2", "cups")] });
    const b = recipe({ ingredients: [ing("flour", "3", "cups")] });
    const out = diffExtractions(a, b);
    expect(out).toHaveLength(1);
    const [d] = out;
    if (d.kind !== "ingredient_mismatch") throw new Error("kind");
    expect(d.fieldsDiffering).toEqual(["quantity"]);
  });

  it("flags both fields when both differ", () => {
    const a = recipe({ ingredients: [ing("butter", "1/2", "cup")] });
    const b = recipe({ ingredients: [ing("butter", "1", "stick")] });
    const out = diffExtractions(a, b);
    expect(out).toHaveLength(1);
    const [d] = out;
    if (d.kind !== "ingredient_mismatch") throw new Error("kind");
    expect(new Set(d.fieldsDiffering)).toEqual(new Set(["quantity", "unit"]));
  });

  it("does NOT flag note differences (notes are free-form)", () => {
    const a = recipe({
      ingredients: [ing("onion", "1", null, "diced")],
    });
    const b = recipe({
      ingredients: [ing("onion", "1", null, "finely chopped")],
    });
    expect(diffExtractions(a, b)).toEqual([]);
  });

  it("emits ingredient_only_in_original when an ingredient is unmatched in the check pass", () => {
    const a = recipe({
      ingredients: [ing("salt", "1", "tsp"), ing("MSG", "1", "tsp")],
    });
    const b = recipe({ ingredients: [ing("salt", "1", "tsp")] });
    const out = diffExtractions(a, b);
    expect(out).toHaveLength(1);
    const [d] = out;
    expect(d.kind).toBe("ingredient_only_in_original");
    if (d.kind === "ingredient_only_in_original") {
      expect(d.index).toBe(1);
      expect(d.original.name).toBe("MSG");
    }
  });

  it("emits ingredient_missing_from_original when the check pass found something we didn't", () => {
    const a = recipe({ ingredients: [ing("salt", "1", "tsp")] });
    const b = recipe({
      ingredients: [ing("salt", "1", "tsp"), ing("vanilla", "1", "tsp")],
    });
    const out = diffExtractions(a, b);
    expect(out).toHaveLength(1);
    const [d] = out;
    expect(d.kind).toBe("ingredient_missing_from_original");
    if (d.kind === "ingredient_missing_from_original") {
      expect(d.check.name).toBe("vanilla");
      expect(d.suggestedIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("matches case-insensitively across punctuation differences", () => {
    const a = recipe({
      ingredients: [ing("All-Purpose Flour", "2", "cups")],
    });
    const b = recipe({
      ingredients: [ing("all purpose flour", "2", "cups")],
    });
    expect(diffExtractions(a, b)).toEqual([]);
  });

  it("normalizes whitespace and case in quantity / unit comparisons", () => {
    const a = recipe({ ingredients: [ing("salt", "1 ", "Tbsp")] });
    const b = recipe({ ingredients: [ing("salt", "1", "tbsp")] });
    expect(diffExtractions(a, b)).toEqual([]);
  });
});

describe("diffExtractions — steps", () => {
  it("emits nothing when steps match", () => {
    const a = recipe({
      steps: [step("Mash bananas."), step("Mix dry and wet.")],
    });
    const b = recipe({
      steps: [step("Mash bananas."), step("Mix dry and wet.")],
    });
    expect(
      diffExtractions(a, b).filter((d) => d.kind.startsWith("step_")),
    ).toEqual([]);
  });

  it("tolerates light paraphrases (cosmetic differences only)", () => {
    const a = recipe({
      steps: [step("Mash the bananas in a bowl.")],
    });
    const b = recipe({
      steps: [step("Mash the bananas in a bowl")],
    });
    expect(
      diffExtractions(a, b).filter((d) => d.kind.startsWith("step_")),
    ).toEqual([]);
  });

  it("flags step_text_diverges when the step is substantively different", () => {
    const a = recipe({
      steps: [step("Bake at 350F for 1 hour until golden.")],
    });
    const b = recipe({
      steps: [step("Bake at 425F for 20 minutes.")],
    });
    const out = diffExtractions(a, b).filter((d) =>
      d.kind.startsWith("step_"),
    );
    expect(out).toHaveLength(1);
    const [d] = out;
    expect(d.kind).toBe("step_text_diverges");
    if (d.kind === "step_text_diverges") expect(d.index).toBe(0);
  });

  it("emits step_only_in_original for trailing original steps", () => {
    const a = recipe({
      steps: [step("Mix."), step("Bake."), step("Cool.")],
    });
    const b = recipe({ steps: [step("Mix."), step("Bake.")] });
    const out = diffExtractions(a, b).filter((d) =>
      d.kind.startsWith("step_"),
    );
    expect(out).toHaveLength(1);
    const [d] = out;
    expect(d.kind).toBe("step_only_in_original");
    if (d.kind === "step_only_in_original") {
      expect(d.index).toBe(2);
      expect(d.original).toBe("Cool.");
    }
  });

  it("emits step_missing_from_original for trailing check-only steps", () => {
    const a = recipe({ steps: [step("Mix."), step("Bake.")] });
    const b = recipe({
      steps: [step("Mix."), step("Bake."), step("Garnish with parsley.")],
    });
    const out = diffExtractions(a, b).filter((d) =>
      d.kind.startsWith("step_"),
    );
    expect(out).toHaveLength(1);
    const [d] = out;
    expect(d.kind).toBe("step_missing_from_original");
    if (d.kind === "step_missing_from_original") {
      expect(d.check).toMatch(/parsley/);
    }
  });
});

describe("diffExtractions — combined", () => {
  it("returns ingredient and step discrepancies together, in that order", () => {
    const a = recipe({
      ingredients: [ing("salt", "1", "tsp")],
      steps: [step("Bake at 350F for 1 hour.")],
    });
    const b = recipe({
      ingredients: [ing("salt", "1", "tbsp")],
      steps: [step("Broil at 500F for 5 minutes.")],
    });
    const out = diffExtractions(a, b);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("ingredient_mismatch");
    expect(out[1].kind).toBe("step_text_diverges");
  });

  it("handles empty-name original ingredients gracefully (skips matching, emits unmatched)", () => {
    const a = recipe({
      ingredients: [ing("", "1", "tsp"), ing("salt", "1", "tsp")],
    });
    const b = recipe({ ingredients: [ing("salt", "1", "tsp")] });
    const out = diffExtractions(a, b);
    // The empty-name ingredient can't match anything, so it surfaces
    // as "only in original". The salt row matches cleanly.
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("ingredient_only_in_original");
  });
});
