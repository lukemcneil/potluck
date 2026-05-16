import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  collections,
  collectionRecipes,
  recipePhotos,
  recipes,
  saves,
  users,
} from "@/db/schema";
import type { RecipeCardData } from "@/components/recipe/RecipeCard";

export type CollectionSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: "public" | "unlisted" | "private";
  isDefaultSaves: boolean;
  recipeCount: number;
  coverPhoto: string | null;
  ownerHandle: string | null;
};

export async function listCollectionsForUser(
  userId: string,
  opts: { publicOnly?: boolean } = {},
): Promise<CollectionSummary[]> {
  const conds = [eq(collections.ownerId, userId)];
  if (opts.publicOnly) conds.push(eq(collections.visibility, "public"));

  const rows = db
    .select({
      id: collections.id,
      name: collections.name,
      slug: collections.slug,
      description: collections.description,
      visibility: collections.visibility,
      isDefaultSaves: collections.isDefaultSaves,
      coverPath: collections.coverPhotoPath,
      ownerHandle: users.handle,
    })
    .from(collections)
    .leftJoin(users, eq(collections.ownerId, users.id))
    .where(and(...conds))
    .orderBy(desc(collections.isDefaultSaves), asc(collections.name))
    .all();

  if (rows.length === 0) return [];

  const counts = db
    .select({
      collectionId: collectionRecipes.collectionId,
      n: sql<number>`COUNT(*)`,
    })
    .from(collectionRecipes)
    .where(
      inArray(
        collectionRecipes.collectionId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(collectionRecipes.collectionId)
    .all();
  const countMap = new Map(counts.map((c) => [c.collectionId, c.n]));

  // Fall back to the first recipe's COVER hero photo when no
  // explicit collection cover is set. Source-only photos must never
  // surface as a collection thumbnail.
  const fallbackCovers = db
    .select({
      collectionId: collectionRecipes.collectionId,
      path: recipePhotos.path,
    })
    .from(collectionRecipes)
    .innerJoin(recipePhotos, eq(recipePhotos.recipeId, collectionRecipes.recipeId))
    .where(
      and(
        inArray(
          collectionRecipes.collectionId,
          rows.map((r) => r.id),
        ),
        eq(recipePhotos.position, 0),
        eq(recipePhotos.role, "cover"),
      ),
    )
    .orderBy(collectionRecipes.collectionId, asc(collectionRecipes.position))
    .all();
  const fallbackByCollection = new Map<string, string>();
  for (const c of fallbackCovers) {
    if (!fallbackByCollection.has(c.collectionId)) {
      fallbackByCollection.set(c.collectionId, c.path);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description ?? null,
    visibility: r.visibility,
    isDefaultSaves: r.isDefaultSaves,
    recipeCount: countMap.get(r.id) ?? 0,
    coverPhoto: r.coverPath ?? fallbackByCollection.get(r.id) ?? null,
    ownerHandle: r.ownerHandle ?? null,
  }));
}

export async function getCollectionByHandleSlug(
  handle: string,
  slug: string,
  viewerId: string | null,
): Promise<{
  collection: CollectionSummary & { ownerId: string };
  recipes: RecipeCardData[];
} | null> {
  const owner = db.select().from(users).where(eq(users.handle, handle)).get();
  if (!owner) return null;

  const c = db
    .select()
    .from(collections)
    .where(and(eq(collections.ownerId, owner.id), eq(collections.slug, slug)))
    .get();
  if (!c) return null;

  const isOwner = viewerId === owner.id;
  if (c.visibility === "private" && !isOwner) return null;

  const list = db
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
    .from(collectionRecipes)
    .innerJoin(recipes, eq(recipes.id, collectionRecipes.recipeId))
    .leftJoin(users, eq(users.id, recipes.authorId))
    .where(eq(collectionRecipes.collectionId, c.id))
    .orderBy(asc(collectionRecipes.position))
    .all();

  // Hide private recipes from non-owners (e.g. someone else's private recipe
  // shouldn't leak into a public collection — defense in depth).
  const visibleList = list.filter(
    (r) => r.visibility !== "private" || r.authorId === viewerId,
  );

  const ids = visibleList.map((r) => r.id);
  // Cards in a collection use the same hero rule as the feed: first
  // cover photo wins; recipes with only source photos render as a
  // text-only card.
  const photos = ids.length
    ? db
        .select({
          recipeId: recipePhotos.recipeId,
          path: recipePhotos.path,
          blurhash: recipePhotos.blurhash,
          position: recipePhotos.position,
        })
        .from(recipePhotos)
        .where(
          and(inArray(recipePhotos.recipeId, ids), eq(recipePhotos.role, "cover")),
        )
        .orderBy(recipePhotos.recipeId, recipePhotos.position)
        .all()
    : [];
  const heroByRecipe = new Map<string, { path: string; blurhash: string | null }>();
  for (const p of photos) {
    if (!heroByRecipe.has(p.recipeId)) {
      heroByRecipe.set(p.recipeId, { path: p.path, blurhash: p.blurhash ?? null });
    }
  }

  const cards: RecipeCardData[] = visibleList.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    prepMinutes: r.prepMinutes ?? null,
    cookMinutes: r.cookMinutes ?? null,
    servings: r.servings ?? null,
    mealType: r.mealType ?? null,
    cuisine: r.cuisine ?? null,
    visibility: r.visibility,
    photoPath: heroByRecipe.get(r.id)?.path ?? null,
    photoBlurhash: heroByRecipe.get(r.id)?.blurhash ?? null,
    author: {
      id: r.authorId,
      name: r.authorName ?? null,
      handle: r.authorHandle ?? null,
      image: r.authorImage ?? null,
    },
  }));

  // Pick a cover: explicit -> first recipe hero -> null.
  const cover = c.coverPhotoPath ?? cards.find((r) => r.photoPath)?.photoPath ?? null;

  return {
    collection: {
      id: c.id,
      ownerId: c.ownerId,
      name: c.name,
      slug: c.slug,
      description: c.description ?? null,
      visibility: c.visibility,
      isDefaultSaves: c.isDefaultSaves,
      recipeCount: cards.length,
      coverPhoto: cover,
      ownerHandle: owner.handle ?? null,
    },
    recipes: cards,
  };
}

/**
 * For a logged-in viewer, returns the set of saved-recipe ids and a map
 * of recipeId -> collectionIds the recipe is in. Used by SaveButton.
 */
export async function getSaveStateForRecipe(
  userId: string,
  recipeId: string,
): Promise<{ saved: boolean; collectionIds: string[] }> {
  const saved = !!db
    .select({ recipeId: saves.recipeId })
    .from(saves)
    .where(and(eq(saves.userId, userId), eq(saves.recipeId, recipeId)))
    .get();

  const inCols = db
    .select({ id: collectionRecipes.collectionId })
    .from(collectionRecipes)
    .innerJoin(collections, eq(collections.id, collectionRecipes.collectionId))
    .where(
      and(
        eq(collectionRecipes.recipeId, recipeId),
        eq(collections.ownerId, userId),
      ),
    )
    .all();

  return { saved, collectionIds: inCols.map((c) => c.id) };
}
