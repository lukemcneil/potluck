"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { recipeComments, recipes } from "@/db/schema";
import { auth } from "@/lib/auth";
import { notifyCommentForRecipeAuthor } from "@/lib/push/notify";
import { logEvent } from "@/lib/insights/log";

type ActionResult<T = unknown> = {
  ok: boolean;
  error?: string;
  data?: T;
};

const MIN_LEN = 1;
const MAX_LEN = 2000;

/**
 * Add a comment. Body is trimmed and validated against MIN_LEN /
 * MAX_LEN. Returns the new comment id so the client can scroll-to /
 * highlight it without a full refetch.
 */
export async function addCommentAction(
  recipeId: string,
  body: string,
): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };
  const userId = session.user.id;

  const trimmed = body.trim();
  if (trimmed.length < MIN_LEN) {
    return { ok: false, error: "Say something first." };
  }
  if (trimmed.length > MAX_LEN) {
    return { ok: false, error: `Keep it under ${MAX_LEN} characters.` };
  }

  const recipe = db
    .select({
      id: recipes.id,
      authorId: recipes.authorId,
      title: recipes.title,
      visibility: recipes.visibility,
    })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .get();
  if (!recipe) return { ok: false, error: "Recipe not found." };
  if (recipe.visibility === "private" && recipe.authorId !== userId) {
    return { ok: false, error: "That recipe is private." };
  }

  const id = crypto.randomUUID();
  const now = new Date();
  db.insert(recipeComments)
    .values({
      id,
      recipeId,
      authorId: userId,
      body: trimmed,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  revalidatePath(`/r/${recipeId}`);

  void notifyCommentForRecipeAuthor({
    recipeId,
    authorId: recipe.authorId,
    commenterId: userId,
    commenterName: session.user.name ?? null,
    body: trimmed,
    recipeTitle: recipe.title,
  });

  await logEvent({ kind: "comment.added", userId, recipeId });

  return { ok: true, data: { id } };
}

/**
 * Delete a comment. Allowed for:
 *   - the comment author (any time), and
 *   - the recipe owner (moderation on their own page).
 */
export async function deleteCommentAction(
  commentId: string,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };
  const userId = session.user.id;

  const row = db
    .select({
      id: recipeComments.id,
      recipeId: recipeComments.recipeId,
      authorId: recipeComments.authorId,
    })
    .from(recipeComments)
    .where(eq(recipeComments.id, commentId))
    .get();
  if (!row) return { ok: true };

  const recipe = db
    .select({ authorId: recipes.authorId })
    .from(recipes)
    .where(eq(recipes.id, row.recipeId))
    .get();
  // recipe is required to exist (FK), but be defensive
  const isCommentAuthor = row.authorId === userId;
  const isRecipeOwner = recipe?.authorId === userId;
  if (!isCommentAuthor && !isRecipeOwner) {
    return { ok: false, error: "Not allowed." };
  }

  db.delete(recipeComments).where(eq(recipeComments.id, commentId)).run();
  revalidatePath(`/r/${row.recipeId}`);
  return { ok: true };
}
