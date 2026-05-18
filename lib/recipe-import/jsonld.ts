import "server-only";

/**
 * JSON-LD Recipe parser for URL imports.
 *
 * Most major recipe blogs (WordPress + Yoast / RankMath, Sugar Spun
 * Run, Sally's Baking Addiction, Simply Recipes, Smitten Kitchen,
 * Bon Appétit, Serious Eats, NYT Cooking, etc.) embed a
 * `<script type="application/ld+json">` block with their recipe in
 * schema.org's `Recipe` format. When that's available we'd rather
 * hand the LLM a few hundred bytes of clean structured data than
 * ~150K of raw HTML — it's cheaper, faster (smaller input AND
 * smaller output because the model doesn't have to filter through
 * navigation / ads / comments), and far less likely to drift on
 * fields where the page author already explicitly said what the
 * value should be.
 *
 * Important design notes:
 *
 *   - We still send the data to an LLM (the user's preference). The
 *     LLM splits "1 1/2 cups flour, sifted" into quantity/unit/name/note,
 *     infers mealType / cuisine / diets from page context, and decides
 *     when to mark confidence: "low" on smudgy / ambiguous fields.
 *     JSON-LD is the SOURCE we feed it, not the FINAL extraction.
 *
 *   - This is best-effort. If JSON-LD isn't present, malformed, or
 *     missing core content (no ingredients, no instructions, both),
 *     we return `null` and the caller falls back to the full-HTML
 *     path. We never throw.
 *
 *   - Schema variations supported: top-level `@type: "Recipe"`,
 *     `@type: ["Recipe", "HowTo"]` arrays, `@graph`-wrapped (Yoast
 *     bundles every page's schemas into one big `@graph` array),
 *     and HowToSection-nested instructions.
 *
 * Pure module — no I/O, no network. Safe to unit-test against
 * snippet HTML strings.
 */

export type JsonLdRecipe = {
  /** Recipe title — always present in normalized output. */
  name: string;
  description: string | null;
  /** Raw ingredient lines, e.g. "1 1/2 cups all-purpose flour, sifted". */
  ingredients: string[];
  /** Ordered instruction steps with HTML and section headers stripped. */
  instructions: string[];
  /** ISO 8601 duration strings (e.g. "PT30M") — LLM converts. */
  prepTime: string | null;
  cookTime: string | null;
  totalTime: string | null;
  /** Single yield string, e.g. "12 eclairs" or "6 servings". */
  yield: string | null;
  /** Common labels we feed to the LLM as a hint. */
  category: string | null;
  cuisine: string | null;
  keywords: string[];
  /**
   * Schema.org diet URLs (e.g. `https://schema.org/VegetarianDiet`)
   * OR short labels — we just pass them through; the LLM decides
   * which of our `KNOWN_DIETS` to suggest.
   */
  suitableForDiet: string[];
  /** Free-form headnotes — schema.org doesn't have a great field for this; some sites use HowToTip. */
  notes: string[];
};

/** Hard cap on bytes we feed to the LLM in the formatted payload. */
const MAX_FORMATTED_CHARS = 30_000;
/** Per-field length caps (keeps a runaway ingredient list bounded). */
const MAX_INGREDIENTS = 80;
const MAX_INSTRUCTIONS = 60;
const MAX_KEYWORDS = 16;
const MAX_DIETS = 8;

/**
 * Find and normalize the first Recipe node anywhere in the page's
 * JSON-LD blocks. Returns null if no usable recipe is found.
 *
 * "Usable" means: has at least a name AND at least one ingredient
 * line (or one instruction). Empty/broken JSON-LD is treated as
 * absent so the caller falls through to the HTML path.
 */
export function findJsonLdRecipe(html: string): JsonLdRecipe | null {
  const blocks = extractLdBlocks(html);
  for (const data of blocks) {
    const node = walkForRecipe(data);
    if (!node) continue;
    const normalized = normalize(node);
    if (isUseful(normalized)) return normalized;
  }
  return null;
}

/**
 * Format a parsed JsonLdRecipe as a compact text block suitable as
 * an LLM user-content payload. The format is intentionally readable —
 * the model parses key-value lines naturally and we get cleaner
 * outputs than from an opaque JSON dump.
 *
 * Caps total length at `MAX_FORMATTED_CHARS` (truncates the longest
 * sections first) so a pathological page can't blow our token budget.
 */
