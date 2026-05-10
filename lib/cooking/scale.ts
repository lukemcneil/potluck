/**
 * Recipe quantity parsing & scaling.
 *
 * Handles the messy reality of how cooks write quantities:
 *   - integers:        "2"
 *   - decimals:        "0.5", "1.5"
 *   - simple fractions: "3/4", "1/2"
 *   - mixed numbers:    "1 1/2", "2 3/4"
 *   - unicode glyphs:   "½", "1½", "¼", "⅓", "⅔", "⅛", "⅜", "⅝", "⅞"
 *   - ranges:          "1-2", "1 to 2"  (treated as the lower bound for parsing,
 *                                         re-emitted as a range when scaling)
 *
 * The output rounds to "kitchen-friendly" fractions (eighths) when the
 * scaled value is non-trivial, so `1 1/2 cups * 2/3 = 1 cup`, not
 * `0.99999... cups`.
 */

export type ParsedQuantity =
  | { kind: "single"; value: number; raw: string }
  | { kind: "range"; low: number; high: number; raw: string };

const VULGAR_FRACTIONS: Record<string, number> = {
  "\u00BD": 1 / 2, // ½
  "\u2153": 1 / 3, // ⅓
  "\u2154": 2 / 3, // ⅔
  "\u00BC": 1 / 4, // ¼
  "\u00BE": 3 / 4, // ¾
  "\u2155": 1 / 5,
  "\u2156": 2 / 5,
  "\u2157": 3 / 5,
  "\u2158": 4 / 5,
  "\u2159": 1 / 6,
  "\u215A": 5 / 6,
  "\u215B": 1 / 8, // ⅛
  "\u215C": 3 / 8, // ⅜
  "\u215D": 5 / 8, // ⅝
  "\u215E": 7 / 8, // ⅞
};

/**
 * Parse a quantity string into a number (or range). Returns `null` if
 * the input isn't recognizable as a number — the caller should fall
 * back to displaying the original text unchanged.
 */
export function parseQuantity(input: string | null | undefined): ParsedQuantity | null {
  if (input == null) return null;
  const raw = input.trim();
  if (!raw) return null;

  // Range: "1-2", "1 to 2", "1 – 2"
  const rangeMatch = raw.match(/^(.+?)\s*(?:-|–|—|to)\s*(.+)$/i);
  if (rangeMatch) {
    const low = parseSingle(rangeMatch[1]);
    const high = parseSingle(rangeMatch[2]);
    if (low != null && high != null) {
      return { kind: "range", low, high, raw };
    }
  }

  const single = parseSingle(raw);
  if (single == null) return null;
  return { kind: "single", value: single, raw };
}

