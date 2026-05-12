import type {
  ExtractedRecipe,
  ExtractedIngredient,
  ExtractedStep,
} from "@/lib/validators";

/**
 * Typed list of ways the original extraction (`A`) disagrees with a
 * second pass (`B`) over the same source. The `index` fields refer
 * back into the original extraction's arrays so the review-step UI can
 * line warnings up against the rows the importer is editing.
 *
 * Naming convention: "original" = pass A (what's in the form), "check"
 * = pass B (the second AI pass we use as a sanity check). When both
 * passes have a value but they disagree we emit `*_mismatch`. When one
 * pass has something the other doesn't we emit `*_only_in_*`.
 */
export type IngredientField = "quantity" | "unit" | "name" | "note";

export type Discrepancy =
  | {
      kind: "ingredient_mismatch";
      /** Index into the original extraction's ingredient array. */
      index: number;
      fieldsDiffering: IngredientField[];
      original: NormalizedIngredient;
      check: NormalizedIngredient;
      reason: string;
    }
  | {
      kind: "ingredient_missing_from_original";
      /** Position the check pass would put it in (best-effort). */
      suggestedIndex: number;
      check: NormalizedIngredient;
      reason: string;
    }
  | {
      kind: "ingredient_only_in_original";
      index: number;
      original: NormalizedIngredient;
      reason: string;
    }
  | {
      kind: "step_text_diverges";
      index: number;
      original: string;
      check: string;
      reason: string;
    }
  | {
      kind: "step_missing_from_original";
      suggestedIndex: number;
      check: string;
      reason: string;
    }
  | {
      kind: "step_only_in_original";
      index: number;
      original: string;
      reason: string;
    };

export type NormalizedIngredient = Pick<
  ExtractedIngredient,
  "quantity" | "unit" | "name" | "note"
>;

/**
 * Drop everything except the four user-facing ingredient fields. We
 * deliberately don't carry `confidence` into the discrepancy payload
 * because confidence is a property of the extraction, not the
 * ingredient itself, and it'd be misleading to render the check pass's
 * confidence next to a value we're suggesting the user adopt.
 */
function trim(ing: ExtractedIngredient): NormalizedIngredient {
  return {
    quantity: ing.quantity ?? null,
    unit: ing.unit ?? null,
    name: ing.name,
    note: ing.note ?? null,
  };
}

/**
 * Normalize a name for matching: lowercase, strip punctuation, collapse
 * whitespace. We keep words intact (no stemming) — false negatives here
 * just mean the row gets flagged as missing/extra, which is safer than
 * silently merging two different ingredients because their stems
 * happened to coincide.
 */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same idea for quantities and units — used for equality checks only. */
