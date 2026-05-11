import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { recipeComments, users } from "@/db/schema";

export type RecipeCommentRow = {
  id: string;
  body: string;
  createdAt: Date;
  authorId: string;
  authorName: string | null;
  authorHandle: string | null;
  authorImage: string | null;
};

/**
 * Comments for a recipe, oldest first (so new ones appear at the
 * bottom of the list — matches typical small-social-app pattern).
 */
export function listCommentsForRecipe(
  recipeId: string,
): RecipeCommentRow[] {
  return db
    .select({
      id: recipeComments.id,
      body: recipeComments.body,
      createdAt: recipeComments.createdAt,
      authorId: users.id,
      authorName: users.name,
      authorHandle: users.handle,
      authorImage: users.image,
    })
    .from(recipeComments)
    .innerJoin(users, eq(users.id, recipeComments.authorId))
    .where(eq(recipeComments.recipeId, recipeId))
    .orderBy(recipeComments.createdAt)
    .all();
}

/**
 * Lightweight count for use on cards / metadata strips.
 */
export function countCommentsForRecipe(recipeId: string): number {
  const row = db
    .select({ id: recipeComments.id })
    .from(recipeComments)
    .where(eq(recipeComments.recipeId, recipeId))
    .all();
  return row.length;
}
