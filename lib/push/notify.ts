import "server-only";

/**
 * Fire-and-forget push notifications fired from server actions when
 * social events happen on a user's recipe (comment, rating, save).
 *
 * All entry points are async + safe to `void`. They swallow their own
 * errors and log to stdout so a flaky push service can never block a
 * user-facing action.
 *
 * The actual web-push wiring lives in `./send.ts`. These helpers exist
 * so callers can import a stable shape regardless of whether VAPID is
 * configured (when it isn't, every call is a no-op).
 */

import { sendPushToUser } from "./send";

type RecipeRef = { recipeId: string };

export async function notifyCommentForRecipeAuthor(args: RecipeRef & {
  authorId: string;
  commenterId: string;
  commenterName: string | null;
  body: string;
  recipeTitle: string;
}): Promise<void> {
  if (args.authorId === args.commenterId) return;
  const who = args.commenterName?.trim() || "Someone";
  await sendPushToUser(args.authorId, {
    title: `${who} commented on ${args.recipeTitle}`,
    body: truncate(args.body, 140),
    url: `/r/${args.recipeId}#comments`,
    tag: `comment:${args.recipeId}`,
  });
}

export async function notifyRatingForRecipeAuthor(args: RecipeRef & {
  authorId: string;
  raterId: string;
  raterName: string | null;
  value: number;
}): Promise<void> {
  if (args.authorId === args.raterId) return;
  const who = args.raterName?.trim() || "Someone";
  const stars = "★".repeat(args.value) + "☆".repeat(5 - args.value);
  await sendPushToUser(args.authorId, {
    title: `${who} rated your recipe`,
    body: stars,
    url: `/r/${args.recipeId}`,
    tag: `rating:${args.recipeId}`,
  });
}

export async function notifySaveForRecipeAuthor(args: RecipeRef & {
  authorId: string;
  saverId: string;
  saverName: string | null;
  recipeTitle: string;
}): Promise<void> {
  if (args.authorId === args.saverId) return;
  const who = args.saverName?.trim() || "Someone";
  await sendPushToUser(args.authorId, {
    title: `${who} saved ${args.recipeTitle}`,
    body: "It's now in their cookbook.",
    url: `/r/${args.recipeId}`,
    tag: `save:${args.recipeId}`,
  });
}

function truncate(s: string, max: number): string {
  const trimmed = s.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}
