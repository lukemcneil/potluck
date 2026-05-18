"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, and, sql } from "drizzle-orm";
import { ZodError } from "zod";

import { db } from "@/db/client";
import {
  recipes,
  recipePhotos,
  recipeIngredients,
  recipeSteps,
  tags,
  recipeTags,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { recipeFormSchema, slugify } from "@/lib/validators";

type State = { error?: string; fieldErrors?: Record<string, string[]> };

export async function createRecipeAction(
  _prev: State,
  formData: FormData,
): Promise<State> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be signed in." };
  }
  const userId = session.user.id;
  const handle = session.user.handle;

  const json = formData.get("payload");
  if (typeof json !== "string") {
    return { error: "Missing form payload." };
  }

  let parsed;
  try {
    parsed = recipeFormSchema.parse(JSON.parse(json));
  } catch (err) {
    if (err instanceof ZodError) {
      const flat = err.flatten();
      return {
        error: "Some fields need attention.",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      };
    }
    return { error: "Invalid form data." };
  }

  const baseSlug = slugify(parsed.title) || "recipe";
  const slug = await uniqueSlugFor(userId, baseSlug);

  const recipeId = crypto.randomUUID();
  const now = new Date();

  db.transaction((tx) => {
    tx.insert(recipes)
      .values({
        id: recipeId,
        authorId: userId,
        title: parsed.title.trim(),
        slug,
        description: parsed.description ?? null,
        notes: parsed.notes ?? null,
        prepMinutes: parsed.prepMinutes ?? null,
        cookMinutes: parsed.cookMinutes ?? null,
        servings: parsed.servings ?? null,
        mealType: parsed.mealType ?? null,
        cuisine: parsed.cuisine ?? null,
        diets: parsed.diets ?? [],
        visibility: parsed.visibility,
        kind: parsed.kind,
        sourceUrl: parsed.sourceUrl ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    if (parsed.ingredients.length) {
      tx.insert(recipeIngredients)
        .values(
          parsed.ingredients.map((ing, i) => ({
            recipeId,
            position: i,
            quantity: ing.quantity ?? null,
            unit: ing.unit ?? null,
            name: ing.name,
            note: ing.note ?? null,
          })),
        )
        .run();
    }

    if (parsed.steps.length) {
      tx.insert(recipeSteps)
        .values(
          parsed.steps.map((s, i) => ({
            recipeId,
            position: i,
            body: s.body,
          })),
        )
        .run();
    }

    if (parsed.photos.length) {
      tx.insert(recipePhotos)
        .values(
          parsed.photos.map((p, i) => ({
            recipeId,
            position: i,
            path: p.path,
            role: p.role,
            createdAt: now,
          })),
        )
        .run();
    }

    if (parsed.tags.length) {
      const cleanTagNames = Array.from(
        new Set(parsed.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
      );
      for (const name of cleanTagNames) {
        const existing = tx
          .select({ id: tags.id })
          .from(tags)
          .where(eq(tags.name, name))
          .get();
        const tagId = existing?.id ?? crypto.randomUUID();
        if (!existing) {
          tx.insert(tags).values({ id: tagId, name }).run();
        }
        tx.insert(recipeTags)
          .values({ recipeId, tagId })
          .onConflictDoNothing()
          .run();
      }
    }
  });

  revalidatePath("/feed");
  if (handle) revalidatePath(`/u/${handle}`);
  // The two path-specific revalidates above invalidate the SERVER
  // cache for /feed and the author's profile, but Next's client
  // router cache (and the BottomTabBar's prefetches) can still serve
  // a previously-rendered /feed when the user taps Home after
  // creating a recipe — so the new recipe doesn't show up until a
  // manual refresh. Invalidating the root layout drops the whole
  // client cache subtree, which is cheap on this app (every page is
  // already force-dynamic) and is the only thing that reliably makes
  // "create recipe → tap Home → see it" work in one shot.
  revalidatePath("/", "layout");
  redirect(`/r/${recipeId}`);
}

async function uniqueSlugFor(authorId: string, base: string): Promise<string> {
  let candidate = base;
  for (let i = 1; i <= 50; i += 1) {
    const existing = db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.authorId, authorId), eq(recipes.slug, candidate)))
      .get();
    if (!existing) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function updateRecipeAction(
  recipeId: string,
  _prev: State,
  formData: FormData,
): Promise<State> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "You must be signed in." };
  }
  const userId = session.user.id;
  const handle = session.user.handle;

  const owned = db
    .select({ id: recipes.id, authorId: recipes.authorId, slug: recipes.slug })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .get();
  if (!owned) return { error: "Recipe not found." };
  if (owned.authorId !== userId) return { error: "Not your recipe." };

  const json = formData.get("payload");
  if (typeof json !== "string") return { error: "Missing form payload." };

  let parsed;
  try {
    parsed = recipeFormSchema.parse(JSON.parse(json));
  } catch (err) {
    if (err instanceof ZodError) {
      const flat = err.flatten();
      return {
        error: "Some fields need attention.",
        fieldErrors: flat.fieldErrors as Record<string, string[]>,
      };
    }
    return { error: "Invalid form data." };
  }

  // Slug is preserved on edit unless the title changes a lot — we don't
  // touch it here to keep the URL stable. (Future: add a "regenerate
  // slug" toggle if a user really wants it.)
  const now = new Date();

  db.transaction((tx) => {
    tx.update(recipes)
      .set({
        title: parsed.title.trim(),
        description: parsed.description ?? null,
        notes: parsed.notes ?? null,
        prepMinutes: parsed.prepMinutes ?? null,
        cookMinutes: parsed.cookMinutes ?? null,
        servings: parsed.servings ?? null,
        mealType: parsed.mealType ?? null,
        cuisine: parsed.cuisine ?? null,
        diets: parsed.diets ?? [],
        visibility: parsed.visibility,
        kind: parsed.kind,
        sourceUrl: parsed.sourceUrl ?? null,
        updatedAt: now,
      })
      .where(eq(recipes.id, recipeId))
      .run();

    // Replace child rows wholesale. SQLite's row count for these tables
    // is tiny (tens), so this is simpler than diffing and the FTS
    // triggers handle re-indexing of ingredients automatically.
    tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId)).run();
    if (parsed.ingredients.length) {
      tx.insert(recipeIngredients)
        .values(
          parsed.ingredients.map((ing, i) => ({
            recipeId,
            position: i,
            quantity: ing.quantity ?? null,
            unit: ing.unit ?? null,
            name: ing.name,
            note: ing.note ?? null,
          })),
        )
        .run();
    }

    tx.delete(recipeSteps).where(eq(recipeSteps.recipeId, recipeId)).run();
    if (parsed.steps.length) {
      tx.insert(recipeSteps)
        .values(
          parsed.steps.map((s, i) => ({
            recipeId,
            position: i,
            body: s.body,
          })),
        )
        .run();
    }

    // Photos are stored on disk, but the form payload sends back the
    // current ordered list of {path, role} pairs (existing + newly
    // uploaded, with any role flips the user made). We replace the
    // recipePhotos rows wholesale; on-disk files are left alone —
    // orphan cleanup is a separate concern.
    tx.delete(recipePhotos).where(eq(recipePhotos.recipeId, recipeId)).run();
    if (parsed.photos.length) {
      tx.insert(recipePhotos)
        .values(
          parsed.photos.map((p, i) => ({
            recipeId,
            position: i,
            path: p.path,
            role: p.role,
            createdAt: now,
          })),
        )
        .run();
    }

    tx.delete(recipeTags).where(eq(recipeTags.recipeId, recipeId)).run();
    if (parsed.tags.length) {
      const cleanTagNames = Array.from(
        new Set(parsed.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
      );
      for (const name of cleanTagNames) {
        const existing = tx
          .select({ id: tags.id })
          .from(tags)
          .where(eq(tags.name, name))
          .get();
        const tagId = existing?.id ?? crypto.randomUUID();
        if (!existing) {
          tx.insert(tags).values({ id: tagId, name }).run();
        }
        tx.insert(recipeTags)
          .values({ recipeId, tagId })
          .onConflictDoNothing()
          .run();
      }
    }
  });

  revalidatePath(`/r/${recipeId}`);
  revalidatePath("/feed");
  if (handle) revalidatePath(`/u/${handle}`);
  // Same router-cache reasoning as createRecipeAction — edits to
  // title/description/photos need to land on the feed card and on
  // any collection thumbnails the next time the user views them.
  revalidatePath("/", "layout");
  redirect(`/r/${recipeId}`);
}

