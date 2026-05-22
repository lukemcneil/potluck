import type {
  ExtractedRecipe,
  ExtractedIngredient,
  ExtractedStep,
  ExtractionIssues,
  IngredientIssue,
  StepIssue,
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
 * Normalize for source-text substring matching. Lowercases, swaps
 * Unicode fraction glyphs to their ASCII forms (so "½ teaspoon" in the
 * source matches an auditor quoting "1/2 teaspoon", and vice versa),
 * strips most punctuation EXCEPT `/` (we need it for fractions), and
 * collapses whitespace.
 *
 * Used by the source-grounding filter in `issuesToDiscrepancies` —
 * gentler than `normalizeName` (which strips `/` and would mangle
 * fractions) and stricter than `normalizeShort` (no fraction handling).
 */
export function normalizeForSourceSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/½/g, "1/2")
    .replace(/¼/g, "1/4")
    .replace(/¾/g, "3/4")
    .replace(/⅓/g, "1/3")
    .replace(/⅔/g, "2/3")
    .replace(/⅛/g, "1/8")
    .replace(/⅜/g, "3/8")
    .replace(/⅝/g, "5/8")
    .replace(/⅞/g, "7/8")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9/.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Bidirectional substring check on normalized phrases. Returns true
 * when `claim` ⊂ `actual` OR `actual` ⊂ `claim` — the auditor might
 * quote a partial value (just the quantity) or a paraphrase that
 * extends what the primary said. Either direction is evidence the
 * auditor was reading the same row.
 *
 * Lenient by design: empty inputs return true (we can't disprove the
 * match, so we keep the issue).
 */
function loosePhraseMatch(claim: string, actual: string): boolean {
  const c = normalizeName(claim);
  const a = normalizeName(actual);
  if (!c || !a) return true;
  return c.includes(a) || a.includes(c);
}

/**
 * Render an ingredient as "qty unit name" for primary-reading matches.
 * Mirrors `formatIngredient` but lives here so the filter doesn't have
 * to reach into the legacy diff pipeline's helpers.
 */
function formatIngredientForMatch(ing: NormalizedIngredient): string {
  return [ing.quantity, ing.unit, ing.name]
    .filter((p): p is string => !!p && p.trim() !== "")
    .join(" ");
}

/**
 * Pick a substantive contiguous phrase (the first `minWords` words of
 * 2+ characters each) from a normalized step / corrected-text claim.
 * Used by the source-grounding filter to check that step-text issues
 * actually quote the source. Returns "" when the input is shorter than
 * the threshold — caller treats "" as "skip the check" (lenient).
 */
function significantPhrase(text: string, minWords: number): string {
  const words = normalizeName(text)
    .split(" ")
    .filter((w) => w.length >= 2);
  if (words.length < minWords) return "";
  return words.slice(0, minWords).join(" ");
}

/**
 * Filter A + Filter B for ingredient issues. Returns false to silently
 * drop the issue before translation. The two filter classes:
 *
 *   A. Primary-side grounding: when the auditor references an existing
 *      row (kind ≠ "missing") and supplies a `primaryReading`, that
 *      reading must loosely substring-match the primary row. Catches
 *      "auditor lied about what primary said" — the most common
 *      lite-class verifier failure mode.
 *
 *   B. Source-side grounding: when the auditor proposes a correction
 *      (`correctedQuantity` / `correctedUnit` / `correctedName`), the
 *      claim must appear in the source content. Catches "auditor
 *      invented a source value." Skipped when `sourceText` is empty
 *      (image-only extractions, where the source isn't a substring
 *      corpus we can search).
 *
 *   A2. "Missing" issues whose proposed ingredient already exists in
 *      the primary — the auditor invented a missing thing that's
 *      already there. Dropped.
 *
 * Lenient defaults: when a field is null/empty, or the claim is too
 * short to safely match, or there's nothing to compare against, the
 * issue is KEPT. We're trying to filter audit hallucinations without
 * suppressing real catches.
 */
