"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { recipes, recipeRatings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { notifyRatingForRecipeAuthor } from "@/lib/push/notify";

type ActionResult = { ok: boolean; error?: string };

/**
 * Set or update the signed-in user's rating for a recipe.
 *
 * - `value` must be 1..5 (integer). Halves are intentionally not
 *   supported per the user's design choice.
 * - The recipe author is allowed to rate their own recipe (it's a
 *   private bookmark for them); the public average computation excludes
 *   the author's own row.
 * - Rating a `private` recipe is allowed for the author only.
 */
export async function setRatingAction(
  recipeId: string,
  value: number,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };
  const userId = session.user.id;

  if (!Number.isInteger(value) || value < 1 || value > 5) {
    return { ok: false, error: "Rating must be 1-5." };
  }

  const recipe = db
    .select({
      id: recipes.id,
      authorId: recipes.authorId,
      visibility: recipes.visibility,
    })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .get();
  if (!recipe) return { ok: false, error: "Recipe not found." };
  if (recipe.visibility === "private" && recipe.authorId !== userId) {
    return { ok: false, error: "That recipe is private." };
  }

  const now = new Date();
  const existing = db
    .select({ value: recipeRatings.value })
    .from(recipeRatings)
    .where(
      and(
        eq(recipeRatings.recipeId, recipeId),
        eq(recipeRatings.userId, userId),
      ),
    )
    .get();

  if (existing) {
    db.update(recipeRatings)
      .set({ value, updatedAt: now })
      .where(
        and(
          eq(recipeRatings.recipeId, recipeId),
          eq(recipeRatings.userId, userId),
        ),
      )
      .run();
  } else {
    db.insert(recipeRatings)
      .values({
        recipeId,
        userId,
        value,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  revalidatePath(`/r/${recipeId}`);
  revalidatePath("/feed");

  // Fire-and-forget push to the author. Don't await — the action is
  // user-blocking and pushes can be slow against external endpoints.
  if (recipe.authorId !== userId) {
    void notifyRatingForRecipeAuthor({
      recipeId,
      authorId: recipe.authorId,
      raterId: userId,
      raterName: session.user.name ?? null,
      value,
    });
  }
  return { ok: true };
}

/**
 * Remove the signed-in user's rating for a recipe. No-op if there
 * isn't one.
 */
export async function clearRatingAction(
  recipeId: string,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };

  db.delete(recipeRatings)
    .where(
      and(
        eq(recipeRatings.recipeId, recipeId),
        eq(recipeRatings.userId, session.user.id),
      ),
    )
    .run();

  revalidatePath(`/r/${recipeId}`);
  return { ok: true };
}