export async function deleteRecipeAction(recipeId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("UNAUTHENTICATED");

  const owned = db
    .select({ authorId: recipes.authorId })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .get();
  if (!owned) return;
  if (owned.authorId !== session.user.id) throw new Error("FORBIDDEN");

  db.delete(recipes).where(eq(recipes.id, recipeId)).run();
  revalidatePath("/feed");
  if (session.user.handle) revalidatePath(`/u/${session.user.handle}`);
  // Same router-cache reasoning as createRecipeAction — a deleted
  // recipe also disappears from saves, collection covers, and any
  // other surface, so drop the whole client cache subtree.
  revalidatePath("/", "layout");
}

// Light read helpers used by detail / profile pages.

export type RecipeDetail = NonNullable<Awaited<ReturnType<typeof getRecipe>>>;

export async function getRecipe(id: string) {
  const recipe = db
    .select()
    .from(recipes)
    .where(eq(recipes.id, id))
    .get();
  if (!recipe) return null;

  const photos = db
    .select()
    .from(recipePhotos)
    .where(eq(recipePhotos.recipeId, id))
    .orderBy(recipePhotos.position)
    .all();

  const ingredients = db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, id))
    .orderBy(recipeIngredients.position)
    .all();

  const steps = db
    .select()
    .from(recipeSteps)
    .where(eq(recipeSteps.recipeId, id))
    .orderBy(recipeSteps.position)
    .all();

  const recipeTagRows = db
    .select({ name: tags.name })
    .from(recipeTags)
    .innerJoin(tags, eq(recipeTags.tagId, tags.id))
    .where(eq(recipeTags.recipeId, id))
    .all();

  return {
    recipe,
    photos,
    ingredients,
    steps,
    tagNames: recipeTagRows.map((t) => t.name),
  };
}

export async function getRecipeCount(authorId: string): Promise<number> {
  const row = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(recipes)
    .where(eq(recipes.authorId, authorId))
    .get();
  return row?.n ?? 0;
}
