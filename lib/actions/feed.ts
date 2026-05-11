"use server";

import { z } from "zod";

import {
  listRecipeCards,
  type RecipeFeedFilters,
} from "@/lib/queries/recipes";
import { MEAL_TYPES, type MealType } from "@/db/schema";
import { KNOWN_DIETS } from "@/lib/validators";
import type { RecipeCardData } from "@/components/recipe/RecipeCard";

/**
 * Server action used by the FeedList client component to load the next
 * page of recipes for infinite scroll. Re-uses the same filter parsing
 * as /feed so the URL stays the source of truth.
 */
const loadInputSchema = z.object({
  meal: z.string().optional(),
  cuisine: z.string().optional(),
  diet: z.string().optional(),
  max: z.string().optional(),
  offset: z.number().int().nonnegative().max(10_000),
  limit: z.number().int().min(1).max(48).default(24),
});

export type LoadMoreFeedInput = z.input<typeof loadInputSchema>;
export type LoadMoreFeedResult = {
  recipes: RecipeCardData[];
  nextOffset: number | null;
};

export async function loadMoreFeedAction(
  raw: LoadMoreFeedInput,
): Promise<LoadMoreFeedResult> {
  const input = loadInputSchema.parse(raw);
  const filters = parseFilters(input);
  const recipes = await listRecipeCards({
    publicOnly: true,
    limit: input.limit,
    offset: input.offset,
    ...filters,
  });
  // If we got fewer than `limit` rows, we've reached the tail. Otherwise
  // compute the next cursor — there might be one more page.
  const nextOffset =
    recipes.length < input.limit ? null : input.offset + recipes.length;
  return { recipes, nextOffset };
}

function parseFilters(sp: {
  meal?: string;
  cuisine?: string;
  diet?: string;
  max?: string;
}): Pick<RecipeFeedFilters, "mealType" | "cuisine" | "diets" | "maxMinutes"> {
  const meal = (MEAL_TYPES as readonly string[]).includes(sp.meal ?? "")
    ? (sp.meal as MealType)
    : undefined;
  const cuisine = sp.cuisine?.trim() || undefined;
  const allowedDiets = new Set<string>(KNOWN_DIETS);
  const diets = sp.diet
    ? sp.diet
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter((d) => allowedDiets.has(d))
    : undefined;
  const max = Number(sp.max);
  const maxMinutes = Number.isFinite(max) && max > 0 ? max : undefined;
  return { mealType: meal, cuisine, diets, maxMinutes };
}
