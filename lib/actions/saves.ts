"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  collections,
  collectionRecipes,
  recipes,
  saves,
} from "@/db/schema";
import { auth } from "@/lib/auth";

type ActionResult = { ok: boolean; error?: string };

/**
 * Save a recipe (idempotent) into the user's "All Saves" + any specified
 * collections. The flat `saves` table is kept in sync so we can answer
 * "is this saved?" with a single primary-key lookup.
 *
 * - Creates the All Saves collection on the fly if it's missing for some
 *   reason (it should be created at first sign-in).
 * - Does NOT remove the recipe from collections that aren't in
 *   `collectionIds` — use `removeRecipeFromCollectionAction` for that.
 */
export async function saveRecipeAction(
  recipeId: string,
  collectionIds: string[] = [],
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };
  const userId = session.user.id;

  const recipe = db
    .select({ id: recipes.id, visibility: recipes.visibility, authorId: recipes.authorId })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .get();
  if (!recipe) return { ok: false, error: "Recipe not found." };
  if (recipe.visibility === "private" && recipe.authorId !== userId) {
    return { ok: false, error: "That recipe is private." };
  }

  const allSavesId = ensureAllSavesCollection(userId);

  // Validate any user-specified collections are owned by the user.
  const validatedExtras: string[] = [];
  if (collectionIds.length > 0) {
    const owned = db
      .select({ id: collections.id })
      .from(collections)
      .where(
        and(eq(collections.ownerId, userId), inArray(collections.id, collectionIds)),
      )
      .all();
    for (const c of owned) validatedExtras.push(c.id);
  }

  const targets = Array.from(new Set([allSavesId, ...validatedExtras]));

  db.transaction((tx) => {
    tx.insert(saves)
      .values({ userId, recipeId, savedAt: new Date() })
      .onConflictDoNothing()
      .run();

    for (const collectionId of targets) {
      const nextPos =
        tx
          .select({
            n: sql<number>`COALESCE(MAX(${collectionRecipes.position}), -1) + 1`,
          })
          .from(collectionRecipes)
          .where(eq(collectionRecipes.collectionId, collectionId))
          .get()?.n ?? 0;
      tx.insert(collectionRecipes)
        .values({
          collectionId,
          recipeId,
          position: nextPos,
          addedAt: new Date(),
        })
        .onConflictDoNothing()
        .run();
    }
  });

  revalidatePath("/cookbook");
  if (session.user.handle) revalidatePath(`/u/${session.user.handle}`);
  return { ok: true };
}

/**
 * Remove a recipe from saves AND from every collection owned by the
 * current user. This is the "I'm done with this" full-cleanup variant.
 */
export async function unsaveRecipeAction(recipeId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };
  const userId = session.user.id;

  db.transaction((tx) => {
    const owned = tx
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.ownerId, userId))
      .all();
    if (owned.length > 0) {
      tx.delete(collectionRecipes)
        .where(
          and(
            eq(collectionRecipes.recipeId, recipeId),
            inArray(
              collectionRecipes.collectionId,
              owned.map((c) => c.id),
            ),
          ),
        )
        .run();
    }
    tx.delete(saves)
      .where(and(eq(saves.userId, userId), eq(saves.recipeId, recipeId)))
      .run();
  });

  revalidatePath("/cookbook");
  if (session.user.handle) revalidatePath(`/u/${session.user.handle}`);
  return { ok: true };
}

function ensureAllSavesCollection(userId: string): string {
  const existing = db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.ownerId, userId), eq(collections.isDefaultSaves, true)))
    .get();
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  db.insert(collections)
    .values({
      id,
      ownerId: userId,
      name: "All Saves",
      slug: "all-saves",
      visibility: "private",
      isDefaultSaves: true,
      createdAt: new Date(),
    })
    .run();
  return id;
}
