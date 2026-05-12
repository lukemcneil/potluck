import type {
  ExtractedIngredient,
  ExtractedStep,
  ExtractedRecipe,
} from "@/lib/validators";
import type { Discrepancy } from "@/lib/ai/discrepancies";

/**
 * Per-row review metadata the form attaches to each ingredient and
 * step it renders. A row is "needs review" if at least one of these
 * fields is set; the form gates Save on every needs-review row being
 * resolved (either by the user picking an action or editing the row).
 *
 * `lowConfidence`: model self-flagged the row as low confidence.
 * `mismatch`: verification pass disagreed about quantity/unit; the
 *   strip offers a two-button chooser using both readings.
 * `onlyInOriginal`: primary saw it, verification didn't — the strip
 *   offers Keep / Remove.
 * `injected`: row was added by the verification pass (primary missed
 *   it). The strip offers Add (accept) / Skip (delete the row).
 *
 * Reasons are pre-formatted for display; we don't re-derive them in
 * the UI so the React layer stays presentational.
 */
export type IngredientFlag = {
  lowConfidence: boolean;
  mismatch: {
    fieldsDiffering: ("quantity" | "unit")[];
    check: { quantity: string | null; unit: string | null; name: string };
    reason: string;
  } | null;
  onlyInOriginal: { reason: string } | null;
  injected: { reason: string } | null;
};

export type StepFlag = {
  lowConfidence: boolean;
  textDiverges: { check: string; reason: string } | null;
  onlyInOriginal: { reason: string } | null;
  injected: { reason: string } | null;
};

/**
 * Form-shape ingredient + step (matches `recipeFormSchema` defaults).
 * Carries `position` so we can preserve order when inserting verifier
 * additions; `note` and `quantity`/`unit` may be null.
 */
export type ReviewIngredient = {
  position: number;
  quantity: string | null;
  unit: string | null;
  name: string;
  note: string | null;
};

export type ReviewStep = {
  position: number;
  body: string;
};

/**
 * What the form needs to render the review step. `ingredients` and
 * `steps` are the user-editable rows in display order (with verifier
 * additions inserted in place); `ingredientFlags` and `stepFlags` are
 * the per-row metadata at the matching index.
 */
export type ReviewPayload = {
  ingredients: ReviewIngredient[];
  ingredientFlags: IngredientFlag[];
  steps: ReviewStep[];
  stepFlags: StepFlag[];
};

const EMPTY_INGREDIENT_FLAG: IngredientFlag = {
  lowConfidence: false,
  mismatch: null,
  onlyInOriginal: null,
  injected: null,
};

const EMPTY_STEP_FLAG: StepFlag = {
  lowConfidence: false,
  textDiverges: null,
  onlyInOriginal: null,
  injected: null,
};

/**
 * Build the form's initial state from a primary extraction + the
 * deterministic discrepancy list. Pure function: deterministic output,
 * no I/O. Tested in `__tests__/review.test.ts`.
 *
 * Verifier-added ingredients/steps get spliced into the array at their
 * suggested index, with their flag carried alongside. Indices in the
 * `discrepancies` payload refer to the PRIMARY extraction's arrays;
 * we apply the splices last so the indices line up correctly.
 */
