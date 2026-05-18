import { describe, expect, it } from "vitest";

import {
  diffExtractions,
  issuesToDiscrepancies,
  normalizeName,
} from "../discrepancies";
import type {
  ExtractedRecipe,
  ExtractionIssues,
  IngredientIssue,
  StepIssue,
} from "@/lib/validators";

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
    notes: null,
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

// =========================================================================
// `issuesToDiscrepancies` — translator from the sequential audit pass's
// structured output into the existing Discrepancy[] shape the review UI
// consumes. The audit pass produces typed "issues" (wrong_quantity,
// missing, should_be_removed, etc.); we translate to mismatches /
// missing_from / only_in_original so the review UI keeps working
// unchanged.
// =========================================================================

function ingIssue(partial: Partial<IngredientIssue>): IngredientIssue {
  return {
    primaryIndex: 0,
    kind: "wrong_quantity",
    correctedQuantity: null,
    correctedUnit: null,
    correctedName: null,
    correctedNote: null,
    reason: "audited",
    ...partial,
  };
}

function stepIssue(partial: Partial<StepIssue>): StepIssue {
  return {
    primaryIndex: 0,
    kind: "text_wrong",
    insertPosition: null,
    correctedText: null,
    reason: "audited",
    ...partial,
  };
}

function noIssues(): ExtractionIssues {
  return { looksCorrect: true, ingredientIssues: [], stepIssues: [] };
}

