import "server-only";

import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  lte,
  like,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db/client";
import { sqlite } from "@/db/client";
import {
  recipes,
  recipePhotos,
  users,
  type MealType,
} from "@/db/schema";
import type { RecipeCardData } from "@/components/recipe/RecipeCard";

const PAGE_SIZE = 24;

export type RecipeFeedFilters = {
  authorId?: string;
  /** When set, only public + unlisted are returned (anyone but the author). */
  publicOnly?: boolean;
  /** Filter by exact meal type. */
  mealType?: MealType;
  /** Filter by cuisine (case-insensitive). */
  cuisine?: string;
  /** Match recipes that have ALL of the listed diets. */
  diets?: string[];
  /** Total time = prep + cook ≤ this. */
  maxMinutes?: number;
  limit?: number;
  offset?: number;
};

/**
 * Builds the shared filter conditions for listing/searching recipes.
 * Used by both `listRecipeCards` and `searchRecipes` so filters work
 * the same in both surfaces.
 */
function buildFilterConditions(filters: RecipeFeedFilters): SQL[] {
  const conds: SQL[] = [];
  if (filters.authorId) conds.push(eq(recipes.authorId, filters.authorId));
  if (filters.publicOnly) conds.push(eq(recipes.visibility, "public"));
  if (filters.mealType) conds.push(eq(recipes.mealType, filters.mealType));
  if (filters.cuisine) {
    conds.push(eq(sql`LOWER(${recipes.cuisine})`, filters.cuisine.toLowerCase()));
  }
  // diets is stored as a JSON array of strings; LIKE on the literal text
  // is good enough at our scale and avoids needing json_each().
  if (filters.diets && filters.diets.length > 0) {
    for (const diet of filters.diets) {
      const safe = diet.replace(/[\\%_"]/g, "");
      conds.push(like(recipes.diets, `%"${safe}"%`));
    }
  }
  if (typeof filters.maxMinutes === "number") {
    // We want recipes whose total time fits the cap, but a recipe with
    // no prep/cook data shouldn't silently pass the filter — `COALESCE`
    // would treat both NULLs as 0 and "0 ≤ 20" is always true. Require
    // at least one of the two to be set so the comparison is meaningful.
    const atLeastOneSet = or(
      isNotNull(recipes.prepMinutes),
      isNotNull(recipes.cookMinutes),
    );
    if (atLeastOneSet) conds.push(atLeastOneSet);
    conds.push(
      lte(
        sql`COALESCE(${recipes.prepMinutes}, 0) + COALESCE(${recipes.cookMinutes}, 0)`,
        filters.maxMinutes,
      ),
    );
  }
  return conds;
}

export async function listRecipeCards(
  filters: RecipeFeedFilters = {},
): Promise<RecipeCardData[]> {
  const limit = filters.limit ?? PAGE_SIZE;
  const offset = filters.offset ?? 0;

  const conds = buildFilterConditions(filters);
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
  opts: RecipeFeedFilters = {},
): Promise<RecipeCardData[]> {
  const limit = opts.limit ?? PAGE_SIZE;
  const offset = opts.offset ?? 0;
  const trimmed = query.trim();
  if (!trimmed) return [];

  const matchExpr = toFtsMatch(trimmed);
  if (!matchExpr) return [];

  // FTS hits are usually small; we over-fetch by 4x to give the secondary
  // filter step room before LIMIT-ing the final ordered set.
  const fetchLimit = Math.max(limit * 4, 32);

  const idRows = sqlite
    .prepare(
      `SELECT recipe_id, bm25(recipes_fts) AS score
       FROM recipes_fts
       WHERE recipes_fts MATCH ?
       ORDER BY score ASC
       LIMIT ?`,
    )
    .all(matchExpr, fetchLimit) as Array<{ recipe_id: string; score: number }>;

  if (idRows.length === 0) return [];
  const ids = idRows.map((r) => r.recipe_id);

  const filterConds = buildFilterConditions({
    ...opts,
    publicOnly: opts.publicOnly ?? true,
  });

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
    .where(and(inArray(recipes.id, ids), ...filterConds))
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

  // Preserve FTS rank order, then slice to the page window. We
  // over-fetched ids so post-filter slicing won't surface a partial page.
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
  return result.slice(offset, offset + limit);
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

/**
 * Distinct cuisines that have at least one public recipe. Used to
 * populate the cuisine filter dropdown so we only show options that
 * actually return results.
 */
export async function listAvailableCuisines(): Promise<string[]> {
  const rows = db
    .select({ cuisine: recipes.cuisine })
    .from(recipes)
    .where(and(eq(recipes.visibility, "public"), sql`${recipes.cuisine} IS NOT NULL AND ${recipes.cuisine} != ''`))
    .groupBy(recipes.cuisine)
    .all();
  return rows
    .map((r) => (r.cuisine ?? "").trim().toLowerCase())
    .filter((c) => c.length > 0)
    .sort();
}

export async function countRecipes(filters: RecipeFeedFilters = {}): Promise<number> {
  const conds = buildFilterConditions(filters);
  const where = conds.length === 1 ? conds[0] : conds.length > 1 ? and(...conds) : undefined;

  const row = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(recipes)
    .where(where)
    .get();
  return row?.n ?? 0;
}
