import "server-only";

import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { recipeRatings, recipes } from "@/db/schema";

/**
 * Public rating summary for a recipe — average + count, EXCLUDING the
 * recipe author's own rating (the author rating their own recipe is a
 * private bookmark and shouldn't influence the visible average).
 *
 * Returns `{ avg: null, count: 0 }` when nobody other than the author
 * has rated it.
 */
export type RatingSummary = {
  avg: number | null;
  count: number;
};

export function getRatingSummary(recipeId: string): RatingSummary {
  const recipe = db
    .select({ authorId: recipes.authorId })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .get();
  if (!recipe) return { avg: null, count: 0 };

  const row = db
    .select({
      avg: sql<number | null>`AVG(${recipeRatings.value})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(recipeRatings)
    .where(
      and(
        eq(recipeRatings.recipeId, recipeId),
        ne(recipeRatings.userId, recipe.authorId),
      ),
    )
    .get();

  if (!row || !row.count) return { avg: null, count: 0 };
  return { avg: row.avg ?? null, count: Number(row.count) };
}

/**
 * Bulk version: same exclusion rule applied per-recipe. Used by the
 * feed/profile/cookbook query helpers so RecipeCardData can carry
 * `avgRating` + `ratingCount` without an N+1.
 */
export function getRatingSummariesByRecipeId(
  recipeIds: string[],
): Map<string, RatingSummary> {
  const out = new Map<string, RatingSummary>();
  if (recipeIds.length === 0) return out;

  // Exclude each recipe's own author from its average using a
  // correlated subquery on `recipes`.
  const rows = db
    .select({
      recipeId: recipeRatings.recipeId,
      avg: sql<number | null>`AVG(${recipeRatings.value})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(recipeRatings)
    .innerJoin(recipes, eq(recipes.id, recipeRatings.recipeId))
    .where(
      and(
        inArray(recipeRatings.recipeId, recipeIds),
        sql`${recipeRatings.userId} <> ${recipes.authorId}`,
      ),
    )
    .groupBy(recipeRatings.recipeId)
    .all();

  for (const r of rows) {
    out.set(r.recipeId, {
      avg: r.avg ?? null,
      count: Number(r.count),
    });
  }
  return out;
}

/**
 * The signed-in user's own rating for a recipe (1..5), or null if they
 * haven't rated it. The author can rate their own recipe; we surface
 * it back here too.
 */
export function getViewerRating(
  recipeId: string,
  userId: string | null,
): number | null {
  if (!userId) return null;
  const row = db
    .select({ value: recipeRatings.value })
    .from(recipeRatings)
    .where(
      and(
        eq(recipeRatings.recipeId, recipeId),
        eq(recipeRatings.userId, userId),
      ),
    )
    .get();
  return row?.value ?? null;
}