export function formatJsonLdAsText(r: JsonLdRecipe): string {
  const lines: string[] = [];
  lines.push(`Title: ${r.name}`);
  if (r.description) lines.push(`Description: ${r.description}`);
  if (r.yield) lines.push(`Yield: ${r.yield}`);
  if (r.prepTime) lines.push(`Prep time: ${r.prepTime}`);
  if (r.cookTime) lines.push(`Cook time: ${r.cookTime}`);
  if (r.totalTime) lines.push(`Total time: ${r.totalTime}`);
  if (r.category) lines.push(`Category hint: ${r.category}`);
  if (r.cuisine) lines.push(`Cuisine hint: ${r.cuisine}`);
  if (r.keywords.length > 0)
    lines.push(`Keywords: ${r.keywords.slice(0, MAX_KEYWORDS).join(", ")}`);
  if (r.suitableForDiet.length > 0)
    lines.push(
      `Suitable for diet (schema.org URLs or labels): ${r.suitableForDiet.slice(0, MAX_DIETS).join(", ")}`,
    );

  if (r.ingredients.length > 0) {
    lines.push("");
    lines.push("Ingredients (verbatim, one per line):");
    for (const ing of r.ingredients.slice(0, MAX_INGREDIENTS)) {
      lines.push(`- ${ing}`);
    }
  }

  if (r.instructions.length > 0) {
    lines.push("");
    lines.push("Instructions (verbatim, in order):");
    r.instructions.slice(0, MAX_INSTRUCTIONS).forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
  }

  if (r.notes.length > 0) {
    lines.push("");
    lines.push("Author notes / tips:");
    for (const n of r.notes) lines.push(`- ${n}`);
  }

  const formatted = lines.join("\n");
  if (formatted.length <= MAX_FORMATTED_CHARS) return formatted;
  return formatted.slice(0, MAX_FORMATTED_CHARS) + "\n[truncated]";
}

function extractLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Some sites embed two concatenated objects in one block ("}{").
      // We could try to split-and-recover, but in practice the
      // second copy is usually a different schema (BreadcrumbList,
      // WebPage) and the first is what we want — so we just skip
      // unparseable blocks. The image extractor uses the same
      // forgiving strategy and works fine on real-world pages.
    }
  }
  return out;
}

/**
 * Depth-first walk looking for the first Recipe node. Matches the
 * conventions the image extractor already handles:
 *
 *   - `@type === "Recipe"` (single string)
 *   - `@type: ["Recipe", "HowTo"]` (array form some sites use)
 *   - `@graph: [...]` (Yoast/RankMath/WordPress bundle)
 *   - bare array of typed nodes
 */
function walkForRecipe(
  node: unknown,
): Record<string, unknown> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = walkForRecipe(child);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;

  const type = obj["@type"];
  const isRecipe =
    type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"));
  if (isRecipe) return obj;

  if (obj["@graph"]) return walkForRecipe(obj["@graph"]);

  return null;
}

function normalize(raw: Record<string, unknown>): JsonLdRecipe {
  return {
    name: stripTags(pickString(raw["name"])) ?? "",
    description: stripTags(pickString(raw["description"])),
    ingredients: pickStringArray(raw["recipeIngredient"])
      .map((s) => stripTags(s))
      .filter((s): s is string => s != null && s.length > 0),
    instructions: extractInstructions(raw["recipeInstructions"]),
    prepTime: pickString(raw["prepTime"]),
    cookTime: pickString(raw["cookTime"]),
    totalTime: pickString(raw["totalTime"]),
    yield: pickFirstString(raw["recipeYield"]),
    category: pickFirstString(raw["recipeCategory"]),
    cuisine: pickFirstString(raw["recipeCuisine"]),
    keywords: pickKeywords(raw["keywords"]),
    suitableForDiet: pickStringArray(raw["suitableForDiet"]),
    notes: [],
  };
}

function isUseful(r: JsonLdRecipe): boolean {
  // "Useful" = has a title AND something the user could cook from.
  // Lots of misuses of schema.org out there — pages tag their About
  // section as Recipe with just a description — so we require either
  // an ingredients list OR step instructions, ideally both.
  if (!r.name.trim()) return false;
  return r.ingredients.length > 0 || r.instructions.length > 0;
}

