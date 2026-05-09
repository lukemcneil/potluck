import { z } from "zod";
import { MEAL_TYPES, RECIPE_KIND, VISIBILITY } from "@/db/schema";

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

  prepMinutes: z.coerce.number().int().min(0).max(60 * 24).optional().nullable(),
  cookMinutes: z.coerce.number().int().min(0).max(60 * 24).optional().nullable(),
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

  photoIds: z.array(z.string()).default([]),
});
export type RecipeFormInput = z.infer<typeof recipeFormSchema>;

export const extractedRecipeSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  ingredients: z
    .array(
      z.object({
        quantity: z.string().trim().max(40).optional().nullable(),
        unit: z.string().trim().max(40).optional().nullable(),
        name: z.string().trim().min(1).max(120),
        note: z.string().trim().max(200).optional().nullable(),
      }),
    )
    .min(1, "Recipe must have at least one ingredient")
    .max(80),
  steps: z.array(z.string().trim().min(1).max(2000)).min(1).max(60),
  prepMinutes: z.number().int().min(0).max(60 * 24).optional().nullable(),
  cookMinutes: z.number().int().min(0).max(60 * 24).optional().nullable(),
  servings: z.string().trim().max(40).optional().nullable(),
  mealType: z.enum(MEAL_TYPES).optional().nullable(),
  cuisine: z.string().trim().max(60).optional().nullable(),
  suggestedDiets: z.array(z.string().trim().max(40)).max(10).optional(),
  suggestedTags: z.array(z.string().trim().max(40)).max(10).optional(),
});
export type ExtractedRecipe = z.infer<typeof extractedRecipeSchema>;

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
