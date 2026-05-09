import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  recipes,
  recipePhotos,
  users,
} from "@/db/schema";
import type { RecipeCardData } from "@/components/recipe/RecipeCard";

const PAGE_SIZE = 24;

export type RecipeFeedFilters = {
  authorId?: string;
  /** When set, only public + unlisted are returned (anyone but the author). */
  publicOnly?: boolean;
  limit?: number;
  offset?: number;
};

export async function listRecipeCards(
  filters: RecipeFeedFilters = {},
): Promise<RecipeCardData[]> {
  const limit = filters.limit ?? PAGE_SIZE;
  const offset = filters.offset ?? 0;

  const conds = [];
  if (filters.authorId) conds.push(eq(recipes.authorId, filters.authorId));
  if (filters.publicOnly) conds.push(eq(recipes.visibility, "public"));

  const where = conds.length === 1 ? conds[0] : conds.length > 1 ? and(...conds) : undefined;

  const baseRows = db
    .select({
      id: recipes.id,
      title: recipes.title,
      description: recipes.description,
      prepMinutes: recipes.prepMinutes,
      cookMinutes: recipes.cookMinutes,
      servings: recipes.servings,
      mealType: recipes.mealType,
      cuisine: recipes.cuisine,
      visibility: recipes.visibility,
      authorId: recipes.authorId,
      authorName: users.name,
      authorHandle: users.handle,
      authorImage: users.image,
    })
    .from(recipes)
    .leftJoin(users, eq(recipes.authorId, users.id))
    .where(where)
    .orderBy(desc(recipes.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  if (baseRows.length === 0) return [];

  const ids = baseRows.map((r) => r.id);
  const heroPhotos = db
    .select({
      recipeId: recipePhotos.recipeId,
      path: recipePhotos.path,
      blurhash: recipePhotos.blurhash,
      position: recipePhotos.position,
    })
    .from(recipePhotos)
    .where(inArray(recipePhotos.recipeId, ids))
    .orderBy(recipePhotos.recipeId, recipePhotos.position)
    .all();

  const heroByRecipe = new Map<string, { path: string; blurhash: string | null }>();
  for (const p of heroPhotos) {
    if (!heroByRecipe.has(p.recipeId)) {
      heroByRecipe.set(p.recipeId, { path: p.path, blurhash: p.blurhash ?? null });
    }
  }

  return baseRows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    prepMinutes: row.prepMinutes ?? null,
    cookMinutes: row.cookMinutes ?? null,
    servings: row.servings ?? null,
    mealType: row.mealType ?? null,
    cuisine: row.cuisine ?? null,
    visibility: row.visibility,
    photoPath: heroByRecipe.get(row.id)?.path ?? null,
    photoBlurhash: heroByRecipe.get(row.id)?.blurhash ?? null,
    author: {
      id: row.authorId,
      name: row.authorName ?? null,
      handle: row.authorHandle ?? null,
      image: row.authorImage ?? null,
    },
  }));
}

export async function countRecipes(filters: RecipeFeedFilters = {}): Promise<number> {
  const conds = [];
  if (filters.authorId) conds.push(eq(recipes.authorId, filters.authorId));
  if (filters.publicOnly) conds.push(eq(recipes.visibility, "public"));
  const where = conds.length === 1 ? conds[0] : conds.length > 1 ? and(...conds) : undefined;

  const row = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(recipes)
    .where(where)
    .get();
  return row?.n ?? 0;
}