function shouldEmitIngredientIssue(
  issue: IngredientIssue,
  primary: ExtractedRecipe,
  sourceText: string,
): boolean {
  if (issue.kind === "missing") {
    // Filter A2: corrected name exactly matches an existing primary
    // ingredient — the auditor invented a "missing" that's already
    // there. We use normalized EQUALITY here rather than substring
    // because substring is too aggressive ("salt" ⊂ "sea salt for
    // finishing" — but those are genuinely different ingredients and
    // dropping the issue would suppress a real catch). The redundant
    // strip the user sees when the audit suggests a name variant of
    // an existing ingredient is a much lower cost than losing a real
    // missing-ingredient flag.
    if (issue.correctedName) {
      const nameNorm = normalizeName(issue.correctedName);
      if (nameNorm) {
        const alreadyThere = primary.ingredients.some(
          (ing) => normalizeName(ing.name) === nameNorm,
        );
        if (alreadyThere) return false;
      }
    }

    // Filter B: corrected name appears in source. Skip when source is
    // empty (image inputs) or the name is too short to safely match
    // (e.g. "egg" — would always trivially match).
    if (sourceText && issue.correctedName) {
      const claim = normalizeForSourceSearch(issue.correctedName);
      const src = normalizeForSourceSearch(sourceText);
      if (claim.length >= 3 && !src.includes(claim)) return false;
    }

    return true;
  }

  // Existing-row issues (wrong_*, should_be_removed):

  // Filter A — primaryReading vs actual primary row.
  if (issue.primaryIndex != null && issue.primaryReading) {
    const idx = issue.primaryIndex;
    if (idx >= 0 && idx < primary.ingredients.length) {
      const actual = formatIngredientForMatch(primary.ingredients[idx]);
      if (!loosePhraseMatch(issue.primaryReading, actual)) return false;
    }
  }

  // Filter B for wrong_quantity / wrong_unit: the combined "qty unit"
  // claim must appear verbatim in source. Skipped for wrong_name (too
  // prone to paraphrase, "scallions" vs "green onions") and for
  // should_be_removed (no source claim to verify).
  if (
    (issue.kind === "wrong_quantity" || issue.kind === "wrong_unit") &&
    sourceText
  ) {
    const qty = (issue.correctedQuantity ?? "").trim();
    const unit = (issue.correctedUnit ?? "").trim();
    const combined = `${qty} ${unit}`.trim();
    if (combined.length >= 2) {
      const claim = normalizeForSourceSearch(combined);
      const src = normalizeForSourceSearch(sourceText);
      if (claim && !src.includes(claim)) return false;
    }
  }

  return true;
}

/**
 * Filter counterpart for step issues. Same A / A2 / B framework as
 * `shouldEmitIngredientIssue` above; see that docstring for the design
 * rationale.
 *
 * Step-side grounding is phrase-based rather than full-substring:
 * recipe steps are long enough that a single contiguous N-word phrase
 * (N=5 here) appearing in both the corrected text and the source is
 * strong evidence the auditor was reading the source. We don't require
 * the entire corrected step to appear verbatim — minor rewording is
 * legitimate and dropping those would suppress real catches.
 */
function shouldEmitStepIssue(
  issue: StepIssue,
  primary: ExtractedRecipe,
  sourceText: string,
): boolean {
  if (issue.kind === "missing") {
    // Filter A2: the supposedly-missing step is already in primary.
    if (issue.correctedText) {
      const phrase = significantPhrase(issue.correctedText, 5);
      if (phrase) {
        const alreadyThere = primary.steps.some((s) =>
          normalizeName(s.body).includes(phrase),
        );
        if (alreadyThere) return false;
      }
    }

    // Filter B: corrected text shares a 5+ word phrase with source.
    if (sourceText && issue.correctedText) {
      const phrase = significantPhrase(issue.correctedText, 5);
      if (phrase && !normalizeName(sourceText).includes(phrase)) return false;
    }

    return true;
  }

  // Filter A — primaryReading vs actual step body.
  if (issue.primaryIndex != null && issue.primaryReading) {
    const idx = issue.primaryIndex;
    if (idx >= 0 && idx < primary.steps.length) {
      if (!loosePhraseMatch(issue.primaryReading, primary.steps[idx].body)) {
        return false;
      }
    }
  }

  // Filter B for text_wrong: corrected text shares a 5+ word phrase
  // with source. Skipped for should_be_removed (no source claim).
  if (issue.kind === "text_wrong" && sourceText && issue.correctedText) {
    const phrase = significantPhrase(issue.correctedText, 5);
    if (phrase && !normalizeName(sourceText).includes(phrase)) return false;
  }

  return true;
}

/**
 * Translate the sequential verifier's `ExtractionIssues` into the
 * existing `Discrepancy[]` shape that the review UI already speaks.
 *
 * The verifier (in the sequential design) has already seen the
 * primary's recipe + the source content and emitted typed issues:
 *   - wrong_*           → ingredient_mismatch with the corrected check side
 *   - should_be_removed → ingredient_only_in_original
 *   - missing           → ingredient_missing_from_original
 * Same mapping for steps. We do light defensive validation
 * (out-of-bounds indexes get dropped) so a confused verifier can't
 * crash the importer.
 *
 * Audit-hallucination filtering: BEFORE translation each issue is run
 * through Filter A (primary-side: did the auditor mis-quote the
 * primary?) and Filter B (source-side: does the auditor's correction
 * actually appear in the source?). See `shouldEmitIngredientIssue` /
 * `shouldEmitStepIssue` for the full rules; both filters bias toward
 * KEEPING issues when uncertain. Filters that drop are logged via
 * `console.log` so we can tune them.
 *
 * `sourceText` is the flattened text of the source the auditor saw —
 * the URL's HTML/JSON-LD blob or the user's pasted text. Pass "" (or
 * omit it) for image-only extractions; Filter B becomes a no-op in
 * that case and only primary-side checks run.
 *
 * Pure function — no I/O, no LLM. The verifier's `reason` strings are
 * surfaced verbatim in the review strips so the model's natural-
 * language explanation reaches the user.
 */