function normalizeShort(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compare two extractions of the same source and emit a typed list of
 * discrepancies. Pure function: deterministic for fixed inputs, no I/O,
 * no LLM calls. The aligner is intentionally conservative — when in
 * doubt it flags a row rather than silently merging.
 */
export function diffExtractions(
  a: ExtractedRecipe,
  b: ExtractedRecipe,
): Discrepancy[] {
  const out: Discrepancy[] = [];
  out.push(...diffIngredients(a.ingredients, b.ingredients));
  out.push(...diffSteps(a.steps, b.steps));
  return out;
}

function diffIngredients(
  original: ExtractedIngredient[],
  check: ExtractedIngredient[],
): Discrepancy[] {
  const out: Discrepancy[] = [];
  // `usedCheck` tracks which check-pass indices we've already paired
  // with an original. Indexes never repeat so we can deduplicate
  // greedily; the alternative (Hungarian algorithm or similar) is way
  // overkill for typical recipe sizes (≤ ~25 ingredients).
  const usedCheck = new Set<number>();

  // Pass 1: exact normalized-name match. This pairs up the easy
  // overwhelming-majority of ingredients (model-A "salt" ↔ model-B
  // "salt") so we can focus the harder unmatched cases below.
  const matched = new Map<number, number>();
  for (let i = 0; i < original.length; i++) {
    const oNorm = normalizeName(original[i].name);
    if (!oNorm) continue;
    let foundJ = -1;
    for (let j = 0; j < check.length; j++) {
      if (usedCheck.has(j)) continue;
      if (normalizeName(check[j].name) === oNorm) {
        foundJ = j;
        break;
      }
    }
    if (foundJ !== -1) {
      matched.set(i, foundJ);
      usedCheck.add(foundJ);
    }
  }

  // Pass 2: for each pair, diff the four user-facing fields and emit
  // an `ingredient_mismatch` if anything differs. We compare normalized
  // text so "1 1/2" matches "1 1/2 " and "Tbsp" matches "tbsp".
  for (const [i, j] of matched.entries()) {
    const o = original[i];
    const c = check[j];
    const fields: IngredientField[] = [];
    if (normalizeShort(o.quantity) !== normalizeShort(c.quantity)) {
      fields.push("quantity");
    }
    if (normalizeShort(o.unit) !== normalizeShort(c.unit)) {
      fields.push("unit");
    }
    // We deliberately don't flag note differences — notes are free-form
    // and the two passes will rarely word them the same way, which
    // would bury the high-stakes quantity/unit warnings under noise.
    if (fields.length > 0) {
      out.push({
        kind: "ingredient_mismatch",
        index: i,
        fieldsDiffering: fields,
        original: trim(o),
        check: trim(c),
        reason: explainMismatch(c, fields),
      });
    }
  }

  // Pass 3: anything in `original` we didn't match goes out as
  // `ingredient_only_in_original`. The reviewer can keep or remove it.
  for (let i = 0; i < original.length; i++) {
    if (matched.has(i)) continue;
    out.push({
      kind: "ingredient_only_in_original",
      index: i,
      original: trim(original[i]),
      reason: "The verification pass didn't find this ingredient in the source.",
    });
  }

  // Pass 4: anything in `check` we didn't pair goes out as
  // `ingredient_missing_from_original`, with a suggested insertion
  // point near the check pass's own position so the row appears in a
  // sensible spot in the form.
  for (let j = 0; j < check.length; j++) {
    if (usedCheck.has(j)) continue;
    // Suggest inserting at the same relative position. We don't know
    // exactly where it should go, but appending at `j` (capped to the
    // current length) is usually close enough.
    const suggestedIndex = Math.min(j, original.length);
    out.push({
      kind: "ingredient_missing_from_original",
      suggestedIndex,
      check: trim(check[j]),
      reason: "The verification pass found this ingredient in the source but it isn't in the extracted recipe.",
    });
  }

  return out;
}

function explainMismatch(
  c: ExtractedIngredient,
  fields: IngredientField[],
): string {
  const formatted = formatIngredient(c);
  const fieldList = fields.join(" / ");
  return `Verification pass read this ingredient as \u201C${formatted}\u201D (${fieldList} differ).`;
}

function formatIngredient(ing: ExtractedIngredient): string {
  const parts = [ing.quantity, ing.unit, ing.name].filter(
    (p): p is string => !!p && p.trim() !== "",
  );
  return parts.join(" ").trim();
}

/**
 * Step alignment is positional: we compare original[i] vs check[i] and
 * flag divergence past a small Levenshtein-ratio threshold. Models
 * sometimes reword steps slightly (active voice, capitalization, "to"
 * vs "until"), so we tolerate cosmetic differences and only flag steps
 * that read as substantively different.
 *
 * Trailing-length differences become `step_only_in_original` /
 * `step_missing_from_original` so the reviewer can decide whether the
 * extra step is real or hallucinated.
 */
function diffSteps(
  original: ExtractedStep[],
  check: ExtractedStep[],
): Discrepancy[] {
  const out: Discrepancy[] = [];
  const common = Math.min(original.length, check.length);
  for (let i = 0; i < common; i++) {
    const o = original[i].body;
    const c = check[i].body;
    if (significantlyDifferent(o, c)) {
      out.push({
        kind: "step_text_diverges",
        index: i,
        original: o,
        check: c,
        reason: "Verification pass wrote this step differently — confirm the source matches one of them.",
      });
    }
  }
  for (let i = common; i < original.length; i++) {
    out.push({
      kind: "step_only_in_original",
      index: i,
      original: original[i].body,
      reason: "The verification pass didn't see this step in the source.",
    });
  }
  for (let j = common; j < check.length; j++) {
    out.push({
      kind: "step_missing_from_original",
      suggestedIndex: j,
      check: check[j].body,
      reason: "The verification pass found this step in the source but it isn't in the extracted recipe.",
    });
  }
  return out;
}

/**
 * Two step strings are "significantly different" if their normalized
 * Levenshtein ratio exceeds 0.30 (i.e. 30% of the longer string would
 * need to be edited to turn one into the other). Tuned so paraphrases
 * pass and a wholesale rewrite trips.
 */
function significantlyDifferent(a: string, b: string): boolean {
  const aN = normalizeName(a);
  const bN = normalizeName(b);
  if (aN === bN) return false;
  const longer = Math.max(aN.length, bN.length);
  if (longer === 0) return false;
  const dist = levenshtein(aN, bN);
  return dist / longer > 0.3;
}

/** Plain Levenshtein. Recipes max out at ~60 steps × ~150 chars, so
 * O(n*m) on a single pair is trivial. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}
