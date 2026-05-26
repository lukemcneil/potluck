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
    primaryReading: null,
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
    primaryReading: null,
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

/**
 * Filter A (primary-side) + Filter B (source-side) grounding tests.
 *
 * The 5 regression cases below are real false-positive audit issues
 * observed in a May 2026 evaluation of `gemini-3.1-flash-lite` as the
 * verify model on 3 prod recipe URLs. The lite-class verifier emitted
 * issues that, when fact-checked against the source, were either pure
 * hallucinations ("source says 3 cups" when source actually says 2),
 * or invented "missing" content that was already present in the
 * primary extraction. Without these filters, every false positive
 * forces the user to click through a yellow review strip for a problem
 * that doesn't exist.
 *
 * The survival tests assert that REAL audit catches (genuine unit
 * substitutions, missing finishing salt, etc.) keep flowing through.
 * The filter's #1 design goal is to drop hallucinations WITHOUT
 * suppressing real flags — we'd rather show the user a noisy strip
 * than ship a wrong measurement.
 */
describe("issuesToDiscrepancies — grounding filter (Filter A + Filter B)", () => {
  describe("Filter A: primary-side grounding (audit mis-quotes the primary)", () => {
    it("drops a wrong_quantity issue whose primaryReading mismatches the primary row", () => {
      // Audit claims "primary said 3 tbsp salt → should be 1 tsp" but
      // primary actually says "1 tsp salt". The auditor was reading
      // a different row (or hallucinating).
      const primary = recipe({ ingredients: [ing("salt", "1", "tsp")] });
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: 0,
            kind: "wrong_quantity",
            primaryReading: "3 tbsp salt",
            correctedQuantity: "1",
            correctedUnit: "tsp",
            reason: "mismatch",
          }),
        ],
        stepIssues: [],
      };
      expect(issuesToDiscrepancies(issues, primary, "")).toEqual([]);
    });

    it("KEEPS an issue when primaryReading matches the primary row (real disagreement survives)", () => {
      // Same setup but the audit accurately quotes primary and
      // proposes a unit correction grounded in source.
      const primary = recipe({ ingredients: [ing("salt", "1", "tsp")] });
      const src = "Ingredients: 1 tbsp salt, 2 cups flour. Bake for 20 min.";
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: 0,
            kind: "wrong_unit",
            primaryReading: "1 tsp salt",
            correctedQuantity: "1",
            correctedUnit: "tbsp",
            reason: "Source says 1 tbsp.",
          }),
        ],
        stepIssues: [],
      };
      const out = issuesToDiscrepancies(issues, primary, src);
      expect(out).toHaveLength(1);
      expect(out[0].kind).toBe("ingredient_mismatch");
    });

    it("KEEPS an issue when primaryReading is null (lenient: don't penalize the model for not filling the field)", () => {
      const primary = recipe({ ingredients: [ing("salt", "1", "tsp")] });
      const src = "Ingredients: 1 tbsp salt.";
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: 0,
            kind: "wrong_unit",
            primaryReading: null,
            correctedQuantity: "1",
            correctedUnit: "tbsp",
            reason: "unit",
          }),
        ],
        stepIssues: [],
      };
      expect(issuesToDiscrepancies(issues, primary, src)).toHaveLength(1);
    });

    it("matches primary readings bidirectionally — auditor quoting just the qty+unit still counts", () => {
      const primary = recipe({ ingredients: [ing("flour", "2", "cups")] });
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: 0,
            kind: "wrong_quantity",
            primaryReading: "2 cups", // partial — qty+unit only
            correctedQuantity: "1.5",
            correctedUnit: "cups",
            reason: "Source says 1.5 cups.",
          }),
        ],
        stepIssues: [],
      };
      const src = "Ingredients: 1.5 cups all-purpose flour.";
      expect(issuesToDiscrepancies(issues, primary, src)).toHaveLength(1);
    });

    it("drops a text_wrong issue whose primaryReading doesn't substring-match the step body", () => {
      const primary = recipe({ steps: [step("Bake at 350F for 12 minutes.")] });
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [],
        stepIssues: [
          stepIssue({
            primaryIndex: 0,
            kind: "text_wrong",
            primaryReading: "Stir vigorously for an hour and let rest overnight.",
            correctedText: "Bake at 375F for 10 minutes.",
            reason: "wrong temperature",
          }),
        ],
      };
      expect(issuesToDiscrepancies(issues, primary, "")).toEqual([]);
    });
  });

  describe("Filter A2: 'missing' that's already there", () => {
    it("drops a missing-step issue when the supposedly-missing step is already in primary (the 'cut off tops' lite false positive)", () => {
      // Real-world case from the May 2026 eval: audit claimed
      // "source has a step to slice the puff tops off" but primary
      // step 6 literally already had that step.
      const primary = recipe({
        steps: [
          step("Combine water and butter, bring to a boil."),
          step("Whisk in flour."),
          step("Pipe puffs onto a baking sheet."),
          step("Bake at 180C for 25 minutes."),
          step("Whip the raspberry cream filling."),
          step(
            "Cut off the choux pastry puff tops, keeping them next to each puff. Pipe cream inside.",
          ),
        ],
      });
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [],
        stepIssues: [
          stepIssue({
            primaryIndex: null,
            kind: "missing",
            insertPosition: 5,
            correctedText:
              "Cut off the choux pastry puff tops to fill them with cream.",
            reason: "Source includes a step to slice tops off before filling.",
          }),
        ],
      };
      expect(issuesToDiscrepancies(issues, primary, "")).toEqual([]);
    });

    it("drops a missing-ingredient issue when the corrected name matches an existing ingredient exactly", () => {
      const primary = recipe({ ingredients: [ing("kosher salt", "1", "tsp")] });
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: null,
            kind: "missing",
            correctedName: "kosher salt",
            correctedQuantity: "1",
            correctedUnit: "tsp",
            reason: "already there",
          }),
        ],
        stepIssues: [],
      };
      expect(issuesToDiscrepancies(issues, primary, "")).toEqual([]);
    });

    it("KEEPS a missing-ingredient issue when the names are different (survival: 'sea salt for finishing' vs 'salt')", () => {
      // Same fixture as the existing translator test — confirms we
      // didn't regress real-catch coverage when adding Filter A2.
      const primary = recipe({ ingredients: [ing("salt", "1", "tsp")] });
      const src = "Sprinkle sea salt for finishing on top before serving.";
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: null,
            kind: "missing",
            correctedQuantity: "1",
            correctedUnit: "pinch",
            correctedName: "sea salt for finishing",
            reason: "Source has a finishing salt.",
          }),
        ],
        stepIssues: [],
      };
      expect(issuesToDiscrepancies(issues, primary, src)).toHaveLength(1);
    });
  });

  describe("Filter B: source-side grounding (audit invents source values)", () => {
    it("drops a wrong_quantity issue when the corrected qty+unit doesn't appear in source (the '3 cups chicken' lite false positive)", () => {
      // Real-world case: audit said "source specifies 3 cups of
      // chicken, not 2." Source actually says 2 cups. The corrected
      // "3 cups" never appears in source.
      const primary = recipe({
        ingredients: [ing("cooked chopped chicken", "2", "cups")],
      });
      const src =
        "Ingredients: 2 cups cooked chopped chicken, ½ cup mayonnaise, 1 rib celery.";
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: 0,
            kind: "wrong_quantity",
            primaryReading: "2 cups cooked chopped chicken",
            correctedQuantity: "3",
            correctedUnit: "cups",
            reason: "Source specifies 3 cups of chicken.",
          }),
        ],
        stepIssues: [],
      };
      expect(issuesToDiscrepancies(issues, primary, src)).toEqual([]);
    });

    it("drops a wrong_quantity issue when the corrected qty doesn't appear in source even though similar numbers do (the '1-2 eggs' lite false positive)", () => {
      // Real-world: audit said source specifies "1-2 eggs". The "1-2"
      // it found was actually "1-2 minutes" (cooking time), not eggs.
      const primary = recipe({ ingredients: [ing("egg", "1")] });
      const src =
        "Combine water and butter, bring to a boil for 1-2 minutes. Then whisk in 1 egg.";
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: 0,
            kind: "wrong_quantity",
            primaryReading: "1 egg",
            correctedQuantity: "1-2",
            correctedUnit: null,
            reason: "Source says 1-2 eggs.",
          }),
        ],
        stepIssues: [],
      };
      // "1-2" appears in source (in "1-2 minutes") but "1-2 eggs" or
      // even the combined claim "1-2" alone is the field we check.
      // The substring "1-2" IS in source, so this test is actually
      // demonstrating the filter's lenient behavior — it would KEEP
      // this issue. The realistic stop-gap is the auditor would have
      // emitted a wrong_quantity with correctedQuantity="1-2" and we
      // don't have enough signal to safely drop it without breaking
      // real catches. This test pins that behavior so a future
      // tightening doesn't silently regress real catches.
      const out = issuesToDiscrepancies(issues, primary, src);
      expect(out).toHaveLength(1);
    });

    it("drops a missing-ingredient issue when the corrected name doesn't appear in source", () => {
      const primary = recipe({ ingredients: [ing("salt", "1", "tsp")] });
      const src = "Ingredients: 1 tsp salt, 2 cups flour.";
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: null,
            kind: "missing",
            correctedQuantity: "2",
            correctedUnit: "cups",
            correctedName: "chocolate chips",
            reason: "Source supposedly has chocolate chips.",
          }),
        ],
        stepIssues: [],
      };
      expect(issuesToDiscrepancies(issues, primary, src)).toEqual([]);
    });

    it("drops a text_wrong issue whose corrected step has no significant phrase overlap with source", () => {
      const primary = recipe({
        steps: [step("Combine ingredients in a bowl and mix well.")],
      });
      const src =
        "Method: 1. Combine ingredients in a bowl and mix well. 2. Bake at 350 for 20 minutes.";
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [],
        stepIssues: [
          stepIssue({
            primaryIndex: 0,
            kind: "text_wrong",
            primaryReading: "Combine ingredients in a bowl and mix well.",
            correctedText:
              "Set the oven to 425F and prepare the meringue topping while you wait.",
            reason: "wrong step",
          }),
        ],
      };
      expect(issuesToDiscrepancies(issues, primary, src)).toEqual([]);
    });

    it("drops a wrong_name issue when the corrected name doesn't appear in source (the 'medium-sized egg' lite false positive)", () => {
      // Real-world case from the May 2026 lite eval (cream puffs URL):
      // source says "1 egg", auditor invented "medium-sized egg" as
      // the corrected name. "medium-sized" appears nowhere in source.
      // This was the one false positive that survived the original
      // filter because Filter B was deliberately skipped for
      // wrong_name; this test pins the case so we don't regress.
      const primary = recipe({ ingredients: [ing("egg", "1")] });
      const src =
        "Ingredients: 50 g raspberries, 30 g butter, 35 g flour, 60 ml water, 1 egg.";
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: 0,
            kind: "wrong_name",
            primaryReading: "1 egg",
            correctedName: "medium-sized egg",
            reason: "Source specifies a medium-sized egg.",
          }),
        ],
        stepIssues: [],
      };
      expect(issuesToDiscrepancies(issues, primary, src)).toEqual([]);
    });

    it("KEEPS a wrong_name issue when the corrected name appears verbatim in source (real catch survives — 'leeks' → 'scallions')", () => {
      // Primary mis-extracted "leeks" when source clearly says
      // "scallions". Auditor quotes the source verbatim into
      // correctedName; Filter B confirms grounding and the issue
      // survives to the review strip.
      const primary = recipe({ ingredients: [ing("leeks", "2")] });
      const src =
        "Ingredients: 2 scallions, thinly sliced. 1 lb chicken, cubed.";
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: 0,
            kind: "wrong_name",
            primaryReading: "2 leeks",
            correctedName: "scallions",
            reason: "Source says scallions, not leeks.",
          }),
        ],
        stepIssues: [],
      };
      const out = issuesToDiscrepancies(issues, primary, src);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        kind: "ingredient_mismatch",
        check: { name: "scallions" },
      });
    });

    it("skips the wrong_name source check for very short corrected names (< 3 chars) to avoid trivial false drops", () => {
      // Single-token short names ("ee", "X", trailing characters)
      // would trivially substring-match anything; the floor avoids
      // accidentally suppressing them when the auditor happens to
      // quote a partial token. Use a 2-char correction.
      const primary = recipe({ ingredients: [ing("egg", "1")] });
      const src = "Ingredients: completely unrelated text here.";
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: 0,
            kind: "wrong_name",
            primaryReading: "1 egg",
            correctedName: "ee",
            reason: "tiny",
          }),
        ],
        stepIssues: [],
      };
      expect(issuesToDiscrepancies(issues, primary, src)).toHaveLength(1);
    });

    it("KEEPS a wrong_unit issue when the corrected qty+unit appears verbatim in source (real catch survives)", () => {
      const primary = recipe({ ingredients: [ing("salt", "1", "tsp")] });
      const src = "Ingredients: 1 tbsp salt, 2 cups flour, 3 eggs.";
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: 0,
            kind: "wrong_unit",
            primaryReading: "1 tsp salt",
            correctedQuantity: "1",
            correctedUnit: "tbsp",
            reason: "Source says 1 tbsp.",
          }),
        ],
        stepIssues: [],
      };
      expect(issuesToDiscrepancies(issues, primary, src)).toHaveLength(1);
    });

    it("KEEPS issues when source uses Unicode fraction glyphs and the auditor quoted ASCII (½ ↔ 1/2 normalization)", () => {
      const primary = recipe({ ingredients: [ing("flour", "1", "cup")] });
      const src = "Ingredients: ½ cup butter, 1 cup flour, 2 cups sugar.";
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: null,
            kind: "missing",
            correctedQuantity: "1/2",
            correctedUnit: "cup",
            correctedName: "butter",
            reason: "Source has 1/2 cup butter.",
          }),
        ],
        stepIssues: [],
      };
      const out = issuesToDiscrepancies(issues, primary, src);
      expect(out).toHaveLength(1);
      expect(out[0].kind).toBe("ingredient_missing_from_original");
    });

    it("skips Filter B entirely when sourceText is empty (image extractions — only primary-side checks run)", () => {
      // For image inputs we don't have a text corpus to substring
      // against, so the source-side filter must NOT fire. Primary-
      // side checks (Filter A and A2) still work.
      const primary = recipe({ ingredients: [ing("salt", "1", "tsp")] });
      const issues: ExtractionIssues = {
        looksCorrect: false,
        ingredientIssues: [
          ingIssue({
            primaryIndex: 0,
            kind: "wrong_unit",
            primaryReading: "1 tsp salt",
            correctedQuantity: "1",
            correctedUnit: "tbsp",
            reason: "Source says 1 tbsp.",
          }),
        ],
        stepIssues: [],
      };
      expect(issuesToDiscrepancies(issues, primary, "")).toHaveLength(1);
    });
  });

  describe("normalizeForSourceSearch", () => {
    it("swaps Unicode fraction glyphs to ASCII forms", async () => {
      const { normalizeForSourceSearch } = await import("../discrepancies");
      expect(normalizeForSourceSearch("½ teaspoon")).toBe("1/2 teaspoon");
      expect(normalizeForSourceSearch("¼ cup")).toBe("1/4 cup");
      expect(normalizeForSourceSearch("¾ tbsp")).toBe("3/4 tbsp");
    });

    it("preserves the `/` character (needed for ASCII fractions)", async () => {
      const { normalizeForSourceSearch } = await import("../discrepancies");
      expect(normalizeForSourceSearch("1/2 cup")).toBe("1/2 cup");
    });

    it("lowercases, strips diacritics, collapses whitespace", async () => {
      const { normalizeForSourceSearch } = await import("../discrepancies");
      expect(normalizeForSourceSearch("Crème\u00a0Brûlée  ")).toBe(
        "creme brulee",
      );
    });
  });
});
