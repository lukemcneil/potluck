import { z } from "zod";
import { MEAL_TYPES, PHOTO_ROLES, RECIPE_KIND, VISIBILITY } from "@/db/schema";

export const ingredientSchema = z.object({
  position: z.number().int().nonnegative().default(0),
  quantity: z.string().trim().max(40).optional().nullable(),
  unit: z.string().trim().max(40).optional().nullable(),
  name: z.string().trim().min(1, "Ingredient name is required").max(120),
  note: z.string().trim().max(200).optional().nullable(),
});
export type IngredientInput = z.infer<typeof ingredientSchema>;

export const stepSchema = z.object({
  position: z.number().int().nonnegative().default(0),
  body: z.string().trim().min(1, "Step is required").max(2000),
});
export type StepInput = z.infer<typeof stepSchema>;

export const KNOWN_DIETS = [
  "vegetarian",
  "vegan",
  "gluten-free",
  "dairy-free",
  "nut-free",
  "keto",
  "paleo",
  "low-carb",
  "pescatarian",
] as const;

export const recipeFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  // Free-form author notes (tips, substitutions, family context). A
  // 4000-char ceiling is roughly two screens of paragraph text — far
  // more than any real cookbook note we've seen, but bounded so it
  // can't become a hiding spot for spam if we ever go multi-user.
  notes: z.string().trim().max(4000).optional().nullable(),

  prepMinutes: z.number().int().min(0).max(60 * 24).nullable().optional(),
  cookMinutes: z.number().int().min(0).max(60 * 24).nullable().optional(),
  servings: z.string().trim().max(40).optional().nullable(),

  mealType: z.enum(MEAL_TYPES).optional().nullable(),
  cuisine: z.string().trim().max(60).optional().nullable(),
  diets: z.array(z.string().trim().max(40)).default([]),
  tags: z.array(z.string().trim().max(40)).default([]),

  visibility: z.enum(VISIBILITY).default("public"),
  kind: z.enum(RECIPE_KIND).default("structured"),

  sourceUrl: z.string().trim().url().max(500).optional().nullable(),

  ingredients: z.array(ingredientSchema).default([]),
  steps: z.array(stepSchema).default([]),

  // Photos are sent as { path, role } pairs so callers can mark a
  // photo as a `source` (paper recipe card, magazine clipping —
  // kept for verification) rather than a `cover` (visual hero on
  // the feed, recipe card, and detail page). Path is the public
  // /uploads/... URL the upload API hands back. Role defaults to
  // `cover` so any client still posting plain strings would just
  // need to wrap them in objects (no role change for them).
  photos: z
    .array(
      z.object({
        path: z.string().trim().min(1).max(500),
        role: z.enum(PHOTO_ROLES).default("cover"),
      }),
    )
    .max(16)
    .default([]),
});
export type RecipeFormInput = z.input<typeof recipeFormSchema>;
export type RecipeFormOutput = z.output<typeof recipeFormSchema>;
export type RecipeFormPhotoInput = RecipeFormOutput["photos"][number];