describe("issuesToDiscrepancies", () => {
  it("emits nothing when the audit pass says everything is correct", () => {
    const primary = recipe({});
    expect(issuesToDiscrepancies(noIssues(), primary)).toEqual([]);
  });

  it("translates wrong_quantity into an ingredient_mismatch with quantity field", () => {
    const primary = recipe({
      ingredients: [ing("salt", "1", "tbsp")],
    });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [
        ingIssue({
          primaryIndex: 0,
          kind: "wrong_quantity",
          correctedQuantity: "1",
          correctedUnit: "tsp",
          reason: "Source says 1 tsp not 1 tbsp.",
        }),
      ],
      stepIssues: [],
    };
    const out = issuesToDiscrepancies(issues, primary);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "ingredient_mismatch",
      index: 0,
      fieldsDiffering: ["quantity"],
      check: { quantity: "1", unit: "tsp", name: "salt" },
      reason: "Source says 1 tsp not 1 tbsp.",
    });
  });

  it("translates wrong_unit (the canonical tsp/tbsp swap) into a unit mismatch", () => {
    const primary = recipe({ ingredients: [ing("salt", "1", "tbsp")] });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [
        ingIssue({
          primaryIndex: 0,
          kind: "wrong_unit",
          correctedQuantity: "1",
          correctedUnit: "tsp",
          reason: "Source clearly reads tsp.",
        }),
      ],
      stepIssues: [],
    };
    const out = issuesToDiscrepancies(issues, primary);
    expect(out[0]).toMatchObject({
      kind: "ingredient_mismatch",
      fieldsDiffering: ["unit"],
      check: { unit: "tsp" },
    });
  });

  it("uses primary's name for wrong_quantity / wrong_unit (doesn't propose a rename)", () => {
    const primary = recipe({ ingredients: [ing("salt", "1", "tbsp")] });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [
        ingIssue({
          primaryIndex: 0,
          kind: "wrong_unit",
          correctedQuantity: "1",
          correctedUnit: "tsp",
          // Verifier mistakenly fills in correctedName too. We should
          // ignore it for unit-only fixes so the strip doesn't show a
          // spurious "use 'salt' / use 'salt'" chooser.
          correctedName: "kosher salt",
          reason: "tsp not tbsp",
        }),
      ],
      stepIssues: [],
    };
    const out = issuesToDiscrepancies(issues, primary);
    expect((out[0] as { check: { name: string } }).check.name).toBe("salt");
  });

  it("translates wrong_name into a name mismatch using the corrected name", () => {
    const primary = recipe({ ingredients: [ing("flour", "2", "cups")] });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [
        ingIssue({
          primaryIndex: 0,
          kind: "wrong_name",
          correctedName: "cake flour",
          reason: "Source specifies cake flour.",
        }),
      ],
      stepIssues: [],
    };
    const out = issuesToDiscrepancies(issues, primary);
    expect(out[0]).toMatchObject({
      kind: "ingredient_mismatch",
      fieldsDiffering: ["name"],
      check: { name: "cake flour" },
    });
  });

  it("translates should_be_removed into ingredient_only_in_original", () => {
    const primary = recipe({
      ingredients: [ing("salt", "1", "tsp"), ing("paprika", "1", "tsp")],
    });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [
        ingIssue({
          primaryIndex: 1,
          kind: "should_be_removed",
          reason: "Source has no paprika; this is hallucinated.",
        }),
      ],
      stepIssues: [],
    };
    const out = issuesToDiscrepancies(issues, primary);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "ingredient_only_in_original",
      index: 1,
      original: { name: "paprika" },
    });
  });

  it("translates missing into ingredient_missing_from_original (appended)", () => {
    const primary = recipe({ ingredients: [ing("salt", "1", "tsp")] });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [
        ingIssue({
          primaryIndex: null,
          kind: "missing",
          correctedQuantity: "1",
          correctedUnit: "pinch",
          correctedName: "sea salt for finishing",
          reason: "Source has a finishing salt the primary missed.",
        }),
      ],
      stepIssues: [],
    };
    const out = issuesToDiscrepancies(issues, primary);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "ingredient_missing_from_original",
      suggestedIndex: 1,
      check: {
        quantity: "1",
        unit: "pinch",
        name: "sea salt for finishing",
      },
    });
  });

  it("drops missing-ingredient issues that don't have a name", () => {
    const primary = recipe({ ingredients: [ing("salt", "1", "tsp")] });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [
        ingIssue({
          primaryIndex: null,
          kind: "missing",
          // No correctedName → not actionable.
          reason: "Something is missing.",
        }),
      ],
      stepIssues: [],
    };
    expect(issuesToDiscrepancies(issues, primary)).toEqual([]);
  });

  it("drops issues with out-of-bounds primaryIndex", () => {
    const primary = recipe({ ingredients: [ing("salt", "1", "tsp")] });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [
        ingIssue({
          primaryIndex: 17,
          kind: "wrong_quantity",
          correctedQuantity: "2",
          reason: "but there's no index 17",
        }),
      ],
      stepIssues: [],
    };
    expect(issuesToDiscrepancies(issues, primary)).toEqual([]);
  });

  it("translates step text_wrong into step_text_diverges with corrected text", () => {
    const primary = recipe({
      steps: [step("Bake at 350F for 1 hour."), step("Cool on a rack.")],
    });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [],
      stepIssues: [
        stepIssue({
          primaryIndex: 0,
          kind: "text_wrong",
          correctedText: "Bake at 375F for 45 minutes.",
          reason: "Source temperature/time differs.",
        }),
      ],
    };
    const out = issuesToDiscrepancies(issues, primary);
    expect(out[0]).toMatchObject({
      kind: "step_text_diverges",
      index: 0,
      check: "Bake at 375F for 45 minutes.",
    });
  });

  it("safely clamps a hallucinated missing-step issue against an empty primary steps array", () => {
    // Backstop for the AUDIT_SYSTEM_PROMPT empty-steps guidance: even
    // if the auditor hallucinates a "missing" step against an
    // ingredient-only recipe (where primary.steps is correctly empty),
    // the translator must clamp insertPosition to 0 and produce a
    // sensible discrepancy that the review UI can handle. The real
    // defense is the prompt — this test just locks in that the
    // translator doesn't crash or emit a nonsensical index when the
    // prompt fails to suppress the hallucination.
    const primary = recipe({ steps: [] });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [],
      stepIssues: [
        stepIssue({
          primaryIndex: null,
          kind: "missing",
          insertPosition: 42, // Past the (empty) end.
          correctedText: "Hallucinated step the source doesn't have.",
          reason: "Auditor hallucinated this against ingredient-only source.",
        }),
      ],
    };
    const out = issuesToDiscrepancies(issues, primary);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "step_missing_from_original",
      suggestedIndex: 0, // Clamped to primary.steps.length (= 0).
    });
  });

  it("translates step missing into step_missing_from_original with clamped insert position", () => {
    const primary = recipe({ steps: [step("Mix.")] });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [],
      stepIssues: [
        stepIssue({
          primaryIndex: null,
          kind: "missing",
          insertPosition: 99, // Way out of bounds.
          correctedText: "Rest the dough overnight.",
          reason: "Source has an overnight rest step.",
        }),
      ],
    };
    const out = issuesToDiscrepancies(issues, primary);
    expect(out[0]).toMatchObject({
      kind: "step_missing_from_original",
      suggestedIndex: 1, // Clamped to primary.steps.length.
      check: "Rest the dough overnight.",
    });
  });

  it("translates step should_be_removed into step_only_in_original", () => {
    const primary = recipe({
      steps: [step("Mix."), step("Stir vigorously for an hour.")],
    });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [],
      stepIssues: [
        stepIssue({
          primaryIndex: 1,
          kind: "should_be_removed",
          reason: "Source doesn't say to stir for an hour.",
        }),
      ],
    };
    const out = issuesToDiscrepancies(issues, primary);
    expect(out[0]).toMatchObject({
      kind: "step_only_in_original",
      index: 1,
    });
  });

  it("drops text_wrong issues with no correctedText (not actionable)", () => {
    const primary = recipe({ steps: [step("Mix.")] });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [],
      stepIssues: [
        stepIssue({
          primaryIndex: 0,
          kind: "text_wrong",
          correctedText: null,
          reason: "looks wrong",
        }),
      ],
    };
    expect(issuesToDiscrepancies(issues, primary)).toEqual([]);
  });

  it("returns ingredient discrepancies before step discrepancies", () => {
    const primary = recipe({
      ingredients: [ing("salt", "1", "tbsp")],
      steps: [step("Bake.")],
    });
    const issues: ExtractionIssues = {
      looksCorrect: false,
      ingredientIssues: [
        ingIssue({
          primaryIndex: 0,
          kind: "wrong_unit",
          correctedUnit: "tsp",
          correctedQuantity: "1",
          reason: "tsp",
        }),
      ],
      stepIssues: [
        stepIssue({
          primaryIndex: 0,
          kind: "text_wrong",
          correctedText: "Bake at 350F.",
          reason: "Source includes temperature.",
        }),
      ],
    };
    const out = issuesToDiscrepancies(issues, primary);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("ingredient_mismatch");
    expect(out[1].kind).toBe("step_text_diverges");
  });
});