function pickString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

function pickFirstString(v: unknown): string | null {
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = pickString(item);
      if (s) return s;
    }
    return null;
  }
  return pickString(v);
}

function pickStringArray(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") {
    const s = v.trim();
    return s ? [s] : [];
  }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") {
      const s = item.trim();
      if (s) out.push(s);
      continue;
    }
    // Schema.org sometimes wraps strings in `{ "@type": "Text", "value": "..." }`
    // or `{ "name": "..." }` — best effort.
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const cand = pickString(obj["value"]) ?? pickString(obj["name"]);
      if (cand) out.push(cand);
    }
  }
  return out;
}

function pickKeywords(v: unknown): string[] {
  // schema.org allows keywords as either a comma-separated string or
  // an array of strings. Normalize to a flat list.
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return pickStringArray(v);
}

/**
 * recipeInstructions can be:
 *   - a plain string (sometimes one big blob, sometimes newline-separated)
 *   - an array of strings (one per step)
 *   - an array of HowToStep objects (preferred shape)
 *     - HowToStep has `text` (primary) or `name` (header-only fallback)
 *   - an array of HowToSection objects (multi-section recipes:
 *     "For the dough", "For the filling", etc.) — each section has
 *     `name` + `itemListElement` which is itself an array of HowToSteps.
 *
 * We flatten everything to a single ordered string array. Section
 * headers become "[Section Name]" prefixed entries so the LLM can
 * preserve recipe structure if it wants. HTML tags are stripped.
 */
function extractInstructions(node: unknown): string[] {
  const out: string[] = [];

  const walk = (n: unknown, sectionLabel: string | null) => {
    if (!n) return;
    if (typeof n === "string") {
      // Some sites cram every step into one string with line breaks.
      const parts = n
        .split(/\r?\n+/)
        .map((s) => stripTags(s))
        .filter((s): s is string => s != null && s.length > 0);
      if (sectionLabel && parts.length > 0) {
        out.push(`[${sectionLabel}] ${parts[0]}`);
        for (let i = 1; i < parts.length; i++) out.push(parts[i]);
      } else {
        for (const p of parts) out.push(p);
      }
      return;
    }
    if (Array.isArray(n)) {
      for (const child of n) walk(child, sectionLabel);
      return;
    }
    if (typeof n !== "object") return;
    const obj = n as Record<string, unknown>;
    const type = obj["@type"];

    // HowToSection: emit a header marker, then recurse into its
    // itemListElement. The marker keeps multi-section recipes
    // ("For the dough" / "For the filling") legible in the
    // formatted payload.
    if (
      type === "HowToSection" ||
      (Array.isArray(type) && type.includes("HowToSection"))
    ) {
      const sectionName = pickString(obj["name"]);
      walk(obj["itemListElement"], sectionName ?? sectionLabel);
      return;
    }

    // HowToStep: prefer `text`, fall back to `name`.
    if (
      type === "HowToStep" ||
      (Array.isArray(type) && type.includes("HowToStep"))
    ) {
      const text =
        stripTags(pickString(obj["text"])) ??
        stripTags(pickString(obj["name"]));
      if (text) {
        out.push(sectionLabel ? `[${sectionLabel}] ${text}` : text);
      }
      return;
    }

    // Unknown typed object — try `text`/`name` as a last resort
    // (some sites tag steps with no @type at all).
    const generic =
      stripTags(pickString(obj["text"])) ?? stripTags(pickString(obj["name"]));
    if (generic) {
      out.push(sectionLabel ? `[${sectionLabel}] ${generic}` : generic);
    }
  };

  walk(node, null);
  return out;
}

/**
 * Strip HTML tags and decode the handful of HTML entities that
 * commonly survive into JSON-LD string fields (em dashes, fractions
 * embedded as &frac12;, etc.). We don't pull in a full HTML parser —
 * JSON-LD strings should be plain text in spec, and what slips
 * through tends to be `<em>` / `<a>` / `<strong>` / `<br>`.
 */
export function stripTags(input: string | null): string | null {
  if (input == null) return null;
  const decoded = input
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&frac12;/gi, "1/2")
    .replace(/&frac14;/gi, "1/4")
    .replace(/&frac34;/gi, "3/4")
    .replace(/\s+/g, " ")
    .trim();
  return decoded.length > 0 ? decoded : null;
}
