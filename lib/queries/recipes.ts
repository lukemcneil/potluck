import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sqlite } from "@/db/client";
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

/**
 * Full-text search over title + description + ingredients (FTS5 mirror
 * table maintained by triggers — see `db/migrations/0001_potluck_fts.sql`).
 *
 * Always restricted to public recipes. Sanitizes the input to a safe FTS5
 * MATCH expression (prefix-on-each-token, double-quoted) so the user can
 * type anything without breaking the parser.
 */
export async function searchRecipes(
  query: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<RecipeCardData[]> {
  const limit = opts.limit ?? PAGE_SIZE;
  const offset = opts.offset ?? 0;
  const trimmed = query.trim();
  if (!trimmed) return [];

  const matchExpr = toFtsMatch(trimmed);
  if (!matchExpr) return [];

  // Ranked by FTS5 bm25; lower is better, so ASC. We only pull recipe ids
  // here, then re-hydrate via the same join used by listRecipeCards so
  // every result has the same shape.
  const idRows = sqlite
    .prepare(
      `SELECT recipe_id, bm25(recipes_fts) AS score
       FROM recipes_fts
       WHERE recipes_fts MATCH ?
       ORDER BY score ASC
       LIMIT ? OFFSET ?`,
    )
    .all(matchExpr, limit, offset) as Array<{ recipe_id: string; score: number }>;

  if (idRows.length === 0) return [];
  const ids = idRows.map((r) => r.recipe_id);

  const rows = db
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
    .where(
      and(eq(recipes.visibility, "public"), inArray(recipes.id, ids)),
    )
    .all();

  // Reattach hero photos.
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

  // Preserve FTS rank order.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const result: RecipeCardData[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    result.push({
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
    });
  }
  return result;
}

/**
 * Convert free-form user input into a safe FTS5 MATCH expression. We
 * tokenize on whitespace, strip FTS5 syntax characters, double-quote each
 * token, and append a `*` for prefix matching. Empty tokens are dropped;
 * a fully-empty query yields null so the caller can short-circuit.
 *
 * Example: `pad thai chicken*` -> `"pad"* "thai"* "chicken"*`
 */
function toFtsMatch(input: string): string | null {
  const tokens = input
    .split(/\s+/)
    .map((t) => t.replace(/["()*:^-]/g, "").trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" ");
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