function parseSingle(input: string): number | null {
  let s = input.trim();
  if (!s) return null;

  // Replace vulgar fractions with " <decimal>" so "1½" -> "1 0.5".
  s = s.replace(/[\u00BC-\u00BE\u2153-\u215E]/g, (g) => {
    const v = VULGAR_FRACTIONS[g];
    return v != null ? ` ${v}` : g;
  });

  // Mixed number: "1 1/2"
  const mixed = s.match(/^([+-]?\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (den === 0) return null;
    const sign = whole < 0 || /^-/.test(mixed[1]) ? -1 : 1;
    return sign * (Math.abs(whole) + num / den);
  }

  // Pure fraction: "3/4"
  const frac = s.match(/^([+-]?\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (den === 0) return null;
    return num / den;
  }

  // Mixed-with-decimal-after-vulgar substitution: "1 0.5"
  const mixedDec = s.match(/^([+-]?\d+)\s+(\d*\.\d+|\d+\/\d+)$/);
  if (mixedDec) {
    const whole = Number(mixedDec[1]);
    const tail = mixedDec[2].includes("/")
      ? parseSingle(mixedDec[2])
      : Number(mixedDec[2]);
    if (tail == null || !Number.isFinite(tail)) return null;
    const sign = /^-/.test(mixedDec[1]) ? -1 : 1;
    return sign * (Math.abs(whole) + tail);
  }

  // Plain integer / decimal
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  return null;
}

/**
 * Render a number as a human-friendly quantity string. Snaps to
 * eighths so weird floating-point results (`0.99999`, `0.333333`) come
 * out as kitchen-readable fractions.
 *
 * Examples:
 *   formatQuantity(1.5)    -> "1 1/2"
 *   formatQuantity(0.75)   -> "3/4"
 *   formatQuantity(0.3333) -> "1/3"
 *   formatQuantity(2)      -> "2"
 */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  // Special-case common thirds since 1/3 and 2/3 don't snap to eighths.
  const thirdsRemainder = abs - Math.floor(abs);
  if (closeTo(thirdsRemainder, 1 / 3, 0.02)) {
    const whole = Math.floor(abs);
    return `${sign}${whole > 0 ? `${whole} ` : ""}1/3`;
  }
  if (closeTo(thirdsRemainder, 2 / 3, 0.02)) {
    const whole = Math.floor(abs);
    return `${sign}${whole > 0 ? `${whole} ` : ""}2/3`;
  }

  // Snap to nearest 1/8.
  const eighths = Math.round(abs * 8);
  if (eighths === 0) return "0";
  const whole = Math.floor(eighths / 8);
  const remainder = eighths - whole * 8;
  if (remainder === 0) return `${sign}${whole}`;

  const fracStr = simplifyEighth(remainder);
  if (whole === 0) return `${sign}${fracStr}`;
  return `${sign}${whole} ${fracStr}`;
}

function simplifyEighth(num: number): string {
  // num is in 1..7; reduce by gcd with 8.
  const g = gcd(num, 8);
  return `${num / g}/${8 / g}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function closeTo(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) < tol;
}

/**
 * Multiply a quantity string by `factor` and return the rendered
 * scaled string. If the input can't be parsed, returns the original
 * string unchanged so we never silently drop information.
 */
export function scaleQuantity(input: string | null | undefined, factor: number): string {
  if (input == null) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (!Number.isFinite(factor) || factor <= 0) return trimmed;

  const parsed = parseQuantity(trimmed);
  if (!parsed) return trimmed;

  if (parsed.kind === "range") {
    return `${formatQuantity(parsed.low * factor)}\u2013${formatQuantity(parsed.high * factor)}`;
  }
  return formatQuantity(parsed.value * factor);
}

/**
 * Pluralize / depluralize a unit based on the rendered quantity. Recipe
 * authors usually write the original ingredient at the original servings,
 * so scaling 2 cups -> 1 leaves "1 cups" without help. We canonicalise to
 * the singular form (e.g. "cup") when the numeric quantity is <= 1, and
 * to the plural form (e.g. "cups") otherwise. Units we don't know about
 * pass through unchanged.
 *
 * Quantity comes in as the rendered string (post-`scaleQuantity` /
 * `formatQuantity`) so we can re-parse it; ranges always read as plural
 * (using the upper bound).
 */
export function pluralizeUnit(
  unit: string | null | undefined,
  quantity: string | null | undefined,
): string {
  const u = (unit ?? "").trim();
  if (!u) return "";

  const known = UNIT_FORMS.get(u.toLowerCase());
  if (!known) return u;

  const parsed = parseQuantity(quantity ?? "");
  // Unscaleable quantity ("a pinch") → assume the original wording was sane.
  if (!parsed) return u;
  const ref = parsed.kind === "range" ? parsed.high : parsed.value;
  return ref <= 1 ? known.singular : known.plural;
}

type UnitForms = { singular: string; plural: string };

// Map from any spelling we accept to its canonical singular + plural pair.
// Entries deliberately cover the abbreviations that don't pluralize (tsp,
// tbsp, oz, g, kg, ml, l) so they round-trip cleanly.
const UNIT_PAIRS: readonly UnitForms[] = [
  { singular: "cup", plural: "cups" },
  { singular: "tsp", plural: "tsp" },
  { singular: "teaspoon", plural: "teaspoons" },
  { singular: "tbsp", plural: "tbsp" },
  { singular: "tablespoon", plural: "tablespoons" },
  { singular: "ounce", plural: "ounces" },
  { singular: "oz", plural: "oz" },
  { singular: "fl oz", plural: "fl oz" },
  { singular: "pound", plural: "pounds" },
  { singular: "lb", plural: "lbs" },
  { singular: "gram", plural: "grams" },
  { singular: "g", plural: "g" },
  { singular: "kg", plural: "kg" },
  { singular: "kilogram", plural: "kilograms" },
  { singular: "ml", plural: "ml" },
  { singular: "milliliter", plural: "milliliters" },
  { singular: "millilitre", plural: "millilitres" },
  { singular: "l", plural: "l" },
  { singular: "liter", plural: "liters" },
  { singular: "litre", plural: "litres" },
  { singular: "pint", plural: "pints" },
  { singular: "quart", plural: "quarts" },
  { singular: "gallon", plural: "gallons" },
  { singular: "stick", plural: "sticks" },
  { singular: "slice", plural: "slices" },
  { singular: "clove", plural: "cloves" },
  { singular: "can", plural: "cans" },
  { singular: "jar", plural: "jars" },
  { singular: "bottle", plural: "bottles" },
  { singular: "package", plural: "packages" },
  { singular: "pkg", plural: "pkgs" },
  { singular: "bunch", plural: "bunches" },
  { singular: "head", plural: "heads" },
  { singular: "sprig", plural: "sprigs" },
  { singular: "leaf", plural: "leaves" },
  { singular: "stalk", plural: "stalks" },
  { singular: "ear", plural: "ears" },
  { singular: "pinch", plural: "pinches" },
  { singular: "dash", plural: "dashes" },
  { singular: "drop", plural: "drops" },
  { singular: "piece", plural: "pieces" },
];

const UNIT_FORMS: Map<string, UnitForms> = (() => {
  const map = new Map<string, UnitForms>();
  for (const p of UNIT_PAIRS) {
    map.set(p.singular.toLowerCase(), p);
    map.set(p.plural.toLowerCase(), p);
  }
  return map;
})();

// Pre-built once: longest unit aliases first so "tablespoons" wins over
// "tbsp" when both could match.
const UNIT_REGEX_FRAGMENT = (() => {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const p of UNIT_PAIRS) {
    for (const a of [p.plural, p.singular]) {
      if (!seen.has(a.toLowerCase())) {
        seen.add(a.toLowerCase());
        aliases.push(a);
      }
    }
  }
  aliases.sort((a, b) => b.length - a.length);
  return aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
})();

// Match a quantity (mixed/fraction/decimal/vulgar fraction) followed by a
// known cooking unit. Lookbehind on whitespace / start / open-bracket so
// that vulgar fractions (which aren't word chars and so don't get a \b)
// still anchor cleanly. Trailing \b ensures "min" doesn't match "minute"
// inside "30 minutes" — only known units anchor the unit side.
const QUANTITY_UNIT_RE = new RegExp(
  String.raw`(?<=^|[\s([])(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?|[\u00BC-\u00BE\u2153-\u215E])\s+(` +
    UNIT_REGEX_FRAGMENT +
    String.raw`)\b`,
  "gi",
);

/**
 * Build the "<quantity> <unit>" prefix shown before an ingredient name,
 * dropping the unit when it would just duplicate words already in the
 * name. This catches AI-extraction artefacts like
 *   { quantity: "1", unit: "green onion", name: "green onion" }
 * which would otherwise render as "1 green onion green onion".
 *
 * The dedupe is conservative: we only drop the unit when its full
 * lowercased form appears as a whole word inside the lowercased name.
 * "cups" inside "buttercup squash" does NOT count because of the word
 * boundary check; "leaves" inside "basil leaves" does.
 */
export function formatIngredientPrefix(
  quantity: string | null | undefined,
  unit: string | null | undefined,
  name: string,
): string {
  const q = (quantity ?? "").trim();
  const u = (unit ?? "").trim();
  const n = (name ?? "").trim();
  if (!q && !u) return "";

  const showUnit = u && !unitDuplicatesName(u, n);
  return [q, showUnit ? u : ""].filter(Boolean).join(" ");
}

function unitDuplicatesName(unit: string, name: string): boolean {
  if (!unit || !name) return false;
  const u = unit.toLowerCase();
  const n = name.toLowerCase();
  // Exact match: { unit: "green onion", name: "green onion" }.
  if (u === n) return true;
  // Whole-word containment: { unit: "leaves", name: "basil leaves" }.
  // Escape regex metachars so units like "fl oz" don't blow up.
  const escaped = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(n);
}

/**
 * Rescale "<quantity> <unit>" tokens embedded in free-form step text,
 * leaving everything else (temperatures, times, prose) untouched.
 *
 * Examples (factor = 0.5):
 *   "Add 3 cups broth and simmer 30 minutes" -> "Add 1 1/2 cups broth and simmer 30 minutes"
 *   "Bake at 350\u00B0F for 20 min"          -> unchanged (no known unit)
 */
export function scaleStepText(body: string, factor: number): string {
  if (!body) return body;
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return body;
  return body.replace(QUANTITY_UNIT_RE, (match, qty: string, unit: string) => {
    const scaledQty = scaleQuantity(qty, factor);
    if (scaledQty === qty.trim()) return match;
    const scaledUnit = pluralizeUnit(unit, scaledQty);
    return `${scaledQty} ${scaledUnit}`;
  });
}
