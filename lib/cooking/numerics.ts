import { parseQuantity } from "@/lib/cooking/scale";

/**
 * Derive the storage-shape "numeric" companion for a free-text
 * quantity / servings string. Used at write time (server actions,
 * AI extraction, shopping consolidation) so the DB carries both the
 * author's preferred wording AND a math-friendly number whenever one
 * is recoverable.
 *
 * Returns:
 *   - The single numeric value when the input parses as a number.
 *   - The midpoint when the input parses as a range ("4-6 servings"
 *     → 5). Midpoint is the only sane single-value choice; the cook
 *     still sees "4–6 servings" in the UI and scales relative to it.
 *   - `null` when the input is empty, null, or non-numeric (e.g.
 *     "a pinch", "to taste", "1 loaf", "a dozen").
 *
 * Never throws.
 */
export function deriveNumeric(input: string | null | undefined): number | null {
  if (input == null) return null;
  const parsed = parseQuantity(input);
  if (!parsed) return null;
  if (parsed.kind === "single") {
    return Number.isFinite(parsed.value) ? parsed.value : null;
  }
  // Range: store the midpoint. Math at scale time multiplies the
  // midpoint and re-renders the result on each side of an en-dash,
  // so this is the natural anchor.
  if (Number.isFinite(parsed.low) && Number.isFinite(parsed.high)) {
    return (parsed.low + parsed.high) / 2;
  }
  return null;
}
