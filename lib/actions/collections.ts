"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { ZodError } from "zod";

import { db } from "@/db/client";
import { collections, collectionRecipes, recipes } from "@/db/schema";
import { auth } from "@/lib/auth";
import { collectionFormSchema, slugify } from "@/lib/validators";

type ActionResult<T = unknown> = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  data?: T;
};

export async function createCollectionAction(input: {
  name: string;
  description?: string | null;
  visibility?: "public" | "unlisted" | "private";
}): Promise<ActionResult<{ id: string; slug: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };

  let parsed;
  try {
    parsed = collectionFormSchema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        ok: false,
        error: "Some fields need attention.",
        fieldErrors: err.flatten().fieldErrors as Record<string, string[]>,
      };
    }
    return { ok: false, error: "Invalid input." };
  }

  const baseSlug = slugify(parsed.name) || "collection";
  const slug = uniqueCollectionSlug(session.user.id, baseSlug);

  const id = crypto.randomUUID();
  db.insert(collections)
    .values({
      id,
      ownerId: session.user.id,
      name: parsed.name,
      slug,
      description: parsed.description ?? null,
      visibility: parsed.visibility,
      isDefaultSaves: false,
      createdAt: new Date(),
    })
    .run();

  if (session.user.handle) {
    revalidatePath(`/u/${session.user.handle}`);
  }
  revalidatePath("/cookbook");

  return { ok: true, data: { id, slug } };
}

export async function updateCollectionAction(
  id: string,
  input: { name?: string; description?: string | null; visibility?: "public" | "unlisted" | "private" },
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };

  const existing = db
    .select()
    .from(collections)
    .where(eq(collections.id, id))
    .get();
  if (!existing) return { ok: false, error: "Not found." };
  if (existing.ownerId !== session.user.id) {
    return { ok: false, error: "Not yours to edit." };
  }
  if (existing.isDefaultSaves && input.name) {
    return { ok: false, error: "The All Saves collection can't be renamed." };
  }

  const updates: Partial<typeof collections.$inferInsert> = {};
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.description !== undefined) updates.description = input.description;
  if (input.visibility !== undefined) updates.visibility = input.visibility;

  if (Object.keys(updates).length === 0) return { ok: true };

  db.update(collections).set(updates).where(eq(collections.id, id)).run();

  if (session.user.handle) revalidatePath(`/u/${session.user.handle}`);
  revalidatePath("/cookbook");
  return { ok: true };
}

export async function deleteCollectionAction(id: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };

  const existing = db
    .select({ ownerId: collections.ownerId, isDefaultSaves: collections.isDefaultSaves })
    .from(collections)
    .where(eq(collections.id, id))
    .get();
  if (!existing) return { ok: false, error: "Not found." };
  if (existing.ownerId !== session.user.id) {
    return { ok: false, error: "Not yours to delete." };
  }
  if (existing.isDefaultSaves) {
    return { ok: false, error: "The All Saves collection can't be deleted." };
  }

  db.delete(collections).where(eq(collections.id, id)).run();
  if (session.user.handle) revalidatePath(`/u/${session.user.handle}`);
  revalidatePath("/cookbook");
  return { ok: true };
}

export async function addRecipeToCollectionAction(
  collectionId: string,
  recipeId: string,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };

  const owns = db
    .select({ id: collections.id })
    .from(collections)
    .where(
      and(eq(collections.id, collectionId), eq(collections.ownerId, session.user.id)),
    )
    .get();
  if (!owns) return { ok: false, error: "Collection not found." };

  const recipeExists = db
    .select({ id: recipes.id, visibility: recipes.visibility, authorId: recipes.authorId })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .get();
  if (!recipeExists) return { ok: false, error: "Recipe not found." };
  if (
    recipeExists.visibility === "private" &&
    recipeExists.authorId !== session.user.id
  ) {
    return { ok: false, error: "That recipe is private." };
  }

  const nextPos =
    db
      .select({
        n: sql<number>`COALESCE(MAX(${collectionRecipes.position}), -1) + 1`,
      })
      .from(collectionRecipes)
      .where(eq(collectionRecipes.collectionId, collectionId))
      .get()?.n ?? 0;

  db.insert(collectionRecipes)
    .values({
      collectionId,
      recipeId,
      position: nextPos,
      addedAt: new Date(),
    })
    .onConflictDoNothing()
    .run();

  if (session.user.handle) revalidatePath(`/u/${session.user.handle}`);
  revalidatePath("/cookbook");
  return { ok: true };
}

export async function removeRecipeFromCollectionAction(
  collectionId: string,
  recipeId: string,
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Sign in required." };

  const owns = db
    .select({ id: collections.id })
    .from(collections)
    .where(
      and(eq(collections.id, collectionId), eq(collections.ownerId, session.user.id)),
    )
    .get();
  if (!owns) return { ok: false, error: "Collection not found." };

  db.delete(collectionRecipes)
    .where(
      and(
        eq(collectionRecipes.collectionId, collectionId),
        eq(collectionRecipes.recipeId, recipeId),
      ),
    )
    .run();

  if (session.user.handle) revalidatePath(`/u/${session.user.handle}`);
  revalidatePath("/cookbook");
  return { ok: true };
}

function uniqueCollectionSlug(ownerId: string, base: string): string {
  let candidate = base;
  for (let i = 1; i <= 50; i += 1) {
    const exists = db
      .select({ id: collections.id })
      .from(collections)
      .where(and(eq(collections.ownerId, ownerId), eq(collections.slug, candidate)))
      .get();
    if (!exists) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}