export function buildReviewPayload(
  recipe: ExtractedRecipe,
  discrepancies: Discrepancy[],
): ReviewPayload {
  const ingredientFlags: IngredientFlag[] = recipe.ingredients.map((ing) =>
    ing.confidence === "low"
      ? { ...EMPTY_INGREDIENT_FLAG, lowConfidence: true }
      : { ...EMPTY_INGREDIENT_FLAG },
  );
  const stepFlags: StepFlag[] = recipe.steps.map((s) =>
    s.confidence === "low"
      ? { ...EMPTY_STEP_FLAG, lowConfidence: true }
      : { ...EMPTY_STEP_FLAG },
  );

  // Apply mismatch + only-in-original flags onto the existing rows.
  for (const d of discrepancies) {
    if (d.kind === "ingredient_mismatch") {
      const flag = ingredientFlags[d.index];
      if (!flag) continue;
      flag.mismatch = {
        fieldsDiffering: d.fieldsDiffering.filter(
          (f): f is "quantity" | "unit" => f === "quantity" || f === "unit",
        ),
        check: {
          quantity: d.check.quantity,
          unit: d.check.unit,
          name: d.check.name,
        },
        reason: d.reason,
      };
    } else if (d.kind === "ingredient_only_in_original") {
      const flag = ingredientFlags[d.index];
      if (!flag) continue;
      flag.onlyInOriginal = { reason: d.reason };
    } else if (d.kind === "step_text_diverges") {
      const flag = stepFlags[d.index];
      if (!flag) continue;
      flag.textDiverges = { check: d.check, reason: d.reason };
    } else if (d.kind === "step_only_in_original") {
      const flag = stepFlags[d.index];
      if (!flag) continue;
      flag.onlyInOriginal = { reason: d.reason };
    }
  }

  // Splice in verifier-added rows (missing_from_original). Done in a
  // single pass after the in-place flag application so suggestedIndex
  // refers to positions in the primary array (which is what the
  // discrepancy aligner emits).
  const ingredients: ReviewIngredient[] = recipe.ingredients.map((ing, i) => ({
    position: i,
    quantity: ing.quantity ?? null,
    unit: ing.unit ?? null,
    name: ing.name,
    note: ing.note ?? null,
  }));
  const steps: ReviewStep[] = recipe.steps.map((s, i) => ({
    position: i,
    body: s.body,
  }));

  // Sort additions by suggestedIndex so the inserts compose. We
  // deliberately use a stable sort (Array.prototype.sort in modern V8
  // is stable) so the relative order of two additions at the same
  // suggested index matches the order the verifier returned them in.
  const ingredientAdditions = discrepancies
    .filter(
      (d): d is Extract<Discrepancy, { kind: "ingredient_missing_from_original" }> =>
        d.kind === "ingredient_missing_from_original",
    )
    .slice()
    .sort((a, b) => a.suggestedIndex - b.suggestedIndex);

  for (let n = 0; n < ingredientAdditions.length; n++) {
    const add = ingredientAdditions[n];
    // Each prior insert shifts subsequent positions by +1.
    const insertAt = Math.min(add.suggestedIndex + n, ingredients.length);
    ingredients.splice(insertAt, 0, {
      position: insertAt,
      quantity: add.check.quantity ?? null,
      unit: add.check.unit ?? null,
      name: add.check.name,
      note: add.check.note ?? null,
    });
    ingredientFlags.splice(insertAt, 0, {
      ...EMPTY_INGREDIENT_FLAG,
      injected: { reason: add.reason },
    });
  }

  const stepAdditions = discrepancies
    .filter(
      (d): d is Extract<Discrepancy, { kind: "step_missing_from_original" }> =>
        d.kind === "step_missing_from_original",
    )
    .slice()
    .sort((a, b) => a.suggestedIndex - b.suggestedIndex);

  for (let n = 0; n < stepAdditions.length; n++) {
    const add = stepAdditions[n];
    const insertAt = Math.min(add.suggestedIndex + n, steps.length);
    steps.splice(insertAt, 0, {
      position: insertAt,
      body: add.check,
    });
    stepFlags.splice(insertAt, 0, {
      ...EMPTY_STEP_FLAG,
      injected: { reason: add.reason },
    });
  }

  // Re-number positions after splices so downstream consumers can
  // trust them. (The form re-derives positions on submit, but keeping
  // them consistent here makes the data easier to inspect in tests.)
  ingredients.forEach((ing, i) => {
    ing.position = i;
  });
  steps.forEach((s, i) => {
    s.position = i;
  });

  return { ingredients, ingredientFlags, steps, stepFlags };
}

/** Convenience helpers used by the form to know whether a row needs
 * the user's attention and how to label the strip. */
export function ingredientNeedsReview(flag: IngredientFlag): boolean {
  return (
    flag.lowConfidence ||
    flag.mismatch != null ||
    flag.onlyInOriginal != null ||
    flag.injected != null
  );
}

export function stepNeedsReview(flag: StepFlag): boolean {
  return (
    flag.lowConfidence ||
    flag.textDiverges != null ||
    flag.onlyInOriginal != null ||
    flag.injected != null
  );
}

/** Used to seed unused fixtures in tests / dev tooling. */
export function ingredientAsExtracted(
  ing: ReviewIngredient,
): ExtractedIngredient {
  return {
    quantity: ing.quantity,
    unit: ing.unit,
    name: ing.name,
    note: ing.note,
    confidence: "high",
  };
}

export function stepAsExtracted(s: ReviewStep): ExtractedStep {
  return { body: s.body, confidence: "high" };
}