export function issuesToDiscrepancies(
  issues: ExtractionIssues,
  primary: ExtractedRecipe,
  sourceText: string = "",
): Discrepancy[] {
  const out: Discrepancy[] = [];
  let droppedIngredients = 0;
  let droppedSteps = 0;

  for (const issue of issues.ingredientIssues) {
    if (!shouldEmitIngredientIssue(issue, primary, sourceText)) {
      droppedIngredients++;
      continue;
    }
    const d = ingredientIssueToDiscrepancy(issue, primary);
    if (d) out.push(d);
  }
  for (const issue of issues.stepIssues) {
    if (!shouldEmitStepIssue(issue, primary, sourceText)) {
      droppedSteps++;
      continue;
    }
    const d = stepIssueToDiscrepancy(issue, primary);
    if (d) out.push(d);
  }

  if (droppedIngredients > 0 || droppedSteps > 0) {
    console.log(
      `[ai.audit.filter] dropped ungrounded issues: ingredients=${droppedIngredients} steps=${droppedSteps} (kept ${out.length})`,
    );
  }

  return out;
}

function ingredientIssueToDiscrepancy(
  issue: IngredientIssue,
  primary: ExtractedRecipe,
): Discrepancy | null {
  if (issue.kind === "missing") {
    // Verifier says this ingredient is in the source but the primary
    // missed it. Needs a full corrected name to be actionable.
    const name = issue.correctedName?.trim();
    if (!name) return null;
    return {
      kind: "ingredient_missing_from_original",
      // We don't know where it should go in the original list; the
      // splicer in `buildReviewPayload` will insert it. Appending at
      // the end is the safe default — the user can drag it.
      suggestedIndex: primary.ingredients.length,
      check: {
        quantity: issue.correctedQuantity ?? null,
        unit: issue.correctedUnit ?? null,
        name,
        note: issue.correctedNote ?? null,
      },
      reason: issue.reason,
    };
  }

  // Everything else needs a primaryIndex that lands inside the array.
  const idx = issue.primaryIndex;
  if (idx == null || idx < 0 || idx >= primary.ingredients.length) return null;
  const original = primary.ingredients[idx];

  if (issue.kind === "should_be_removed") {
    return {
      kind: "ingredient_only_in_original",
      index: idx,
      original: trim(original),
      reason: issue.reason,
    };
  }

  // wrong_quantity / wrong_unit / wrong_name. Translate to a mismatch
  // with `fieldsDiffering` set to which slice the verifier flagged.
  const field: IngredientField =
    issue.kind === "wrong_quantity"
      ? "quantity"
      : issue.kind === "wrong_unit"
        ? "unit"
        : "name";

  return {
    kind: "ingredient_mismatch",
    index: idx,
    fieldsDiffering: [field],
    original: trim(original),
    check: {
      quantity: issue.correctedQuantity ?? original.quantity ?? null,
      unit: issue.correctedUnit ?? original.unit ?? null,
      // For wrong_name we use the corrected name; for wrong_quantity
      // / wrong_unit we keep the primary's name so the chooser strip
      // doesn't spuriously offer a name swap.
      name:
        issue.kind === "wrong_name"
          ? (issue.correctedName?.trim() ?? original.name)
          : original.name,
      note: issue.correctedNote ?? original.note ?? null,
    },
    reason: issue.reason,
  };
}

function stepIssueToDiscrepancy(
  issue: StepIssue,
  primary: ExtractedRecipe,
): Discrepancy | null {
  if (issue.kind === "missing") {
    const body = issue.correctedText?.trim();
    if (!body) return null;
    const pos =
      issue.insertPosition != null
        ? Math.max(0, Math.min(issue.insertPosition, primary.steps.length))
        : primary.steps.length;
    return {
      kind: "step_missing_from_original",
      suggestedIndex: pos,
      check: body,
      reason: issue.reason,
    };
  }

  const idx = issue.primaryIndex;
  if (idx == null || idx < 0 || idx >= primary.steps.length) return null;
  const original = primary.steps[idx];

  if (issue.kind === "should_be_removed") {
    return {
      kind: "step_only_in_original",
      index: idx,
      original: original.body,
      reason: issue.reason,
    };
  }

  // text_wrong. Need the corrected text to be useful — without it the
  // review strip would just say "this is wrong but here's nothing to
  // compare to", which isn't actionable. Drop those silently.
  const correctedText = issue.correctedText?.trim();
  if (!correctedText) return null;

  return {
    kind: "step_text_diverges",
    index: idx,
    original: original.body,
    check: correctedText,
    reason: issue.reason,
  };
}

/**
 * Compare two extractions of the same source and emit a typed list of
 * discrepancies. Pure function: deterministic for fixed inputs, no I/O,
 * no LLM calls. The aligner is intentionally conservative — when in
 * doubt it flags a row rather than silently merging.
 *
 * NOTE: This is no longer wired into the live extraction pipeline
 * (`extractAndVerifyRecipe` now uses the sequential audit pass via
 * `issuesToDiscrepancies`). It's kept exported because it's a useful
 * pure-code utility with deep test coverage, and a future "compare
 * two independent extractions" workflow could reuse it as-is.
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
