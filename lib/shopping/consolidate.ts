import { formatQuantity, parseQuantity } from "@/lib/cooking/scale";

/**
 * Shopping-list ingredient consolidation.
 *
 * Merge rule (deliberately conservative — see TODO.md / DEVELOPMENT.md):
 *
 *   Two items merge IFF
 *     trim(lower(name)) === trim(lower(other.name)) AND unit === other.unit
 *     (with both null counting as the same "no unit").
 *
 * No fuzzy name matching, no unit conversion. "all-purpose flour" and
 * "flour" stay separate; "1 tbsp" and "1 tsp" stay separate. The user
 * picked this so the list never silently combines distinct things.
 *
 * Quantities ARE summed when both sides parse cleanly via `parseQuantity`
 * — that handles `1 1/2`, `½`, `0.5`, `2-3` (we sum the midpoint of a
 * range). When either side is unparseable, we keep them as separate
 * rows so we never lose information. The original strings are
 * preserved verbatim in the merged display so "2½" stays "2½".
 */

export type IngredientInput = {
  name: string;
  quantity: string | null;
  unit: string | null;
  /** Provenance for "from Pad Thai" attribution on the list item. */
  sourceRecipeId: string | null;
};

export type ConsolidatedItem = {
  name: string;
  quantity: string | null;
  unit: string | null;
  sourceRecipeIds: string[];
};

export function consolidate(
  items: IngredientInput[],
): ConsolidatedItem[] {
  type Bucket = {
    displayName: string;
    unit: string | null;
    /** All raw quantity strings we tried to merge into this bucket. */
    quantities: Array<string | null>;
    /** Numeric subtotal across the parseable quantity strings. */
    parsedTotal: number;
    /** True iff every input quantity parsed; lets us decide whether
     *  to emit a clean numeric or fall back to "1, 2, see notes". */
    allParsed: boolean;
    sourceRecipeIds: Set<string>;
  };

  const buckets = new Map<string, Bucket>();
  // Preserve first-seen order so the output reads in a sensible
  // sequence rather than alphabetical chaos.
  const order: string[] = [];

  for (const it of items) {
    const cleanName = it.name.trim();
    if (!cleanName) continue;
    const key = `${cleanName.toLowerCase()}\x00${it.unit?.trim().toLowerCase() ?? ""}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        displayName: cleanName,
        unit: it.unit?.trim() || null,
        quantities: [],
        parsedTotal: 0,
        allParsed: true,
        sourceRecipeIds: new Set(),
      };
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.quantities.push(it.quantity?.trim() || null);
    if (it.sourceRecipeId) bucket.sourceRecipeIds.add(it.sourceRecipeId);

    if (it.quantity == null || !it.quantity.trim()) {
      // No quantity is "fine" — treat as "some" and don't break the
      // numeric tally if everything else parses.
      continue;
    }
    const parsed = parseQuantity(it.quantity);
    const n =
      parsed == null
        ? null
        : parsed.kind === "single"
          ? parsed.value
          : (parsed.low + parsed.high) / 2;
    if (n == null) {
      bucket.allParsed = false;
    } else {
      bucket.parsedTotal += n;
    }
  }

  return order.map((key) => {
    const b = buckets.get(key)!;
    const onlyOne = b.quantities.length === 1;
    let mergedQuantity: string | null = null;

    if (onlyOne) {
      mergedQuantity = b.quantities[0];
    } else if (b.allParsed && b.parsedTotal > 0) {
      mergedQuantity = formatQuantity(b.parsedTotal);
    } else {
      // Fall back to the verbatim strings joined with " + " — never
      // silently drop a quantity even if the math couldn't combine it.
      const present = b.quantities.filter((q): q is string => !!q);
      mergedQuantity = present.length > 0 ? present.join(" + ") : null;
    }

    return {
      name: b.displayName,
      quantity: mergedQuantity,
      unit: b.unit,
      sourceRecipeIds: Array.from(b.sourceRecipeIds),
    };
  });
}

// (formatQuantity is now centralized in lib/cooking/scale.ts — same
// Unicode-glyph output, same eighth-snapping math. Imported above.)