// OpenAI's Responses API + structured outputs runs in strict mode which
// requires (a) the root schema to be `type: "object"` (so no top-level
// unions / anyOf) and (b) every property to be in `required[]` with
// `nullable: true` for omittable fields.
//
// To let the model bail when the input isn't actually a recipe, we
// give it a flat `notARecipe` boolean discriminator + an optional
// `reason` string. When `notARecipe=true`, all the recipe fields are
// allowed to be empty (no `min(1)`) — we just throw them away. When
// `notARecipe=false`, we re-validate against the stricter content
// schema in code (see `extractRecipe()`).
// Per-field confidence the model returns alongside each ingredient and
// step. `low` means the model wasn't sure about something (smudged
// photo, ambiguous unit, partial OCR, etc.) and the review-step UI
// should force the user to confirm or edit before saving.
export const confidenceSchema = z.enum(["high", "low"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const extractedRecipeWireSchema = z.object({
  notARecipe: z.boolean(),
  reason: z.string().trim().max(500).nullable(),
  title: z.string().trim().max(160),
  description: z.string().trim().max(2000).nullable(),
  // Author/source notes pulled from the recipe — chef's notes,
  // "make-ahead", "substitutions", "tips", "from the kitchen of…",
  // recipe headnotes. NOT ingredient counts or steps. Free-form text,
  // line breaks preserved.
  notes: z.string().trim().max(4000).nullable(),
  ingredients: z
    .array(
      z.object({
        quantity: z.string().trim().max(40).nullable(),
        unit: z.string().trim().max(40).nullable(),
        name: z.string().trim().max(120),
        note: z.string().trim().max(200).nullable(),
        confidence: confidenceSchema,
      }),
    )
    .max(80),
  steps: z
    .array(
      z.object({
        body: z.string().trim().max(2000),
        confidence: confidenceSchema,
      }),
    )
    .max(60),
  prepMinutes: z.number().int().min(0).max(60 * 24).nullable(),
  cookMinutes: z.number().int().min(0).max(60 * 24).nullable(),
  servings: z.string().trim().max(40).nullable(),
  mealType: z.enum(MEAL_TYPES).nullable(),
  cuisine: z.string().trim().max(60).nullable(),
  suggestedDiets: z.array(z.string().trim().max(40)).max(10),
  suggestedTags: z.array(z.string().trim().max(40)).max(10),
});

/**
 * The "we found a recipe" shape — used everywhere downstream of
 * `extractRecipe()`. Stricter than the wire schema (title + at least
 * one ingredient + at least one step required, ingredient names
 * non-empty, step text non-empty).
 */
export const extractedRecipeSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable(),
  notes: z.string().trim().max(4000).nullable(),
  ingredients: z
    .array(
      z.object({
        quantity: z.string().trim().max(40).nullable(),
        unit: z.string().trim().max(40).nullable(),
        name: z.string().trim().min(1).max(120),
        note: z.string().trim().max(200).nullable(),
        confidence: confidenceSchema,
      }),
    )
    .min(1, "Recipe must have at least one ingredient")
    .max(80),
  // Steps are intentionally allowed to be empty. Lots of real-world
  // sources are ingredient-only — Instagram screenshots of a recipe
  // card with just the components, a magazine "build your own bowl"
  // box, a parent's hand-written list with no method ("you know how
  // to make it"). When the source genuinely has no instructions, we'd
  // rather save the ingredients half than throw the whole import
  // away. The recipe detail page already renders a "no steps yet"
  // empty state, and the editor lets the cook fill them in later.
  steps: z
    .array(
      z.object({
        body: z.string().trim().min(1).max(2000),
        confidence: confidenceSchema,
      }),
    )
    .max(60),
  prepMinutes: z.number().int().min(0).max(60 * 24).nullable(),
  cookMinutes: z.number().int().min(0).max(60 * 24).nullable(),
  servings: z.string().trim().max(40).nullable(),
  mealType: z.enum(MEAL_TYPES).nullable(),
  cuisine: z.string().trim().max(60).nullable(),
  suggestedDiets: z.array(z.string().trim().max(40)).max(10),
  suggestedTags: z.array(z.string().trim().max(40)).max(10),
});
export type ExtractedRecipe = z.infer<typeof extractedRecipeSchema>;
export type ExtractedIngredient = ExtractedRecipe["ingredients"][number];
export type ExtractedStep = ExtractedRecipe["steps"][number];

/**
 * Output shape for the SEQUENTIAL verifier pass. After the primary
 * extraction produces a recipe, we run a second LLM call whose job is
 * to audit that recipe against the original source and report any
 * mistakes — wrong quantities, wrong units, missed ingredients,
 * hallucinated rows, garbled steps.
 *
 * This is deliberately a flat object (no top-level union) and every
 * field is `nullable` rather than `optional` so it passes both
 * OpenAI's strict-mode structured-output JSON Schema validation and
 * Gemini's. See `extractedRecipeWireSchema` above for the same
 * pattern + rationale.
 */
export const ingredientIssueWireSchema = z.object({
  // Which ingredient in the primary extraction is wrong. `null` when
  // the issue is "missing" (the source has it but primary doesn't).
  primaryIndex: z.number().int().min(0).max(200).nullable(),
  kind: z.enum([
    "wrong_quantity",
    "wrong_unit",
    "wrong_name",
    "should_be_removed",
    "missing",
  ]),
  // For wrong_*: what the ingredient should actually be (from the
  // source). For "missing": the ingredient that should be added.
  // For "should_be_removed": null (nothing to suggest).
  correctedQuantity: z.string().trim().max(40).nullable(),
  correctedUnit: z.string().trim().max(40).nullable(),
  correctedName: z.string().trim().max(120).nullable(),
  correctedNote: z.string().trim().max(200).nullable(),
  reason: z.string().trim().max(300),
});

export const stepIssueWireSchema = z.object({
  primaryIndex: z.number().int().min(0).max(200).nullable(),
  kind: z.enum(["text_wrong", "should_be_removed", "missing"]),
  // Where this step should be inserted, for kind=missing. 0-indexed
  // position in the primary's step array. Null for non-missing.
  insertPosition: z.number().int().min(0).max(200).nullable(),
  correctedText: z.string().trim().max(2000).nullable(),
  reason: z.string().trim().max(300),
});

export const extractionIssuesWireSchema = z.object({
  // Verifier's overall confidence that the primary got things right.
  // We don't gate UI on this directly — it's a debugging signal that
  // helps us calibrate how aggressive the prompt should be.
  looksCorrect: z.boolean(),
  ingredientIssues: z.array(ingredientIssueWireSchema).max(40),
  stepIssues: z.array(stepIssueWireSchema).max(20),
});
export type ExtractionIssues = z.infer<typeof extractionIssuesWireSchema>;
export type IngredientIssue = z.infer<typeof ingredientIssueWireSchema>;
export type StepIssue = z.infer<typeof stepIssueWireSchema>;

export const collectionFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).optional().nullable(),
  visibility: z.enum(VISIBILITY).default("public"),
});
export type CollectionFormInput = z.infer<typeof collectionFormSchema>;

export const handleSchema = z
  .string()
  .trim()
  .min(2, "Too short")
  .max(32, "Too long")
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
    message: "Lowercase letters, numbers, and dashes only",
  });

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
